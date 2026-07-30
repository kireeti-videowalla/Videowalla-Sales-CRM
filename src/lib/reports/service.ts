import type { Prisma, ReportKind } from '@prisma/client';
import { prisma } from '../db';
import { computeActiveSeconds } from '../shifts/service';
import { computeScorecard } from '../sprint/scorecard';
import {
  DEFAULT_TIMEZONE,
  endOfMonthInTz,
  formatInTz,
  secondsToHours,
  startOfMonthInTz,
} from '../time';

/**
 * Reporting. Every number traces to a stored event.
 *
 * Where a figure cannot be honestly computed — revenue with no linked deal,
 * ROI with no compensation configured — the report returns null and the UI says
 * so, rather than printing a zero that reads like a fact.
 */

export type ShiftReport = {
  shiftId: string;
  plannedStartAt: string | null;
  plannedHours: number | null;
  actualStartAt: string;
  actualEndAt: string | null;
  activeHours: number;
  inactiveHours: number;
  startedLateMinutes: number | null;
  contactsCompleted: number;
  verifiedContacts: number;
  manualContacts: number;
  followUpsCompleted: number;
  conversations: number;
  interestedLeads: number;
  meetingsCreated: number;
  notesWritten: number;
  missingNotes: number;
  ticketsOpened: number;
};

export async function buildShiftReport(shiftId: string): Promise<ShiftReport> {
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  const now = new Date();
  const activeSeconds = computeActiveSeconds(shift, now);
  const end = shift.endedAt ?? now;
  const elapsedSeconds = Math.max(0, Math.floor((end.getTime() - shift.startedAt.getTime()) / 1000));

  const attempts = await prisma.contactAttempt.findMany({
    where: { shiftId },
    include: { outcome: { select: { countsAsContact: true, countsAsConversation: true, requiresNote: true } } },
  });
  const counted = attempts.filter((a) => a.outcome.countsAsContact);

  const followUpsCompleted = await prisma.followUp.count({
    where: { completedById: shift.userId, completedAt: { gte: shift.startedAt, lte: end } },
  });
  const interestedLeads = await prisma.stageHistory.count({
    where: { shiftId, toStage: { key: 'interested' } },
  });
  const meetingsCreated = await prisma.meeting.count({
    where: { createdById: shift.userId, createdAt: { gte: shift.startedAt, lte: end } },
  });
  const notes = await prisma.note.count({
    where: { userId: shift.userId, createdAt: { gte: shift.startedAt, lte: end } },
  });
  const ticketsOpened = await prisma.activityEvent.count({ where: { shiftId, kind: 'LEAD_OPENED' } });

  return {
    shiftId,
    plannedStartAt: shift.plannedStartAt?.toISOString() ?? null,
    plannedHours: shift.plannedHours,
    actualStartAt: shift.startedAt.toISOString(),
    actualEndAt: shift.endedAt?.toISOString() ?? null,
    activeHours: secondsToHours(activeSeconds),
    inactiveHours: Math.max(0, Number((secondsToHours(elapsedSeconds) - secondsToHours(activeSeconds)).toFixed(2))),
    startedLateMinutes: shift.startedLateMinutes,
    contactsCompleted: counted.length,
    verifiedContacts: counted.filter((a) => a.verification === 'VERIFIED_BY_INTEGRATION').length,
    manualContacts: counted.filter((a) => a.verification === 'MANUALLY_REPORTED').length,
    followUpsCompleted,
    conversations: counted.filter((a) => a.isConversation).length,
    interestedLeads,
    meetingsCreated,
    notesWritten: notes,
    missingNotes: attempts.filter((a) => a.outcome.requiresNote && !a.note).length,
    ticketsOpened,
  };
}

export type WeeklyReport = Awaited<ReturnType<typeof buildWeeklyReport>>;

