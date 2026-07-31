'use client';

import { useActionState, useState, useTransition } from 'react';
import { Alert, Badge, Button, inputClass } from './ui';
import { FIELD_LABEL_ENTRIES } from '@/lib/pipeline/field-labels';
import {
  addOutcomeAction,
  addStageAction,
  deleteStageAction,
  saveOutcomesAction,
  saveStageRulesAction,
  saveStagesAction,
  type PipelineConfigState,
} from '@/app/actions/pipeline-config';

const initial: PipelineConfigState = { error: null };

export type StageRow = {
  id: string;
  key: string;
  name: string;
  category: string;
  position: number;
  color: string;
  isActive: boolean;
  isSystem: boolean;
  requiredFields: string[];
  automations: string[];
  ticketCount: number;
};

export function StageEditor({ stages }: { stages: StageRow[] }) {
  const [saveState, saveAction, saving] = useActionState(saveStagesAction, initial);
  const [addState, addAction, adding] = useActionState(addStageAction, initial);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4 px-5 py-4">
      {saveState.error && <Alert tone="bad">{saveState.error}</Alert>}
      {saveState.ok && <Alert tone="good">{saveState.message}</Alert>}
      {deleteError && <Alert tone="bad">{deleteError}</Alert>}

      <p className="text-xs text-ink-500">
        Lower position numbers appear further left on the board. Columns marked{' '}
        <Badge tone="info">system</Badge> drive automation — you can rename, recolour and reorder them,
        but they cannot be switched off.
      </p>

      <form action={saveAction} className="space-y-2">
        <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
          {stages.map((s) => (
            <li key={s.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  name={`position_${s.id}`}
                  defaultValue={s.position}
                  className={`${inputClass} tnum w-20`}
                  aria-label={`${s.name} position`}
                />
                <input
                  type="color"
                  name={`color_${s.id}`}
                  defaultValue={s.color}
                  className="h-9 w-10 cursor-pointer rounded border border-ink-300"
                  aria-label={`${s.name} colour`}
                />
                <input
                  name={`name_${s.id}`}
                  defaultValue={s.name}
                  className={`${inputClass} min-w-[180px] flex-1`}
                  aria-label={`${s.name} name`}
                />
                {s.isSystem && <Badge tone="info">system</Badge>}
                <span className="tnum text-xs text-ink-400">{s.ticketCount} cards</span>

                <label className="flex items-center gap-1 text-xs text-ink-600">
                  <input
                    type="checkbox"
                    name={`active_${s.id}`}
                    defaultChecked={s.isActive}
                    disabled={s.isSystem}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  shown
                </label>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                >
                  {expanded === s.id ? 'Hide' : 'Rules'}
                </Button>

                {!s.isSystem && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      startTransition(async () => {
                        const r = await deleteStageAction(s.id);
                        setDeleteError(r.error);
                      })
                    }
                  >
                    Delete
                  </Button>
                )}
              </div>

              {expanded === s.id && <StageRules stage={s} />}
            </li>
          ))}
        </ul>

        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save columns'}
        </Button>
      </form>

      <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Add a column</h4>
        {addState.error && <Alert tone="bad">{addState.error}</Alert>}
        {addState.ok && <Alert tone="good">{addState.message}</Alert>}
        <form action={addAction} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-[160px] flex-1">
            <span className="block text-xs font-medium text-ink-700">Name</span>
            <input name="name" className={`${inputClass} mt-1`} required />
          </label>
          <label>
            <span className="block text-xs font-medium text-ink-700">Where it belongs</span>
            <select name="category" className={`${inputClass} mt-1`} defaultValue="ENGAGED">
              <option value="INTAKE">Intake</option>
              <option value="READY">Ready to work</option>
              <option value="CONTACTED">Contacted</option>
              <option value="ENGAGED">Engaged</option>
              <option value="MEETING">Meeting</option>
              <option value="CLOSED_WON">Closed won</option>
              <option value="CLOSED_LOST">Closed lost</option>
            </select>
          </label>
          <label>
            <span className="block text-xs font-medium text-ink-700">Colour</span>
            <input type="color" name="color" defaultValue="#64748b" className="mt-1 h-9 w-12 rounded border border-ink-300" />
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={adding}>
            Add column
          </Button>
        </form>
      </div>
    </div>
  );
}

