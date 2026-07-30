import type { OpportunityKind, Prisma, SourceRecord } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { qualifyOpportunity } from '../ai/provider';
import type { QualificationInput } from '../ai/prompt';
import { getSetting } from '../settings/service';
import {
  daysBetween,
  DEFAULT_TIMEZONE,
} from '../time';
import {
  extractDomain,
  normalizeCompanyName,
  normalizeJobTitle,
  normalizeText,
  stableKey,
  ticketReference,
  truncate,
} from '../normalize';
import { opportunityDedupeKey, upsertCompany } from './dedupe';
import { enrichCompany } from './enrichment';
import { scoreLead } from './scoring';

const log = createLogger('pipeline');

export type ProcessOutcome = {
  sourceRecordId: string;
  status: 'CREATED' | 'UPDATED' | 'DUPLICATE' | 'DISQUALIFIED' | 'MANUAL_REVIEW' | 'FAILED';
  companyId?: string;
  opportunityId?: string;
  ticketId?: string;
  score?: number;
  reason?: string;
};

type ParsedPayload = {
  companyName?: string | null;
  title?: string | null;
  location?: string | null;
  url?: string | null;
  phone?: string | null;
  email?: string | null;
  snippet?: string | null;
  platform?: string | null;
  postedAtText?: string | null;
  industrySlug?: string | null;
  locationSlug?: string | null;
};