export async function buildWeeklyReport(sprintId: string) {
  const sprint = await prisma.weeklySprint.findUniqueOrThrow({
    where: { id: sprintId },
    include: { targets: { orderBy: { position: 'asc' } }, user: true },
  });
  const scorecard = await computeScorecard(sprintId);

  const previous = await prisma.weeklyScorecard.findFirst({
    where: { userId: sprint.userId, isFrozen: true, sprint: { weekStart: { lt: sprint.weekStart } } },
    orderBy: { createdAt: 'desc' },
  });

  const contactRate = scorecard.metrics.contactsCompleted > 0
    ? scorecard.metrics.answeredCount / scorecard.metrics.contactsCompleted
    : null;
  const conversationRate = scorecard.metrics.contactsCompleted > 0
    ? scorecard.metrics.conversations / scorecard.metrics.contactsCompleted
    : null;

  const leadsAssigned = await prisma.leadTicket.count({ where: { sprintId } });

  // Source / industry / location performance for the Sunday Review.
  const attempts = await prisma.contactAttempt.findMany({
    where: { sprintId },
    include: {
      ticket: {
        include: {
          company: { select: { city: true, industryLabel: true, industry: { select: { name: true } } } },
          opportunity: { select: { sourceRecord: { select: { kind: true } } } },
        },
      },
      outcome: { select: { countsAsConversation: true } },
    },
  });

  const tally = (getKey: (a: (typeof attempts)[number]) => string | null) => {
    const map = new Map<string, { attempts: number; conversations: number }>();
    for (const a of attempts) {
      const key = getKey(a);
      if (!key) continue;
      const entry = map.get(key) ?? { attempts: 0, conversations: 0 };
      entry.attempts += 1;
      if (a.outcome.countsAsConversation) entry.conversations += 1;
      map.set(key, entry);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v, rate: v.attempts ? Number((v.conversations / v.attempts).toFixed(2)) : 0 }))
      .sort((a, b) => b.conversations - a.conversations || b.attempts - a.attempts)
      .slice(0, 8);
  };

  return {
    sprintId,
    label: sprint.label,
    user: { id: sprint.user.id, name: sprint.user.name },
    periodStart: sprint.weekStart.toISOString(),
    periodEnd: sprint.weekEnd.toISOString(),
    targets: sprint.targets.map((t) => ({
      key: t.key,
      label: t.label,
      target: t.target,
      suggested: t.suggestedTarget,
      overridden: Boolean(t.overriddenById),
    })),
    scorecard,
    leadsAssigned,
    rates: {
      contactRate: contactRate === null ? null : Number(contactRate.toFixed(3)),
      conversationRate: conversationRate === null ? null : Number(conversationRate.toFixed(3)),
    },
    comparison: previous
      ? {
          previousScore: previous.totalScore,
          scoreDelta: scorecard.totalScore - previous.totalScore,
          previousContacts: previous.contactsCompleted,
          contactsDelta: scorecard.metrics.contactsCompleted - previous.contactsCompleted,
          previousMeetings: previous.meetingsBooked,
          meetingsDelta: scorecard.metrics.meetingsBooked - previous.meetingsBooked,
        }
      : null,
    performance: {
      byIndustry: tally((a) => a.ticket.company.industry?.name ?? a.ticket.company.industryLabel),
      byLocation: tally((a) => a.ticket.company.city),
      bySource: tally((a) => a.ticket.opportunity.sourceRecord?.kind ?? null),
    },
  };
}

export type MonthlyReport = Awaited<ReturnType<typeof buildMonthlyReport>>;

