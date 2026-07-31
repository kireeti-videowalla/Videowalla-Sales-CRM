import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { tick } from '@/lib/jobs/runner';
import '@/lib/jobs/handlers';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = createLogger('api.cron');

/**
 * Serverless-friendly entry point for the job system.
 *
 * On a normal server, run `npm run worker` instead — it is a long-lived process
 * with concurrency. This route exists so platforms without background workers
 * (Vercel Cron, an external scheduler) can drive the same code path.
 */
export async function POST(request: NextRequest) {
  const env = getEnv();
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured on the server.' },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.headers.get('x-cron-secret') ??
    '';

  // Constant-time comparison so the secret cannot be recovered by timing.
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    log.warn('rejected cron tick with a bad secret');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  try {
    const result = await tick(20);
    return NextResponse.json({ ...result, durationMs: Date.now() - started });
  } catch (err) {
    log.error('cron tick failed', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Tick failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
