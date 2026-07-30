import type { Company, ConfidenceLevel, VerificationStatus } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { htmlToText } from '../ingestion/email-parser';
import {
  extractDomain,
  isLikelyRoleEmail,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  titleCase,
} from '../normalize';

const log = createLogger('pipeline.enrichment');

/**
 * Contact enrichment.
 *
 * Rules that are not negotiable:
 *  - Nothing is ever fabricated. A field is either found in a real source or
 *    left null and listed as missing.
 *  - Every value stores where it came from, when, and how confident we are.
 *  - Providers are pluggable so an approved commercial enrichment service can
 *    be added later without touching the pipeline.
 */

export type EnrichedField<T> = {
  value: T;
  source: string;
  sourceUrl?: string | null;
  confidence: ConfidenceLevel;
  status: VerificationStatus;
};

export type EnrichmentOutput = {
  provider: string;
  companyPhone?: EnrichedField<string> | null;
  companyEmail?: EnrichedField<string> | null;
  linkedinUrl?: EnrichedField<string> | null;
  instagramUrl?: EnrichedField<string> | null;
  facebookUrl?: EnrichedField<string> | null;
  websiteUrl?: EnrichedField<string> | null;
  description?: EnrichedField<string> | null;
  contacts: Array<{
    fullName: string;
    title: string | null;
    roleKind: string;
    phone: EnrichedField<string> | null;
    email: EnrichedField<string> | null;
    linkedinUrl: string | null;
    confidence: ConfidenceLevel;
    source: string;
  }>;
  missing: string[];
  errors: string[];
};

export interface EnrichmentProvider {
  name: string;
  isAvailable(): Promise<boolean>;
  enrich(company: Company): Promise<EnrichmentOutput>;
}

// ---------------------------------------------------------------------------
// Public website provider
// ---------------------------------------------------------------------------

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/about-us', '/our-team', '/team'];
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 600_000;

const PHONE_RE = /(?:\+?1[\s.\-–]?)?\(?([2-9]\d{2})\)?[\s.\-–]?(\d{3})[\s.\-–]?(\d{4})/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const OWNER_TITLE_RE =
  /\b(owner|founder|co[- ]founder|president|ceo|chief executive|managing director|principal|proprietor)\b/i;
const MARKETING_TITLE_RE =
  /\b(marketing (director|manager|lead|coordinator)|head of marketing|cmo|brand manager|communications manager)\b/i;

