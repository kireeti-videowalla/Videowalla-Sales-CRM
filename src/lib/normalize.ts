import { sha256 } from './crypto';

/**
 * Deduplication depends entirely on these functions producing the same output
 * for the same real-world entity. They are pure and unit-tested in
 * normalize.test.ts.
 */

const COMPANY_SUFFIXES = [
  'inc', 'inc.', 'incorporated', 'ltd', 'ltd.', 'limited', 'llc', 'llp', 'lp',
  'corp', 'corp.', 'corporation', 'co', 'co.', 'company', 'gmbh', 'plc',
  'ulc', 'pc', 'professional corporation',
];

const NOISE_WORDS = ['the', 'and', '&'];

/** Lowercase, strip punctuation, legal suffixes and filler words. */
export function normalizeCompanyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s&.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = base
    .split(' ')
    .filter(Boolean)
    .filter((t) => !NOISE_WORDS.includes(t));

  while (tokens.length > 1 && COMPANY_SUFFIXES.includes(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }

  return tokens.join(' ').replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
}

const PUBLIC_SUFFIX_TWO_PART = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'com.br', 'co.jp', 'co.za', 'com.mx',
]);

/**
 * Extracts the registrable domain, dropping `www.` and any subdomain. This is
 * the single strongest dedup signal we have, so it must be conservative.
 * Returns null for URLs that cannot host a company site (mailto:, IPs, etc).
 */
export function extractDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim().toLowerCase();
  if (!value) return null;
  // Reject non-web schemes outright. Without this, `mailto:a@b.com` would be
  // coerced into `https://mailto:a@b.com` and yield a bogus domain.
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(value)?.[1];
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;
  if (!scheme) value = `https://${value}`;

  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }

  host = host.replace(/^www\./, '');
  if (!host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  if (PUBLIC_SUFFIX_TWO_PART.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let value = input.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    url.hash = '';
    // Strip tracking noise so the same posting from two emails dedupes.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|_hs|ref|source)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * North-American phone normalisation to E.164. Returns null rather than
 * guessing when the input is not a plausible NANP number — a wrong number is
 * worse than a missing one.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, '');
  if (!digits) return null;

  let d = digits.startsWith('+') ? digits.slice(1) : digits;
  if (d.length === 10) d = `1${d}`;
  if (d.length === 11 && d.startsWith('1')) {
    const area = d.slice(1, 4);
    const exchange = d.slice(4, 7);
    // NANP: area and exchange codes cannot start with 0 or 1.
    if (/^[2-9]/.test(area) && /^[2-9]/.test(exchange)) return `+${d}`;
    return null;
  }
  if (d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  return EMAIL_RE.test(value) ? value : null;
}

export function isLikelyRoleEmail(email: string): boolean {
  const local = email.split('@')[0] ?? '';
  return /^(info|contact|hello|sales|admin|office|support|enquiries|inquiries|team|careers|jobs|hr)$/.test(
    local,
  );
}

export function normalizeJobTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\b(senior|junior|jr|sr|lead|head of|entry level|intern|contract|full[- ]?time|part[- ]?time|remote|hybrid|on[- ]?site)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Stable short hash used for source-record external ids. */
export function stableKey(...parts: Array<string | null | undefined>): string {
  return sha256(parts.map((p) => (p ?? '').trim().toLowerCase()).join('|')).slice(0, 40);
}

/** Human-readable ticket reference, e.g. VW-4F2A9C. */
export function ticketReference(seed: string): string {
  return `VW-${sha256(seed).slice(0, 6).toUpperCase()}`;
}

export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');
}

export function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`;
}
