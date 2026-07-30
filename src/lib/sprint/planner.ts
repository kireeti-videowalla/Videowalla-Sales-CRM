import type { Prisma, WeeklySprint } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { ingestAllSources } from '../ingestion/ingest';
import { processPendingRecords } from '../pipeline/process';
import { notify } from '../notifications/service';
import { getSetting } from '../settings/service';
import { autoEndStaleShifts } from '../shifts/service';
import { sweepFollowUps } from '../followups/service';
import {
  addDays,
  DEFAULT_TIMEZONE,
  endOfWeekInTz,
  isoWeekLabel,
  startOfWeekInTz,
} from '../time';
import { computeScorecard, saveScorecard } from './scorecard';
import { calculateTargets, leadsToPrepare, TARGET_DEFINITIONS, type TargetInputs } from './targets';
import type { PlannedShift } from '../shifts/service';

const log = createLogger('sprint.planner');

export type PlanningReport = {
  ranAt: string;
  timezone: string;
  weekLabel: string;
  closedSprints: Array<{ sprintId: string; label: string; score: number; targetCompletion: number }>;
  carryover: { followUps: number; tickets: number; interested: number; invites: number };
  ingestion: { created: number; duplicates: number; errors: string[] };
  processing: { created: number; updated: number; manualReview: number; disqualified: number; failed: number };
  sprints: Array<{
    sprintId: string;
    userId: string;
    userName: string;
    label: string;
    availableHours: number;
    targets: Record<string, number>;
    leadsAssigned: number;
    carryoverTickets: number;
    leadShortfall: number;
    rationale: string[];
  }>;
  warnings: string[];
};

/**
 * The Sunday workflow.
 *
 * Ordering matters and mirrors the spec exactly:
 *   1. close the previous week (freeze the scorecard — history is never reset)
 *   2. carry unfinished work forward
 *   3. collect new opportunities from every source
 *   4. calculate real capacity
 *   5. derive dynamic targets
 *   6. create the sprint
 *   7. notify the owner for approval
 *   8. prepare the salesperson's workspace
 */