function roleKindFor(title: string): string {
  const t = title.toLowerCase();
  if (/co[- ]?founder|founder/.test(t)) return 'FOUNDER';
  if (/\bceo\b|chief executive/.test(t)) return 'CEO';
  if (/president/.test(t)) return 'PRESIDENT';
  if (/owner|proprietor|principal|managing director/.test(t)) return 'OWNER';
  if (/head of marketing|marketing director|cmo/.test(t)) return 'MARKETING_DECISION_MAKER';
  if (/marketing manager|brand manager|communications manager/.test(t)) return 'MARKETING_MANAGER';
  return 'OTHER';
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Identify honestly. We only read pages that are publicly served.
        'user-agent': 'VideowallaSalesBot/1.0 (+https://videowalla.co; internal sales research)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html')) return null;
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer.slice(0, MAX_BYTES)).toString('utf8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a company's own public website — the pages any visitor sees. It honours
 * a `Disallow: /` robots directive and never attempts a login, a CAPTCHA or a
 * platform that restricts automated access.
 */
async function isCrawlAllowed(origin: string): Promise<boolean> {
  const robots = await fetchPage(`${origin}/robots.txt`).catch(() => null);
  if (!robots) return true;
  const text = robots.toLowerCase();
  // Conservative: only back off on a blanket disallow for all agents.
  const generic = /user-agent:\s*\*([\s\S]*?)(?=\nuser-agent:|$)/.exec(text)?.[1] ?? '';
  return !/^\s*disallow:\s*\/\s*$/m.test(generic);
}

export class WebsiteEnrichmentProvider implements EnrichmentProvider {
  name = 'public_website';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async enrich(company: Company): Promise<EnrichmentOutput> {
    const out: EnrichmentOutput = { provider: this.name, contacts: [], missing: [], errors: [] };

    const website = normalizeUrl(company.websiteUrl);
    if (!website) {
      out.missing.push('Company website');
      out.errors.push('No website on record, so public-page enrichment could not run.');
      return out;
    }

    let origin: string;
    try {
      origin = new URL(website).origin;
    } catch {
      out.errors.push(`Malformed website URL: ${website}`);
      return out;
    }

    if (!(await isCrawlAllowed(origin))) {
      out.errors.push(`${origin} disallows automated access in robots.txt — skipped.`);
      return out;
    }

    const domain = extractDomain(website);
    const phones = new Map<string, string>();
    const emails = new Map<string, string>();
    const socials: Record<string, string> = {};
    const people = new Map<string, { title: string; url: string }>();
    let description: { text: string; url: string } | null = null;
    let pagesRead = 0;

    for (const path of CONTACT_PATHS) {
      const url = `${origin}${path}`;
      const html = await fetchPage(url);
      if (!html) continue;
      pagesRead += 1;

      const text = htmlToText(html);

      for (const raw of text.match(PHONE_RE) ?? []) {
        const normalized = normalizePhone(raw);
        if (normalized && !phones.has(normalized)) phones.set(normalized, url);
      }

      for (const raw of text.match(EMAIL_RE) ?? []) {
        const normalized = normalizeEmail(raw);
        if (!normalized) continue;
        // Only trust addresses on the company's own domain; a third-party
        // address on a page is usually a vendor, not this company.
        const emailDomain = normalized.split('@')[1];
        if (domain && emailDomain && !emailDomain.endsWith(domain)) continue;
        if (/\.(png|jpe?g|gif|webp|svg)$/i.test(normalized)) continue;
        if (!emails.has(normalized)) emails.set(normalized, url);
      }

      for (const m of html.matchAll(/https?:\/\/(?:www\.)?(linkedin\.com|instagram\.com|facebook\.com)\/[^\s"'<>)]+/gi)) {
        const host = m[1]!.toLowerCase();
        const key = host.startsWith('linkedin') ? 'linkedin' : host.startsWith('instagram') ? 'instagram' : 'facebook';
        if (!socials[key]) socials[key] = m[0];
      }

      if (!description) {
        const meta = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{40,400})["']/i.exec(html)?.[1];
        if (meta) description = { text: meta.trim(), url };
      }

      // "Jane Smith, Owner" / "Jane Smith — Founder"
      for (const m of text.matchAll(
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,2})\s*(?:,|—|–|-|\||\n)\s*([A-Za-z][A-Za-z\s&/]{2,40})/g,
      )) {
        const name = m[1]!.trim();
        const title = m[2]!.trim();
        if (!OWNER_TITLE_RE.test(title) && !MARKETING_TITLE_RE.test(title)) continue;
        if (name.split(/\s+/).length > 3) continue;
        if (!people.has(name)) people.set(name, { title: titleCase(title), url });
      }
    }

    if (pagesRead === 0) {
      out.errors.push(`Could not read any public page on ${origin}.`);
      return out;
    }

    const firstPhone = [...phones.entries()][0];
    if (firstPhone) {
      out.companyPhone = {
        value: firstPhone[0],
        source: 'Company website',
        sourceUrl: firstPhone[1],
        // Found on the company's own site, but not dialled — high, not verified.
        confidence: 'HIGH',
        status: 'HIGH_CONFIDENCE',
      };
    } else {
      out.missing.push('Business phone number');
    }

    const emailEntries = [...emails.entries()];
    const personalEmail = emailEntries.find(([e]) => !isLikelyRoleEmail(e));
    const chosenEmail = personalEmail ?? emailEntries[0];
    if (chosenEmail) {
      out.companyEmail = {
        value: chosenEmail[0],
        source: 'Company website',
        sourceUrl: chosenEmail[1],
        confidence: personalEmail ? 'HIGH' : 'MEDIUM',
        status: personalEmail ? 'HIGH_CONFIDENCE' : 'MEDIUM_CONFIDENCE',
      };
    } else {
      out.missing.push('Business email address');
    }

    for (const [key, field] of [
      ['linkedin', 'linkedinUrl'],
      ['instagram', 'instagramUrl'],
      ['facebook', 'facebookUrl'],
    ] as const) {
      const value = socials[key];
      if (value) {
        (out as Record<string, unknown>)[field] = {
          value: normalizeUrl(value) ?? value,
          source: 'Company website',
          sourceUrl: origin,
          confidence: 'HIGH',
          status: 'HIGH_CONFIDENCE',
        } satisfies EnrichedField<string>;
      }
    }

    if (description) {
      out.description = {
        value: description.text,
        source: 'Website meta description',
        sourceUrl: description.url,
        confidence: 'HIGH',
        status: 'HIGH_CONFIDENCE',
      };
    }

    for (const [name, info] of people) {
      const isOwner = OWNER_TITLE_RE.test(info.title);
      out.contacts.push({
        fullName: name,
        title: info.title,
        roleKind: roleKindFor(info.title),
        // Page-level phone/email are attached at company level, not guessed
        // onto a specific person — that would be fabrication.
        phone: null,
        email: null,
        linkedinUrl: socials.linkedin ?? null,
        confidence: isOwner ? 'MEDIUM' : 'LOW',
        source: `Company website (${info.url})`,
      });
    }

    if (out.contacts.length === 0) out.missing.push('Owner or decision-maker name');

    return out;
  }
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const providers: EnrichmentProvider[] = [new WebsiteEnrichmentProvider()];

export function registerEnrichmentProvider(provider: EnrichmentProvider): void {
  providers.push(provider);
}

/**
 * Runs every available provider and persists results, keeping an audit trail of
 * every field attempted (including failures) in EnrichmentRecord.
 */
export async function enrichCompany(companyId: string): Promise<{
  attempted: number;
  fieldsWritten: number;
  contactsCreated: number;
  missing: string[];
  errors: string[];
}> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error(`Company ${companyId} not found`);

  const summary = { attempted: 0, fieldsWritten: 0, contactsCreated: 0, missing: [] as string[], errors: [] as string[] };

  for (const provider of providers) {
    if (!(await provider.isAvailable())) continue;
    summary.attempted += 1;

    let output: EnrichmentOutput;
    try {
      output = await provider.enrich(company);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('enrichment provider failed', { provider: provider.name, companyId, message });
      summary.errors.push(`${provider.name}: ${message}`);
      await prisma.enrichmentRecord.create({
        data: {
          companyId,
          provider: provider.name,
          field: '*',
          succeeded: false,
          errorMessage: message.slice(0, 1000),
          status: 'UNVERIFIED',
        },
      });
      continue;
    }

    summary.missing.push(...output.missing);
    summary.errors.push(...output.errors);

    const companyUpdates: Record<string, unknown> = {};

    const applyField = async (
      field: keyof Company,
      recordField: string,
      enriched: EnrichedField<string> | null | undefined,
      transform?: (v: string) => string | null,
    ) => {
      if (!enriched) return;
      await prisma.enrichmentRecord.create({
        data: {
          companyId,
          provider: provider.name,
          field: recordField,
          value: enriched.value,
          source: enriched.source,
          sourceUrl: enriched.sourceUrl ?? null,
          confidence: enriched.confidence,
          status: enriched.status,
        },
      });
      // Never overwrite a value we already hold.
      if (company[field]) return;
      const value = transform ? transform(enriched.value) : enriched.value;
      if (!value) return;
      companyUpdates[field as string] = value;
      if (field === 'phone') companyUpdates.normalizedPhone = normalizePhone(value);
      summary.fieldsWritten += 1;
    };

    await applyField('phone', 'company.phone', output.companyPhone);
    await applyField('email', 'company.email', output.companyEmail);
    await applyField('linkedinUrl', 'company.linkedin', output.linkedinUrl);
    await applyField('instagramUrl', 'company.instagram', output.instagramUrl);
    await applyField('facebookUrl', 'company.facebook', output.facebookUrl);
    await applyField('description', 'company.description', output.description);

    if (Object.keys(companyUpdates).length > 0) {
      await prisma.company.update({ where: { id: companyId }, data: companyUpdates });
    }

    for (const person of output.contacts) {
      const existing = await prisma.contact.findFirst({
        where: { companyId, fullName: { equals: person.fullName, mode: 'insensitive' } },
      });
      if (existing) continue;

      const hasPrimary = await prisma.contact.findFirst({ where: { companyId, isPrimary: true } });
      await prisma.contact.create({
        data: {
          companyId,
          fullName: person.fullName,
          title: person.title,
          roleKind: person.roleKind,
          isPrimary: !hasPrimary,
          phone: person.phone?.value ?? null,
          normalizedPhone: person.phone ? normalizePhone(person.phone.value) : null,
          phoneSource: person.phone?.source ?? null,
          phoneStatus: person.phone?.status ?? 'UNVERIFIED',
          phoneCheckedAt: person.phone ? new Date() : null,
          email: person.email?.value ?? null,
          emailSource: person.email?.source ?? null,
          emailStatus: person.email?.status ?? 'UNVERIFIED',
          emailCheckedAt: person.email ? new Date() : null,
          linkedinUrl: person.linkedinUrl,
          discoverySource: person.source,
          confidence: person.confidence,
        },
      });
      summary.contactsCreated += 1;

      await prisma.enrichmentRecord.create({
        data: {
          companyId,
          provider: provider.name,
          field: 'contact.person',
          value: { fullName: person.fullName, title: person.title, roleKind: person.roleKind },
          source: person.source,
          confidence: person.confidence,
          status: 'UNVERIFIED',
        },
      });
    }
  }

  summary.missing = [...new Set(summary.missing)];
  return summary;
}
