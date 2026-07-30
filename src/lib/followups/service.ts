import type { ContactChannel, FollowUp, FollowUpReasonKind } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { logActivity } from '../activity/log';
import { getSetting } from '../settings/service';
import {
  addBusinessDaysInTz,
  addDaysInTz,
  DEFAULT_TIMEZONE,
  getTzParts,
  zonedTimeToUtc,
} from '../time';

const log = createLogger('followups');

/**
 * Follow-up automation.
 *
 * The product promise is "never silently lose a follow-up": a follow-up is only
 * ever CLOSED by being completed or explicitly cancelled with a reason, and any
 * outstanding follow-up at week's end is carried into the next sprint rather
 * than dropped.
 */

export type CreateFollowUpInput = {
  ticketId: string;
  ownerId?: string | null;
  reasonKind: FollowUpReasonKind;
  reason: string;
  channel?: ContactChannel;
  dueAt?: Date;
  ruleKey?: string;
  attemptNumber?: number;
  note?: string;
  automated?: boolean;
  createdByUserId?: string;
};

/** Normalises a due date to the configured start-of-day hour in the rep's tz. */
async function alignToDueHour(date: Date, timezone: string): Promise<Date> {
  const policy = await getSetting('followups.policy');
  const p = getTzParts(date, timezone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day, hour: policy.dueHourLocal, minute: 0 },
    timezone,
  );
}

export async function createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
  const ticket = await prisma.leadTicket.findUniqueOrThrow({
    where: { id: input.ticketId },
    include: { company: true, assignee: { select: { timezone: true } } },
  });

  if (ticket.company.doNotContact) {
    throw new Error('Cannot create a follow-up for a do-not-contact company.');
  }

  const timezone = ticket.assignee?.timezone ?? DEFAULT_TIMEZONE;
  const dueAt = await alignToDueHour(input.dueAt ?? new Date(), timezone);

  // One open follow-up per ticket. A newer one supersedes the old rather than
  // stacking duplicates in the queue — but the old one is retained, marked
  // SUPERSEDED, so history is never rewritten.
  const open = await prisma.followUp.findMany({
    where: { ticketId: ticket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
  });
  if (open.length > 0) {
    await prisma.followUp.updateMany({
      where: { id: { in: open.map((f) => f.id) } },
      data: { status: 'SUPERSEDED', cancelReason: 'Replaced by a newer follow-up.' },
    });
  }

  const followUp = await prisma.followUp.create({
    data: {
      ticketId: ticket.id,
      ownerId: input.ownerId ?? ticket.assigneeId,
      sprintId: ticket.sprintId,
      dueAt,
      reasonKind: input.reasonKind,
      reason: input.reason.slice(0, 500),
      channel: input.channel ?? 'PHONE',
      ruleKey: input.ruleKey ?? null,
      attemptNumber: input.attemptNumber ?? null,
      note: input.note?.slice(0, 1000) ?? null,
      automated: input.automated ?? true,
    },
  });

  await prisma.leadTicket.update({
    where: { id: ticket.id },
    data: { nextFollowUpAt: dueAt, nextActionLabel: input.reason.slice(0, 200) },
  });

  if (input.createdByUserId) {
    await logActivity({
      userId: input.createdByUserId,
      kind: 'FOLLOW_UP_CREATED',
      summary: `Follow-up set for ${ticket.company.name}: ${input.reason}`,
      ticketId: ticket.id,
      metadata: { dueAt: dueAt.toISOString(), reasonKind: input.reasonKind },
    });
  }

  return followUp;
}

/**
 * Applies the configured follow-up rule for an unanswered attempt.
 * Rules live in the FollowUpRule table so timings are owner-editable.
 */
export async function scheduleRetryForAttempt(params: {
  ticketId: string;
  attemptNumber: number;
  channel: ContactChannel;
  createdByUserId?: string;
}): Promise<FollowUp | null> {
  const policy = await getSetting('followups.policy');
  const rules = await prisma.followUpRule.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
  });

  const rule =
    rules.find((r) => r.attemptNumber === params.attemptNumber) ??
    (params.attemptNumber >= policy.maxAttemptsBeforeLongTerm
      ? rules.find((r) => r.reasonKind === 'LONG_TERM_RETRY')
      : null);

  if (!rule) {
    log.info('no follow-up rule matched attempt', { attemptNumber: params.attemptNumber });
    return null;
  }

  const ticket = await prisma.leadTicket.findUniqueOrThrow({
    where: { id: params.ticketId },
    include: { assignee: { select: { timezone: true } } },
  });
  const timezone = ticket.assignee?.timezone ?? DEFAULT_TIMEZONE;
  const base = new Date();
  const dueAt = rule.delayBusinessDays
    ? addBusinessDaysInTz(base, rule.delayDays, timezone)
    : addDaysInTz(base, rule.delayDays, timezone);

  return createFollowUp({
    ticketId: params.ticketId,
    reasonKind: rule.reasonKind,
    reason: rule.label,
    channel: params.channel,
    dueAt,
    ruleKey: rule.key,
    attemptNumber: params.attemptNumber,
    automated: true,
    createdByUserId: params.createdByUserId,
  });
}

