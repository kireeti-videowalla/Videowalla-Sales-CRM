import type { ContactChannel, ContactVerification } from '@prisma/client';
import { prisma } from '../db';
import { logActivity } from '../activity/log';
import { getOpenShift } from '../shifts/service';
import { moveTicketToStage, type StageFormData } from './stages';
import { notify } from '../notifications/service';
import { getSetting } from '../settings/service';

/**
 * Recording a contact attempt is the salesperson's single most common action,
 * so it is deliberately one call: pick an outcome, add a note, done. Everything
 * else — attempt counting, stage movement, follow-up scheduling, activity
 * logging, owner alerts — happens automatically behind it.
 */

export type LogAttemptInput = {
  ticketId: string;
  userId: string;
  outcomeKey: string;
  channel?: ContactChannel;
  note?: string;
  /** Extra fields the target stage requires (conversation summary, etc). */
  stageData?: StageFormData;
  /** Present only when a calling/email integration reported the event. */
  provider?: { name: string; eventId: string; durationSeconds?: number; answered?: boolean } | null;
};

export type LogAttemptResult =
  | { ok: true; attemptId: string; movedToStage: string | null; missing?: never }
  | { ok: false; error: string; missing?: string[] };

export async function logContactAttempt(input: LogAttemptInput): Promise<LogAttemptResult> {
  const ticket = await prisma.leadTicket.findUnique({
    where: { id: input.ticketId },
    include: { company: true, primaryContact: true, stage: true },
  });
  if (!ticket) return { ok: false, error: 'Ticket not found.' };
  if (ticket.company.doNotContact) {
    return { ok: false, error: 'This company is marked do-not-contact.' };
  }

  const outcome = await prisma.contactOutcomeType.findUnique({ where: { key: input.outcomeKey } });
  if (!outcome || !outcome.isActive) return { ok: false, error: 'Unknown contact outcome.' };

  if (outcome.requiresNote && !input.note?.trim()) {
    return { ok: false, error: `A note is required when the outcome is "${outcome.label}".` };
  }

  const shift = await getOpenShift(input.userId);
  const attemptNumber = ticket.attemptCount + 1;
  const now = new Date();

  // Verified vs manually reported is never blurred: only a provider-reported
  // event counts as verified, and the distinction is stored, displayed and
  // reported on separately.
  const verification: ContactVerification = input.provider
    ? 'VERIFIED_BY_INTEGRATION'
    : 'MANUALLY_REPORTED';

  const answered =
    input.provider?.answered ?? ['connected', 'interested', 'follow_up_later', 'not_interested', 'gatekeeper', 'meeting_invite_sent', 'meeting_booked'].includes(outcome.key);

  const attempt = await prisma.contactAttempt.create({
    data: {
      ticketId: ticket.id,
      contactId: ticket.primaryContactId,
      userId: input.userId,
      shiftId: shift?.id ?? null,
      sprintId: ticket.sprintId,
      channel: input.channel ?? 'PHONE',
      outcomeId: outcome.id,
      outcomeKey: outcome.key,
      attemptNumber,
      verification,
      answered,
      isConversation: outcome.countsAsConversation,
      durationSeconds: input.provider?.durationSeconds ?? null,
      providerEventId: input.provider?.eventId ?? null,
      providerName: input.provider?.name ?? null,
      startedAt: now,
      endedAt: input.provider?.durationSeconds
        ? new Date(now.getTime() + input.provider.durationSeconds * 1000)
        : null,
      note: input.note?.trim().slice(0, 2000) ?? null,
    },
  });

  await prisma.leadTicket.update({
    where: { id: ticket.id },
    data: {
      attemptCount: attemptNumber,
      lastAttemptAt: now,
      lastOutcomeKey: outcome.key,
      connectedCount: outcome.countsAsConversation ? { increment: 1 } : undefined,
    },
  });

  await logActivity({
    userId: input.userId,
    kind: 'CONTACT_ATTEMPT_LOGGED',
    summary: `${ticket.company.name}: ${outcome.label} (attempt ${attemptNumber}, ${
      verification === 'VERIFIED_BY_INTEGRATION' ? 'verified' : 'manually reported'
    })`,
    ticketId: ticket.id,
    shiftId: shift?.id,
    metadata: { outcome: outcome.key, attemptNumber, verification, channel: input.channel ?? 'PHONE' },
  });

  // Completing a due follow-up is implicit in making the contact.
  const openFollowUp = await prisma.followUp.findFirst({
    where: { ticketId: ticket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
    orderBy: { dueAt: 'asc' },
  });
  if (openFollowUp) {
    await prisma.followUp.update({
      where: { id: openFollowUp.id },
      data: { status: 'COMPLETED', completedAt: now, completedById: input.userId },
    });
    await prisma.contactAttempt.update({ where: { id: attempt.id }, data: { followUpId: openFollowUp.id } });
    await logActivity({
      userId: input.userId,
      kind: 'FOLLOW_UP_COMPLETED',
      summary: `Completed follow-up for ${ticket.company.name}`,
      ticketId: ticket.id,
      shiftId: shift?.id,
    });
  }

  let movedToStage: string | null = null;
  if (outcome.targetStageKey) {
    const move = await moveTicketToStage({
      ticketId: ticket.id,
      toStageKey: outcome.targetStageKey,
      userId: input.userId,
      automated: true,
      note: input.note,
      data: {
        contactMethod: input.channel ?? 'PHONE',
        attemptNumber,
        ...(input.stageData ?? {}),
      },
    });
    if (!move.ok) {
      // The attempt itself is already recorded and must not be rolled back;
      // report what the stage still needs so the rep can complete it.
      return { ok: false, error: move.error, missing: move.missing };
    }
    movedToStage = outcome.targetStageKey;
  }

  const policy = await getSetting('notifications.policy');
  if (outcome.key === 'meeting_invite_sent' && policy.alertOnMeetingBooked) {
    await notify({
      key: 'meeting.invite_sent',
      roles: ['OWNER'],
      title: 'Meeting invite sent',
      body: `An invitation was sent to ${ticket.company.name}.`,
      severity: 'INFO',
      linkUrl: `/leads/${ticket.id}`,
      dedupeKey: `invite:${ticket.id}:${attemptNumber}`,
    });
  }

  return { ok: true, attemptId: attempt.id, movedToStage };
}

export async function listOutcomes() {
  return prisma.contactOutcomeType.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } });
}
