import type { Shift } from '@prisma/client';
import { prisma } from '../db';
import { logActivity } from '../activity/log';
import { getSetting } from '../settings/service';
import {
  addDays,
  DEFAULT_TIMEZONE,
  endOfWeekInTz,
  getTzParts,
  parseHhMm,
  secondsToHours,
  startOfWeekInTz,
  zonedTimeToUtc,
} from '../time';

export type PlannedShift = { weekday: number; startTime: string; hours: number };

export type ShiftSnapshot = {
  shift: Shift | null;
  isActive: boolean;
  isPaused: boolean;
  /** Live active seconds including the currently running segment. */
  activeSeconds: number;
  elapsedSeconds: number;
};

/**
 * Active time is stored as accumulated seconds plus an open `lastResumedAt`
 * marker, so the running total is always derivable without a ticking timer and
 * survives a server restart.
 */
export function computeActiveSeconds(shift: Shift, now = new Date()): number {
  const open =
    shift.status === 'ACTIVE' && shift.lastResumedAt
      ? Math.max(0, Math.floor((now.getTime() - shift.lastResumedAt.getTime()) / 1000))
      : 0;
  return shift.activeSeconds + open;
}

export async function getOpenShift(userId: string): Promise<Shift | null> {
  return prisma.shift.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } },
    orderBy: { startedAt: 'desc' },
  });
}

export async function getShiftSnapshot(userId: string): Promise<ShiftSnapshot> {
  const shift = await getOpenShift(userId);
  if (!shift) {
    return { shift: null, isActive: false, isPaused: false, activeSeconds: 0, elapsedSeconds: 0 };
  }
  const now = new Date();
  return {
    shift,
    isActive: shift.status === 'ACTIVE',
    isPaused: shift.status === 'PAUSED',
    activeSeconds: computeActiveSeconds(shift, now),
    elapsedSeconds: Math.floor((now.getTime() - shift.startedAt.getTime()) / 1000),
  };
}

/**
 * Finds the planned shift for today from the rep's work schedule, so lateness
 * can be measured against something real rather than assumed.
 */
async function plannedShiftForToday(
  userId: string,
  timezone: string,
  now: Date,
): Promise<{ plannedStartAt: Date; hours: number } | null> {
  const schedule = await prisma.workSchedule.findFirst({
    where: { userId, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!schedule) return null;

  const planned = (schedule.plannedShifts as PlannedShift[]) ?? [];
  const today = getTzParts(now, timezone);
  const match = planned.find((p) => p.weekday === today.weekday);
  if (!match) return null;

  const { hour, minute } = parseHhMm(match.startTime);
  return {
    plannedStartAt: zonedTimeToUtc(
      { year: today.year, month: today.month, day: today.day, hour, minute },
      timezone,
    ),
    hours: match.hours,
  };
}

export async function startShift(userId: string): Promise<{ ok: boolean; shift?: Shift; error?: string }> {
  const existing = await getOpenShift(userId);
  if (existing) return { ok: false, error: 'You already have an open shift. End it before starting a new one.' };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const timezone = user.timezone || DEFAULT_TIMEZONE;
  const now = new Date();

  const sprint = await prisma.weeklySprint.findFirst({
    where: {
      userId,
      status: { in: ['APPROVED', 'ACTIVE'] },
      weekStart: { lte: now },
      weekEnd: { gte: now },
    },
  });

  const planned = await plannedShiftForToday(userId, timezone, now);
  const policy = await getSetting('shifts.policy');
  const lateMinutes = planned
    ? Math.max(0, Math.round((now.getTime() - planned.plannedStartAt.getTime()) / 60_000))
    : null;

  const shift = await prisma.shift.create({
    data: {
      userId,
      sprintId: sprint?.id ?? null,
      status: 'ACTIVE',
      startedAt: now,
      lastResumedAt: now,
      lastActivityAt: now,
      plannedStartAt: planned?.plannedStartAt ?? null,
      plannedHours: planned?.hours ?? null,
      startedLateMinutes: lateMinutes !== null && lateMinutes > policy.lateThresholdMinutes ? lateMinutes : null,
    },
  });

  await prisma.shiftEvent.create({ data: { shiftId: shift.id, kind: 'STARTED' } });
  await logActivity({
    userId,
    kind: 'SHIFT_STARTED',
    summary: 'Started shift',
    shiftId: shift.id,
    sprintId: sprint?.id,
    metadata: { plannedHours: planned?.hours ?? null, lateMinutes },
  });

  // Sprint goes ACTIVE the first time the rep actually starts working it.
  if (sprint && sprint.status === 'APPROVED') {
    await prisma.weeklySprint.update({ where: { id: sprint.id }, data: { status: 'ACTIVE' } });
  }

  return { ok: true, shift };
}

export async function pauseShift(
  userId: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const shift = await getOpenShift(userId);
  if (!shift) return { ok: false, error: 'No open shift to pause.' };
  if (shift.status === 'PAUSED') return { ok: false, error: 'Shift is already paused.' };

  const now = new Date();
  await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: 'PAUSED',
      activeSeconds: computeActiveSeconds(shift, now),
      lastResumedAt: null,
      lastActivityAt: now,
    },
  });
  await prisma.shiftEvent.create({
    data: { shiftId: shift.id, kind: 'PAUSED', reason: reason?.slice(0, 300) ?? null },
  });
  await logActivity({
    userId,
    kind: 'SHIFT_PAUSED',
    summary: reason ? `Paused shift — ${reason}` : 'Paused shift',
    shiftId: shift.id,
  });
  return { ok: true };
}