export async function scheduleRuleFollowUp(params: {
  ticketId: string;
  ruleKey: string;
  reasonOverride?: string;
  dueAtOverride?: Date;
  channel?: ContactChannel;
  createdByUserId?: string;
}): Promise<FollowUp | null> {
  const rule = await prisma.followUpRule.findUnique({ where: { key: params.ruleKey } });
  if (!rule || !rule.isActive) return null;

  const ticket = await prisma.leadTicket.findUniqueOrThrow({
    where: { id: params.ticketId },
    include: { assignee: { select: { timezone: true } } },
  });
  const timezone = ticket.assignee?.timezone ?? DEFAULT_TIMEZONE;
  const dueAt =
    params.dueAtOverride ??
    (rule.delayBusinessDays
      ? addBusinessDaysInTz(new Date(), rule.delayDays, timezone)
      : addDaysInTz(new Date(), rule.delayDays, timezone));

  return createFollowUp({
    ticketId: params.ticketId,
    reasonKind: rule.reasonKind,
    reason: params.reasonOverride ?? rule.label,
    channel: params.channel ?? 'PHONE',
    dueAt,
    ruleKey: rule.key,
    automated: true,
    createdByUserId: params.createdByUserId,
  });
}

export async function completeFollowUp(
  followUpId: string,
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const followUp = await prisma.followUp.findUnique({
    where: { id: followUpId },
    include: { ticket: { include: { company: true } } },
  });
  if (!followUp) return { ok: false, error: 'Follow-up not found.' };
  if (followUp.status === 'COMPLETED') return { ok: true };

  await prisma.followUp.update({
    where: { id: followUpId },
    data: { status: 'COMPLETED', completedAt: new Date(), completedById: userId },
  });

  const stillOpen = await prisma.followUp.findFirst({
    where: { ticketId: followUp.ticketId, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
    orderBy: { dueAt: 'asc' },
  });
  await prisma.leadTicket.update({
    where: { id: followUp.ticketId },
    data: { nextFollowUpAt: stillOpen?.dueAt ?? null },
  });

  await logActivity({
    userId,
    kind: 'FOLLOW_UP_COMPLETED',
    summary: `Completed follow-up for ${followUp.ticket.company.name}`,
    ticketId: followUp.ticketId,
  });

  return { ok: true };
}

export async function cancelFollowUp(
  followUpId: string,
  reason: string,
  userId: string,
): Promise<void> {
  await prisma.followUp.update({
    where: { id: followUpId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason.slice(0, 300) },
  });
  const followUp = await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } });
  await logActivity({
    userId,
    kind: 'FOLLOW_UP_COMPLETED',
    summary: `Cancelled follow-up: ${reason}`,
    ticketId: followUp.ticketId,
  });
}

/**
 * Moves SCHEDULED → DUE → OVERDUE. Run frequently by the `followups.sweep` job
 * so the rep's queue and the owner's alerts reflect reality without anyone
 * refreshing a browser.
 */
export async function sweepFollowUps(now = new Date()): Promise<{ due: number; overdue: number }> {
  const dueResult = await prisma.followUp.updateMany({
    where: { status: 'SCHEDULED', dueAt: { lte: now } },
    data: { status: 'DUE' },
  });

  // Overdue once a full day past due.
  const overdueResult = await prisma.followUp.updateMany({
    where: { status: 'DUE', dueAt: { lt: new Date(now.getTime() - 86_400_000) } },
    data: { status: 'OVERDUE' },
  });

  return { due: dueResult.count, overdue: overdueResult.count };
}

export type FollowUpQueueItem = Awaited<ReturnType<typeof listFollowUps>>[number];

export async function listFollowUps(params: {
  userId?: string;
  statuses?: FollowUp['status'][];
  limit?: number;
  dueBefore?: Date;
}) {
  return prisma.followUp.findMany({
    where: {
      ...(params.userId ? { ownerId: params.userId } : {}),
      status: { in: params.statuses ?? ['SCHEDULED', 'DUE', 'OVERDUE'] },
      ...(params.dueBefore ? { dueAt: { lte: params.dueBefore } } : {}),
      // A do-not-contact company can never appear in a follow-up queue.
      ticket: { company: { doNotContact: false } },
    },
    orderBy: [{ dueAt: 'asc' }],
    take: params.limit ?? 100,
    include: {
      ticket: {
        include: {
          company: { select: { id: true, name: true, city: true, phone: true } },
          primaryContact: { select: { fullName: true, phone: true, title: true } },
          stage: { select: { key: true, name: true, color: true } },
        },
      },
    },
  });
}

export async function outstandingFollowUpCount(userId: string): Promise<number> {
  return prisma.followUp.count({
    where: {
      ownerId: userId,
      status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] },
      ticket: { company: { doNotContact: false } },
    },
  });
}
