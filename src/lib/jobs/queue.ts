import type { Job, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';

const log = createLogger('jobs.queue');

export type EnqueueOptions = {
  /** Delay before the job becomes eligible to run. */
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /**
   * When set, enqueuing is a no-op if a job with the same key already exists.
   * This is how "process this gmail message" or "plan week 2026-W31" stay
   * exactly-once even if the trigger fires repeatedly.
   */
  idempotencyKey?: string;
};

export async function enqueue(
  name: string,
  payload: Prisma.InputJsonValue = {},
  options: EnqueueOptions = {},
): Promise<Job | null> {
  const data = {
    name,
    payload,
    runAt: options.runAt ?? new Date(),
    priority: options.priority ?? 100,
    maxAttempts: options.maxAttempts ?? 5,
    idempotencyKey: options.idempotencyKey ?? null,
  };

  if (!data.idempotencyKey) {
    return prisma.job.create({ data });
  }

  try {
    return await prisma.job.create({ data });
  } catch (err) {
    // P2002 = unique violation on idempotencyKey: the work is already queued
    // or already done. That is the desired outcome, not an error.
    if (isUniqueViolation(err)) {
      log.debug('duplicate job suppressed', { name, idempotencyKey: data.idempotencyKey });
      return null;
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

/**
 * Atomically claim one runnable job.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes multiple worker processes safe: each
 * claims a different row instead of contending on the same one.
 */
export async function claimNextJob(workerId: string): Promise<Job | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Job"
    SET status = 'RUNNING',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        "startedAt" = COALESCE("startedAt", NOW()),
        attempts = attempts + 1,
        "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= NOW()
      ORDER BY priority ASC, "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) return null;
  return prisma.job.findUnique({ where: { id } });
}

export async function completeJob(jobId: string, result?: Prisma.InputJsonValue): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'SUCCEEDED',
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      result: result ?? undefined,
    },
  });
}

/** Exponential backoff: 30s, 60s, 120s, 240s… capped at 30 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000);
}

export async function failJob(job: Job, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const exhausted = job.attempts >= job.maxAttempts;

  await prisma.$transaction([
    prisma.jobFailure.create({
      data: { jobId: job.id, attempt: job.attempts, message: message.slice(0, 2000), stack },
    }),
    prisma.job.update({
      where: { id: job.id },
      data: {
        // DEAD is the dead-letter state: it stays visible to the owner in
        // Settings → Automation instead of disappearing.
        status: exhausted ? 'DEAD' : 'PENDING',
        lastError: message.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        finishedAt: exhausted ? new Date() : null,
        runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
      },
    }),
  ]);

  log.error('job failed', {
    jobId: job.id,
    name: job.name,
    attempt: job.attempts,
    exhausted,
    message,
  });
}

/**
 * Returns jobs that a worker claimed and never finished (crash, redeploy) back
 * to PENDING so they are retried rather than lost.
 */
export async function reclaimStuckJobs(olderThanMs = 10 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.job.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', lockedAt: null, lockedBy: null },
  });
  if (count > 0) log.warn('reclaimed stuck jobs', { count });
  return count;
}

export async function retryDeadJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PENDING', attempts: 0, runAt: new Date(), lastError: null, finishedAt: null },
  });
}

export async function queueStats() {
  const grouped = await prisma.job.groupBy({ by: ['status'], _count: { _all: true } });
  const base = { PENDING: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0, DEAD: 0, CANCELLED: 0 };
  for (const row of grouped) base[row.status] = row._count._all;
  return base;
}
