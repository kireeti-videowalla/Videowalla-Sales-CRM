import { normalizeUrl, stableKey, truncate } from '../normalize';

/**
 * Parses alert emails into candidate opportunities.
 *
 * Important boundary: we only ever read email the owner has forwarded or
 * labelled in their own mailbox, and we follow links no further than recording
 * them. Nothing here logs into, scrapes, or circumvents access controls on
 * Indeed, LinkedIn or any other platform.
 */

export type ParsedCandidate = {
  /** Stable identity for dedup: same alert twice must produce the same key. */
  externalId: string;
  title: string | null;
  companyName: string | null;
  location: string | null;
  url: string | null;
  snippet: string;
  platform: string | null;
  postedAtText: string | null;
};

export type ParsedEmail = {
  detectedKind:
    | 'GOOGLE_ALERT'
    | 'INDEED_ALERT_EMAIL'
    | 'LINKEDIN_ALERT_EMAIL'
    | 'JOB_ALERT_EMAIL'
    | 'GMAIL_MESSAGE';
  platform: string | null;
  candidates: ParsedCandidate[];
};

export type RawEmail = {
  messageId: string;
  subject: string;
  from: string;
  receivedAt: Date;
  textBody: string;
  htmlBody?: string | null;
};

const TRACKING_HOSTS =
  /(google\.com\/url|indeed\.com\/rc\/clk|linkedin\.com\/comm|list-manage\.com|click\.|track\.|email\.|sendgrid\.net|mailchimp)/i;

