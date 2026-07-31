'use client';

import { useActionState } from 'react';
import { Alert, Button, inputClass } from './ui';
import { importCsvAction, runIngestionAction, type IngestState } from '@/app/actions/ingest';

const initial: IngestState = { error: null };

export function RunIngestionPanel({ sources }: { sources: Array<{ key: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(runIngestionAction, initial);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <label className="min-w-[220px]">
        <span className="block text-xs font-medium text-ink-700">Run a source now</span>
        <select name="sourceKey" className={`${inputClass} mt-1`} defaultValue="">
          <option value="">All active sources</option>
          {sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Queuing…' : 'Run now'}
      </Button>
      <p className="w-full text-xs text-ink-500">
        Sources also run automatically on their schedule. This queues a background job — it does not block
        the page.
      </p>
    </form>
  );
}

export function CsvImportPanel() {
  const [state, formAction, pending] = useActionState(importCsvAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <label className="block">
        <span className="block text-sm font-medium text-ink-700">CSV file</span>
        <span className="block text-xs text-ink-500">
          Recognised columns: company, website, city, phone, email, role, notes. Others are preserved on the
          source record.
        </span>
        <input type="file" name="file" accept=".csv,text/csv" className="mt-1 block w-full text-sm" required />
      </label>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Importing…' : 'Import'}
      </Button>
    </form>
  );
}
