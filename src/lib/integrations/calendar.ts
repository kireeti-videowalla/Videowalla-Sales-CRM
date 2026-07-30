import type { Meeting } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { logActivity } from '../activity/log';
import { moveTicketToStage } from '../pipeline/stages';
import { notify } from '../notifications/service';
import { normalizeEmail } from '../normalize';
import { DEFAULT_TIMEZONE, formatInTz } from '../time';
import { googleApiRequest } from './google-oauth';
import { isIntegrationReady, markIntegrationSync, recordIntegrationFailure } from './store';

const log = createLogger('calendar');

const BASE = 'https://www.googleapis.com/calendar/v3';

export type CreateMeetingInput = {
  ticketId: string;
  createdById: string;
  contactEmail: string;
  meetingType: string;
  startsAt: Date;
  durationMinutes: number;
  title?: string;
  notes?: string;
  timezone?: string;
  includeSalesperson?: boolean;
};

export type CreateMeetingResult =
  | { ok: true; meeting: Meeting; externalEventId: string | null; htmlLink: string | null; delivered: boolean }
  | { ok: false; error: string };

type GoogleEvent = {
  id?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; organizer?: boolean }>;
};

/**
 * Creates a Google Calendar invitation from inside a lead ticket.
 *
 * When Calendar is not connected the meeting is still recorded as
 * INVITE_DRAFTED with an explicit message, so the rep is never told an
 * invitation went out when it did not.
 */
