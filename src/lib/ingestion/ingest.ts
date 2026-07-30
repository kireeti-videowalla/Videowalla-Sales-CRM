import type { LeadSource, Prisma, SourceKind } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { stableKey } from '../normalize';
import { enqueue } from '../jobs/queue';
import { fetchMessages } from '../integrations/gmail';
import { isIntegrationReady } from '../integrations/store';
import { searchPlaces } from '../integrations/places';
import { parseEmail, type ParsedCandidate, type RawEmail } from './email-parser';

const log = createLogger('ingest');

export type IngestResult = {
  sourceKey: string;
  created: number;
  duplicates: number;
  skipped: number;
  error?: string;
};

/**
 * Writes one raw artifact to the database.
 *
 * Idempotent by (kind, externalId): re-ingesting the same alert email or the
 * same Places result is a no-op that returns `duplicate`, which is exactly what
 * "do not create separate duplicate tickets every time the same alert arrives"
 * requires at the intake layer.
 */
export async function recordSource(params: {
  sourceId?: string | null;
  kind: SourceKind;
  externalId: string;
  subject?: string | null;
  sender?: string | null;
  receivedAt?: Date | null;
  sourceUrl?: string | null;
  rawPayload: Prisma.InputJsonValue;
  parsedPayload?: Prisma.InputJsonValue;
}): Promise<{ id: string; isNew: boolean }> {
  const existing = await prisma.sourceRecord.findUnique({
    where: { kind_externalId: { kind: params.kind, externalId: params.externalId } },
    select: { id: true },
  });
  if (existing) {
    // Touch lastSeen semantics without destroying the original payload.
    await prisma.sourceRecord.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() },
    });
    return { id: existing.id, isNew: false };
  }

  const created = await prisma.sourceRecord.create({
    data: {
      sourceId: params.sourceId ?? null,
      kind: params.kind,
      externalId: params.externalId,
      subject: params.subject ?? null,
      sender: params.sender ?? null,
      receivedAt: params.receivedAt ?? new Date(),
      sourceUrl: params.sourceUrl ?? null,
      rawPayload: params.rawPayload,
      parsedPayload: params.parsedPayload,
      status: 'PARSED',
    },
    select: { id: true },
  });
  return { id: created.id, isNew: true };
}

function candidateToPayload(candidate: ParsedCandidate, email: RawEmail): Prisma.InputJsonValue {
  return {
    title: candidate.title,
    companyName: candidate.companyName,
    location: candidate.location,
    url: candidate.url,
    snippet: candidate.snippet,
    platform: candidate.platform,
    postedAtText: candidate.postedAtText,
    emailSubject: email.subject,
    emailFrom: email.from,
  };
}

/** Ingests one Gmail-backed lead source. */
export async function ingestGmailSource(source: LeadSource): Promise<IngestResult> {
  const result: IngestResult = { sourceKey: source.key, created: 0, duplicates: 0, skipped: 0 };

  if (!(await isIntegrationReady('GMAIL'))) {
    result.error = 'Gmail is not connected. Authorise it in Settings → Integrations.';
    result.skipped = 1;
    return result;
  }

  const config = source.config as { label?: string; query?: string; maxMessages?: number };
  // Only look at mail since the last successful run, with a 14-day floor on
  // first run so a fresh install still has something to work with.
  const since = source.lastSuccessAt ?? new Date(Date.now() - 14 * 86_400_000);

  let emails: RawEmail[];
  try {
    emails = await fetchMessages({
      label: config.label,
      query: config.query,
      maxMessages: config.maxMessages ?? 50,
      since,
    });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await prisma.leadSource.update({
      where: { id: source.id },
      data: { lastRunAt: new Date(), lastError: result.error.slice(0, 1000) },
    });
    return result;
  }

  for (const email of emails) {
    const parsed = parseEmail(email);
    for (const candidate of parsed.candidates) {
      const record = await recordSource({
        sourceId: source.id,
        kind: parsed.detectedKind as SourceKind,
        externalId: candidate.externalId,
        subject: email.subject,
        sender: email.from,
        receivedAt: email.receivedAt,
        sourceUrl: candidate.url,
        // The original email is preserved verbatim, permanently.
        rawPayload: {
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          receivedAt: email.receivedAt.toISOString(),
          textBody: email.textBody.slice(0, 100_000),
          htmlBody: email.htmlBody?.slice(0, 200_000) ?? null,
        },
        parsedPayload: candidateToPayload(candidate, email),
      });

      if (record.isNew) {
        result.created += 1;
        await enqueue(
          'pipeline.process_record',
          { sourceRecordId: record.id },
          { idempotencyKey: `process-record:${record.id}`, priority: 80 },
        );
      } else {
        result.duplicates += 1;
      }
    }
  }

  await prisma.leadSource.update({
    where: { id: source.id },
    data: { lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null },
  });
  return result;
}

