import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToText, parseEmail, unwrapTrackingUrl, type RawEmail } from './email-parser';

function email(overrides: Partial<RawEmail>): RawEmail {
  return {
    messageId: 'msg-1',
    subject: 'Job alert',
    from: 'alerts@example.com',
    receivedAt: new Date('2026-07-27T12:00:00Z'),
    textBody: '',
    htmlBody: null,
    ...overrides,
  };
}

test('unwrapTrackingUrl recovers the destination from a Google redirector', () => {
  const wrapped = 'https://www.google.com/url?rct=j&url=https%3A%2F%2Fsummitridge.ca%2Fcareers%2Fsocial-media&usg=x';
  assert.equal(unwrapTrackingUrl(wrapped), 'https://summitridge.ca/careers/social-media');
});

test('htmlToText strips markup and collapses whitespace', () => {
  const out = htmlToText('<div><h1>Hi</h1><p>A&nbsp;&amp;&nbsp;B</p><script>bad()</script></div>');
  assert.equal(out, 'Hi\nA & B');
  assert.ok(!out.includes('bad()'));
});

test('Google Alert email yields one candidate per real destination link', () => {
  const html = `
    <html><body>
      <a href="https://www.google.com/url?url=https%3A%2F%2Fsummitridge.ca%2Fcareers%2Fsocial-media-manager">
        Social Media Manager - Summit Ridge Builders - Toronto, ON
      </a>
      <a href="https://www.google.com/url?url=https%3A%2F%2Fnorthwindhvac.ca%2Fjobs%2Fvideographer">
        Videographer - Northwind Heating &amp; Cooling - Burlington, ON
      </a>
      <a href="https://www.google.com/alerts/manage">Manage alerts</a>
      <a href="https://google.com/unsub">Unsubscribe</a>
    </body></html>`;
  const parsed = parseEmail(
    email({ from: 'googlealerts-noreply@google.com', subject: 'Google Alert - videographer', htmlBody: html }),
  );

  assert.equal(parsed.detectedKind, 'GOOGLE_ALERT');
  assert.equal(parsed.candidates.length, 2);
  const [first, second] = parsed.candidates;
  assert.equal(first?.title, 'Social Media Manager');
  assert.equal(first?.companyName, 'Summit Ridge Builders');
  assert.equal(first?.location, 'Toronto, ON');
  assert.equal(first?.url, 'https://summitridge.ca/careers/social-media-manager');
  assert.equal(second?.companyName, 'Northwind Heating & Cooling');
});

test('the same Google Alert parsed twice produces identical external ids', () => {
  const html = `<a href="https://summitridge.ca/careers/social-media-manager">Social Media Manager - Summit Ridge Builders - Toronto, ON</a>`;
  const a = parseEmail(email({ from: 'googlealerts-noreply@google.com', htmlBody: html, messageId: 'm1' }));
  const b = parseEmail(email({ from: 'googlealerts-noreply@google.com', htmlBody: html, messageId: 'm2' }));
  assert.equal(a.candidates[0]?.externalId, b.candidates[0]?.externalId);
});

test('Indeed alert keys candidates on the job id so duplicates collapse', () => {
  const html = `
    <a href="https://ca.indeed.com/viewjob?jk=abc123def456&from=alert">Content Creator</a>
    <p>Maple Ridge Dental — Oakville, ON<br>3 days ago</p>
    <a href="https://ca.indeed.com/viewjob?jk=abc123def456&from=email">Content Creator</a>`;
  const parsed = parseEmail(email({ from: 'alert@indeed.com', subject: 'New jobs for content creator', htmlBody: html }));

  assert.equal(parsed.detectedKind, 'INDEED_ALERT_EMAIL');
  assert.equal(parsed.platform, 'Indeed');
  assert.equal(parsed.candidates.length, 1, 'the same jk= must not create two candidates');
  assert.equal(parsed.candidates[0]?.title, 'Content Creator');
  assert.equal(parsed.candidates[0]?.postedAtText, '3 days ago');
});

test('LinkedIn alert is detected from the sender', () => {
  const html = `<a href="https://www.linkedin.com/jobs/view/4012345678/">Marketing Manager - Lakeshore Plumbing</a>`;
  const parsed = parseEmail(email({ from: 'jobs-noreply@linkedin.com', htmlBody: html }));
  assert.equal(parsed.detectedKind, 'LINKEDIN_ALERT_EMAIL');
  assert.equal(parsed.candidates[0]?.companyName, 'Lakeshore Plumbing');
});

test('an unrecognised forwarded email still produces one candidate', () => {
  const parsed = parseEmail(
    email({
      from: 'kireeti@videowalla.co',
      subject: 'Fwd: this company might need us',
      textBody: 'Saw this: https://harbourpointdental.ca/careers — they want a content person.',
    }),
  );
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0]?.url, 'https://harbourpointdental.ca/careers');
  assert.match(parsed.candidates[0]?.snippet ?? '', /content person/);
});

test('plain-text Google Alerts are parsed when there is no HTML part', () => {
  const parsed = parseEmail(
    email({
      from: 'googlealerts-noreply@google.com',
      subject: 'Google Alert - social media manager',
      textBody: [
        'Social Media Manager - Riverstone Renovations - Hamilton, ON',
        'https://riverstonereno.ca/careers/social-media-manager',
        'Riverstone is looking for a social media manager to run content.',
      ].join('\n'),
    }),
  );
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0]?.companyName, 'Riverstone Renovations');
  assert.equal(parsed.candidates[0]?.location, 'Hamilton, ON');
});
