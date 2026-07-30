import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractDomain,
  normalizeCompanyName,
  normalizeEmail,
  normalizeJobTitle,
  normalizePhone,
  normalizeUrl,
} from './normalize';

test('normalizeCompanyName collapses legal suffixes and punctuation', () => {
  const expected = 'summit ridge builders';
  for (const variant of [
    'Summit Ridge Builders Inc.',
    'SUMMIT RIDGE BUILDERS LTD',
    'Summit-Ridge Builders, Inc',
    'The Summit Ridge Builders Corporation',
  ]) {
    assert.equal(normalizeCompanyName(variant), expected, variant);
  }
});

test('normalizeCompanyName keeps a single-word name that looks like a suffix', () => {
  assert.equal(normalizeCompanyName('Limited'), 'limited');
});

test('extractDomain strips subdomains and www', () => {
  assert.equal(extractDomain('https://www.summitridge.ca/careers'), 'summitridge.ca');
  assert.equal(extractDomain('careers.summitridge.ca'), 'summitridge.ca');
  assert.equal(extractDomain('http://summitridge.co.uk/jobs'), 'summitridge.co.uk');
  assert.equal(extractDomain('mailto:a@b.com'), null);
  assert.equal(extractDomain('192.168.1.1'), null);
  assert.equal(extractDomain(''), null);
});

test('normalizeUrl removes tracking params so duplicate alerts collapse', () => {
  assert.equal(
    normalizeUrl('https://www.Example.com/job/123/?utm_source=alert&gclid=xyz&id=7'),
    'https://example.com/job/123?id=7',
  );
});

test('normalizePhone produces E.164 and rejects impossible NANP numbers', () => {
  assert.equal(normalizePhone('(416) 555-0142'), '+14165550142');
  assert.equal(normalizePhone('416.555.0142'), '+14165550142');
  assert.equal(normalizePhone('+1 416 555 0142'), '+14165550142');
  assert.equal(normalizePhone('116-555-0142'), null); // area code starts with 1
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(null), null);
});

test('normalizeEmail validates rather than guesses', () => {
  assert.equal(normalizeEmail('  Owner@Example.COM '), 'owner@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.equal(normalizeEmail('a@b'), null);
});

test('normalizeJobTitle strips seniority and employment modifiers', () => {
  assert.equal(normalizeJobTitle('Senior Social Media Manager (Full-Time)'), 'social media manager');
  assert.equal(normalizeJobTitle('Jr. Videographer - Remote'), 'videographer -');
});
