'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/lib/auth/session';
import { safeErrorMessage } from '@/lib/logger';
import { ingestCsvRows, ingestManualUrl } from '@/lib/ingestion/ingest';
import { enqueue } from '@/lib/jobs/queue';
import { parseCsv } from '@/lib/ingestion/csv';

export type IngestState = { error: string | null; ok?: boolean; message?: string };

export async function submitUrlAction(_prev: IngestState, formData: FormData): Promise<IngestState> {
  try {
    const user = await authorize('sources.manage');
    const url = String(formData.get('url') ?? '').trim();
    if (!url) return { error: 'Enter a URL.' };
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { error: 'Only http and https URLs are supported.' };
      }
    } catch {
      return { error: 'That does not look like a valid URL.' };
    }

    const result = await ingestManualUrl({
      url,
      note: String(formData.get('note') ?? '').trim() || undefined,
      companyName: String(formData.get('companyName') ?? '').trim() || undefined,
      submittedById: user.id,
    });

    revalidatePath('/leads');
    return {
      error: null,
      ok: true,
      message: result.isNew
        ? 'Queued. The pipeline will qualify, enrich and score it within a few minutes.'
        : 'This URL has already been submitted — the existing record was reused rather than duplicated.',
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function importCsvAction(_prev: IngestState, formData: FormData): Promise<IngestState> {
  try {
    const user = await authorize('sources.manage');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV file.' };
    if (file.size > 4 * 1024 * 1024) return { error: 'The file is too large (4 MB maximum).' };

    const rows = parseCsv(await file.text());
    if (rows.length === 0) return { error: 'No data rows were found in that file.' };
    if (rows.length > 2000) return { error: 'Import at most 2000 rows at a time.' };

    const result = await ingestCsvRows(rows, user.id);
    revalidatePath('/leads');
    return {
      error: null,
      ok: true,
      message: `${result.created} new record${result.created === 1 ? '' : 's'} queued, ${result.duplicates} already existed, ${result.skipped} skipped (no company name).`,
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function runIngestionAction(_prev: IngestState, formData: FormData): Promise<IngestState> {
  try {
    await authorize('sources.manage');
    const sourceKey = String(formData.get('sourceKey') ?? '');

    if (sourceKey) {
      await enqueue('ingest.single_source', { sourceKey }, { priority: 30 });
      return { error: null, ok: true, message: `Queued a run for "${sourceKey}".` };
    }
    await enqueue('ingest.all_sources', {}, { priority: 30 });
    return { error: null, ok: true, message: 'Queued a run of every active lead source.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
