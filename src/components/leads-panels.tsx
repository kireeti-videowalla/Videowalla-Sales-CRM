'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, inputClass } from './ui';
import { submitUrlAction, type IngestState } from '@/app/actions/ingest';

const initial: IngestState = { error: null };

export function ManualUrlPanel() {
  const [state, formAction, pending] = useActionState(submitUrlAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-4 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label="URL" required hint="A company website, careers page or public job posting.">
            <input name="url" type="url" className={inputClass} placeholder="https://example.ca/careers/social-media-manager" required />
          </Field>
        </div>
        <Field label="Company name (optional)">
          <input name="companyName" className={inputClass} />
        </Field>
      </div>
      <Field label="Note (optional)" hint="Anything you already know. It is passed to the qualification step.">
        <input name="note" className={inputClass} />
      </Field>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Queuing…' : 'Add and process'}
      </Button>
    </form>
  );
}