/** Google/Indeed/LinkedIn wrap destinations in redirectors; unwrap to the real URL. */
export function unwrapTrackingUrl(input: string): string {
  let url = input;
  for (let i = 0; i < 3; i += 1) {
    try {
      const parsed = new URL(url);
      const target =
        parsed.searchParams.get('url') ??
        parsed.searchParams.get('u') ??
        parsed.searchParams.get('q') ??
        parsed.searchParams.get('targetUrl');
      if (target && /^https?:\/\//i.test(target)) {
        url = decodeURIComponent(target);
        continue;
      }
    } catch {
      return input;
    }
    break;
  }
  return url;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    // Trim each line so stripped tags do not leave leading/trailing padding.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type HtmlLink = { href: string; text: string };

function extractHtmlLinks(html: string): HtmlLink[] {
  const links: HtmlLink[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const href = m[1];
    const text = htmlToText(m[2] ?? '').trim();
    if (!href || href.startsWith('mailto:') || href.startsWith('#')) continue;
    links.push({ href: unwrapTrackingUrl(href), text });
  }
  return links;
}

function detectPlatform(email: RawEmail): { kind: ParsedEmail['detectedKind']; platform: string | null } {
  const from = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();

  if (from.includes('googlealerts') || subject.startsWith('google alert')) {
    return { kind: 'GOOGLE_ALERT', platform: 'Google Alerts' };
  }
  if (from.includes('indeed')) return { kind: 'INDEED_ALERT_EMAIL', platform: 'Indeed' };
  if (from.includes('linkedin')) return { kind: 'LINKEDIN_ALERT_EMAIL', platform: 'LinkedIn' };
  if (from.includes('ziprecruiter')) return { kind: 'JOB_ALERT_EMAIL', platform: 'ZipRecruiter' };
  if (from.includes('glassdoor')) return { kind: 'JOB_ALERT_EMAIL', platform: 'Glassdoor' };
  if (from.includes('jobbank') || from.includes('guichetemplois')) {
    return { kind: 'JOB_ALERT_EMAIL', platform: 'Job Bank' };
  }
  if (/\b(job alert|new jobs?|hiring|job posting)\b/.test(subject)) {
    return { kind: 'JOB_ALERT_EMAIL', platform: null };
  }
  return { kind: 'GMAIL_MESSAGE', platform: null };
}

/** "Social Media Manager - Summit Ridge Builders - Toronto, ON" */
function splitJobLine(text: string): { title: string | null; company: string | null; location: string | null } {
  const parts = text
    .split(/\s+[-–—|]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return { title: parts[0] ?? null, company: parts[1] ?? null, location: parts.slice(2).join(' - ') };
  }
  if (parts.length === 2) {
    const second = parts[1] ?? '';
    // A trailing "City, ON" is a location, not a company.
    if (/,\s*[A-Z]{2}\b/.test(second) || /\b(ontario|toronto|canada|remote)\b/i.test(second)) {
      return { title: parts[0] ?? null, company: null, location: second };
    }
    return { title: parts[0] ?? null, company: second, location: null };
  }
  return { title: text.trim() || null, company: null, location: null };
}

function parseGoogleAlert(email: RawEmail, html: string | null): ParsedCandidate[] {
  const candidates: ParsedCandidate[] = [];
  const seen = new Set<string>();

  if (html) {
    for (const link of extractHtmlLinks(html)) {
      const url = normalizeUrl(link.href);
      if (!url || TRACKING_HOSTS.test(url)) continue;
      if (/google\.com\/(alerts|search)/i.test(url)) continue;
      if (!link.text || link.text.length < 8) continue;
      if (/^(unsubscribe|see more|view all|manage|flag as irrelevant|rss feed)/i.test(link.text)) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      const split = splitJobLine(link.text);
      candidates.push({
        externalId: stableKey('google-alert', url),
        title: split.title,
        companyName: split.company,
        location: split.location,
        url,
        snippet: truncate(link.text, 500),
        platform: 'Google Alerts',
        postedAtText: null,
      });
    }
  }

  if (candidates.length === 0) {
    // Plain-text alerts: "<title>\n<url>\n<snippet>"
    const blocks = email.textBody.split(/\n\s*\n/);
    for (const block of blocks) {
      const urlMatch = /https?:\/\/\S+/.exec(block);
      if (!urlMatch) continue;
      const url = normalizeUrl(unwrapTrackingUrl(urlMatch[0]));
      if (!url || seen.has(url) || /google\.com\/alerts/i.test(url)) continue;
      seen.add(url);
      const title = block.split('\n')[0]?.trim() ?? null;
      const split = splitJobLine(title ?? '');
      candidates.push({
        externalId: stableKey('google-alert', url),
        title: split.title,
        companyName: split.company,
        location: split.location,
        url,
        snippet: truncate(block.trim(), 800),
        platform: 'Google Alerts',
        postedAtText: null,
      });
    }
  }

  return candidates;
}

function parseJobBoardAlert(
  email: RawEmail,
  html: string | null,
  platform: string | null,
): ParsedCandidate[] {
  const candidates: ParsedCandidate[] = [];
  const seen = new Set<string>();

  const jobUrlPattern =
    /(viewjob|\/jobs\/view|\/job\/|\/careers?\/|\/postings?\/|jk=|currentJobId|\/vacancy\/)/i;

  if (html) {
    const links = extractHtmlLinks(html);
    for (const link of links) {
      const url = normalizeUrl(link.href);
      if (!url) continue;
      if (!jobUrlPattern.test(url)) continue;
      if (!link.text || link.text.length < 4) continue;
      if (/^(unsubscribe|view all|see all|update|settings|privacy)/i.test(link.text)) continue;

      // Board urls carry a job id; use it so the same posting arriving in two
      // different alert emails collapses to one record.
      const idMatch = /(?:jk=|currentJobId=|\/view\/|\/job\/)([A-Za-z0-9_-]{5,})/.exec(url);
      const key = idMatch?.[1] ?? url;
      if (seen.has(key)) continue;
      seen.add(key);

      const split = splitJobLine(link.text);
      // Surrounding text often carries "Company – City, ON" right after the link.
      const context = extractContextAfter(html, link.href);

      candidates.push({
        externalId: stableKey(platform ?? 'job-alert', key),
        title: split.title,
        companyName: split.company ?? context.company,
        location: split.location ?? context.location,
        url,
        snippet: truncate([link.text, context.raw].filter(Boolean).join(' — '), 800),
        platform,
        postedAtText: context.posted,
      });
    }
  }

  if (candidates.length === 0) {
    for (const block of email.textBody.split(/\n\s*\n/)) {
      const urlMatch = /https?:\/\/\S+/.exec(block);
      if (!urlMatch) continue;
      const url = normalizeUrl(unwrapTrackingUrl(urlMatch[0]));
      if (!url || !jobUrlPattern.test(url) || seen.has(url)) continue;
      seen.add(url);
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const split = splitJobLine(lines[0] ?? '');
      candidates.push({
        externalId: stableKey(platform ?? 'job-alert', url),
        title: split.title,
        companyName: split.company ?? lines[1] ?? null,
        location: split.location ?? lines[2] ?? null,
        url,
        snippet: truncate(block.trim(), 800),
        platform,
        postedAtText: null,
      });
    }
  }

  return candidates;
}

function extractContextAfter(html: string, href: string): {
  company: string | null;
  location: string | null;
  posted: string | null;
  raw: string;
} {
  const idx = html.indexOf(href);
  if (idx === -1) return { company: null, location: null, posted: null, raw: '' };
  const raw = htmlToText(html.slice(idx, idx + 900));
  const location = /([A-Z][A-Za-z.\s-]{2,30},\s*(?:ON|Ontario|BC|AB|QC|MB|SK|NS|NB|NL|PE))\b/.exec(raw)?.[1] ?? null;
  const posted = /(\d+\+?\s*(?:day|hour|week|month)s?\s*ago|just posted|today|yesterday)/i.exec(raw)?.[1] ?? null;
  const company = /(?:^|\n)\s*(?:at\s+)?([A-Z][\w&'.,-]*(?:\s+[A-Z][\w&'.,-]*){0,4})\s*(?:\n|—|-)/.exec(raw)?.[1]?.trim() ?? null;
  return { company, location, posted, raw: truncate(raw, 400) };
}

/**
 * Fallback for a hand-forwarded email: treat the whole message as one
 * candidate so nothing the owner forwards is silently dropped.
 */
function parseGenericEmail(email: RawEmail, text: string): ParsedCandidate[] {
  const firstUrl = /https?:\/\/\S+/.exec(text)?.[0];
  const url = firstUrl ? normalizeUrl(unwrapTrackingUrl(firstUrl)) : null;
  return [
    {
      externalId: stableKey('email', email.messageId),
      title: email.subject || null,
      companyName: null,
      location: null,
      url,
      snippet: truncate(text, 4000),
      platform: null,
      postedAtText: null,
    },
  ];
}

export function parseEmail(email: RawEmail): ParsedEmail {
  const { kind, platform } = detectPlatform(email);
  const html = email.htmlBody ?? null;
  const text = email.textBody?.trim() ? email.textBody : html ? htmlToText(html) : '';

  let candidates: ParsedCandidate[];
  switch (kind) {
    case 'GOOGLE_ALERT':
      candidates = parseGoogleAlert(email, html);
      break;
    case 'INDEED_ALERT_EMAIL':
    case 'LINKEDIN_ALERT_EMAIL':
    case 'JOB_ALERT_EMAIL':
      candidates = parseJobBoardAlert(email, html, platform);
      break;
    default:
      candidates = [];
  }

  if (candidates.length === 0) candidates = parseGenericEmail(email, text);

  return { detectedKind: kind, platform, candidates };
}
