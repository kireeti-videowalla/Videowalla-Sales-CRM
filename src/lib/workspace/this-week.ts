import { prisma } from '../db';
import { getShiftSnapshot, weeklyHours } from '../shifts/service';
import { computeScorecard } from '../sprint/scorecard';
import { DEFAULT_TIMEZONE, endOfWeekInTz, startOfWeekInTz } from '../time';

/**
 * Everything the salesperson's "This Week" page needs, in one query pass.
 *
 * The brief's requirement is that when she opens the app her work is already
 * prepared — so this returns the whole workspace, including the prioritised
 * call queue, rather than making the page assemble it.
 */
export async function getThisWeek(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const now = new Date();
  const weekStart = startOfWeekInTz(now, tz);
  const weekEnd = endOfWeekInTz(now, tz);

  const sprint = await prisma.weeklySprint.findFirst({
    where: { userId, weekStart: { lte: now }, weekEnd: { gte: now } },
    include: { targets: { orderBy: { position: 'asc' } } },
  });

  const shift = await getShiftSnapshot(userId);
  const hours = await weeklyHours(userId, weekStart, weekEnd);

  const scorecard = sprint ? await computeScorecard(sprint.id) : null;

  const previousScorecard = await prisma.weeklyScorecard.findFirst({
    where: { userId, isFrozen: true },
    orderBy: { createdAt: 'desc' },
    include: { sprint: { select: { label: true } } },
  });

  // Priority queue: overdue and due follow-ups first (commitments), then
  // interested leads, then new leads by score. This ordering is the product —
  // she works top-down and never has to decide who to call next.
  const followUpQueue = await prisma.followUp.findMany({
    where: {
      ownerId: userId,
      status: { in: ['OVERDUE', 'DUE'] },
      ticket: { company: { doNotContact: false }, closedAt: null },
    },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    take: 25,
    include: {
      ticket: {
        include: {
          company: { select: { id: true, name: true, city: true, phone: true } },
          primaryContact: { select: { fullName: true, phone: true, title: true } },
          stage: { select: { key: true, name: true, color: true } },
          opportunity: { select: { headline: true, suggestedOpening: true } },
        },
      },
    },
  });

  const newLeadQueue = sprint
    ? await prisma.leadTicket.findMany({
        where: {
          assigneeId: userId,
          sprintId: sprint.id,
          closedAt: null,
          attemptCount: 0,
          stage: { key: 'ready_to_contact' },
          company: { doNotContact: false },
        },
        orderBy: [{ queuePosition: 'asc' }, { score: 'desc' }],
        take: 30,
        include: {
          company: { select: { id: true, name: true, city: true, phone: true, industryLabel: true } },
          primaryContact: { select: { fullName: true, phone: true, title: true } },
          stage: { select: { key: true, name: true, color: true } },
          opportunity: { select: { headline: true, suggestedOpening: true, recommendedService: true } },
        },
      })
    : [];

  const interestedQueue = await prisma.leadTicket.findMany({
    where: { assigneeId: userId, stage: { key: 'interested' }, closedAt: null },
    orderBy: { updatedAt: 'asc' },
    take: 10,
    include: {
      company: { select: { id: true, name: true, phone: true } },
      primaryContact: { select: { fullName: true, phone: true } },
      stage: { select: { key: true, name: true, color: true } },
      opportunity: { select: { headline: true } },
    },
  });

  const overdueCount = await prisma.followUp.count({
    where: { ownerId: userId, status: 'OVERDUE', ticket: { company: { doNotContact: false } } },
  });

  const targetFor = (key: string) => sprint?.targets.find((t) => t.key === key)?.target ?? 0;

  return {
    user,
    timezone: tz,
    weekStart,
    weekEnd,
    sprint,
    shift,
    hours,
    scorecard,
    previousScorecard,
    targets: {
      totalContacts: targetFor('TOTAL_CONTACTS'),
      newContacts: targetFor('NEW_CONTACTS'),
      followUps: targetFor('FOLLOW_UPS'),
      conversations: targetFor('CONVERSATIONS'),
      interested: targetFor('INTERESTED'),
      meetings: targetFor('MEETINGS'),
    },
    queues: { followUpQueue, newLeadQueue, interestedQueue },
    overdueCount,
  };
}

export type ThisWeekData = Awaited<ReturnType<typeof getThisWeek>>;
