'use server';

import { revalidatePath } from 'next/cache';
import type { ContactChannel } from '@prisma/client';
import { authorize } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { safeErrorMessage } from '@/lib/logger';
import { logActivity } from '@/lib/activity/log';
import { logContactAttempt } from '@/lib/pipeline/contact-attempts';
import { moveTicketToStage, type StageFormData } from '@/lib/pipeline/stages';
import { createFollowUp, completeFollowUp } from '@/lib/followups/service';
import { decideReview } from '@/lib/pipeline/review';
import { createMeetingInvite } from '@/lib/integrations/calendar';
import { can } from '@/lib/auth/rbac';

export type ActionState = { error: string | null; ok?: boolean; message?: string; missing?: string[] };

function refresh(ticketId?: string) {
  if (ticketId) revalidatePath(`/leads/${ticketId}`);
  revalidatePath('/this-week');
  revalidatePath('/call-queue');
  revalidatePath('/pipeline');
  revalidatePath('/follow-ups');
  revalidatePath('/overview');
  revalidatePath('/live-activity');
}

/**
 * A sales rep may only act on tickets assigned to them. Ownership is checked
 * server-side on every mutation — the UI never being shown a button is not a
 * substitute for this.
 */
async function assertTicketAccess(ticketId: string, userId: string, role: string): Promise<string | null> {
  const ticket = await prisma.leadTicket.findUnique({
    where: { id: ticketId },
    select: { assigneeId: true },
  });
  if (!ticket) return 'Ticket not found.';
  if (role === 'OWNER') return null;
  if (role === 'MANAGER') return 'Managers have view-only access.';
  if (ticket.assigneeId !== userId) return 'This lead is not assigned to you.';
  return null;
}