function StageRules({ stage }: { stage: StageRow }) {
  const [state, formAction, pending] = useActionState(saveStageRulesAction, initial);

  return (
    <div className="mt-3 rounded-lg bg-ink-50 p-3">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="stageId" value={stage.id} />

        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            Information required before a card can enter this column
          </span>
          <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {FIELD_LABEL_ENTRIES.map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5 text-xs text-ink-700">
                <input
                  type="checkbox"
                  name="requiredFields"
                  value={key}
                  defaultChecked={stage.requiredFields.includes(key)}
                  className="h-3.5 w-3.5 rounded border-ink-300"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {stage.automations.length > 0 && (
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              Automatic actions on entry
            </span>
            <p className="mt-0.5 text-xs text-ink-600">
              {stage.automations.map((a) => a.replace(/_/g, ' ')).join(' · ')}
            </p>
            <p className="text-[11px] text-ink-400">
              These are built into the product and cannot be edited here — naming one that does not exist
              would silently do nothing.
            </p>
          </div>
        )}

        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Save required information'}
        </Button>
      </form>
    </div>
  );
}

export type OutcomeRow = {
  id: string;
  key: string;
  label: string;
  position: number;
  isActive: boolean;
  targetStageKey: string | null;
  countsAsContact: boolean;
  countsAsConversation: boolean;
  requiresNote: boolean;
  requiresFollowUp: boolean;
};

export function OutcomeEditor({
  outcomes,
  stages,
}: {
  outcomes: OutcomeRow[];
  stages: Array<{ key: string; name: string }>;
}) {
  const [saveState, saveAction, saving] = useActionState(saveOutcomesAction, initial);
  const [addState, addAction, adding] = useActionState(addOutcomeAction, initial);

  return (
    <div className="space-y-4 px-5 py-4">
      {saveState.error && <Alert tone="bad">{saveState.error}</Alert>}
      {saveState.ok && <Alert tone="good">{saveState.message}</Alert>}

      <p className="text-xs text-ink-500">
        These are the buttons she sees after a call. &ldquo;Moves to&rdquo; decides where the card goes;
        the tick boxes decide what the outcome counts toward in her weekly score.
      </p>

      <form action={saveAction} className="space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-2 py-1 font-medium">#</th>
                <th className="px-2 py-1 font-medium">Label</th>
                <th className="px-2 py-1 font-medium">Moves to</th>
                <th className="px-2 py-1 font-medium">Contact</th>
                <th className="px-2 py-1 font-medium">Conversation</th>
                <th className="px-2 py-1 font-medium">Needs note</th>
                <th className="px-2 py-1 font-medium">Needs follow-up</th>
                <th className="px-2 py-1 font-medium">Shown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {outcomes.map((o) => (
                <tr key={o.id}>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      name={`position_${o.id}`}
                      defaultValue={o.position}
                      className={`${inputClass} tnum w-16`}
                      aria-label={`${o.label} position`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      name={`label_${o.id}`}
                      defaultValue={o.label}
                      className={`${inputClass} min-w-[150px]`}
                      aria-label={`${o.label} name`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      name={`stage_${o.id}`}
                      defaultValue={o.targetStageKey ?? ''}
                      className={`${inputClass} min-w-[160px]`}
                      aria-label={`${o.label} target column`}
                    >
                      <option value="">Stay where it is</option>
                      {stages.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(
                    [
                      ['contact', o.countsAsContact],
                      ['conversation', o.countsAsConversation],
                      ['note', o.requiresNote],
                      ['followup', o.requiresFollowUp],
                      ['active', o.isActive],
                    ] as const
                  ).map(([field, value]) => (
                    <td key={field} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        name={`${field}_${o.id}`}
                        defaultChecked={value}
                        className="h-4 w-4 rounded border-ink-300"
                        aria-label={`${o.label} ${field}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save outcomes'}
        </Button>
      </form>

      <div className="rounded-lg border border-ink-200 bg-ink-50 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Add an outcome</h4>
        {addState.error && <Alert tone="bad">{addState.error}</Alert>}
        {addState.ok && <Alert tone="good">{addState.message}</Alert>}
        <form action={addAction} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-[160px] flex-1">
            <span className="block text-xs font-medium text-ink-700">Label</span>
            <input name="label" className={`${inputClass} mt-1`} required />
          </label>
          <label>
            <span className="block text-xs font-medium text-ink-700">Moves to</span>
            <select name="targetStageKey" className={`${inputClass} mt-1`} defaultValue="">
              <option value="">Stay where it is</option>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 pb-2 text-xs text-ink-600">
            <input type="checkbox" name="countsAsContact" defaultChecked className="h-4 w-4 rounded border-ink-300" />
            counts as a contact
          </label>
          <label className="flex items-center gap-1 pb-2 text-xs text-ink-600">
            <input type="checkbox" name="requiresNote" className="h-4 w-4 rounded border-ink-300" />
            needs a note
          </label>
          <Button type="submit" size="sm" variant="secondary" disabled={adding}>
            Add outcome
          </Button>
        </form>
      </div>
    </div>
  );
}
