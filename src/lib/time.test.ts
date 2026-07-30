import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addBusinessDaysInTz,
  endOfWeekInTz,
  formatDateInTz,
  getTzParts,
  isoWeekLabel,
  startOfWeekInTz,
  zonedTimeToUtc,
} from './time';

const TZ = 'America/Toronto';

test('startOfWeekInTz returns local Sunday midnight during EDT', () => {
  // Wed 2026-07-29 14:00 EDT
  const d = new Date('2026-07-29T18:00:00Z');
  const start = startOfWeekInTz(d, TZ);
  const p = getTzParts(start, TZ);
  assert.equal(p.weekday, 0);
  assert.equal(p.hour, 0);
  assert.equal(p.minute, 0);
  assert.equal(formatDateInTz(start, TZ), '2026-07-26');
});

test('startOfWeekInTz returns local Sunday midnight during EST', () => {
  // Wed 2026-01-14 09:00 EST
  const d = new Date('2026-01-14T14:00:00Z');
  const start = startOfWeekInTz(d, TZ);
  const p = getTzParts(start, TZ);
  assert.equal(p.weekday, 0);
  assert.equal(p.hour, 0);
  assert.equal(formatDateInTz(start, TZ), '2026-01-11');
});

test('a Sunday is its own week start', () => {
  const sunday = zonedTimeToUtc({ year: 2026, month: 7, day: 26, hour: 18 }, TZ);
  assert.equal(formatDateInTz(startOfWeekInTz(sunday, TZ), TZ), '2026-07-26');
});

test('week spans exactly seven local days across a DST change', () => {
  // Week containing the 2026-03-08 spring-forward transition.
  const d = zonedTimeToUtc({ year: 2026, month: 3, day: 10, hour: 12 }, TZ);
  const start = startOfWeekInTz(d, TZ);
  const end = endOfWeekInTz(d, TZ);
  assert.equal(formatDateInTz(start, TZ), '2026-03-08');
  assert.equal(formatDateInTz(end, TZ), '2026-03-14');
  // 7 days minus one hour lost to DST, minus 1ms.
  assert.equal(end.getTime() - start.getTime(), 7 * 86_400_000 - 3_600_000 - 1);
});

test('zonedTimeToUtc resolves Sunday 18:00 Toronto correctly in both offsets', () => {
  const summer = zonedTimeToUtc({ year: 2026, month: 7, day: 26, hour: 18 }, TZ);
  assert.equal(summer.toISOString(), '2026-07-26T22:00:00.000Z'); // EDT = UTC-4
  const winter = zonedTimeToUtc({ year: 2026, month: 1, day: 11, hour: 18 }, TZ);
  assert.equal(winter.toISOString(), '2026-01-11T23:00:00.000Z'); // EST = UTC-5
});

test('addBusinessDaysInTz skips weekends', () => {
  const friday = zonedTimeToUtc({ year: 2026, month: 7, day: 31, hour: 10 }, TZ);
  const twoDays = addBusinessDaysInTz(friday, 2, TZ);
  assert.equal(formatDateInTz(twoDays, TZ), '2026-08-04'); // Tuesday
});

test('isoWeekLabel produces stable ISO week identifiers', () => {
  assert.equal(isoWeekLabel(new Date('2026-07-30T12:00:00Z'), TZ), '2026-W31');
});
