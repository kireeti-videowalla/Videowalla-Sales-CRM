import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Liveness probe. Deliberately reveals nothing beyond reachability. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: 'degraded' }, { status: 503 });
  }
}
