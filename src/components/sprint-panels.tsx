'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Alert, Badge, Button, inputClass } from './ui';
import {
  approveReviewBatchAction,
  approveSprintAction,
  overrideTargetsAction,
  replanAction,
  type SprintActionState,
} from '@/app/actions/sprints';

const initial: SprintActionState = { error: null };

export function ApproveSprintPanel({
  sprintId,
  targets,
  status,
  rationale,
}: {
  sprintId: string;
  targets: Array<{ key: string; label: string; target: number; suggested: number; overridden: boolean }>;
  status: string;
  rationale: string[];
}) {
  const [approveState, approveAction, approving] = useActionState(approveSprintAction, initial);
  const [overrideState, overrideAction, overriding] = useActionState(overrideTargetsAction, initial);

  return (
    <div className="space-y-4 px-5 py-4">
      {approveState.error && <Alert tone="bad">{approveState.error}</Alert>}
      {approveState.ok && <Alert tone="good">{approveState.message}</Alert>}
      {overrideState.error && <Alert tone="bad">{overrideState.error}</Alert>}
      {overrideState.ok && <Alert tone="good">{overrideState.message}</Alert>}

      <form action={overrideAction} className="space-y-3">
        <input type="hidden" name="sprintId" value={sprintId} />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {targets.map((t) => (
            <label key={t.key} className="block">
              <span className="block text-xs font-medium text-ink-700">{t.label}</span>
              <input
                type="number"
                min={0}
                name={`target_${t.key}`}
                defaultValue={t.target}
                className={`${inputClass} tnum mt-1`}
              />
              <span className="mt-0.5 block text-[11px] text-ink-500">
                Engine suggested {t.suggested}
                {t.overridden && ' · you overrode this'}
              </span>
            </label>
          ))}
        </div>
        <Button type="submit" variant="secondary" size="sm" disabled={overriding}>
          {overriding ? 'Saving…' : 'Save target changes'}
        </Button>
      </form>

      {rationale.length > 0 && (
        <details className="rounded-lg bg-ink-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-700">
            Why the engine chose these targets
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink-600">
            {rationale.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}

      {status === 'PENDING_APPROVAL' || status === 'DRAFT' ? (
        <form action={approveAction}>
          <input type="hidden" name="sprintId" value={sprintId} />
          <Button type="submit" size="lg" disabled={approving}>
            {approving ? 'Approving…' : 'Approve next week'}
          </Button>
        </form>
      ) : (
        <Badge tone="good">Approved</Badge>
      )}
    </div>
  );
}

export function ReviewExceptionsPanel({
  tickets,
}: {
  tickets: Array<{ id: string; company: string; headline: string; score: number; source: string }>;
}) {
  const [state, formAction, pending] = useActionState(approveReviewBatchAction, initial);

  if (tickets.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-500">Nothing is waiting for review.</p>;
  }

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <p className="text-sm text-ink-600">
        These leads did not pass automatically — either the extraction confidence or the score was below
        your configured thresholds. Approving one puts it in the salesperson&rsquo;s queue.
      </p>

      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        {tickets.map((t) => (
          <li key={t.id} className="flex items-start gap-3 px-3 py-2">
            <input
              type="checkbox"
              name="ticketIds"
              value={t.id}
              className="mt-1 h-4 w-4 rounded border-ink-300"
              defaultChecked
            />
            <div className="min-w-0 flex-1">
              <Link href={`/leads/${t.id}`} className="text-sm font-medium text-ink-900 hover:underline">
                {t.company}
              </Link>
              <p className="truncate text-xs text-ink-500">{t.headline}</p>
              <p className="text-[11px] text-ink-400">{t.source}</p>
            </div>
            <span className="tnum shrink-0 text-sm font-semibold text-ink-600">{t.score}</span>
          </li>
        ))}
      </ul>

      <Button type="submit" disabled={pending}>
        {pending ? 'Approving…' : 'Approve selected for calling'}
      </Button>
    </form>
  );
}

export function ReplanPanel() {
  const [state, formAction, pending] = useActionState(replanAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <p className="text-sm text-ink-600">
        Planning normally runs automatically on Sunday evening. Run it now if you have changed settings or
        want fresh leads immediately.
      </p>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="skipIngestion" className="h-4 w-4 rounded border-ink-300" />
        Skip lead discovery (only re-plan from leads already collected)
      </label>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Queuing…' : 'Run planning now'}
      </Button>
    </form>
  );
}
