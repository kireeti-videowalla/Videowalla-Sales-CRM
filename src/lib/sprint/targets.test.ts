import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultsFor } from '../settings/definitions';
import { calculateTargets, leadsToPrepare, type TargetInputs } from './targets';

const config = defaultsFor('sprint.capacity');

function inputs(overrides: Partial<TargetInputs> = {}): TargetInputs {
  return {
    availableHours: 8,
    plannedShiftCount: 2,
    overdueFollowUps: 0,
    dueFollowUps: 0,
    interestedAwaitingAction: 0,
    unconfirmedInvites: 0,
    availableNewLeads: 100,
    historicalConversationRate: null,
    historicalInterestRate: null,
    historicalMeetingRate: null,
    ...overrides,
  };
}

test('a clean 8-hour week lands inside the 30-40 default range', () => {
  const t = calculateTargets(inputs(), config);
  assert.ok(t.totalContacts >= 30 && t.totalContacts <= 40, `got ${t.totalContacts}`);
  assert.equal(t.followUps, 0);
  assert.equal(t.newContacts, t.totalContacts);
});

test('a heavy follow-up week shifts the mix toward follow-ups, not more total work', () => {
  const light = calculateTargets(inputs(), config);
  const heavy = calculateTargets(
    inputs({ overdueFollowUps: 10, dueFollowUps: 5, interestedAwaitingAction: 5, unconfirmedInvites: 2 }),
    config,
  );

  assert.ok(heavy.followUps >= 15, `expected follow-up work, got ${heavy.followUps}`);
  assert.ok(heavy.newContacts < light.newContacts, 'new contacts must give way to committed work');
  assert.ok(heavy.plannedMinutes <= heavy.availableMinutes, 'plan must fit the available time');
});

test('targets never exceed the qualified leads actually prepared', () => {
  const t = calculateTargets(inputs({ availableNewLeads: 12 }), config);
  assert.equal(t.newContacts, 12);
  assert.ok(t.leadShortfall > 0, 'a shortage must be flagged for the owner');
});

test('the plan always fits inside the available minutes', () => {
  for (const hours of [2, 4, 6, 8, 10]) {
    for (const shifts of [1, 2, 4]) {
      const t = calculateTargets(inputs({ availableHours: hours, plannedShiftCount: shifts }), config);
      assert.ok(
        t.plannedMinutes <= t.availableMinutes,
        `${hours}h/${shifts} shifts: planned ${t.plannedMinutes} > available ${t.availableMinutes}`,
      );
    }
  }
});

test('zero paid hours produces zero targets rather than a negative plan', () => {
  const t = calculateTargets(inputs({ availableHours: 0 }), config);
  assert.equal(t.totalContacts, 0);
  assert.equal(t.newContacts, 0);
  assert.equal(t.plannedMinutes, 0);
});

test('total contacts respect the configured hard maximum', () => {
  const t = calculateTargets(inputs({ availableHours: 40, plannedShiftCount: 5 }), config);
  assert.ok(t.totalContacts <= config.maxTotalContacts, `got ${t.totalContacts}`);
});

test('historical rates override the configured baselines', () => {
  const baseline = calculateTargets(inputs(), config);
  const withHistory = calculateTargets(
    inputs({ historicalConversationRate: 0.5, historicalInterestRate: 0.3, historicalMeetingRate: 0.2 }),
    config,
  );
  assert.ok(withHistory.conversations > baseline.conversations);
  assert.ok(withHistory.meetings > baseline.meetings);
  assert.match(withHistory.rationale.join(' '), /own history/);
});

test('every plan explains itself', () => {
  const t = calculateTargets(inputs({ overdueFollowUps: 8 }), config);
  assert.ok(t.rationale.length >= 3);
  assert.match(t.rationale.join(' '), /working minutes/);
});

test('leadsToPrepare adds a buffer above the new-contact target', () => {
  assert.equal(leadsToPrepare(20, config), 28); // 20 * 1.4
  assert.equal(leadsToPrepare(0, config), 0);
});
