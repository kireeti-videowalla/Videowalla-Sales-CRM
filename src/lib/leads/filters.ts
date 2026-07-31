import type { Prisma, UserRole } from '@prisma/client';
import { normalizeJobTitle } from '../normalize';

export type LeadFilterParams = Record<string, string | undefined>;

/**
 * Builds the Prisma `where` clause for the Leads screen.
 *
 * Extracted from the page so it can be unit-tested. Filters are composed into
 * grouped objects and assigned once. Building this with repeated
 * `...(cond ? { company: {...} } : {})` spreads looks tidy but is wrong: two
 * spreads that both set `company` overwrite each other, so choosing an industry
 * would silently discard the "has a phone number" filter and the user would get
 * results that do not match what they asked for.
 */
export function buildLeadWhere(
  params: LeadFilterParams,
  role: UserRole,
  userId: string | null,
): Prisma.LeadTicketWhereInput {
  const company: Prisma.CompanyWhereInput = {};
  const opportunity: Prisma.OpportunityWhereInput = {};
  const score: Prisma.IntFilter = {};

  if (params.industry) company.industry = { slug: params.industry };
  if (params.location) company.location = { slug: params.location };
  if (params.hasPhone === 'yes') company.normalizedPhone = { not: null };
  if (params.minEmployees) company.employeeCountMin = { gte: Number(params.minEmployees) };
  if (params.maxEmployees) company.employeeCountMax = { lte: Number(params.maxEmployees) };
  if (params.minRevenue) {
    company.revenueMinCents = { gte: BigInt(Math.round(Number(params.minRevenue) * 100)) };
  }
  if (params.dataQuality === 'verified') {
    company.OR = [{ revenueVerified: true }, { employeeCountVerified: true }];
  } else if (params.dataQuality === 'estimated') {
    company.revenueVerified = false;
    company.employeeCountVerified = false;
  }
  // Suppressed companies stay hidden unless explicitly asked for.
  company.doNotContact = params.dnc === 'yes';

  if (params.hiring === 'yes') opportunity.kind = 'HIRING_INTENT';
  if (params.source) opportunity.sourceRecord = { kind: params.source as never };
  if (params.role) {
    opportunity.jobPosting = { normalizedTitle: { contains: normalizeJobTitle(params.role) } };
  }
  if (params.postingAge) opportunity.postingAgeDays = { lte: Number(params.postingAge) || 30 };

  if (params.minScore) score.gte = Number(params.minScore) || 0;
  if (params.maxScore) score.lte = Number(params.maxScore) || 100;

  const where: Prisma.LeadTicketWhereInput = {};

  // A rep can only ever list their own leads, whatever the query string says.
  if (role === 'SALES_REP' && userId) {
    where.assigneeId = userId;
  } else if (params.assignee) {
    where.assigneeId = params.assignee === 'unassigned' ? null : params.assignee;
  }

  if (params.stage) where.stage = { key: params.stage };
  if (params.priority) where.priority = params.priority as never;
  if (params.sprint) where.sprintId = params.sprint === 'none' ? null : params.sprint;
  if (params.followUpBefore) {
    where.nextFollowUpAt = { not: null, lte: new Date(`${params.followUpBefore}T23:59:59`) };
  }
  if (params.hasEmail === 'yes') {
    where.OR = [{ company: { email: { not: null } } }, { primaryContact: { email: { not: null } } }];
  }

  if (Object.keys(score).length) where.score = score;
  if (Object.keys(company).length) where.company = company;
  if (Object.keys(opportunity).length) where.opportunity = opportunity;

  if (params.q) {
    // AND-wrapped so it composes with the hasEmail OR above instead of
    // replacing it.
    where.AND = [
      {
        OR: [
          { company: { name: { contains: params.q, mode: 'insensitive' } } },
          { reference: { contains: params.q, mode: 'insensitive' } },
          { opportunity: { headline: { contains: params.q, mode: 'insensitive' } } },
        ],
      },
    ];
  }

  return where;
}