export async function runSundayPlanning(options: {
  now?: Date;
  userIds?: string[];
  skipIngestion?: boolean;
  /**
   * Which week to plan. Defaults to the week after the one containing `now`,
   * which is the Sunday-evening behaviour. Pass 'current' to plan the week in
   * progress — used when the system is first set up mid-week, so the
   * salesperson is not left without a workspace until the next Sunday.
   */
  targetWeek?: 'next' | 'current';
} = {}): Promise<PlanningReport> {
  const now = options.now ?? new Date();
  const config = await getSetting('sprint.sundayPlanning');
  const capacityConfig = await getSetting('sprint.capacity');
  const timezone = config.timezone || DEFAULT_TIMEZONE;

  const currentWeekStart = startOfWeekInTz(now, timezone);
  const nextWeekStart =
    options.targetWeek === 'current'
      ? currentWeekStart
      : startOfWeekInTz(addDays(currentWeekStart, 8), timezone);
  const nextWeekEnd = endOfWeekInTz(nextWeekStart, timezone);
  const weekLabel = isoWeekLabel(nextWeekStart, timezone);

  const report: PlanningReport = {
    ranAt: now.toISOString(),
    timezone,
    weekLabel,
    closedSprints: [],
    carryover: { followUps: 0, tickets: 0, interested: 0, invites: 0 },
    ingestion: { created: 0, duplicates: 0, errors: [] },
    processing: { created: 0, updated: 0, manualReview: 0, disqualified: 0, failed: 0 },
    sprints: [],
    warnings: [],
  };

  const reps = await prisma.user.findMany({
    where: {
      role: 'SALES_REP',
      status: 'ACTIVE',
      ...(options.userIds?.length ? { id: { in: options.userIds } } : {}),
    },
  });

  if (reps.length === 0) {
    report.warnings.push('No active sales representatives — no sprints were created.');
    return report;
  }

  // ---- STEP 1: close the previous week ------------------------------------
  await autoEndStaleShifts();
  await sweepFollowUps(now);

  for (const rep of reps) {
    const previous = await prisma.weeklySprint.findMany({
      where: { userId: rep.id, status: { in: ['APPROVED', 'ACTIVE', 'DRAFT', 'PENDING_APPROVAL'] }, weekEnd: { lt: nextWeekStart } },
    });
    for (const sprint of previous) {
      const result = await computeScorecard(sprint.id);
      // Freeze: this is the permanent record of that week. Nothing is deleted.
      await saveScorecard(sprint, result, true);
      await prisma.weeklySprint.update({
        where: { id: sprint.id },
        data: { status: 'CLOSED', closedAt: now },
      });
      report.closedSprints.push({
        sprintId: sprint.id,
        label: sprint.label,
        score: result.totalScore,
        targetCompletion: result.targetCompletion,
      });
      log.info('closed sprint', { sprintId: sprint.id, score: result.totalScore });
    }
  }

  // ---- STEP 3: collect new opportunities ----------------------------------
  // (Runs before capacity so target maths sees the real lead supply.)
  if (!options.skipIngestion && config.discoveryEnabled) {
    const ingestResults = await ingestAllSources({ maxDiscoveryResults: config.maxDiscoveryResults });
    for (const r of ingestResults) {
      report.ingestion.created += r.created;
      report.ingestion.duplicates += r.duplicates;
      if (r.error) report.ingestion.errors.push(`${r.sourceKey}: ${r.error}`);
    }

    // Process everything ingested, in batches, so the week's leads are ready.
    for (let batch = 0; batch < 10; batch += 1) {
      const outcomes = await processPendingRecords(50);
      if (outcomes.length === 0) break;
      for (const o of outcomes) {
        if (o.status === 'CREATED') report.processing.created += 1;
        else if (o.status === 'UPDATED') report.processing.updated += 1;
        else if (o.status === 'MANUAL_REVIEW') report.processing.manualReview += 1;
        else if (o.status === 'DISQUALIFIED') report.processing.disqualified += 1;
        else if (o.status === 'FAILED') report.processing.failed += 1;
      }
    }
  } else {
    report.warnings.push('Automated discovery was skipped for this run.');
  }

  const stages = await prisma.pipelineStage.findMany();
  const stageId = (key: string) => stages.find((s) => s.key === key)?.id;
  const readyStageId = stageId('ready_to_contact');
  if (!readyStageId) throw new Error('Pipeline stages are not seeded. Run `npm run seed`.');

  // ---- Per-rep sprint creation --------------------------------------------
  for (const rep of reps) {
    // ---- STEP 4: capacity -------------------------------------------------
    const schedule = await prisma.workSchedule.findFirst({
      where: {
        userId: rep.id,
        effectiveFrom: { lte: nextWeekEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: nextWeekStart } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    const plannedShifts = (schedule?.plannedShifts as PlannedShift[]) ?? [];
    const availableHours = schedule?.weeklyHours ?? capacityConfig.weeklyHours;
    if (!schedule) {
      report.warnings.push(
        `${rep.name} has no work schedule configured — used the default ${availableHours}h week.`,
      );
    }

    // ---- STEP 2: carryover ------------------------------------------------
    const overdueFollowUps = await prisma.followUp.count({
      where: { ownerId: rep.id, status: 'OVERDUE', ticket: { company: { doNotContact: false } } },
    });
    const dueFollowUps = await prisma.followUp.count({
      where: {
        ownerId: rep.id,
        status: { in: ['SCHEDULED', 'DUE'] },
        dueAt: { lte: nextWeekEnd },
        ticket: { company: { doNotContact: false } },
      },
    });
    const interestedAwaiting = await prisma.leadTicket.count({
      where: { assigneeId: rep.id, stage: { key: 'interested' }, closedAt: null },
    });
    const unconfirmedInvites = await prisma.leadTicket.count({
      where: { assigneeId: rep.id, stage: { key: 'meeting_invite_sent' }, closedAt: null },
    });

    // Unfinished tickets from earlier sprints follow the rep into the new week.
    const carryoverTickets = await prisma.leadTicket.findMany({
      where: {
        assigneeId: rep.id,
        closedAt: null,
        stage: {
          key: { in: ['ready_to_contact', 'contacted_no_answer', 'follow_up_required', 'interested', 'meeting_invite_sent'] },
        },
      },
      orderBy: [{ priority: 'asc' }, { score: 'desc' }],
      select: { id: true },
    });

    report.carryover.followUps += overdueFollowUps + dueFollowUps;
    report.carryover.tickets += carryoverTickets.length;
    report.carryover.interested += interestedAwaiting;
    report.carryover.invites += unconfirmedInvites;

    // ---- Lead supply ------------------------------------------------------
    const unassignedReady = await prisma.leadTicket.findMany({
      where: {
        assigneeId: null,
        closedAt: null,
        stageId: readyStageId,
        company: { doNotContact: false },
      },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, score: true },
    });

    // ---- Historical conversion rates --------------------------------------
    const history = await prisma.weeklyScorecard.findMany({
      where: { userId: rep.id, isFrozen: true },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });
    const totals = history.reduce(
      (acc, h) => ({
        contacts: acc.contacts + h.contactsCompleted,
        conversations: acc.conversations + h.conversations,
        interested: acc.interested + h.interestedLeads,
        meetings: acc.meetings + h.meetingsBooked,
      }),
      { contacts: 0, conversations: 0, interested: 0, meetings: 0 },
    );
    const hasHistory = totals.contacts >= 20;

    const targetInputs: TargetInputs = {
      availableHours,
      plannedShiftCount: plannedShifts.length || 2,
      overdueFollowUps,
      dueFollowUps,
      interestedAwaitingAction: interestedAwaiting,
      unconfirmedInvites,
      availableNewLeads: unassignedReady.length,
      historicalConversationRate: hasHistory ? totals.conversations / totals.contacts : null,
      historicalInterestRate: hasHistory ? totals.interested / totals.contacts : null,
      historicalMeetingRate: hasHistory ? totals.meetings / totals.contacts : null,
    };

    // ---- STEP 5: dynamic targets ------------------------------------------
    const targets = calculateTargets(targetInputs, capacityConfig);

    // ---- STEP 6: create the sprint ----------------------------------------
    const priorityLocations = await prisma.location.findMany({
      where: { isActive: true, isExcluded: false },
      orderBy: { priority: 'asc' },
      take: 5,
    });
    const priorityIndustries = await prisma.industry.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
      take: 6,
    });

    const sprintData = {
      userId: rep.id,
      weekStart: nextWeekStart,
      weekEnd: nextWeekEnd,
      label: weekLabel,
      status: (config.autoApprove ? 'APPROVED' : 'PENDING_APPROVAL') as WeeklySprint['status'],
      availableHours,
      plannedShifts: plannedShifts as unknown as Prisma.InputJsonValue,
      priorityLocationIds: priorityLocations.map((l) => l.id),
      priorityIndustryIds: priorityIndustries.map((i) => i.id),
      instructions: buildInstructions(targets, priorityLocations.map((l) => l.name)),
      planningNotes: targets.rationale.join(' '),
      targetRationale: { rationale: targets.rationale, inputs: targetInputs } as unknown as Prisma.InputJsonValue,
      leadShortfall: targets.leadShortfall,
      ...(config.autoApprove ? { approvedAt: now } : {}),
    };

    const existing = await prisma.weeklySprint.findUnique({
      where: { userId_weekStart: { userId: rep.id, weekStart: nextWeekStart } },
    });

    // Re-running planning must never blow away an approved plan.
    if (existing && existing.status === 'APPROVED') {
      report.warnings.push(`${rep.name}'s sprint for ${weekLabel} is already approved — left untouched.`);
      continue;
    }

    const sprint = existing
      ? await prisma.weeklySprint.update({ where: { id: existing.id }, data: sprintData })
      : await prisma.weeklySprint.create({ data: sprintData });

    const targetValues: Record<string, number> = {
      TOTAL_CONTACTS: targets.totalContacts,
      NEW_CONTACTS: targets.newContacts,
      FOLLOW_UPS: targets.followUps,
      CONVERSATIONS: targets.conversations,
      INTERESTED: targets.interested,
      MEETINGS: targets.meetings,
    };

    for (const def of TARGET_DEFINITIONS) {
      const value = targetValues[def.key] ?? 0;
      const existingTarget = await prisma.sprintTarget.findUnique({
        where: { sprintId_key: { sprintId: sprint.id, key: def.key } },
      });
      // An owner override survives a re-plan; only the suggestion is refreshed.
      if (existingTarget?.overriddenById) {
        await prisma.sprintTarget.update({
          where: { id: existingTarget.id },
          data: { suggestedTarget: value },
        });
        targetValues[def.key] = existingTarget.target;
        continue;
      }
      await prisma.sprintTarget.upsert({
        where: { sprintId_key: { sprintId: sprint.id, key: def.key } },
        create: {
          sprintId: sprint.id,
          key: def.key,
          label: def.label,
          target: value,
          suggestedTarget: value,
          position: def.position,
          rationale: targets.rationale.join(' '),
        },
        update: { target: value, suggestedTarget: value, rationale: targets.rationale.join(' ') },
      });
    }

    // ---- STEP 8: prepare the workspace ------------------------------------
    // Carryover first — unfinished obligations outrank fresh leads.
    let queuePosition = 0;
    for (const ticket of carryoverTickets) {
      await prisma.leadTicket.update({
        where: { id: ticket.id },
        data: { sprintId: sprint.id, isCarryover: true, queuePosition: queuePosition++ },
      });
    }

    const toAssign = unassignedReady.slice(0, leadsToPrepare(targets.newContacts, capacityConfig));
    for (const ticket of toAssign) {
      await prisma.leadTicket.update({
        where: { id: ticket.id },
        data: {
          assigneeId: rep.id,
          sprintId: sprint.id,
          isCarryover: false,
          queuePosition: queuePosition++,
        },
      });
    }

    // Follow-ups belong to the new sprint so the weekly report counts them.
    await prisma.followUp.updateMany({
      where: {
        ownerId: rep.id,
        status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] },
      },
      data: { sprintId: sprint.id },
    });
    await prisma.followUp.updateMany({
      where: {
        ownerId: null,
        status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] },
        ticket: { assigneeId: rep.id },
      },
      data: { sprintId: sprint.id, ownerId: rep.id },
    });

    report.sprints.push({
      sprintId: sprint.id,
      userId: rep.id,
      userName: rep.name,
      label: weekLabel,
      availableHours,
      targets: targetValues,
      leadsAssigned: toAssign.length,
      carryoverTickets: carryoverTickets.length,
      leadShortfall: targets.leadShortfall,
      rationale: targets.rationale,
    });

    if (targets.leadShortfall > 0) {
      report.warnings.push(
        `${rep.name}: ${targets.leadShortfall} more qualified leads were needed than were available.`,
      );
    }

    if (config.autoApprove) {
      await notify({
        key: 'rep.sprint_approved',
        userIds: [rep.id],
        title: `Your week ${weekLabel} is ready`,
        body: `${targets.totalContacts} contacts, ${targets.followUps} follow-ups, ${availableHours} paid hours.`,
        severity: 'INFO',
        linkUrl: '/this-week',
        dedupeKey: `sprint-ready:${sprint.id}`,
      });
    }
  }

  // ---- STEP 7: notify the owner -------------------------------------------
  await persistSundayReport(report, nextWeekStart);

  const notifyPolicy = await getSetting('notifications.policy');
  const summaryLines = report.sprints.map(
    (s) => `${s.userName}: ${s.targets.TOTAL_CONTACTS} contacts (${s.targets.NEW_CONTACTS} new, ${s.targets.FOLLOW_UPS} follow-ups), ${s.leadsAssigned} leads prepared.`,
  );

  await notify({
    key: 'sprint.ready',
    roles: ['OWNER'],
    title: `Week ${weekLabel} is ready for approval`,
    body: [
      summaryLines.join(' '),
      `${report.ingestion.created} new lead sources ingested, ${report.processing.created} tickets created, ${report.processing.manualReview} need review.`,
      report.warnings.length ? `Warnings: ${report.warnings.length}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    severity: report.warnings.length > 0 ? 'WARNING' : 'INFO',
    linkUrl: '/sunday-review',
    dedupeKey: `sunday-plan:${weekLabel}`,
    metadata: report as unknown as Prisma.InputJsonValue,
  });

  if (notifyPolicy.alertOnLeadShortage && report.sprints.some((s) => s.leadShortfall > 0)) {
    await notify({
      key: 'lead.shortage',
      roles: ['OWNER'],
      title: 'Qualified lead shortage',
      body: 'There were not enough qualified leads to fill next week. Consider widening locations, industries or keywords.',
      severity: 'WARNING',
      linkUrl: '/settings/discovery',
      dedupeKey: `lead-shortage:${weekLabel}`,
    });
  }

  log.info('sunday planning complete', {
    weekLabel,
    sprints: report.sprints.length,
    ticketsCreated: report.processing.created,
  });

  return report;
}

function buildInstructions(
  targets: ReturnType<typeof calculateTargets>,
  locationNames: string[],
): string {
  const parts = [
    `Work the priority queue top-down. ${targets.followUps} follow-up${targets.followUps === 1 ? '' : 's'} and interested-lead actions come first — they are commitments already made.`,
    `Then work through ${targets.newContacts} new compan${targets.newContacts === 1 ? 'y' : 'ies'}.`,
    locationNames.length ? `Priority territory this week: ${locationNames.slice(0, 3).join(', ')}.` : '',
    `Log an outcome on every ticket you open, even when nobody answers — an unlogged call cannot be counted.`,
  ];
  return parts.filter(Boolean).join(' ');
}

async function persistSundayReport(report: PlanningReport, weekStart: Date): Promise<void> {
  // The Report unique key includes a nullable userId, and Postgres treats NULLs
  // as distinct, so an upsert would never match. Look it up explicitly instead.
  const existing = await prisma.report.findFirst({
    where: { kind: 'SUNDAY_SUMMARY', userId: null, periodStart: weekStart },
    select: { id: true },
  });
  const payload = report as unknown as Prisma.InputJsonValue;

  if (existing) {
    await prisma.report.update({ where: { id: existing.id }, data: { payload } });
    return;
  }
  await prisma.report.create({
    data: {
      kind: 'SUNDAY_SUMMARY',
      periodStart: weekStart,
      periodEnd: endOfWeekInTz(weekStart, report.timezone),
      title: `Sunday plan for ${report.weekLabel}`,
      payload,
    },
  });
}

/** Owner approval of a planned week. */
export async function approveSprint(
  sprintId: string,
  ownerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const sprint = await prisma.weeklySprint.findUnique({
    where: { id: sprintId },
    include: { targets: true, user: true },
  });
  if (!sprint) return { ok: false, error: 'Sprint not found.' };
  if (sprint.status === 'CLOSED') return { ok: false, error: 'This week is already closed.' };

  await prisma.weeklySprint.update({
    where: { id: sprintId },
    data: { status: 'APPROVED', approvedAt: new Date(), approvedById: ownerId },
  });

  const total = sprint.targets.find((t) => t.key === 'TOTAL_CONTACTS')?.target ?? 0;
  const followUps = sprint.targets.find((t) => t.key === 'FOLLOW_UPS')?.target ?? 0;

  await notify({
    key: 'rep.sprint_approved',
    userIds: [sprint.userId],
    title: `Your week ${sprint.label} is ready`,
    body: `${total} contacts, ${followUps} follow-ups, ${sprint.availableHours} paid hours. Open This Week to start.`,
    severity: 'SUCCESS',
    linkUrl: '/this-week',
    dedupeKey: `sprint-approved:${sprintId}`,
  });

  return { ok: true };
}

export async function overrideTarget(params: {
  sprintId: string;
  key: string;
  target: number;
  ownerId: string;
}): Promise<void> {
  await prisma.sprintTarget.update({
    where: { sprintId_key: { sprintId: params.sprintId, key: params.key } },
    data: {
      target: Math.max(0, Math.round(params.target)),
      overriddenById: params.ownerId,
      overriddenAt: new Date(),
    },
  });
}