export async function resumeShift(userId: string): Promise<{ ok: boolean; error?: string }> {
  const shift = await getOpenShift(userId);
  if (!shift) return { ok: false, error: 'No open shift to resume.' };
  if (shift.status === 'ACTIVE') return { ok: false, error: 'Shift is already running.' };

  const now = new Date();
  const pausedFor = Math.max(0, Math.floor((now.getTime() - shift.updatedAt.getTime()) / 1000));

  await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: 'ACTIVE',
      lastResumedAt: now,
      lastActivityAt: now,
      pausedSeconds: shift.pausedSeconds + pausedFor,
    },
  });
  await prisma.shiftEvent.create({ data: { shiftId: shift.id, kind: 'RESUMED' } });
  await logActivity({ userId, kind: 'SHIFT_RESUMED', summary: 'Resumed shift', shiftId: shift.id });
  return { ok: true };
}

export async function endShift(
  userId: string,
  note?: string,
): Promise<{ ok: boolean; shift?: Shift; error?: string; warnings: string[] }> {
  const shift = await getOpenShift(userId);
  if (!shift) return { ok: false, error: 'No open shift to end.', warnings: [] };

  const now = new Date();
  const policy = await getSetting('shifts.policy');
  const warnings: string[] = [];

  // Surface unmet end-of-shift requirements rather than blocking — the rep
  // still needs to be able to clock out, but the gap is recorded.
  if (policy.requireEndOfShiftNotes) {
    const attemptsMissingNotes = await prisma.contactAttempt.count({
      where: {
        shiftId: shift.id,
        note: null,
        outcome: { requiresNote: true },
      },
    });
    if (attemptsMissingNotes > 0) {
      warnings.push(
        `${attemptsMissingNotes} contact${attemptsMissingNotes === 1 ? '' : 's'} still need a note.`,
      );
    }
  }

  const ended = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: 'ENDED',
      endedAt: now,
      activeSeconds: computeActiveSeconds(shift, now),
      lastResumedAt: null,
      endNote: note?.slice(0, 1000) ?? null,
    },
  });

  await prisma.shiftEvent.create({ data: { shiftId: shift.id, kind: 'ENDED' } });
  await logActivity({
    userId,
    kind: 'SHIFT_ENDED',
    summary: `Ended shift — ${secondsToHours(ended.activeSeconds)}h active`,
    shiftId: shift.id,
    metadata: { activeSeconds: ended.activeSeconds, warnings },
  });

  return { ok: true, shift: ended, warnings };
}

/** Total completed hours for a rep within a week, including any open shift. */
export async function weeklyHours(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<{ completedHours: number; activeHours: number; shiftCount: number }> {
  const shifts = await prisma.shift.findMany({
    where: { userId, startedAt: { gte: weekStart, lte: weekEnd } },
  });
  const now = new Date();
  let activeSeconds = 0;
  let elapsedSeconds = 0;

  for (const shift of shifts) {
    activeSeconds += computeActiveSeconds(shift, now);
    const end = shift.endedAt ?? now;
    elapsedSeconds += Math.max(0, Math.floor((end.getTime() - shift.startedAt.getTime()) / 1000));
  }

  return {
    completedHours: secondsToHours(elapsedSeconds),
    activeHours: secondsToHours(activeSeconds),
    shiftCount: shifts.length,
  };
}

export async function currentWeekBounds(userId: string): Promise<{ start: Date; end: Date; timezone: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const now = new Date();
  return { start: startOfWeekInTz(now, tz), end: endOfWeekInTz(now, tz), timezone: tz };
}

/**
 * Auto-ends shifts left running far past any plausible working day, so a rep
 * who forgets to clock out does not accrue phantom hours.
 */
export async function autoEndStaleShifts(): Promise<number> {
  const policy = await getSetting('shifts.policy');
  const cutoff = new Date(Date.now() - policy.autoEndAfterHours * 3_600_000);
  const stale = await prisma.shift.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] }, startedAt: { lt: cutoff } },
  });

  for (const shift of stale) {
    const now = new Date();
    await prisma.shift.update({
      where: { id: shift.id },
      data: {
        status: 'ABANDONED',
        endedAt: shift.lastActivityAt,
        // Credit only up to the last real activity, never the idle tail.
        activeSeconds: Math.min(
          computeActiveSeconds(shift, now),
          Math.max(0, Math.floor((shift.lastActivityAt.getTime() - shift.startedAt.getTime()) / 1000)),
        ),
        lastResumedAt: null,
        endNote: 'Automatically ended — shift left open past the configured limit.',
      },
    });
    await prisma.shiftEvent.create({
      data: { shiftId: shift.id, kind: 'AUTO_ENDED', reason: 'Exceeded auto-end threshold' },
    });
  }
  return stale.length;
}

export { addDays, secondsToHours };