export async function buildMonthlyReport(userId: string, when: Date, timezone = DEFAULT_TIMEZONE) {
  const periodStart = startOfMonthInTz(when, timezone);
  const periodEnd = endOfMonthInTz(when, timezone);

  const scorecards = await prisma.weeklyScorecard.findMany({
    where: { userId, sprint: { weekStart: { gte: periodStart, lte: periodEnd } } },
    include: { sprint: { select: { label: true, weekStart: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const sum = <K extends keyof (typeof scorecards)[number]>(key: K) =>
    scorecards.reduce((s, c) => s + (Number(c[key]) || 0), 0);

  const totalContacts = sum('contactsCompleted');
  const conversations = sum('conversations');
  const meetingsBooked = sum('meetingsBooked');
  const totalCostCents = sum('salespersonCostCents');
  const paidHours = sum('completedHours');

  const attributed = await prisma.revenueAttribution.aggregate({
    where: { userId, closedAt: { gte: periodStart, lte: periodEnd } },
    _sum: { amountCents: true },
    _count: { _all: true },
  });
  const wonRevenueCents = attributed._sum.amountCents ?? null;

  const opportunities = await prisma.leadTicket.count({
    where: {
      assigneeId: userId,
      stage: { key: { in: ['proposal', 'won'] } },
      updatedAt: { gte: periodStart, lte: periodEnd },
    },
  });

  const perf = await prisma.contactAttempt.findMany({
    where: { userId, createdAt: { gte: periodStart, lte: periodEnd } },
    include: {
      ticket: {
        include: {
          company: { select: { city: true, industry: { select: { name: true } }, industryLabel: true } },
          opportunity: { select: { sourceRecord: { select: { kind: true } } } },
        },
      },
      outcome: { select: { countsAsConversation: true } },
    },
  });

  const rank = (getKey: (a: (typeof perf)[number]) => string | null) => {
    const map = new Map<string, { attempts: number; conversations: number }>();
    for (const a of perf) {
      const key = getKey(a);
      if (!key) continue;
      const e = map.get(key) ?? { attempts: 0, conversations: 0 };
      e.attempts += 1;
      if (a.outcome.countsAsConversation) e.conversations += 1;
      map.set(key, e);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.conversations - a.conversations)
      .slice(0, 5);
  };

  const recommendations: string[] = [];
  const industries = rank((a) => a.ticket.company.industry?.name ?? a.ticket.company.industryLabel);
  const locations = rank((a) => a.ticket.company.city);
  if (industries[0]) {
    recommendations.push(
      `${industries[0].name} produced the most conversations (${industries[0].conversations} from ${industries[0].attempts} attempts) — consider raising its priority.`,
    );
  }
  if (locations[0]) {
    recommendations.push(`${locations[0].name} was the strongest territory this month.`);
  }
  if (totalContacts > 0 && meetingsBooked === 0) {
    recommendations.push(
      `${totalContacts} contacts produced no booked meetings. Review the call opening and which stage conversations are stalling at.`,
    );
  }
  if (scorecards.length === 0) {
    recommendations.push('No completed weeks in this month, so there is nothing to compare against yet.');
  }

  return {
    userId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    label: formatInTz(periodStart, timezone, { month: 'long', year: 'numeric' }),
    weeks: scorecards.map((c) => ({
      label: c.sprint.label,
      score: c.totalScore,
      contacts: c.contactsCompleted,
      conversations: c.conversations,
      meetings: c.meetingsBooked,
      hours: c.completedHours,
    })),
    totals: {
      paidHours,
      totalContacts,
      newContacts: sum('newContacts'),
      followUps: sum('followUpsCompleted'),
      conversations,
      interestedLeads: sum('interestedLeads'),
      meetingInvitesSent: sum('meetingInvitesSent'),
      meetingsBooked,
      opportunities,
      wonDeals: attributed._count._all,
    },
    rates: {
      conversationRate: totalContacts ? Number((conversations / totalContacts).toFixed(3)) : null,
      meetingRate: totalContacts ? Number((meetingsBooked / totalContacts).toFixed(3)) : null,
    },
    cost: {
      totalCostCents,
      // All null when the underlying data does not exist — never a fake zero.
      costPerContactCents: totalContacts && totalCostCents ? Math.round(totalCostCents / totalContacts) : null,
      costPerConversationCents: conversations && totalCostCents ? Math.round(totalCostCents / conversations) : null,
      costPerMeetingCents: meetingsBooked && totalCostCents ? Math.round(totalCostCents / meetingsBooked) : null,
      revenuePerPaidHourCents:
        paidHours > 0 && wonRevenueCents !== null ? Math.round(Number(wonRevenueCents) / paidHours) : null,
      wonRevenueCents,
      returnOnCost:
        wonRevenueCents !== null && totalCostCents > 0
          ? Number((Number(wonRevenueCents) / totalCostCents).toFixed(2))
          : null,
    },
    strongest: { industries, locations, sources: rank((a) => a.ticket.opportunity.sourceRecord?.kind ?? null) },
    fourWeekTrend: scorecards.slice(-4).map((c) => ({ label: c.sprint.label, score: c.totalScore })),
    recommendations,
  };
}

export async function saveReport(params: {
  kind: ReportKind;
  userId?: string | null;
  sprintId?: string | null;
  shiftId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  title: string;
  payload: unknown;
}): Promise<void> {
  const existing = await prisma.report.findFirst({
    where: { kind: params.kind, userId: params.userId ?? null, periodStart: params.periodStart },
    select: { id: true },
  });
  const payload = params.payload as Prisma.InputJsonValue;

  if (existing) {
    await prisma.report.update({ where: { id: existing.id }, data: { payload, title: params.title } });
    return;
  }
  await prisma.report.create({
    data: {
      kind: params.kind,
      userId: params.userId ?? null,
      sprintId: params.sprintId ?? null,
      shiftId: params.shiftId ?? null,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      title: params.title,
      payload,
    },
  });
}
