import { prisma } from '../db';
import { computeActiveSeconds } from '../shifts/service';
import { computeScorecard } from '../sprint/scorecard';
import {
  DEFAULT_TIMEZONE,
  endOfMonthInTz,
  endOfWeekInTz,
  secondsToHours,
  startOfDayInTz,
  startOfMonthInTz,
  startOfWeekInTz,
} from '../time';

/**
 * Everything the owner needs to answer "is this working?" in about ten seconds.
 */
export async function getOwnerOverview(timezone = DEFAULT_TIMEZONE) {
  const now = new Date();
  const weekStart = startOfWeekInTz(now, timezone);
  const weekEnd = endOfWeekInTz(now, timezone);
  const dayStart = startOfDayInTz(now, timezone);
  const monthStart = startOfMonthInTz(now, timezone);
  const monthEnd = endOfMonthInTz(now, timezone);

  const reps = await prisma.user.findMany({
    where: { role: 'SALES_REP', status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  const repSummaries = await Promise.all(
    reps.map(async (rep) => {
      const openShift = await prisma.shift.findFirst({
        where: { userId: rep.id, status: { in: ['ACTIVE', 'PAUSED'] } },
        orderBy: { startedAt: 'desc' },
      });

      const sprint = await prisma.weeklySprint.findFirst({
        where: { userId: rep.id, weekStart: { lte: now }, weekEnd: { gte: now } },
        include: { targets: { orderBy: { position: 'asc' } } },
      });

      const shifts = await prisma.shift.findMany({
        where: { userId: rep.id, startedAt: { gte: weekStart, lte: weekEnd } },
      });
      let activeSeconds = 0;
      let elapsedSeconds = 0;
      for (const s of shifts) {
        activeSeconds += computeActiveSeconds(s, now);
        elapsedSeconds += Math.max(0, Math.floor(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 1000));
      }

      const scorecard = sprint ? await computeScorecard(sprint.id) : null;

      const previous = await prisma.weeklyScorecard.findMany({
        where: { userId: rep.id, isFrozen: true },
        orderBy: { createdAt: 'desc' },
        take: 4,
        include: { sprint: { select: { label: true } } },
      });

      const contactsToday = await prisma.contactAttempt.count({
        where: { userId: rep.id, createdAt: { gte: dayStart } },
      });

      const lastActivity = await prisma.activityEvent.findFirst({
        where: { userId: rep.id },
        orderBy: { occurredAt: 'desc' },
        include: { ticket: { select: { id: true, company: { select: { name: true } } } } },
      });

      const overdueFollowUps = await prisma.followUp.count({
        where: { ownerId: rep.id, status: 'OVERDUE', ticket: { company: { doNotContact: false } } },
      });

      const unfinished = sprint
        ? await prisma.leadTicket.count({
            where: { sprintId: sprint.id, attemptCount: 0, stage: { key: 'ready_to_contact' } },
          })
        : 0;

      // Month-to-date rollup across whatever weeks have been recorded.
      const monthCards = await prisma.weeklyScorecard.findMany({
        where: { userId: rep.id, sprint: { weekStart: { gte: monthStart, lte: monthEnd } } },
      });
      const monthly = monthCards.reduce(
        (acc, c) => ({
          contacts: acc.contacts + c.contactsCompleted,
          conversations: acc.conversations + c.conversations,
          meetings: acc.meetings + c.meetingsBooked,
          hours: acc.hours + c.completedHours,
          costCents: acc.costCents + c.salespersonCostCents,
        }),
        { contacts: 0, conversations: 0, meetings: 0, hours: 0, costCents: 0 },
      );

      return {
        rep,
        openShift,
        isWorking: openShift?.status === 'ACTIVE',
        isPaused: openShift?.status === 'PAUSED',
        currentShiftSeconds: openShift ? computeActiveSeconds(openShift, now) : 0,
        completedHours: secondsToHours(elapsedSeconds),
        activeHours: secondsToHours(activeSeconds),
        scheduledHours: sprint?.availableHours ?? 0,
        sprint,
        scorecard,
        previousScorecards: previous,
        contactsToday,
        lastActivity,
        overdueFollowUps,
        unfinished,
        monthly,
      };
    }),
  );

  const newQualifiedLeads = await prisma.leadTicket.count({
    where: { stage: { key: 'ready_to_contact' }, createdAt: { gte: weekStart } },
  });
  const reviewQueueCount = await prisma.leadTicket.count({
    where: { stage: { key: 'review_required' }, closedAt: null },
  });
  const pendingApproval = await prisma.weeklySprint.count({ where: { status: 'PENDING_APPROVAL' } });
  const integrationErrors = await prisma.integrationConfig.count({ where: { status: 'ERROR' } });
  const deadJobs = await prisma.job.count({ where: { status: 'DEAD' } });

  return {
    now,
    timezone,
    weekStart,
    weekEnd,
    reps: repSummaries,
    newQualifiedLeads,
    reviewQueueCount,
    pendingApproval,
    integrationErrors,
    deadJobs,
  };
}

export type OwnerOverview = Awaited<ReturnType<typeof getOwnerOverview>>;
