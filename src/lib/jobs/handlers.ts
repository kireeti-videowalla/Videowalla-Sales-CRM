/**
 * All background job handlers, registered once at import time.
 *
 * Importing this module is what makes the worker (and /api/cron/tick) able to
 * execute anything, so both entry points import it exactly once.
 */
import { prisma } from '../db';
import { getSetting } from '../settings/service';
import { registerJob } from './registry';
import { enqueue } from './queue';
import { ingestAllSources } from '../ingestion/ingest';
import { processPendingRecords, processSourceRecord } from '../pipeline/process';
import { runSundayPlanning } from '../sprint/planner';
import { sweepFollowUps } from '../followups/service';
import { autoEndStaleShifts, computeActiveSeconds } from '../shifts/service';
import { notify } from '../notifications/service';
import { syncMeetings } from '../integrations/calendar';
import { buildMonthlyReport, buildShiftReport, buildWeeklyReport, saveReport } from '../reports/service';
import { computeScorecard, saveScorecard } from '../sprint/scorecard';
import {
  DEFAULT_TIMEZONE,
  addDays,
  endOfWeekInTz,
  formatInTz,
  getTzParts,
  startOfMonthInTz,
  startOfWeekInTz,
} from '../time';

// ---------------------------------------------------------------------------
// Ingestion and pipeline
// ---------------------------------------------------------------------------