/**
 * Local company discovery: walks active locations × active industries and
 * records each business found as a COLD_OUTBOUND candidate.
 */
export async function ingestPlacesSource(
  source: LeadSource,
  options: { maxResults?: number; locationIds?: string[]; industryIds?: string[] } = {},
): Promise<IngestResult> {
  const result: IngestResult = { sourceKey: source.key, created: 0, duplicates: 0, skipped: 0 };

  const locations = await prisma.location.findMany({
    where: {
      isActive: true,
      isExcluded: false,
      latitude: { not: null },
      ...(options.locationIds?.length ? { id: { in: options.locationIds } } : {}),
    },
    orderBy: { priority: 'asc' },
    take: 6,
  });
  const industries = await prisma.industry.findMany({
    where: { isActive: true, ...(options.industryIds?.length ? { id: { in: options.industryIds } } : {}) },
    orderBy: { priority: 'asc' },
    take: 6,
  });

  if (locations.length === 0 || industries.length === 0) {
    result.skipped = 1;
    result.error = 'No active locations or industries configured for discovery.';
    return result;
  }

  const budget = options.maxResults ?? 60;

  outer: for (const location of locations) {
    for (const industry of industries) {
      if (result.created + result.duplicates >= budget) break outer;

      const query = `${industry.keywords[0] ?? industry.name} in ${location.name}`;
      const places = await searchPlaces({
        query,
        latitude: location.latitude!,
        longitude: location.longitude!,
        radiusKm: location.radiusKm,
        maxResults: Math.min(20, budget - result.created - result.duplicates),
      });

      for (const place of places) {
        if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
          result.skipped += 1;
          continue;
        }
        const record = await recordSource({
          sourceId: source.id,
          kind: 'PLACES_API',
          externalId: stableKey('places', place.externalId),
          subject: `${place.name} — ${industry.name} in ${location.name}`,
          sender: 'Google Places API',
          receivedAt: new Date(),
          sourceUrl: place.websiteUrl ?? place.mapsUri,
          rawPayload: { ...place, discoveryQuery: query },
          parsedPayload: {
            companyName: place.name,
            url: place.websiteUrl,
            location: [place.city, place.province].filter(Boolean).join(', ') || location.name,
            industrySlug: industry.slug,
            locationSlug: location.slug,
            phone: place.phone,
            snippet: `${place.name} — ${industry.name} in ${place.city ?? location.name}. ${
              place.reviewCount ? `${place.reviewCount} reviews, ${place.reviewRating} rating.` : ''
            }`.trim(),
            platform: 'Google Places',
          },
        });

        if (record.isNew) {
          result.created += 1;
          await enqueue(
            'pipeline.process_record',
            { sourceRecordId: record.id },
            { idempotencyKey: `process-record:${record.id}`, priority: 90 },
          );
        } else {
          result.duplicates += 1;
        }
      }
    }
  }

  await prisma.leadSource.update({
    where: { id: source.id },
    data: { lastRunAt: new Date(), lastSuccessAt: new Date(), lastError: null },
  });
  return result;
}