export async function recordOutcomeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize('contact.log_attempt');
    const ticketId = String(formData.get('ticketId') ?? '');
    const denied = await assertTicketAccess(ticketId, user.id, user.role);
    if (denied) return { error: denied };

    const outcomeKey = String(formData.get('outcomeKey') ?? '');
    if (!outcomeKey) return { error: 'Choose an outcome.' };

    const stageData: StageFormData = {};
    for (const [key, value] of formData.entries()) {
      if (['ticketId', 'outcomeKey', 'channel', 'note'].includes(key)) continue;
      stageData[key] = typeof value === 'string' ? value : null;
    }

    const result = await logContactAttempt({
      ticketId,
      userId: user.id,
      outcomeKey,
      channel: (String(formData.get('channel') ?? 'PHONE') as ContactChannel) || 'PHONE',
      note: String(formData.get('note') ?? '').trim() || undefined,
      stageData,
    });

    refresh(ticketId);
    if (!result.ok) return { error: result.error, missing: result.missing };
    return { error: null, ok: true, message: 'Outcome recorded.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function moveStageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize('leads.move_stage');
    const ticketId = String(formData.get('ticketId') ?? '');
    const denied = await assertTicketAccess(ticketId, user.id, user.role);
    if (denied) return { error: denied };

    const toStageKey = String(formData.get('toStageKey') ?? '');
    const data: StageFormData = {};
    for (const [key, value] of formData.entries()) {
      if (['ticketId', 'toStageKey', 'note'].includes(key)) continue;
      data[key] = typeof value === 'string' ? value : null;
    }

    const result = await moveTicketToStage({
      ticketId,
      toStageKey,
      userId: user.id,
      data,
      note: String(formData.get('note') ?? '').trim() || undefined,
    });

    refresh(ticketId);
    if (!result.ok) return { error: result.error, missing: result.missing };
    return { error: null, ok: true, message: 'Ticket moved.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** Used by the Kanban board's drag-and-drop. */
export async function moveTicketQuickAction(
  ticketId: string,
  toStageKey: string,
): Promise<ActionState> {
  try {
    const user = await authorize('leads.move_stage');
    const denied = await assertTicketAccess(ticketId, user.id, user.role);
    if (denied) return { error: denied };

    const result = await moveTicketToStage({ ticketId, toStageKey, userId: user.id });
    refresh(ticketId);
    if (!result.ok) {
      // Stages with required fields cannot be entered by drag alone; send the
      // user to the ticket where the form can collect them.
      return { error: result.error, missing: result.missing };
    }
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize('notes.create');
    const ticketId = String(formData.get('ticketId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return { error: 'Write something first.' };

    const ticket = await prisma.leadTicket.findUnique({
      where: { id: ticketId },
      select: { companyId: true, assigneeId: true, company: { select: { name: true } } },
    });
    if (!ticket) return { error: 'Ticket not found.' };
    // Owners can comment on any ticket; reps only on their own.
    if (user.role === 'SALES_REP' && ticket.assigneeId !== user.id) {
      return { error: 'This lead is not assigned to you.' };
    }

    await prisma.note.create({
      data: {
        ticketId,
        companyId: ticket.companyId,
        userId: user.id,
        body,
        kind: user.role === 'OWNER' ? 'OWNER_COMMENT' : 'NOTE',
      },
    });
    await logActivity({
      userId: user.id,
      kind: 'NOTE_ADDED',
      summary: `Added a note on ${ticket.company.name}`,
      ticketId,
    });

    refresh(ticketId);
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function editNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize('notes.edit_own');
    const noteId = String(formData.get('noteId') ?? '');
    const body = String(formData.get('body') ?? '').trim();
    if (!body) return { error: 'A note cannot be empty.' };

    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) return { error: 'Note not found.' };
    if (note.userId !== user.id && user.role !== 'OWNER') {
      return { error: 'You can only edit your own notes.' };
    }

    // The previous text is preserved forever — a rep may correct a note but
    // cannot erase what it originally said.
    await prisma.$transaction([
      prisma.noteRevision.create({
        data: { noteId, previousBody: note.body, editedById: user.id },
      }),
      prisma.note.update({ where: { id: noteId }, data: { body } }),
    ]);

    await logActivity({
      userId: user.id,
      kind: 'NOTE_EDITED',
      summary: 'Edited a note (previous version retained)',
      ticketId: note.ticketId,
    });

    refresh(note.ticketId ?? undefined);
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function createFollowUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize('followups.create');
    const ticketId = String(formData.get('ticketId') ?? '');
    const denied = await assertTicketAccess(ticketId, user.id, user.role);
    if (denied) return { error: denied };

    const dueAtRaw = String(formData.get('dueAt') ?? '');
    const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return { error: 'Choose a valid follow-up date.' };

    const reason = String(formData.get('reason') ?? '').trim();
    if (!reason) return { error: 'Say what the follow-up is for.' };

    await createFollowUp({
      ticketId,
      reasonKind: 'MANUAL',
      reason,
      channel: (String(formData.get('channel') ?? 'PHONE') as ContactChannel) || 'PHONE',
      dueAt,
      note: String(formData.get('note') ?? '').trim() || undefined,
      automated: false,
      createdByUserId: user.id,
    });

    refresh(ticketId);
    return { error: null, ok: true, message: 'Follow-up scheduled.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function completeFollowUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize('followups.complete');
    const followUpId = String(formData.get('followUpId') ?? '');
    const result = await completeFollowUp(followUpId, user.id);
    refresh();
    return result.ok ? { error: null, ok: true } : { error: result.error ?? 'Could not complete.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function createMeetingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize('meetings.create');
    const ticketId = String(formData.get('ticketId') ?? '');
    const denied = await assertTicketAccess(ticketId, user.id, user.role);
    if (denied) return { error: denied };

    const startsAtRaw = String(formData.get('startsAt') ?? '');
    const startsAt = startsAtRaw ? new Date(startsAtRaw) : null;
    if (!startsAt || Number.isNaN(startsAt.getTime())) return { error: 'Choose a valid date and time.' };
    if (startsAt < new Date()) return { error: 'The meeting time is in the past.' };

    const result = await createMeetingInvite({
      ticketId,
      createdById: user.id,
      contactEmail: String(formData.get('contactEmail') ?? ''),
      meetingType: String(formData.get('meetingType') ?? 'Discovery call'),
      startsAt,
      durationMinutes: Number(formData.get('durationMinutes') ?? 30) || 30,
      notes: String(formData.get('notes') ?? '').trim() || undefined,
    });

    refresh(ticketId);
    if (!result.ok) return { error: result.error };

    return {
      error: null,
      ok: true,
      // Honest about what actually happened: drafted vs actually delivered.
      message: result.delivered
        ? 'Google Calendar invitation sent.'
        : 'Invitation saved, but Google Calendar is not connected so nothing was sent. Ask the owner to connect it in Settings → Integrations.',
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function reviewDecisionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize('leads.assign');
    if (!can(user.role, 'leads.assign')) return { error: 'Only the owner can approve leads.' };

    const result = await decideReview({
      ticketId: String(formData.get('ticketId') ?? ''),
      decision: String(formData.get('decision') ?? '') === 'DISQUALIFY' ? 'DISQUALIFY' : 'APPROVE',
      userId: user.id,
      reason: String(formData.get('reason') ?? '').trim() || undefined,
    });

    refresh(String(formData.get('ticketId') ?? ''));
    return result.ok ? { error: null, ok: true } : { error: result.error ?? 'Could not apply the decision.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function assignTicketAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const user = await authorize('leads.assign');
    const ticketId = String(formData.get('ticketId') ?? '');
    const assigneeId = String(formData.get('assigneeId') ?? '') || null;

    const ticket = await prisma.leadTicket.findUnique({
      where: { id: ticketId },
      include: { company: { select: { name: true } } },
    });
    if (!ticket) return { error: 'Ticket not found.' };

    const sprint = assigneeId
      ? await prisma.weeklySprint.findFirst({
          where: {
            userId: assigneeId,
            status: { in: ['APPROVED', 'ACTIVE', 'PENDING_APPROVAL'] },
            weekEnd: { gte: new Date() },
          },
          orderBy: { weekStart: 'asc' },
        })
      : null;

    await prisma.leadTicket.update({
      where: { id: ticketId },
      data: { assigneeId, sprintId: sprint?.id ?? ticket.sprintId },
    });
    await prisma.followUp.updateMany({
      where: { ticketId, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
      data: { ownerId: assigneeId, sprintId: sprint?.id ?? ticket.sprintId },
    });

    await logActivity({
      userId: user.id,
      kind: 'LEAD_ASSIGNED',
      summary: assigneeId
        ? `Assigned ${ticket.company.name} to a salesperson`
        : `Unassigned ${ticket.company.name}`,
      ticketId,
    });

    refresh(ticketId);
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** Records that the rep actually opened and read the ticket. */
export async function markLeadOpenedAction(ticketId: string): Promise<void> {
  try {
    const user = await authorize('leads.view.assigned');
    const ticket = await prisma.leadTicket.findUnique({
      where: { id: ticketId },
      select: { company: { select: { name: true } } },
    });
    if (!ticket) return;

    // One LEAD_OPENED event per ticket per shift keeps the activity log
    // meaningful instead of one row per page refresh.
    const shift = await prisma.shift.findFirst({
      where: { userId: user.id, status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true },
    });
    if (shift) {
      const already = await prisma.activityEvent.findFirst({
        where: { shiftId: shift.id, ticketId, kind: 'LEAD_OPENED' },
      });
      if (already) return;
    }

    await logActivity({
      userId: user.id,
      kind: 'LEAD_OPENED',
      summary: `Opened ${ticket.company.name}`,
      ticketId,
    });
  } catch {
    // Activity logging must never break the page render.
  }
}