registerJob('ingest.all_sources', async (payload, ctx) => {
  const config = await getSetting('sprint.sundayPlanning');
  const results = await ingestAllSources({
    maxDiscoveryResults: (payload.maxDiscoveryResults as number) ?? config.maxDiscoveryResults,
  });
  const created = results.reduce((s, r) => s + r.created, 0);
  const errors = results.filter((r) => r.error);

  if (errors.length > 0) {
    const policy = await getSetting('notifications.policy');
    if (policy.alertOnIntegrationFailure) {
      await notify({
        key: 'integration.failure',
        roles: ['OWNER'],
        title: 'A lead source failed to run',
        body: errors.map((e) => `${e.sourceKey}: ${e.error}`).join(' | ').slice(0, 900),
        severity: 'WARNING',
        linkUrl: '/settings/integrations',
        dedupeKey: `source-error:${errors.map((e) => e.sourceKey).join(',')}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  ctx.log.info('ingestion complete', { created, sources: results.length, errors: errors.length });
  return { created, results };
});

registerJob('ingest.single_source', async (payload) => {
  const sourceKey = String(payload.sourceKey ?? '');
  const source = await prisma.leadSource.findUnique({ where: { key: sourceKey } });
  if (!source) throw new Error(`Lead source "${sourceKey}" not found`);
  const { ingestGmailSource, ingestPlacesSource } = await import('../ingestion/ingest');
  return source.kind === 'PLACES_API' ? ingestPlacesSource(source) : ingestGmailSource(source);
});

registerJob('pipeline.process_record', async (payload) => {
  const id = String(payload.sourceRecordId ?? '');
  if (!id) throw new Error('sourceRecordId is required');
  const outcome = await processSourceRecord(id);

  if (outcome.ticketId && outcome.score !== undefined) {
    const policy = await getSetting('notifications.policy');
    if (policy.alertOnHighScoreLead && outcome.score >= policy.highScoreLeadThreshold) {
      const ticket = await prisma.leadTicket.findUnique({
        where: { id: outcome.ticketId },
        include: { company: true, opportunity: true },
      });
      if (ticket) {
        await notify({
          key: 'lead.high_score',
          roles: ['OWNER'],
          title: `High-scoring lead: ${ticket.company.name} (${outcome.score})`,
          body: ticket.opportunity.headline,
          severity: 'SUCCESS',
          linkUrl: `/leads/${ticket.id}`,
          dedupeKey: `high-score:${ticket.id}`,
        });
      }
    }
  }
  return outcome;
});

registerJob('pipeline.process_pending', async (payload, ctx) => {
  const outcomes = await processPendingRecords((payload.limit as number) ?? 50);
  ctx.log.info('processed pending records', { count: outcomes.length });
  return {
    processed: outcomes.length,
    created: outcomes.filter((o) => o.status === 'CREATED').length,
    manualReview: outcomes.filter((o) => o.status === 'MANUAL_REVIEW').length,
    failed: outcomes.filter((o) => o.status === 'FAILED').length,
  };
});

registerJob('pipeline.enrich_company', async (payload) => {
  const companyId = String(payload.companyId ?? '');
  const { enrichCompany } = await import('../pipeline/enrichment');
  return enrichCompany(companyId);
});

// ---------------------------------------------------------------------------
// Weekly planning
// ---------------------------------------------------------------------------

registerJob('sprint.sunday_planning', async (payload, ctx) => {
  const report = await runSundayPlanning({
    now: payload.scheduledFor ? new Date(String(payload.scheduledFor)) : new Date(),
    skipIngestion: payload.skipIngestion === true,
  });
  ctx.log.info('sunday planning finished', { sprints: report.sprints.length });
  return report;
});

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

registerJob('followups.sweep', async (_payload, ctx) => {
  const result = await sweepFollowUps();

  const overdue = await prisma.followUp.findMany({
    where: { status: 'OVERDUE', ticket: { company: { doNotContact: false } } },
    include: { ticket: { include: { company: { select: { name: true } } } } },
    take: 25,
  });

  for (const followUp of overdue) {
    if (!followUp.ownerId) continue;
    await notify({
      key: 'rep.followup_overdue',
      userIds: [followUp.ownerId],
      title: 'Follow-up overdue',
      body: `${followUp.ticket.company.name}: ${followUp.reason}`,
      severity: 'WARNING',
      linkUrl: `/leads/${followUp.ticketId}`,
      // One alert per follow-up per day, not one per sweep.
      dedupeKey: `followup-overdue:${followUp.id}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  if (overdue.length >= 5) {
    await notify({
      key: 'followup.overdue',
      roles: ['OWNER'],
      title: `${overdue.length} follow-ups are overdue`,
      body: 'Overdue follow-ups are stacking up. They will carry into next week automatically.',
      severity: 'WARNING',
      linkUrl: '/pipeline',
      dedupeKey: `followups-overdue-owner:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  ctx.log.info('follow-up sweep', result);
  return { ...result, overdueNotified: overdue.length };
});

// ---------------------------------------------------------------------------
// Shift monitoring
// ---------------------------------------------------------------------------

registerJob('shifts.monitor', async (_payload, ctx) => {
  const policy = await getSetting('shifts.policy');
  const notifyPolicy = await getSetting('notifications.policy');
  const now = new Date();

  const autoEnded = await autoEndStaleShifts();

  const openShifts = await prisma.shift.findMany({
    where: { status: 'ACTIVE' },
    include: { user: { select: { id: true, name: true } }, sprint: { include: { targets: true } } },
  });

  let alerts = 0;

  for (const shift of openShifts) {
    const idleMinutes = Math.floor((now.getTime() - shift.lastActivityAt.getTime()) / 60_000);
    const shiftMinutes = Math.floor(computeActiveSeconds(shift, now) / 60);
    const day = now.toISOString().slice(0, 10);

    if (notifyPolicy.alertOnInactivity && idleMinutes >= policy.inactivityAlertMinutes) {
      await notify({
        key: 'shift.inactive',
        roles: ['OWNER'],
        title: `${shift.user.name} has been inactive for ${idleMinutes} minutes`,
        body: `No meaningful activity in the app since ${formatInTz(shift.lastActivityAt, DEFAULT_TIMEZONE)}.`,
        severity: 'WARNING',
        linkUrl: '/live-activity',
        // Re-alerts each inactivity window rather than every 5 minutes.
        dedupeKey: `inactive:${shift.id}:${Math.floor(idleMinutes / policy.inactivityAlertMinutes)}`,
      });
      alerts += 1;
    }

    if (shiftMinutes >= policy.noTicketOpenedMinutes) {
      const opened = await prisma.activityEvent.count({ where: { shiftId: shift.id, kind: 'LEAD_OPENED' } });
      if (opened === 0) {
        await notify({
          key: 'shift.inactive',
          roles: ['OWNER'],
          title: `${shift.user.name} started a shift but has not opened a lead`,
          body: `${shiftMinutes} minutes into the shift with no ticket opened.`,
          severity: 'WARNING',
          linkUrl: '/live-activity',
          dedupeKey: `no-ticket:${shift.id}`,
        });
        alerts += 1;
      }
    }

    if (policy.noContactInFirstHour && shiftMinutes >= 60) {
      const attempts = await prisma.contactAttempt.count({ where: { shiftId: shift.id } });
      if (attempts === 0) {
        await notify({
          key: 'shift.inactive',
          roles: ['OWNER'],
          title: `${shift.user.name} has logged no contact attempts in the first hour`,
          body: 'The shift has been running for over an hour with no contact recorded.',
          severity: 'WARNING',
          linkUrl: '/live-activity',
          dedupeKey: `no-contact-hour:${shift.id}`,
        });
        alerts += 1;
      }
    }

    // Halfway through the planned shift with too little to show for it.
    if (shift.plannedHours && shift.sprint) {
      const halfway = shift.plannedHours * 30; // minutes
      if (shiftMinutes >= halfway) {
        const target = shift.sprint.targets.find((t) => t.key === 'TOTAL_CONTACTS')?.target ?? 0;
        const expectedThisShift = shift.sprint.availableHours > 0
          ? (target * shift.plannedHours) / shift.sprint.availableHours
          : 0;
        const done = await prisma.contactAttempt.count({ where: { shiftId: shift.id } });
        if (expectedThisShift > 0 && done < expectedThisShift * policy.halfShiftProgressThreshold) {
          await notify({
            key: 'target.behind',
            roles: ['OWNER'],
            title: `${shift.user.name} is behind pace`,
            body: `${done} contacts halfway through a ${shift.plannedHours}h shift; roughly ${Math.round(expectedThisShift)} were expected for the full shift.`,
            severity: 'WARNING',
            linkUrl: '/live-activity',
            dedupeKey: `behind-pace:${shift.id}`,
          });
          alerts += 1;
        }
      }
    }
  }

  // Planned shift missed entirely.
  if (notifyPolicy.alertOnMissedShift) {
    const reps = await prisma.user.findMany({ where: { role: 'SALES_REP', status: 'ACTIVE' } });
    for (const rep of reps) {
      const tz = rep.timezone || DEFAULT_TIMEZONE;
      const today = getTzParts(now, tz);
      const schedule = await prisma.workSchedule.findFirst({
        where: { userId: rep.id, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!schedule) continue;

      const planned = (schedule.plannedShifts as Array<{ weekday: number; startTime: string; hours: number }>) ?? [];
      const todays = planned.filter((p) => p.weekday === today.weekday);
      for (const p of todays) {
        const [h, m] = p.startTime.split(':').map(Number);
        const startMinutes = (h ?? 0) * 60 + (m ?? 0);
        const nowMinutes = today.hour * 60 + today.minute;
        // Only complain once the shift is more than an hour late.
        if (nowMinutes < startMinutes + 60) continue;

        const startedToday = await prisma.shift.count({
          where: {
            userId: rep.id,
            startedAt: { gte: new Date(now.getTime() - 20 * 3_600_000) },
          },
        });
        if (startedToday === 0) {
          await notify({
            key: 'shift.missed',
            roles: ['OWNER'],
            title: `${rep.name} missed a planned shift`,
            body: `A ${p.hours}h shift was scheduled to start at ${p.startTime} and has not been started.`,
            severity: 'WARNING',
            linkUrl: '/live-activity',
            dedupeKey: `missed-shift:${rep.id}:${today.year}-${today.month}-${today.day}:${p.startTime}`,
          });
          alerts += 1;
        }
      }
    }
  }

  ctx.log.info('shift monitor', { openShifts: openShifts.length, alerts, autoEnded });
  return { openShifts: openShifts.length, alerts, autoEnded };
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

registerJob('calendar.sync', async (_payload, ctx) => {
  const result = await syncMeetings();
  ctx.log.info('calendar sync', result);
  return result;
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

registerJob('reports.shift', async (payload) => {
  const shiftId = String(payload.shiftId ?? '');
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  const report = await buildShiftReport(shiftId);
  await saveReport({
    kind: 'SHIFT',
    userId: shift.userId,
    shiftId,
    sprintId: shift.sprintId,
    periodStart: shift.startedAt,
    periodEnd: shift.endedAt ?? new Date(),
    title: `Shift report — ${formatInTz(shift.startedAt, DEFAULT_TIMEZONE)}`,
    payload: report,
  });
  return report;
});

registerJob('reports.daily', async (_payload, ctx) => {
  // Refresh (but never freeze) the live scorecard for every running sprint, so
  // the owner dashboard is accurate without anyone opening a page.
  const active = await prisma.weeklySprint.findMany({ where: { status: { in: ['APPROVED', 'ACTIVE'] } } });
  for (const sprint of active) {
    const result = await computeScorecard(sprint.id);
    await saveScorecard(sprint, result, false);
  }

  const failures = await prisma.integrationFailure.count({
    where: { acknowledgedAt: null, occurredAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (failures > 0) {
    await notify({
      key: 'integration.failure',
      roles: ['OWNER'],
      title: `${failures} integration failure${failures === 1 ? '' : 's'} in the last 24 hours`,
      body: 'Open Settings → Integrations to review and re-test the affected connections.',
      severity: 'WARNING',
      linkUrl: '/settings/integrations',
      dedupeKey: `integration-daily:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  ctx.log.info('daily rollup', { sprints: active.length, failures });
  return { sprints: active.length, failures };
});

registerJob('reports.weekly', async (payload) => {
  const sprintId = String(payload.sprintId ?? '');
  const sprint = await prisma.weeklySprint.findUniqueOrThrow({ where: { id: sprintId } });
  const report = await buildWeeklyReport(sprintId);
  await saveReport({
    kind: 'WEEKLY',
    userId: sprint.userId,
    sprintId,
    periodStart: sprint.weekStart,
    periodEnd: sprint.weekEnd,
    title: `Weekly report — ${sprint.label}`,
    payload: report,
  });
  await notify({
    key: 'report.weekly_ready',
    roles: ['OWNER'],
    title: `Weekly report ready — ${sprint.label}`,
    body: `Score ${report.scorecard.totalScore}/100, ${report.scorecard.metrics.contactsCompleted} contacts, ${report.scorecard.metrics.meetingsBooked} meetings booked.`,
    severity: 'INFO',
    linkUrl: '/reports',
    dedupeKey: `weekly-report:${sprintId}`,
  });
  return report;
});

registerJob('reports.monthly', async (_payload, ctx) => {
  const reps = await prisma.user.findMany({ where: { role: 'SALES_REP', status: 'ACTIVE' } });
  // Runs on the 1st, so report on the month that just ended.
  const lastMonth = addDays(startOfMonthInTz(new Date(), DEFAULT_TIMEZONE), -1);

  for (const rep of reps) {
    const report = await buildMonthlyReport(rep.id, lastMonth, rep.timezone || DEFAULT_TIMEZONE);
    await saveReport({
      kind: 'MONTHLY',
      userId: rep.id,
      periodStart: new Date(report.periodStart),
      periodEnd: new Date(report.periodEnd),
      title: `Monthly report — ${report.label}`,
      payload: report,
    });
  }
  ctx.log.info('monthly reports generated', { reps: reps.length });
  return { reps: reps.length };
});

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

registerJob('maintenance.cleanup', async (_payload, ctx) => {
  const expiredSessions = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } }] },
  });

  // Successful jobs older than 14 days are noise; failures and dead letters are
  // kept because the owner needs to see them.
  const oldJobs = await prisma.job.deleteMany({
    where: { status: 'SUCCEEDED', finishedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } },
  });

  const readNotifications = await prisma.notification.deleteMany({
    where: { readAt: { lt: new Date(Date.now() - 60 * 86_400_000) } },
  });

  ctx.log.info('cleanup complete', {
    sessions: expiredSessions.count,
    jobs: oldJobs.count,
    notifications: readNotifications.count,
  });
  return {
    sessions: expiredSessions.count,
    jobs: oldJobs.count,
    notifications: readNotifications.count,
  };
});

// Kept for completeness: lets the owner re-run a week's plan from the UI.
registerJob('sprint.replan', async (payload) => {
  const userIds = Array.isArray(payload.userIds) ? (payload.userIds as string[]) : undefined;
  return runSundayPlanning({ userIds, skipIngestion: payload.skipIngestion === true });
});

export { enqueue, startOfWeekInTz, endOfWeekInTz };