export async function createMeetingInvite(input: CreateMeetingInput): Promise<CreateMeetingResult> {
  const ticket = await prisma.leadTicket.findUnique({
    where: { id: input.ticketId },
    include: { company: true, primaryContact: true, assignee: true },
  });
  if (!ticket) return { ok: false, error: 'Ticket not found.' };
  if (ticket.company.doNotContact) return { ok: false, error: 'This company is marked do-not-contact.' };

  const email = normalizeEmail(input.contactEmail);
  if (!email) return { ok: false, error: 'A valid contact email address is required to send an invitation.' };

  const timezone = input.timezone ?? ticket.assignee?.timezone ?? DEFAULT_TIMEZONE;
  const endsAt = new Date(input.startsAt.getTime() + input.durationMinutes * 60_000);

  // Avoid duplicate invitations for the same slot.
  const duplicate = await prisma.meeting.findFirst({
    where: {
      ticketId: ticket.id,
      startsAt: input.startsAt,
      status: { in: ['INVITE_SENT', 'CONFIRMED', 'INVITE_DRAFTED'] },
    },
  });
  if (duplicate) {
    return { ok: false, error: 'An invitation for this company at this time already exists.' };
  }

  const owner = await prisma.user.findFirst({ where: { role: 'OWNER', status: 'ACTIVE' } });

  const attendees = [
    { email, responseStatus: 'needsAction' },
    ...(owner?.email ? [{ email: owner.email }] : []),
    ...(input.includeSalesperson !== false && ticket.assignee?.email ? [{ email: ticket.assignee.email }] : []),
  ].filter((a, i, arr) => arr.findIndex((x) => x.email === a.email) === i);

  const title = input.title ?? `Videowalla × ${ticket.company.name} — ${input.meetingType}`;

  const description = [
    `Company: ${ticket.company.name}`,
    ticket.company.websiteUrl ? `Website: ${ticket.company.websiteUrl}` : '',
    ticket.primaryContact ? `Contact: ${ticket.primaryContact.fullName}${ticket.primaryContact.title ? ` (${ticket.primaryContact.title})` : ''}` : '',
    ticket.company.phone ? `Phone: ${ticket.company.phone}` : '',
    '',
    input.notes ? `Notes from the salesperson:\n${input.notes}` : '',
    '',
    `CRM lead: ${ticket.reference}`,
    `CRM lead ID: ${ticket.id}`,
  ]
    .filter(Boolean)
    .join('\n');

  const meeting = await prisma.meeting.create({
    data: {
      ticketId: ticket.id,
      companyId: ticket.companyId,
      contactId: ticket.primaryContactId,
      createdById: input.createdById,
      sprintId: ticket.sprintId,
      provider: 'GOOGLE_CALENDAR',
      meetingType: input.meetingType,
      title,
      description,
      startsAt: input.startsAt,
      endsAt,
      timezone,
      attendees: attendees as unknown as object,
      status: 'INVITE_DRAFTED',
    },
  });

  if (!(await isIntegrationReady('GOOGLE_CALENDAR'))) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { syncError: 'Google Calendar is not connected — the invitation was drafted but not sent.' },
    });
    return {
      ok: true,
      meeting,
      externalEventId: null,
      htmlLink: null,
      delivered: false,
    };
  }

  try {
    const calendarId = 'primary';
    const event = await googleApiRequest<GoogleEvent>(
      'GOOGLE_CALENDAR',
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all&conferenceDataVersion=1`,
      {
        method: 'POST',
        body: JSON.stringify({
          summary: title,
          description,
          start: { dateTime: input.startsAt.toISOString(), timeZone: timezone },
          end: { dateTime: endsAt.toISOString(), timeZone: timezone },
          attendees,
          // Linking the CRM id here is what makes two-way sync possible later.
          extendedProperties: { private: { videowallaTicketId: ticket.id, videowallaReference: ticket.reference } },
          reminders: { useDefault: true },
        }),
      },
    );

    const updated = await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        externalEventId: event.id ?? null,
        calendarId,
        htmlLink: event.htmlLink ?? null,
        status: 'INVITE_SENT',
        inviteSentAt: new Date(),
        lastSyncedAt: new Date(),
        syncError: null,
      },
    });

    await markIntegrationSync('GOOGLE_CALENDAR');

    await moveTicketToStage({
      ticketId: ticket.id,
      toStageKey: 'meeting_invite_sent',
      userId: input.createdById,
      automated: true,
      data: {
        contactEmail: email,
        meetingType: input.meetingType,
        proposedDate: formatInTz(input.startsAt, timezone),
      },
    });

    await logActivity({
      userId: input.createdById,
      kind: 'MEETING_INVITE_SENT',
      summary: `Sent a ${input.meetingType} invitation to ${ticket.company.name} for ${formatInTz(input.startsAt, timezone)}`,
      ticketId: ticket.id,
      metadata: { meetingId: updated.id, externalEventId: event.id },
    });

    return {
      ok: true,
      meeting: updated,
      externalEventId: event.id ?? null,
      htmlLink: event.htmlLink ?? null,
      delivered: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('failed to create calendar event', { ticketId: ticket.id, message });
    await recordIntegrationFailure('GOOGLE_CALENDAR', 'create_event', message);
    await prisma.meeting.update({ where: { id: meeting.id }, data: { syncError: message.slice(0, 1000) } });
    return { ok: false, error: `Google Calendar rejected the invitation: ${message}` };
  }
}

/**
 * Polls sent invitations and promotes them to Meeting Booked once the contact
 * accepts. Runs on the `calendar.sync` schedule.
 */
export async function syncMeetings(): Promise<{ checked: number; confirmed: number; declined: number }> {
  if (!(await isIntegrationReady('GOOGLE_CALENDAR'))) {
    return { checked: 0, confirmed: 0, declined: 0 };
  }

  const pending = await prisma.meeting.findMany({
    where: {
      provider: 'GOOGLE_CALENDAR',
      externalEventId: { not: null },
      status: { in: ['INVITE_SENT', 'CONFIRMED'] },
      startsAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    include: { ticket: { include: { company: true } } },
    take: 100,
  });

  let confirmed = 0;
  let declined = 0;

  for (const meeting of pending) {
    try {
      const event = await googleApiRequest<GoogleEvent>(
        'GOOGLE_CALENDAR',
        `${BASE}/calendars/${encodeURIComponent(meeting.calendarId ?? 'primary')}/events/${meeting.externalEventId}`,
      );

      if (event.status === 'cancelled') {
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: { status: 'CANCELLED', lastSyncedAt: new Date() },
        });
        continue;
      }

      // The external attendee's response is what determines "booked".
      const guest = event.attendees?.find((a) => !a.organizer && a.email !== undefined);
      const response = guest?.responseStatus;

      if (response === 'accepted' && meeting.status !== 'CONFIRMED') {
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), lastSyncedAt: new Date() },
        });
        await moveTicketToStage({
          ticketId: meeting.ticketId,
          toStageKey: 'meeting_booked',
          userId: meeting.createdById,
          automated: true,
        });
        await logActivity({
          userId: meeting.createdById,
          kind: 'MEETING_BOOKED',
          summary: `${meeting.ticket.company.name} accepted the meeting invitation`,
          ticketId: meeting.ticketId,
        });
        await notify({
          key: 'rep.meeting_response',
          userIds: [meeting.createdById],
          title: 'Meeting accepted',
          body: `${meeting.ticket.company.name} accepted your invitation.`,
          severity: 'SUCCESS',
          linkUrl: `/leads/${meeting.ticketId}`,
          dedupeKey: `meeting-accepted:${meeting.id}`,
        });
        confirmed += 1;
      } else if (response === 'declined') {
        await prisma.meeting.update({
          where: { id: meeting.id },
          data: { status: 'DECLINED', lastSyncedAt: new Date() },
        });
        await notify({
          key: 'rep.meeting_response',
          userIds: [meeting.createdById],
          title: 'Meeting declined',
          body: `${meeting.ticket.company.name} declined the invitation. The ticket needs a new next step.`,
          severity: 'WARNING',
          linkUrl: `/leads/${meeting.ticketId}`,
          dedupeKey: `meeting-declined:${meeting.id}`,
        });
        declined += 1;
      } else {
        await prisma.meeting.update({ where: { id: meeting.id }, data: { lastSyncedAt: new Date() } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { syncError: message.slice(0, 1000), lastSyncedAt: new Date() },
      });
      await recordIntegrationFailure('GOOGLE_CALENDAR', 'sync_event', message);
    }
  }

  await markIntegrationSync('GOOGLE_CALENDAR');
  return { checked: pending.length, confirmed, declined };
}

export async function testCalendarConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const json = await googleApiRequest<{ summary?: string; id?: string }>(
      'GOOGLE_CALENDAR',
      `${BASE}/calendars/primary`,
    );
    return { ok: true, message: `Connected to calendar "${json.summary ?? json.id ?? 'primary'}".` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