/** Manual URL submission from the Leads screen. */
export async function ingestManualUrl(params: {
  url: string;
  note?: string;
  companyName?: string;
  submittedById: string;
}): Promise<{ sourceRecordId: string; isNew: boolean }> {
  const source = await prisma.leadSource.findUnique({ where: { key: 'manual_url' } });
  const record = await recordSource({
    sourceId: source?.id ?? null,
    kind: 'MANUAL_URL',
    externalId: stableKey('manual-url', params.url),
    subject: params.companyName ?? params.url,
    sender: `user:${params.submittedById}`,
    receivedAt: new Date(),
    sourceUrl: params.url,
    rawPayload: { url: params.url, note: params.note ?? null, submittedById: params.submittedById },
    parsedPayload: {
      companyName: params.companyName ?? null,
      url: params.url,
      snippet: params.note ?? `Manually submitted: ${params.url}`,
      platform: 'Manual submission',
    },
  });

  if (record.isNew) {
    await enqueue(
      'pipeline.process_record',
      { sourceRecordId: record.id },
      { idempotencyKey: `process-record:${record.id}`, priority: 40 },
    );
  }
  return { sourceRecordId: record.id, isNew: record.isNew };
}

export type CsvRow = Record<string, string>;

/** CSV import. Column names are matched case-insensitively and loosely. */
export async function ingestCsvRows(rows: CsvRow[], submittedById: string): Promise<IngestResult> {
  const source = await prisma.leadSource.findUnique({ where: { key: 'csv_import' } });
  const result: IngestResult = { sourceKey: 'csv_import', created: 0, duplicates: 0, skipped: 0 };

  const pick = (row: CsvRow, ...names: string[]): string | null => {
    for (const name of names) {
      for (const [key, value] of Object.entries(row)) {
        if (key.toLowerCase().replace(/[^a-z]/g, '') === name && value?.trim()) return value.trim();
      }
    }
    return null;
  };

  for (const row of rows) {
    const companyName = pick(row, 'company', 'companyname', 'businessname', 'name');
    if (!companyName) {
      result.skipped += 1;
      continue;
    }
    const website = pick(row, 'website', 'url', 'websiteurl', 'domain');
    const record = await recordSource({
      sourceId: source?.id ?? null,
      kind: 'CSV_IMPORT',
      externalId: stableKey('csv', companyName, website ?? ''),
      subject: companyName,
      sender: `user:${submittedById}`,
      receivedAt: new Date(),
      sourceUrl: website,
      rawPayload: row,
      parsedPayload: {
        companyName,
        url: website,
        location: pick(row, 'city', 'location', 'town'),
        phone: pick(row, 'phone', 'phonenumber', 'telephone'),
        email: pick(row, 'email', 'emailaddress'),
        title: pick(row, 'role', 'jobtitle', 'position'),
        snippet: pick(row, 'notes', 'note', 'description') ?? `Imported from CSV: ${companyName}`,
        platform: 'CSV import',
      },
    });

    if (record.isNew) {
      result.created += 1;
      await enqueue(
        'pipeline.process_record',
        { sourceRecordId: record.id },
        { idempotencyKey: `process-record:${record.id}`, priority: 60 },
      );
    } else {
      result.duplicates += 1;
    }
  }
  return result;
}

/** Runs every active source. Individual failures are isolated and reported. */
export async function ingestAllSources(options: { maxDiscoveryResults?: number } = {}): Promise<IngestResult[]> {
  const sources = await prisma.leadSource.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  const results: IngestResult[] = [];
  for (const source of sources) {
    try {
      switch (source.kind) {
        case 'GMAIL_MESSAGE':
        case 'GOOGLE_ALERT':
        case 'JOB_ALERT_EMAIL':
        case 'INDEED_ALERT_EMAIL':
        case 'LINKEDIN_ALERT_EMAIL':
          results.push(await ingestGmailSource(source));
          break;
        case 'PLACES_API':
          results.push(await ingestPlacesSource(source, { maxResults: options.maxDiscoveryResults }));
          break;
        default:
          // MANUAL_URL and CSV_IMPORT are push-driven, not polled.
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('source ingestion failed', { source: source.key, message });
      results.push({ sourceKey: source.key, created: 0, duplicates: 0, skipped: 0, error: message });
      await prisma.leadSource.update({
        where: { id: source.id },
        data: { lastRunAt: new Date(), lastError: message.slice(0, 1000) },
      });
    }
  }
  return results;
}
