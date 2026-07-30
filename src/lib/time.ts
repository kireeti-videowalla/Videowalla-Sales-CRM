/**
 * Timezone-aware date helpers built on the Intl API — no extra dependency, and
 * correct across DST because offsets are resolved per-instant rather than
 * assumed constant.
 *
 * The whole weekly cadence (sprints run Sunday→Saturday in America/Toronto)
 * depends on these, so they are unit-tested in time.test.ts.
 */

export const DEFAULT_TIMEZONE = 'America/Toronto';

export type TzParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sunday .. 6=Saturday
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Break an instant into wall-clock parts in the given timezone. */
export function getTzParts(date: Date, timeZone = DEFAULT_TIMEZONE): TzParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';
  // Intl renders midnight as hour "24" in some engines; normalise to 0.
  const hour = Number(get('hour')) % 24;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (e.g. -240 for EDT). */
export function tzOffsetMinutes(date: Date, timeZone = DEFAULT_TIMEZONE): number {
  const p = getTzParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Convert a wall-clock time in `timeZone` into the corresponding UTC instant.
 * Two-pass so DST transitions resolve correctly.
 */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  timeZone = DEFAULT_TIMEZONE,
): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour ?? 0,
    wall.minute ?? 0,
    wall.second ?? 0,
  );
  let guess = new Date(naive - tzOffsetMinutes(new Date(naive), timeZone) * 60_000);
  // One correction pass handles the case where the first guess landed on the
  // other side of a DST boundary.
  const offset = tzOffsetMinutes(guess, timeZone);
  guess = new Date(naive - offset * 60_000);
  return guess;
}

/** Midnight (00:00:00) of `date`'s calendar day in `timeZone`, as a UTC instant. */
export function startOfDayInTz(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = getTzParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

export function endOfDayInTz(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  return new Date(addDays(startOfDayInTz(date, timeZone), 1).getTime() - 1);
}

/** Sunday 00:00 local of the week containing `date`. Weeks run Sunday→Saturday. */
export function startOfWeekInTz(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = getTzParts(date, timeZone);
  const midnight = zonedTimeToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
  // Step back day-by-day in local terms so DST shifts cannot skew the result.
  let cursor = midnight;
  let guard = 0;
  while (getTzParts(cursor, timeZone).weekday !== 0 && guard++ < 8) {
    const q = getTzParts(new Date(cursor.getTime() - 12 * 3_600_000), timeZone);
    cursor = zonedTimeToUtc({ year: q.year, month: q.month, day: q.day }, timeZone);
  }
  return cursor;
}

/** Saturday 23:59:59.999 local of the week containing `date`. */
export function endOfWeekInTz(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const start = startOfWeekInTz(date, timeZone);
  const p = getTzParts(start, timeZone);
  const nextSunday = zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day + 7 },
    timeZone,
  );
  return new Date(nextSunday.getTime() - 1);
}

export function startOfMonthInTz(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = getTzParts(date, timeZone);
  return zonedTimeToUtc({ year: p.year, month: p.month, day: 1 }, timeZone);
}

export function endOfMonthInTz(date: Date, timeZone = DEFAULT_TIMEZONE): Date {
  const p = getTzParts(date, timeZone);
  const nextMonth = p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
  return new Date(zonedTimeToUtc({ ...nextMonth, day: 1 }, timeZone).getTime() - 1);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

/** Adds `days` in local calendar terms, preserving the local time of day. */
export function addDaysInTz(date: Date, days: number, timeZone = DEFAULT_TIMEZONE): Date {
  const p = getTzParts(date, timeZone);
  return zonedTimeToUtc(
    { year: p.year, month: p.month, day: p.day + days, hour: p.hour, minute: p.minute, second: p.second },
    timeZone,
  );
}

/** Skips Saturdays and Sundays. Used by follow-up rules with business-day delays. */
export function addBusinessDaysInTz(date: Date, days: number, timeZone = DEFAULT_TIMEZONE): Date {
  let cursor = date;
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    cursor = addDaysInTz(cursor, 1, timeZone);
    const wd = getTzParts(cursor, timeZone).weekday;
    if (wd !== 0 && wd !== 6) remaining -= 1;
  }
  return cursor;
}

/** ISO-8601 week label such as `2026-W31`. Used as the human sprint identifier. */
export function isoWeekLabel(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = getTzParts(date, timeZone);
  const utc = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function formatInTz(
  date: Date,
  timeZone = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, ...options }).format(date);
}

export function formatDateInTz(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = getTzParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "HH:MM" local wall clock. */
export function formatTimeInTz(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const p = getTzParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function parseHhMm(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return { hour: Number(h ?? 0) || 0, minute: Number(m ?? 0) || 0 };
}

export function secondsToHours(seconds: number, decimals = 2): number {
  return Number((seconds / 3600).toFixed(decimals));
}

export function humanDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
