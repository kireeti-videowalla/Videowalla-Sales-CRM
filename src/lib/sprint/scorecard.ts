import type { Prisma, WeeklySprint } from '@prisma/client';
import { prisma } from '../db';
import { getSetting } from '../settings/service';
import { computeActiveSeconds } from '../shifts/service';
import { secondsToHours } from '../time';

/**
 * Weekly performance score, 0-100.
 *
 * Every point is traceable to a counted event. There is no AI judgement and no
 * hidden adjustment — the breakdown shows the weight, what was achieved, what
 * was expected, and how many points that produced.
 */

export type ScoreCategory = {
  key: string;
  label: string;
  weight: number;
  awarded: number;
  achieved: number;
  expected: number;
  detail: string;
};

export type ScorecardResult = {
  totalScore: number;
  breakdown: ScoreCategory[];
  targetCompletion: number;
  metrics: {
    scheduledHours: number;
    completedHours: number;
    activeHours: number;
    inactiveHours: number;
    contactsCompleted: number;
    verifiedContacts: number;
    manualContacts: number;
    newContacts: number;
    followUpsCompleted: number;
    followUpsOutstanding: number;
    conversations: number;
    answeredCount: number;
    interestedLeads: number;
    meetingInvitesSent: number;
    meetingsBooked: number;
    opportunitiesCreated: number;
    notesWritten: number;
    notesRequired: number;
    unfinishedTasks: number;
  };
  cost: {
    salespersonCostCents: number;
    costPerContactCents: number | null;
    costPerConversationCents: number | null;
    costPerMeetingCents: number | null;
    attributedRevenueCents: bigint | null;
  };
};

function ratioScore(achieved: number, expected: number, weight: number): number {
  if (expected <= 0) {
    // Nothing was asked for, so nothing can be withheld.
    return weight;
  }
  return Math.round(Math.min(1, achieved / expected) * weight * 10) / 10;
}

