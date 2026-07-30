import type { Company, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import {
  extractDomain,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
} from '../normalize';

const log = createLogger('pipeline.dedupe');

export type CompanyIdentity = {
  name: string;
  websiteUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  province?: string | null;
};

export type CompanyMatch = {
  company: Company;
  /** How the match was made — surfaced in the UI so a merge is explainable. */
  matchedBy: 'domain' | 'phone' | 'name+city' | 'name';
  confidence: number;
};

/**
 * Finds an existing company for an incoming identity.
 *
 * Ordered strongest-first. Domain is near-certain; a bare name match is weak
 * and only accepted when no city is known on either side, because two different
 * "Summit Plumbing" businesses in different cities are genuinely different
 * companies.
 */
export async function findExistingCompany(identity: CompanyIdentity): Promise<CompanyMatch | null> {
  const domain = extractDomain(identity.websiteUrl);
  if (domain) {
    const byDomain = await prisma.company.findUnique({ where: { websiteDomain: domain } });
    if (byDomain) return { company: byDomain, matchedBy: 'domain', confidence: 0.98 };
  }

  const phone = normalizePhone(identity.phone);
  if (phone) {
    const byPhone = await prisma.company.findFirst({ where: { normalizedPhone: phone } });
    if (byPhone) return { company: byPhone, matchedBy: 'phone', confidence: 0.9 };
  }

  const normalizedName = normalizeCompanyName(identity.name);
  if (!normalizedName) return null;

  const city = identity.city?.trim() || null;
  if (city) {
    const byNameCity = await prisma.company.findFirst({
      where: { normalizedName, city: { equals: city, mode: 'insensitive' } },
    });
    if (byNameCity) return { company: byNameCity, matchedBy: 'name+city', confidence: 0.85 };
  }

  const sameName = await prisma.company.findMany({ where: { normalizedName }, take: 5 });
  if (sameName.length === 1) {
    const only = sameName[0]!;
    // Accept only when neither side asserts a conflicting city.
    if (!city || !only.city || only.city.toLowerCase() === city.toLowerCase()) {
      return { company: only, matchedBy: 'name', confidence: 0.7 };
    }
  }

  return null;
}

export type UpsertCompanyInput = CompanyIdentity & {
  description?: string | null;
  industryId?: string | null;
  industryLabel?: string | null;
  locationId?: string | null;
  addressLine?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  serviceArea?: string | null;
  linkedinUrl?: string | null;
  instagramUrl?: string | null;
  reviewCount?: number | null;
  reviewRating?: number | null;
  employeeCountMin?: number | null;
  employeeCountMax?: number | null;
  employeeCountSource?: string | null;
  employeeCountConfidence?: Company['employeeCountConfidence'];
  revenueMinCents?: number | null;
  revenueMaxCents?: number | null;
  revenueSource?: string | null;
  revenueConfidence?: Company['revenueConfidence'];
};

/**
 * Creates a company or enriches the existing one.
 *
 * Never overwrites a populated field with null, and never downgrades a
 * higher-confidence estimate with a lower-confidence one — re-processing an
 * old alert must not erase better data gathered since.
 */
export async function upsertCompany(
  input: UpsertCompanyInput,
): Promise<{ company: Company; isNew: boolean; matchedBy: CompanyMatch['matchedBy'] | null }> {
  const match = await findExistingCompany(input);
  const domain = extractDomain(input.websiteUrl);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const websiteUrl = normalizeUrl(input.websiteUrl);

  if (!match) {
    const company = await prisma.company.create({
      data: {
        name: input.name.trim(),
        normalizedName: normalizeCompanyName(input.name),
        websiteUrl,
        websiteDomain: domain,
        description: input.description ?? null,
        industryId: input.industryId ?? null,
        industryLabel: input.industryLabel ?? null,
        locationId: input.locationId ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? 'CA',
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        serviceArea: input.serviceArea ?? null,
        phone: input.phone ?? null,
        normalizedPhone: phone,
        email,
        linkedinUrl: input.linkedinUrl ?? null,
        instagramUrl: input.instagramUrl ?? null,
        reviewCount: input.reviewCount ?? null,
        reviewRating: input.reviewRating ?? null,
        employeeCountMin: input.employeeCountMin ?? null,
        employeeCountMax: input.employeeCountMax ?? null,
        employeeCountSource: input.employeeCountSource ?? null,
        employeeCountConfidence: input.employeeCountConfidence ?? 'UNKNOWN',
        employeeCountCheckedAt: input.employeeCountMin != null ? new Date() : null,
        revenueMinCents: input.revenueMinCents != null ? BigInt(Math.round(input.revenueMinCents)) : null,
        revenueMaxCents: input.revenueMaxCents != null ? BigInt(Math.round(input.revenueMaxCents)) : null,
        revenueSource: input.revenueSource ?? null,
        revenueConfidence: input.revenueConfidence ?? 'UNKNOWN',
        revenueCheckedAt: input.revenueMinCents != null ? new Date() : null,
      },
    });
    return { company, isNew: true, matchedBy: null };
  }

  const existing = match.company;
  const data: Prisma.CompanyUpdateInput = { lastSeenAt: new Date() };

  const fill = <K extends keyof Prisma.CompanyUpdateInput>(key: K, value: unknown) => {
    if (value === null || value === undefined || value === '') return;
    if (existing[key as keyof Company] === null || existing[key as keyof Company] === undefined) {
      (data as Record<string, unknown>)[key as string] = value;
    }
  };

  fill('websiteUrl', websiteUrl);
  fill('websiteDomain', domain);
  fill('description', input.description);
  fill('industryLabel', input.industryLabel);
  fill('addressLine', input.addressLine);
  fill('city', input.city);
  fill('province', input.province);
  fill('postalCode', input.postalCode);
  fill('latitude', input.latitude);
  fill('longitude', input.longitude);
  fill('serviceArea', input.serviceArea);
  fill('phone', input.phone);
  fill('normalizedPhone', phone);
  fill('email', email);
  fill('linkedinUrl', input.linkedinUrl);
  fill('instagramUrl', input.instagramUrl);
  fill('reviewCount', input.reviewCount);
  fill('reviewRating', input.reviewRating);
  if (input.industryId && !existing.industryId) data.industry = { connect: { id: input.industryId } };
  if (input.locationId && !existing.locationId) data.location = { connect: { id: input.locationId } };

  if (input.employeeCountMin != null && confidenceRank(input.employeeCountConfidence) > confidenceRank(existing.employeeCountConfidence)) {
    data.employeeCountMin = input.employeeCountMin;
    data.employeeCountMax = input.employeeCountMax ?? null;
    data.employeeCountSource = input.employeeCountSource ?? null;
    data.employeeCountConfidence = input.employeeCountConfidence ?? 'UNKNOWN';
    data.employeeCountCheckedAt = new Date();
  }

  if (input.revenueMinCents != null && confidenceRank(input.revenueConfidence) > confidenceRank(existing.revenueConfidence)) {
    data.revenueMinCents = BigInt(Math.round(input.revenueMinCents));
    data.revenueMaxCents = input.revenueMaxCents != null ? BigInt(Math.round(input.revenueMaxCents)) : null;
    data.revenueSource = input.revenueSource ?? null;
    data.revenueConfidence = input.revenueConfidence ?? 'UNKNOWN';
    data.revenueCheckedAt = new Date();
  }

  const company = await prisma.company.update({ where: { id: existing.id }, data });
  log.debug('company matched', { id: company.id, matchedBy: match.matchedBy });
  return { company, isNew: false, matchedBy: match.matchedBy };
}

export function confidenceRank(level: Company['revenueConfidence'] | undefined): number {
  switch (level) {
    case 'VERIFIED':
      return 4;
    case 'HIGH':
      return 3;
    case 'MEDIUM':
      return 2;
    case 'LOW':
      return 1;
    default:
      return 0;
  }
}

/**
 * Opportunity dedup key.
 *
 * One company + one role = one opportunity, regardless of how many alert emails
 * mention it. For cold outbound (no role) the key is just the company, so a
 * business rediscovered next month updates rather than duplicates.
 */
export function opportunityDedupeKey(params: {
  companyId: string;
  kind: string;
  normalizedRoleTitle?: string | null;
  externalPostingId?: string | null;
}): string {
  if (params.externalPostingId) return `posting:${params.externalPostingId}`;
  if (params.normalizedRoleTitle) {
    return `company:${params.companyId}:role:${params.normalizedRoleTitle}`;
  }
  return `company:${params.companyId}:kind:${params.kind}`;
}
