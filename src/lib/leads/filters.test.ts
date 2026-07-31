import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLeadWhere } from './filters';

/**
 * The bug these tests exist to prevent: composing the query with repeated
 * `...(cond ? { company: {...} } : {})` spreads means two conditions that both
 * target `company` overwrite each other, so a filter the user selected is
 * silently ignored and they get results that do not match what they asked for.
 */

test('two company-level filters both survive', () => {
  const where = buildLeadWhere({ industry: 'plumbing', hasPhone: 'yes' }, 'OWNER', null);
  const company = where.company as Record<string, unknown>;
  assert.deepEqual(company.industry, { slug: 'plumbing' });
  assert.deepEqual(company.normalizedPhone, { not: null });
});

test('four company-level filters all survive together', () => {
  const where = buildLeadWhere(
    { industry: 'hvac', location: 'toronto', hasPhone: 'yes', minEmployees: '5' },
    'OWNER',
    null,
  );
  const company = where.company as Record<string, unknown>;
  assert.deepEqual(company.industry, { slug: 'hvac' });
  assert.deepEqual(company.location, { slug: 'toronto' });
  assert.deepEqual(company.normalizedPhone, { not: null });
  assert.deepEqual(company.employeeCountMin, { gte: 5 });
});

test('opportunity-level filters combine rather than replace', () => {
  const where = buildLeadWhere({ hiring: 'yes', source: 'GOOGLE_ALERT', postingAge: '7' }, 'OWNER', null);
  const opp = where.opportunity as Record<string, unknown>;
  assert.equal(opp.kind, 'HIRING_INTENT');
  assert.deepEqual(opp.sourceRecord, { kind: 'GOOGLE_ALERT' });
  assert.deepEqual(opp.postingAgeDays, { lte: 7 });
});

test('a score range produces both bounds', () => {
  const where = buildLeadWhere({ minScore: '60', maxScore: '80' }, 'OWNER', null);
  assert.deepEqual(where.score, { gte: 60, lte: 80 });
});

test('do-not-contact companies are hidden unless explicitly requested', () => {
  const hidden = buildLeadWhere({}, 'OWNER', null).company as Record<string, unknown>;
  assert.equal(hidden.doNotContact, false);

  const shown = buildLeadWhere({ dnc: 'yes' }, 'OWNER', null).company as Record<string, unknown>;
  assert.equal(shown.doNotContact, true);
});

test('a sales rep is always scoped to their own leads, whatever the query string says', () => {
  const where = buildLeadWhere({ assignee: 'someone-else' }, 'SALES_REP', 'rep-1');
  assert.equal(where.assigneeId, 'rep-1');
});

test('an owner may filter by any assignee', () => {
  assert.equal(buildLeadWhere({ assignee: 'rep-2' }, 'OWNER', null).assigneeId, 'rep-2');
  assert.equal(buildLeadWhere({ assignee: 'unassigned' }, 'OWNER', null).assigneeId, null);
});

test('an empty filter set does not over-constrain the query', () => {
  const where = buildLeadWhere({}, 'OWNER', null);
  assert.equal(where.opportunity, undefined);
  assert.equal(where.score, undefined);
  assert.equal(where.stage, undefined);
});

test('sprint filter distinguishes "no sprint" from a specific sprint', () => {
  assert.equal(buildLeadWhere({ sprint: 'none' }, 'OWNER', null).sprintId, null);
  assert.equal(buildLeadWhere({ sprint: 'abc' }, 'OWNER', null).sprintId, 'abc');
});