/** "3 days ago", "just posted", "2 weeks ago" → a concrete date. */
export function resolvePostedAt(text: string | null | undefined, relativeTo: Date): Date | null {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (/just posted|today|new/.test(t)) return relativeTo;
  if (/yesterday/.test(t)) return new Date(relativeTo.getTime() - 86_400_000);
  const m = /(\d+)\+?\s*(hour|day|week|month)s?\s*ago/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!;
    const ms =
      unit === 'hour' ? 3_600_000 : unit === 'day' ? 86_400_000 : unit === 'week' ? 604_800_000 : 2_592_000_000;
    return new Date(relativeTo.getTime() - n * ms);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

async function buildQualificationInput(record: SourceRecord): Promise<QualificationInput> {
  const parsed = (record.parsedPayload ?? {}) as ParsedPayload;
  const raw = record.rawPayload as Record<string, unknown>;

  const [icp, companyProfile, keywords, industries, locations] = await Promise.all([
    getSetting('icp.criteria'),
    getSetting('company.profile'),
    prisma.keyword.findMany({ where: { isActive: true }, orderBy: { priority: 'asc' } }),
    prisma.industry.findMany({ where: { isActive: true }, orderBy: { priority: 'asc' } }),
    prisma.location.findMany({ where: { isActive: true, isExcluded: false }, orderBy: { priority: 'asc' } }),
  ]);

  const sourceText = [
    parsed.snippet ?? '',
    typeof raw.textBody === 'string' ? raw.textBody : '',
    typeof raw.htmlBody === 'string' ? '' : '',
    typeof raw.note === 'string' ? raw.note : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 24_000);

  const lowerText = `${record.subject ?? ''} ${sourceText}`.toLowerCase();
  const matchedKeywords = keywords.filter((k) => lowerText.includes(k.term.toLowerCase())).map((k) => k.term);

  return {
    sourceText: sourceText || record.subject || '(no text)',
    sourceKind: record.kind,
    sourceUrl: record.sourceUrl,
    sourceSubject: record.subject,
    receivedAt: record.receivedAt,
    hints: {
      companyName: parsed.companyName ?? null,
      jobTitle: parsed.title ?? null,
      location: parsed.location ?? null,
      websiteUrl: parsed.url ?? record.sourceUrl ?? null,
      matchedKeywords,
    },
    activeKeywords: keywords.map((k) => k.term),
    priorityIndustries: industries.map((i) => i.name),
    priorityLocations: locations.map((l) => l.name),
    icp,
    companyProfile,
  };
}

async function resolveIndustryId(label: string | null, slugHint?: string | null): Promise<string | null> {
  if (slugHint) {
    const bySlug = await prisma.industry.findUnique({ where: { slug: slugHint } });
    if (bySlug) return bySlug.id;
  }
  if (!label) return null;
  const normalized = normalizeText(label);
  const industries = await prisma.industry.findMany({ where: { isActive: true } });
  const exact = industries.find((i) => normalizeText(i.name) === normalized);
  if (exact) return exact.id;
  const byKeyword = industries.find((i) =>
    i.keywords.some((k) => normalized.includes(normalizeText(k)) || normalizeText(k).includes(normalized)),
  );
  return byKeyword?.id ?? null;
}

async function resolveLocationId(city: string | null, slugHint?: string | null): Promise<string | null> {
  if (slugHint) {
    const bySlug = await prisma.location.findUnique({ where: { slug: slugHint } });
    if (bySlug) return bySlug.id;
  }
  if (!city) return null;
  const normalized = normalizeText(city);
  const locations = await prisma.location.findMany({ where: { isActive: true } });
  return locations.find((l) => normalizeText(l.name) === normalized)?.id ?? null;
}

/**
 * The full vertical slice for one raw source record:
 *   parse → AI qualify → dedupe company → posting → opportunity → enrich →
 *   score → ticket.
 *
 * Idempotent: re-running for the same record updates rather than duplicates,
 * because the company, posting and opportunity are all resolved through unique
 * dedup keys.
 */
export async function processSourceRecord(sourceRecordId: string): Promise<ProcessOutcome> {
  const record = await prisma.sourceRecord.findUnique({ where: { id: sourceRecordId } });
  if (!record) return { sourceRecordId, status: 'FAILED', reason: 'Source record not found' };

  const parsed = (record.parsedPayload ?? {}) as ParsedPayload;
  const aiConfig = await getSetting('ai.config');
  const postingAgeConfig = await getSetting('discovery.postingAge');

  try {
    // --- 1. Qualify -------------------------------------------------------
    const input = await buildQualificationInput(record);
    const outcome = await qualifyOpportunity(input);
    const q = outcome.result;

    if (q.disqualify) {
      await prisma.sourceRecord.update({
        where: { id: record.id },
        data: {
          status: 'DISQUALIFIED',
          processedAt: new Date(),
          errorMessage: q.disqualifyReason ?? 'Disqualified during AI qualification.',
        },
      });
      return {
        sourceRecordId,
        status: 'DISQUALIFIED',
        reason: q.disqualifyReason ?? 'Did not match the ideal customer profile.',
      };
    }

    // --- 2. Company (deduplicated) ---------------------------------------
    const industryId = await resolveIndustryId(q.company.industryGuess, parsed.industrySlug);
    const locationId = await resolveLocationId(q.company.city, parsed.locationSlug);
    const rawPlace = record.kind === 'PLACES_API' ? (record.rawPayload as Record<string, unknown>) : null;

    const { company, isNew: companyIsNew } = await upsertCompany({
      name: q.company.name,
      websiteUrl: q.company.websiteUrl ?? parsed.url ?? null,
      phone: q.company.phone ?? parsed.phone ?? null,
      email: q.company.email ?? parsed.email ?? null,
      city: q.company.city ?? (rawPlace?.city as string | null) ?? null,
      province: q.company.province ?? (rawPlace?.province as string | null) ?? null,
      postalCode: (rawPlace?.postalCode as string | null) ?? null,
      addressLine: (rawPlace?.addressLine as string | null) ?? null,
      latitude: (rawPlace?.latitude as number | null) ?? null,
      longitude: (rawPlace?.longitude as number | null) ?? null,
      country: q.company.country ?? 'CA',
      description: q.company.description,
      serviceArea: q.company.serviceArea,
      linkedinUrl: q.company.linkedinUrl,
      instagramUrl: q.company.instagramUrl,
      reviewCount: (rawPlace?.reviewCount as number | null) ?? null,
      reviewRating: (rawPlace?.reviewRating as number | null) ?? null,
      industryId,
      industryLabel: q.company.industryGuess,
      locationId,
      employeeCountMin: q.company.employeeCountMin,
      employeeCountMax: q.company.employeeCountMax,
      employeeCountSource: q.company.employeeCountSource,
      employeeCountConfidence: q.company.employeeCountConfidence,
      revenueMinCents: q.company.revenueMinCents,
      revenueMaxCents: q.company.revenueMaxCents,
      revenueSource: q.company.revenueSource,
      revenueConfidence: q.company.revenueConfidence,
    });

    // A do-not-contact company is never revived by new inbound data.
    if (company.doNotContact) {
      await prisma.sourceRecord.update({
        where: { id: record.id },
        data: { status: 'IGNORED', processedAt: new Date(), errorMessage: 'Company is marked do-not-contact.' },
      });
      return { sourceRecordId, status: 'DUPLICATE', companyId: company.id, reason: 'Company is do-not-contact.' };
    }

    // --- 3. Job posting ---------------------------------------------------
    const postedAt =
      (q.role.postedAt ? new Date(q.role.postedAt) : null) ??
      resolvePostedAt(parsed.postedAtText, record.receivedAt ?? record.createdAt);
    const validPostedAt = postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null;

    let jobPostingId: string | null = null;
    let normalizedRoleTitle: string | null = null;

    if (q.role.isHiring && q.role.title) {
      normalizedRoleTitle = normalizeJobTitle(q.role.title);
      const externalPostingId = record.sourceUrl
        ? stableKey('posting', record.sourceUrl)
        : stableKey('posting', company.id, normalizedRoleTitle);

      const existingPosting = await prisma.jobPosting.findUnique({ where: { externalPostingId } });
      const postingData = {
        companyId: company.id,
        sourceRecordId: record.id,
        title: q.role.title,
        normalizedTitle: normalizedRoleTitle,
        externalPostingId,
        employmentType: q.role.employmentType,
        locationText: q.role.locationText ?? parsed.location ?? null,
        salaryText: q.role.salaryText,
        postedAt: validPostedAt,
        sourceUrl: record.sourceUrl,
        sourcePlatform: parsed.platform ?? null,
        responsibilities: q.role.responsibilities,
        requiredSkills: q.role.requiredSkills,
        descriptionText: truncate(input.sourceText, 8000),
        matchedKeywords: q.role.matchedKeywords.length ? q.role.matchedKeywords : (input.hints?.matchedKeywords ?? []),
      };

      const posting = existingPosting
        ? await prisma.jobPosting.update({ where: { id: existingPosting.id }, data: postingData })
        : await prisma.jobPosting.create({ data: postingData });
      jobPostingId = posting.id;
    }

    // --- 4. Opportunity (deduplicated) ------------------------------------
    const kind: OpportunityKind = q.opportunityKind;
    const dedupeKey = opportunityDedupeKey({
      companyId: company.id,
      kind,
      normalizedRoleTitle,
      externalPostingId: jobPostingId
        ? (await prisma.jobPosting.findUnique({ where: { id: jobPostingId }, select: { externalPostingId: true } }))
            ?.externalPostingId ?? null
        : null,
    });

    const postingAgeDays = validPostedAt ? Math.max(0, daysBetween(validPostedAt, new Date())) : null;

    const existingOpportunity = await prisma.opportunity.findUnique({ where: { dedupeKey } });

    const opportunityData = {
      companyId: company.id,
      jobPostingId,
      sourceRecordId: record.id,
      kind,
      dedupeKey,
      headline: truncate(q.headline, 200),
      summary: q.summary || null,
      whatTheyAreLookingFor: q.whatTheyAreLookingFor || null,
      marketingProblem: q.marketingProblem || null,
      whyContact: q.whyContact || null,
      recommendedService: q.recommendedService || null,
      suggestedOpening: q.suggestedOpening || null,
      suggestedEmail: q.suggestedEmail || null,
      suggestedFollowUp: q.suggestedFollowUp || null,
      likelyDecisionMaker: q.contact?.fullName ?? null,
      missingInformation: q.missingInformation,
      aiProvider: outcome.provider,
      aiModel: outcome.model,
      aiConfidence: q.confidence,
      aiRawOutput: q as unknown as Prisma.InputJsonValue,
      aiProcessedAt: new Date(),
      postingAgeDays,
      discoveredAt: record.receivedAt ?? record.createdAt,
      status: 'PROCESSING' as const,
    };

    const opportunity = existingOpportunity
      ? await prisma.opportunity.update({ where: { id: existingOpportunity.id }, data: opportunityData })
      : await prisma.opportunity.create({ data: opportunityData });

    // --- 5. Contact from the source (never invented) ----------------------
    if (q.contact?.fullName) {
      const existingContact = await prisma.contact.findFirst({
        where: { companyId: company.id, fullName: { equals: q.contact.fullName, mode: 'insensitive' } },
      });
      if (!existingContact) {
        const hasPrimary = await prisma.contact.findFirst({ where: { companyId: company.id, isPrimary: true } });
        await prisma.contact.create({
          data: {
            companyId: company.id,
            fullName: q.contact.fullName,
            title: q.contact.title,
            roleKind: q.contact.roleKind,
            isPrimary: !hasPrimary,
            phone: q.contact.phone,
            email: q.contact.email,
            linkedinUrl: q.contact.linkedinUrl,
            phoneStatus: q.contact.phone ? 'UNVERIFIED' : 'UNVERIFIED',
            emailStatus: q.contact.email ? 'UNVERIFIED' : 'UNVERIFIED',
            discoverySource: q.contact.source ?? `Extracted from ${record.kind}`,
            confidence: q.contact.confidence,
          },
        });
      }
    }

    // --- 6. Enrichment ----------------------------------------------------
    // Only for genuinely new companies or those we have never enriched, so a
    // weekly re-run does not hammer the same websites.
    const enrichedBefore = await prisma.enrichmentRecord.count({ where: { companyId: company.id } });
    let enrichmentMissing: string[] = [];
    if (companyIsNew || enrichedBefore === 0) {
      try {
        const enrichment = await enrichCompany(company.id);
        enrichmentMissing = enrichment.missing;
      } catch (err) {
        log.warn('enrichment failed', { companyId: company.id, err: String(err) });
      }
    }

    // --- 7. Score ---------------------------------------------------------
    const freshCompany = await prisma.company.findUniqueOrThrow({
      where: { id: company.id },
      include: { industry: true, location: true },
    });
    const contacts = await prisma.contact.findMany({ where: { companyId: company.id } });
    const posting = jobPostingId
      ? await prisma.jobPosting.findUnique({ where: { id: jobPostingId } })
      : null;

    const matchedKeywordTerms = posting?.matchedKeywords ?? [];
    const keywordRows = matchedKeywordTerms.length
      ? await prisma.keyword.findMany({
          where: { normalizedTerm: { in: matchedKeywordTerms.map((t) => normalizeText(t)) } },
        })
      : [];
    const keywordBoost = keywordRows.reduce((s, k) => s + k.scoreBoost, 0);

    const scoreResult = await scoreLead({
      company: freshCompany,
      contacts,
      jobPosting: posting ? { ...posting, matchedKeywords: posting.matchedKeywords } : null,
      isHiring: q.role.isHiring,
      serviceFit: q.serviceFit,
      keywordBoost,
      postingAgeDays,
    });

    await prisma.leadScore.updateMany({
      where: { opportunityId: opportunity.id, isCurrent: true },
      data: { isCurrent: false },
    });
    const activeProfile = await prisma.scoringProfile.findFirstOrThrow({ where: { isActive: true } });
    await prisma.leadScore.create({
      data: {
        opportunityId: opportunity.id,
        profileId: activeProfile.id,
        score: scoreResult.score,
        band: scoreResult.band,
        dataConfidence: scoreResult.dataConfidence,
        breakdown: scoreResult.breakdown as unknown as Prisma.InputJsonValue,
        explanation: scoreResult.explanation,
        isCurrent: true,
      },
    });

    // --- 8. Routing decision ---------------------------------------------
    const tooOld =
      postingAgeDays !== null &&
      postingAgeDays > postingAgeConfig.lowPriorityDays &&
      postingAgeConfig.olderBehaviour === 'ARCHIVE';

    const needsReview =
      q.confidence < aiConfig.manualReviewConfidenceThreshold ||
      scoreResult.band === 'REVIEW_REQUIRED' ||
      (postingAgeDays !== null &&
        postingAgeDays > postingAgeConfig.lowPriorityDays &&
        postingAgeConfig.olderBehaviour === 'MANUAL_REVIEW');

    const lowPriority = scoreResult.band === 'LOW_PRIORITY';

    if (tooOld) {
      await prisma.opportunity.update({ where: { id: opportunity.id }, data: { status: 'ARCHIVED' } });
      await prisma.sourceRecord.update({
        where: { id: record.id },
        data: { status: 'EXTRACTED', processedAt: new Date(), errorMessage: `Archived: posting is ${postingAgeDays} days old.` },
      });
      return { sourceRecordId, status: 'DISQUALIFIED', companyId: company.id, opportunityId: opportunity.id, score: scoreResult.score, reason: 'Posting older than the configured window.' };
    }

    const stageKey = lowPriority
      ? 'review_required'
      : needsReview
        ? 'review_required'
        : 'ready_to_contact';

    const stage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: stageKey } });

    // --- 9. Ticket --------------------------------------------------------
    const existingTicket = await prisma.leadTicket.findUnique({
      where: { opportunityId: opportunity.id },
      include: { stage: true },
    });

    const primaryContact =
      contacts.find((c) => c.isPrimary) ??
      contacts.find((c) => ['OWNER', 'FOUNDER', 'PRESIDENT', 'CEO'].includes(c.roleKind)) ??
      contacts[0] ??
      null;

    const priority =
      scoreResult.band === 'PRIORITY_LEAD'
        ? 'PRIORITY'
        : scoreResult.band === 'QUALIFIED_LEAD'
          ? 'HIGH'
          : scoreResult.band === 'REVIEW_REQUIRED'
            ? 'NORMAL'
            : 'LOW';

    let ticketId: string;
    let resultStatus: ProcessOutcome['status'];

    if (existingTicket) {
      // Refresh scoring and contact info, but never yank a ticket the rep is
      // already working out from under them.
      const isUntouched = ['new_leads', 'ai_processing', 'review_required', 'ready_to_contact'].includes(
        existingTicket.stage.key,
      );
      await prisma.leadTicket.update({
        where: { id: existingTicket.id },
        data: {
          score: scoreResult.score,
          band: scoreResult.band,
          priority,
          primaryContactId: existingTicket.primaryContactId ?? primaryContact?.id ?? null,
          ...(isUntouched ? { stageId: stage.id } : {}),
        },
      });
      ticketId = existingTicket.id;
      resultStatus = 'UPDATED';
    } else {
      const ticket = await prisma.leadTicket.create({
        data: {
          reference: ticketReference(`${company.id}:${opportunity.id}`),
          companyId: company.id,
          opportunityId: opportunity.id,
          primaryContactId: primaryContact?.id ?? null,
          stageId: stage.id,
          priority,
          score: scoreResult.score,
          band: scoreResult.band,
          nextActionLabel: stageKey === 'ready_to_contact' ? 'Call the company' : 'Owner review required',
        },
      });
      ticketId = ticket.id;
      resultStatus = 'CREATED';

      await prisma.stageHistory.create({
        data: {
          ticketId: ticket.id,
          fromStageId: null,
          toStageId: stage.id,
          automated: true,
          requiredNextAction: ticket.nextActionLabel,
          metadata: {
            createdBy: 'pipeline',
            aiProvider: outcome.provider,
            aiModel: outcome.model,
            degraded: outcome.degraded,
            score: scoreResult.score,
          },
        },
      });
    }

    await prisma.leadScore.updateMany({
      where: { opportunityId: opportunity.id, isCurrent: true },
      data: { ticketId },
    });

    const missingInfo = [...new Set([...q.missingInformation, ...enrichmentMissing])];
    await prisma.opportunity.update({
      where: { id: opportunity.id },
      data: {
        status: needsReview || lowPriority ? 'MANUAL_REVIEW' : 'QUALIFIED',
        missingInformation: missingInfo,
      },
    });

    await prisma.sourceRecord.update({
      where: { id: record.id },
      data: {
        status: needsReview || lowPriority ? 'MANUAL_REVIEW' : 'QUALIFIED',
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    log.info('processed source record', {
      sourceRecordId,
      company: company.name,
      score: scoreResult.score,
      band: scoreResult.band,
      stage: stageKey,
      status: resultStatus,
      provider: outcome.provider,
    });

    return {
      sourceRecordId,
      status: needsReview || lowPriority ? 'MANUAL_REVIEW' : resultStatus,
      companyId: company.id,
      opportunityId: opportunity.id,
      ticketId,
      score: scoreResult.score,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('failed to process source record', { sourceRecordId, message });
    await prisma.sourceRecord.update({
      where: { id: record.id },
      data: { status: 'FAILED', errorMessage: message.slice(0, 1000), processedAt: new Date() },
    });
    throw err;
  }
}

/** Batch entry point used by the scheduled `pipeline.process_pending` job. */
export async function processPendingRecords(limit = 50): Promise<ProcessOutcome[]> {
  const pending = await prisma.sourceRecord.findMany({
    where: { status: { in: ['RECEIVED', 'PARSED'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  const outcomes: ProcessOutcome[] = [];
  for (const record of pending) {
    try {
      outcomes.push(await processSourceRecord(record.id));
    } catch (err) {
      outcomes.push({
        sourceRecordId: record.id,
        status: 'FAILED',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

export { DEFAULT_TIMEZONE, normalizeCompanyName, extractDomain };
