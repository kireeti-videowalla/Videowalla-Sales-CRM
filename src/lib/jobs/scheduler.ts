import { parseExpression } from 'cron-parser';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { enqueue } from './queue';

const log = createLogger('jobs.scheduler');

/**
 * Computes the next fire time for a cron expression in a specific timezone.
 * Exported so the Settings screen can show the owner when Sunday planning will
 * actually run.
 */
export function nextRunFor(cron: string, timezone: string, after = new Date()): Date | null {
  try {
    return parseExpression(cron, { currentDate: after, tz: timezone }).next().toDate();
  } catch (err) {
    log.error('invalid cron expression', { cron, timezone, err: String(err) });
    return null;
  }
}

export function isValidCron(cron: string, timezone = 'UTC'): boolean {
  return nextRunFor(cron, timezone) !== null;
}

/**
 * Evaluates every active schedule and enqueues due jobs.
 *
 * Called on a short interval by the worker (and by /api/cron/tick on
 * serverless hosts). The idempotency key is derived from the scheduled instant,
 * so calling this twice for the same tick enqueues the job exactly once.
 */
export async function runScheduler(now = new Date()): Promise<{ enqueued: number; checked: number }> {
  const schedules = await prisma.scheduledJob.findMany({ where: { isActive: true } });
  let enqueued = 0;

  for (const schedule of schedules) {
    // First observation of a schedule only records its next run — it does not
    // fire immediately, which would mean a redeploy triggers Sunday planning.
    if (!schedule.nextRunAt) {
      const next = nextRunFor(schedule.cron, schedule.timezone, now);
      await prisma.scheduledJob.update({ where: { id: schedule.id }, data: { nextRunAt: next } });
      continue;
    }

    if (schedule.nextRunAt > now) continue;

    const firedAt = schedule.nextRunAt;
    const job = await enqueue(
      schedule.jobName,
      { ...(schedule.payload as Record<string, unknown>), scheduledFor: firedAt.toISOString() },
      {
        idempotencyKey: `schedule:${schedule.key}:${firedAt.toISOString()}`,
        priority: 50,
      },
    );
    if (job) enqueued += 1;

    await prisma.scheduledJob.update({
      where: { id: schedule.id },
      data: {
        lastRunAt: now,
        nextRunAt: nextRunFor(schedule.cron, schedule.timezone, now),
      },
    });
  }

  return { enqueued, checked: schedules.length };
}

/** Recomputes nextRunAt after an owner edits a schedule's cron or timezone. */
export async function refreshSchedule(key: string): Promise<void> {
  const schedule = await prisma.scheduledJob.findUnique({ where: { key } });
  if (!schedule) return;
  await prisma.scheduledJob.update({
    where: { id: schedule.id },
    data: { nextRunAt: nextRunFor(schedule.cron, schedule.timezone) },
  });
}
