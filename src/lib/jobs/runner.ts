import { randomUUID } from 'node:crypto';
import { createLogger } from '../logger';
import { claimNextJob, completeJob, failJob, reclaimStuckJobs } from './queue';
import { getHandler } from './registry';
import { runScheduler } from './scheduler';

const log = createLogger('jobs.runner');

export type RunOnceResult = { processed: number; succeeded: number; failed: number };

/**
 * Drains up to `max` jobs. Used by the long-running worker loop and by
 * /api/cron/tick so the exact same execution path serves both deployment
 * models.
 */
export async function drainJobs(max = 25, workerId = `runner-${randomUUID().slice(0, 8)}`): Promise<RunOnceResult> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < max; i += 1) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    processed += 1;

    const handler = getHandler(job.name);
    if (!handler) {
      await failJob(job, new Error(`No handler registered for job "${job.name}"`));
      failed += 1;
      continue;
    }

    const started = Date.now();
    try {
      const result = await handler((job.payload ?? {}) as Record<string, unknown>, {
        job,
        log: createLogger(`job:${job.name}`),
      });
      await completeJob(job.id, (result ?? null) as never);
      succeeded += 1;
      log.info('job succeeded', { name: job.name, jobId: job.id, ms: Date.now() - started });
    } catch (err) {
      await failJob(job, err);
      failed += 1;
    }
  }

  return { processed, succeeded, failed };
}

/** One full tick: reclaim orphans, fire due schedules, then drain the queue. */
export async function tick(max = 25): Promise<RunOnceResult & { enqueued: number }> {
  await reclaimStuckJobs();
  const { enqueued } = await runScheduler();
  const result = await drainJobs(max);
  return { ...result, enqueued };
}