export async function computeScorecard(sprintId: string): Promise<ScorecardResult> {
  const sprint = await prisma.weeklySprint.findUniqueOrThrow({
    where: { id: sprintId },
    include: { targets: true },
  });

  const weights = await getSetting('performance.score');
  const target = (key: string) => sprint.targets.find((t) => t.key === key)?.target ?? 0;

  // --- Hours ---------------------------------------------------------------
  const shifts = await prisma.shift.findMany({
    where: { userId: sprint.userId, startedAt: { gte: sprint.weekStart, lte: sprint.weekEnd } },
  });
  const now = new Date();
  let activeSeconds = 0;
  let elapsedSeconds = 0;
  for (const shift of shifts) {
    activeSeconds += computeActiveSeconds(shift, now);
    const end = shift.endedAt ?? now;
    elapsedSeconds += Math.max(0, Math.floor((end.getTime() - shift.startedAt.getTime()) / 1000));
  }
  const completedHours = secondsToHours(elapsedSeconds);
  const activeHours = secondsToHours(activeSeconds);
  const inactiveHours = Math.max(0, Number((completedHours - activeHours).toFixed(2)));
  const scheduledHours = sprint.availableHours;

  // --- Contact activity ----------------------------------------------------
  const attempts = await prisma.contactAttempt.findMany({
    where: { userId: sprint.userId, createdAt: { gte: sprint.weekStart, lte: sprint.weekEnd } },
    include: { outcome: { select: { countsAsContact: true, countsAsConversation: true } } },
  });

  const countedAttempts = attempts.filter((a) => a.outcome.countsAsContact);
  const contactsCompleted = countedAttempts.length;
  const verifiedContacts = countedAttempts.filter((a) => a.verification === 'VERIFIED_BY_INTEGRATION').length;
  const manualContacts = contactsCompleted - verifiedContacts;
  const newContacts = countedAttempts.filter((a) => a.attemptNumber === 1).length;
  const conversations = countedAttempts.filter((a) => a.isConversation).length;
  const answeredCount = countedAttempts.filter((a) => a.answered).length;

  const followUpsCompleted = await prisma.followUp.count({
    where: {
      ownerId: sprint.userId,
      status: 'COMPLETED',
      completedAt: { gte: sprint.weekStart, lte: sprint.weekEnd },
    },
  });
  const followUpsOutstanding = await prisma.followUp.count({
    where: { ownerId: sprint.userId, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
  });

  const interestedLeads = await prisma.stageHistory.count({
    where: {
      sprintId: sprint.id,
      toStage: { key: 'interested' },
      occurredAt: { gte: sprint.weekStart, lte: sprint.weekEnd },
    },
  });
  const meetingInvitesSent = await prisma.meeting.count({
    where: {
      createdById: sprint.userId,
      inviteSentAt: { gte: sprint.weekStart, lte: sprint.weekEnd },
    },
  });
  const meetingsBooked = await prisma.meeting.count({
    where: {
      createdById: sprint.userId,
      status: { in: ['CONFIRMED', 'COMPLETED'] },
      updatedAt: { gte: sprint.weekStart, lte: sprint.weekEnd },
    },
  });
  const opportunitiesCreated = await prisma.leadTicket.count({
    where: { sprintId: sprint.id, stage: { key: 'proposal' } },
  });

  // --- Note quality --------------------------------------------------------
  const notes = await prisma.note.findMany({
    where: { userId: sprint.userId, createdAt: { gte: sprint.weekStart, lte: sprint.weekEnd } },
    select: { body: true },
  });
  const substantialNotes = notes.filter((n) => n.body.trim().length >= weights.minimumNoteLength).length;
  const attemptsRequiringNotes = await prisma.contactAttempt.count({
    where: {
      userId: sprint.userId,
      createdAt: { gte: sprint.weekStart, lte: sprint.weekEnd },
      outcome: { requiresNote: true },
    },
  });

  const unfinishedTasks = await prisma.leadTicket.count({
    where: { sprintId: sprint.id, attemptCount: 0, stage: { key: 'ready_to_contact' } },
  });

  // --- Score ---------------------------------------------------------------
  const breakdown: ScoreCategory[] = [
    {
      key: 'attendance',
      label: 'Attendance and scheduled hours',
      weight: weights.attendanceWeight,
      awarded: ratioScore(completedHours, scheduledHours, weights.attendanceWeight),
      achieved: completedHours,
      expected: scheduledHours,
      detail: `${completedHours}h of ${scheduledHours}h scheduled (${activeHours}h active, ${inactiveHours}h paused/idle).`,
    },
    {
      key: 'contacts',
      label: 'Completion of assigned contacts',
      weight: weights.contactsWeight,
      awarded: ratioScore(contactsCompleted, target('TOTAL_CONTACTS'), weights.contactsWeight),
      achieved: contactsCompleted,
      expected: target('TOTAL_CONTACTS'),
      detail: `${contactsCompleted} of ${target('TOTAL_CONTACTS')} contacts (${verifiedContacts} verified, ${manualContacts} manually reported).`,
    },
    {
      key: 'followups',
      label: 'Completion of follow-ups',
      weight: weights.followUpsWeight,
      awarded: ratioScore(followUpsCompleted, target('FOLLOW_UPS'), weights.followUpsWeight),
      achieved: followUpsCompleted,
      expected: target('FOLLOW_UPS'),
      detail: `${followUpsCompleted} of ${target('FOLLOW_UPS')} follow-ups completed; ${followUpsOutstanding} still outstanding.`,
    },
    {
      key: 'notes',
      label: 'Quality and completeness of notes',
      weight: weights.notesQualityWeight,
      awarded: ratioScore(substantialNotes, attemptsRequiringNotes, weights.notesQualityWeight),
      achieved: substantialNotes,
      expected: attemptsRequiringNotes,
      detail: `${substantialNotes} notes of at least ${weights.minimumNoteLength} characters against ${attemptsRequiringNotes} outcomes that require one.`,
    },
    {
      key: 'conversations',
      label: 'Real conversations',
      weight: weights.conversationsWeight,
      awarded: ratioScore(conversations, target('CONVERSATIONS'), weights.conversationsWeight),
      achieved: conversations,
      expected: target('CONVERSATIONS'),
      detail: `${conversations} of ${target('CONVERSATIONS')} conversations; ${answeredCount} attempts were answered.`,
    },
    {
      key: 'interested',
      label: 'Interested opportunities',
      weight: weights.interestedWeight,
      awarded: ratioScore(interestedLeads, target('INTERESTED'), weights.interestedWeight),
      achieved: interestedLeads,
      expected: target('INTERESTED'),
      detail: `${interestedLeads} of ${target('INTERESTED')} leads moved to Interested.`,
    },
    {
      key: 'meetings',
      label: 'Meetings booked',
      weight: weights.meetingsWeight,
      awarded: ratioScore(meetingsBooked, target('MEETINGS'), weights.meetingsWeight),
      achieved: meetingsBooked,
      expected: target('MEETINGS'),
      detail: `${meetingsBooked} of ${target('MEETINGS')} meetings booked; ${meetingInvitesSent} invitations sent.`,
    },
  ];

  const totalWeight = breakdown.reduce((s, c) => s + c.weight, 0) || 1;
  const rawScore = breakdown.reduce((s, c) => s + c.awarded, 0);
  const totalScore = Math.round((rawScore / totalWeight) * 100);

  const totalContactTarget = target('TOTAL_CONTACTS');
  const targetCompletion = totalContactTarget > 0
    ? Number(Math.min(1, contactsCompleted / totalContactTarget).toFixed(3))
    : 0;

  // --- Cost and ROI --------------------------------------------------------
  const compensation = await prisma.compensationSetting.findFirst({
    where: {
      userId: sprint.userId,
      effectiveFrom: { lte: sprint.weekEnd },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: sprint.weekStart } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  const salespersonCostCents = compensation?.weeklyPayCents ?? 0;

  const attributed = await prisma.revenueAttribution.aggregate({
    where: {
      ticket: { sprintId: sprint.id },
      closedAt: { gte: sprint.weekStart, lte: sprint.weekEnd },
    },
    _sum: { amountCents: true },
  });

  const per = (n: number) => (n > 0 && salespersonCostCents > 0 ? Math.round(salespersonCostCents / n) : null);

  return {
    totalScore,
    breakdown,
    targetCompletion,
    metrics: {
      scheduledHours,
      completedHours,
      activeHours,
      inactiveHours,
      contactsCompleted,
      verifiedContacts,
      manualContacts,
      newContacts,
      followUpsCompleted,
      followUpsOutstanding,
      conversations,
      answeredCount,
      interestedLeads,
      meetingInvitesSent,
      meetingsBooked,
      opportunitiesCreated,
      notesWritten: substantialNotes,
      notesRequired: attemptsRequiringNotes,
      unfinishedTasks,
    },
    cost: {
      salespersonCostCents,
      costPerContactCents: per(contactsCompleted),
      costPerConversationCents: per(conversations),
      costPerMeetingCents: per(meetingsBooked),
      // Only ever populated from an explicitly linked deal — never inferred.
      attributedRevenueCents: attributed._sum.amountCents ?? null,
    },
  };
}

/** Persists the scorecard. `freeze` makes it the immutable record of the week. */
export async function saveScorecard(
  sprint: WeeklySprint,
  result: ScorecardResult,
  freeze = false,
): Promise<void> {
  const data = {
    userId: sprint.userId,
    scheduledHours: result.metrics.scheduledHours,
    completedHours: result.metrics.completedHours,
    activeHours: result.metrics.activeHours,
    inactiveHours: result.metrics.inactiveHours,
    contactsCompleted: result.metrics.contactsCompleted,
    verifiedContacts: result.metrics.verifiedContacts,
    manualContacts: result.metrics.manualContacts,
    newContacts: result.metrics.newContacts,
    followUpsCompleted: result.metrics.followUpsCompleted,
    followUpsOutstanding: result.metrics.followUpsOutstanding,
    conversations: result.metrics.conversations,
    answeredCount: result.metrics.answeredCount,
    interestedLeads: result.metrics.interestedLeads,
    meetingInvitesSent: result.metrics.meetingInvitesSent,
    meetingsBooked: result.metrics.meetingsBooked,
    opportunitiesCreated: result.metrics.opportunitiesCreated,
    notesWritten: result.metrics.notesWritten,
    notesRequired: result.metrics.notesRequired,
    unfinishedTasks: result.metrics.unfinishedTasks,
    totalScore: result.totalScore,
    scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
    targetCompletion: result.targetCompletion,
    salespersonCostCents: result.cost.salespersonCostCents,
    costPerContactCents: result.cost.costPerContactCents,
    costPerConversationCents: result.cost.costPerConversationCents,
    costPerMeetingCents: result.cost.costPerMeetingCents,
    attributedRevenueCents: result.cost.attributedRevenueCents,
    ...(freeze ? { isFrozen: true, frozenAt: new Date() } : {}),
  };

  const existing = await prisma.weeklyScorecard.findUnique({ where: { sprintId: sprint.id } });
  // A frozen scorecard is the historical record of a closed week and is never
  // recomputed.
  if (existing?.isFrozen) return;

  await prisma.weeklyScorecard.upsert({
    where: { sprintId: sprint.id },
    create: { sprintId: sprint.id, ...data },
    update: data,
  });
}
