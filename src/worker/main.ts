/**
 * Standalone background worker.
 *
 * Run with `npm run worker`. This process is what makes the system work while
 * nobody has a browser open: it fires the Sunday planning job, ingests lead
 * sources, runs the AI pipeline, sweeps follow-ups and monitors shifts.
 *
 * Multiple instances are safe — job claiming uses SELECT … FOR UPDATE SKIP
 * LOCKED, so two workers never run the same job.
 */
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { prisma } from '../lib/db';
import { getEnv } from '../lib/env';
import { createLogger } from '../lib/logger';
import { claimNextJob, completeJob, failJob, reclaimStuckJobs } from '../lib/jobs/queue';
import { getHandler, registeredJobNames } from '../lib/jobs/registry';
import { runScheduler } from '../lib/jobs/scheduler';
import '../lib/jobs/handlers';

loadEnv({ path: '.env', quiet: true });

const log = createLogger('worker');
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 6)}`;

let running = true;
let inFlight = 0;

async function runOne(): Promise<boolean> {
  const job = await claimNextJob(workerId);
  if (!job) return false;

  inFlight += 1;
  const started = Date.now();
  try {
    const handler = getHandler(job.name);
    if (!handler) throw new Error(`No handler registered for job "${job.name}"`);
    const result = await handler((job.payload ?? {}) as Record<string, unknown>, {
      job,
      log: createLogger(`job:${job.name}`),
    });
    await completeJob(job.id, (result ?? null) as never);
    log.info('job succeeded', { name: job.name, jobId: job.id, ms: Date.now() - started });
  } catch (err) {
    await failJob(job, err);
  } finally {
    inFlight -= 1;
  }
  return true;
}

async function loop(): Promise<void> {
  const env = getEnv();
  const concurrency = env.WORKER_CONCURRENCY;
  const pollMs = env.WORKER_POLL_MS;

  let lastSchedulerRun = 0;
  let lastReclaim = 0;

  log.info('worker started', {
    workerId,
    concurrency,
    pollMs,
    handlers: registeredJobNames().length,
  });

  while (running) {
    try {
      const now = Date.now();

      // Cron evaluation every 30s is plenty for minute-granularity schedules.
      if (now - lastSchedulerRun > 30_000) {
        lastSchedulerRun = now;
        const { enqueued } = await runScheduler();
        if (enqueued > 0) log.info('scheduler enqueued jobs', { enqueued });
      }

      if (now - lastReclaim > 120_000) {
        lastReclaim = now;
        await reclaimStuckJobs();
      }

      const slots = Math.max(0, concurrency - inFlight);
      const batch = await Promise.all(Array.from({ length: slots }, () => runOne()));
      const didWork = batch.some(Boolean);

      if (!didWork) await sleep(pollMs);
    } catch (err) {
      log.error('worker loop error', { err: err instanceof Error ? err.message : String(err) });
      await sleep(5_000);
    }
  }

  // Let in-flight work finish before exiting so nothing is left half-done.
  const deadline = Date.now() + 30_000;
  while (inFlight > 0 && Date.now() < deadline) await sleep(250);

  await prisma.$disconnect();
  log.info('worker stopped', { workerId });
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info('shutdown signal received', { signal });
    running = false;
  });
}

process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection in worker', { reason: String(reason) });
});

void loop();
