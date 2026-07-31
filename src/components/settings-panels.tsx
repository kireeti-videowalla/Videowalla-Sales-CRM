'use client';

import { useActionState, useTransition } from 'react';
import { Alert, Badge, Button, inputClass } from './ui';
import {
  addIndustryAction,
  addKeywordAction,
  addLocationAction,
  deleteKeywordAction,
  excludeLocationAction,
  reprioritiseAction,
  retryJobAction,
  saveFollowUpRulesAction,
  saveIntegrationAction,
  saveScheduleAction,
  saveScoringAction,
  saveSettingsAction,
  testIntegrationAction,
  toggleIndustryAction,
  toggleKeywordAction,
  toggleLocationAction,
  toggleSourceAction,
  type SettingsState,
} from '@/app/actions/settings';

const initial: SettingsState = { error: null };

export type FieldSpec = {
  name: string;
  label: string;
  hint?: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'list';
  options?: Array<{ value: string; label: string }>;
  step?: string;
  min?: number;
  max?: number;
};

/** Generic settings-group editor driven by a field spec. */
export function SettingsForm({
  settingKey,
  fields,
  values,
}: {
  settingKey: string;
  fields: FieldSpec[];
  values: Record<string, unknown>;
}) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, initial);

  return (
    <form action={formAction} className="space-y-4 px-5 py-4">
      <input type="hidden" name="__key" value={settingKey} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          const value = values[f.name];
          if (f.type === 'boolean') {
            return (
              <label key={f.name} className="flex items-start gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  name={f.name}
                  defaultChecked={Boolean(value)}
                  className="mt-0.5 h-4 w-4 rounded border-ink-300"
                />
                <span>
                  <span className="block text-sm font-medium text-ink-700">{f.label}</span>
                  {f.hint && <span className="block text-xs text-ink-500">{f.hint}</span>}
                </span>
              </label>
            );
          }
          return (
            <label key={f.name} className={f.type === 'textarea' || f.type === 'list' ? 'sm:col-span-2' : ''}>
              <span className="block text-sm font-medium text-ink-700">{f.label}</span>
              {f.hint && <span className="block text-xs text-ink-500">{f.hint}</span>}
              {f.type === 'select' ? (
                <select name={f.name} defaultValue={String(value ?? '')} className={`${inputClass} mt-1`}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea name={f.name} rows={3} defaultValue={String(value ?? '')} className={`${inputClass} mt-1`} />
              ) : f.type === 'list' ? (
                <textarea
                  name={f.name}
                  rows={4}
                  defaultValue={Array.isArray(value) ? value.join('\n') : ''}
                  className={`${inputClass} mt-1`}
                  placeholder="One per line"
                />
              ) : (
                <input
                  type={f.type}
                  name={f.name}
                  step={f.step}
                  min={f.min}
                  max={f.max}
                  defaultValue={String(value ?? '')}
                  className={`${inputClass} mt-1 ${f.type === 'number' ? 'tnum' : ''}`}
                />
              )}
            </label>
          );
        })}
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}

export function KeywordManager({
  keywords,
  groups,
}: {
  keywords: Array<{ id: string; term: string; isActive: boolean; priority: number; scoreBoost: number; groupName: string | null }>;
  groups: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(addKeywordAction, initial);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-4 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <label className="min-w-[200px] flex-1">
          <span className="block text-xs font-medium text-ink-700">New keyword</span>
          <input name="term" className={`${inputClass} mt-1`} placeholder="e.g. content producer" required />
        </label>
        <label>
          <span className="block text-xs font-medium text-ink-700">Group</span>
          <select name="groupId" className={`${inputClass} mt-1`} defaultValue="">
            <option value="">None</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs font-medium text-ink-700">Score boost</span>
          <input type="number" name="scoreBoost" min={0} max={10} defaultValue={4} className={`${inputClass} tnum mt-1 w-24`} />
        </label>
        <label>
          <span className="block text-xs font-medium text-ink-700">Priority</span>
          <input type="number" name="priority" min={1} defaultValue={100} className={`${inputClass} tnum mt-1 w-24`} />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          Add
        </Button>
      </form>

      <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
        {keywords.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className={k.isActive ? 'text-ink-900' : 'text-ink-400 line-through'}>{k.term}</span>
            {k.groupName && <Badge tone="neutral">{k.groupName}</Badge>}
            <span className="tnum text-xs text-ink-500">+{k.scoreBoost} score</span>
            <span className="tnum text-xs text-ink-400">priority {k.priority}</span>
            <div className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => startTransition(() => toggleKeywordAction(k.id, !k.isActive))}
              >
                {k.isActive ? 'Pause' : 'Activate'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => startTransition(() => deleteKeywordAction(k.id))}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PriorityList({
  kind,
  items,
  onToggleLabel = 'Active',
}: {
  kind: 'industry' | 'location';
  items: Array<{ id: string; name: string; priority: number; isActive: boolean; isExcluded?: boolean; detail?: string }>;
  onToggleLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(reprioritiseAction, initial);
  const [, startTransition] = useTransition();

  return (
    <div className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <p className="text-xs text-ink-500">
        Lower numbers are searched and scored first. Toronto is 10 by default.
      </p>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="kind" value={kind} />
        <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <input
                type="number"
                name={`priority_${item.id}`}
                defaultValue={item.priority}
                min={1}
                className={`${inputClass} tnum w-20`}
                aria-label={`${item.name} priority`}
              />
              <span className={item.isActive && !item.isExcluded ? 'text-ink-900' : 'text-ink-400'}>
                {item.name}
              </span>
              {item.detail && <span className="text-xs text-ink-400">{item.detail}</span>}
              {item.isExcluded && <Badge tone="bad">Excluded</Badge>}
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    startTransition(() =>
                      kind === 'industry'
                        ? toggleIndustryAction(item.id, !item.isActive)
                        : toggleLocationAction(item.id, !item.isActive),
                    )
                  }
                >
                  {item.isActive ? `Disable` : `Enable`} {onToggleLabel === 'Active' ? '' : onToggleLabel}
                </Button>
                {kind === 'location' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startTransition(() => excludeLocationAction(item.id, !item.isExcluded))}
                  >
                    {item.isExcluded ? 'Un-exclude' : 'Exclude'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save priorities'}
        </Button>
      </form>
    </div>
  );
}

export function AddLocationForm() {
  const [state, formAction, pending] = useActionState(addLocationAction, initial);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}
      <label className="min-w-[160px] flex-1">
        <span className="block text-xs font-medium text-ink-700">Name</span>
        <input name="name" className={`${inputClass} mt-1`} required />
      </label>
      <label>
        <span className="block text-xs font-medium text-ink-700">Kind</span>
        <select name="kind" className={`${inputClass} mt-1`} defaultValue="CITY">
          <option value="CITY">City</option>
          <option value="REGION">Region</option>
          <option value="PROVINCE">Province</option>
          <option value="COUNTRY">Country</option>
        </select>
      </label>
      <label>
        <span className="block text-xs font-medium text-ink-700">Latitude</span>
        <input type="number" step="any" name="latitude" className={`${inputClass} tnum mt-1 w-28`} />
      </label>
      <label>
        <span className="block text-xs font-medium text-ink-700">Longitude</span>
        <input type="number" step="any" name="longitude" className={`${inputClass} tnum mt-1 w-28`} />
      </label>
      <label>
        <span className="block text-xs font-medium text-ink-700">Radius km</span>
        <input type="number" name="radiusKm" defaultValue={25} className={`${inputClass} tnum mt-1 w-24`} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        Add
      </Button>
    </form>
  );
}

export function AddIndustryForm() {
  const [state, formAction, pending] = useActionState(addIndustryAction, initial);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}
      <label className="min-w-[180px] flex-1">
        <span className="block text-xs font-medium text-ink-700">Industry name</span>
        <input name="name" className={`${inputClass} mt-1`} required />
      </label>
      <label className="min-w-[220px] flex-1">
        <span className="block text-xs font-medium text-ink-700">Search terms (comma separated)</span>
        <input name="keywords" className={`${inputClass} mt-1`} placeholder="landscaping, lawn care" />
      </label>
      <label>
        <span className="block text-xs font-medium text-ink-700">Priority</span>
        <input type="number" name="priority" defaultValue={200} className={`${inputClass} tnum mt-1 w-24`} />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        Add
      </Button>
    </form>
  );
}

export function ScoringEditor({
  profileId,
  factors,
  thresholds,
}: {
  profileId: string;
  factors: Array<{ key: string; label: string; weight: number; description: string | null }>;
  thresholds: Record<string, number>;
}) {
  const [state, formAction, pending] = useActionState(saveScoringAction, initial);
  const total = factors.reduce((s, f) => s + f.weight, 0);

  return (
    <form action={formAction} className="space-y-4 px-5 py-4">
      <input type="hidden" name="profileId" value={profileId} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <p className="text-xs text-ink-500">
        Current weights total {total}. The score is normalised to 0-100, so they do not have to sum to
        exactly 100 — but keeping them there makes the numbers easier to reason about.
      </p>

      <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
        {factors.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <input
              type="number"
              name={`weight_${f.key}`}
              defaultValue={f.weight}
              min={0}
              max={100}
              className={`${inputClass} tnum w-20`}
              aria-label={`${f.label} weight`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink-800">{f.label}</div>
              {f.description && <div className="text-xs text-ink-500">{f.description}</div>}
            </div>
          </li>
        ))}
      </ul>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { key: 'PRIORITY_LEAD', label: 'Priority lead at or above' },
          { key: 'QUALIFIED_LEAD', label: 'Qualified lead at or above' },
          { key: 'REVIEW_REQUIRED', label: 'Review required at or above' },
        ].map((t) => (
          <label key={t.key}>
            <span className="block text-xs font-medium text-ink-700">{t.label}</span>
            <input
              type="number"
              name={`threshold_${t.key}`}
              defaultValue={thresholds[t.key] ?? 0}
              min={0}
              max={100}
              className={`${inputClass} tnum mt-1`}
            />
          </label>
        ))}
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save scoring'}
      </Button>
    </form>
  );
}

export function FollowUpRulesEditor({
  rules,
}: {
  rules: Array<{ id: string; key: string; label: string; delayDays: number; delayBusinessDays: boolean; isActive: boolean }>;
}) {
  const [state, formAction, pending] = useActionState(saveFollowUpRulesAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <input
              type="number"
              name={`delay_${r.id}`}
              defaultValue={r.delayDays}
              min={0}
              className={`${inputClass} tnum w-20`}
              aria-label={`${r.label} delay`}
            />
            <span className="text-xs text-ink-500">days</span>
            <label className="flex items-center gap-1 text-xs text-ink-600">
              <input
                type="checkbox"
                name={`business_${r.id}`}
                defaultChecked={r.delayBusinessDays}
                className="h-4 w-4 rounded border-ink-300"
              />
              business days only
            </label>
            <span className="min-w-[200px] flex-1 text-ink-800">{r.label}</span>
            <label className="flex items-center gap-1 text-xs text-ink-600">
              <input
                type="checkbox"
                name={`active_${r.id}`}
                defaultChecked={r.isActive}
                className="h-4 w-4 rounded border-ink-300"
              />
              active
            </label>
          </li>
        ))}
      </ul>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save follow-up rules'}
      </Button>
    </form>
  );
}

export function IntegrationCard({
  kind,
  title,
  description,
  secretFields,
  configFields,
  status,
  isEnabled,
  hasCredentials,
  lastError,
  lastTestedAt,
  canTest,
  authUrl,
}: {
  kind: string;
  title: string;
  description: string;
  secretFields: Array<{ name: string; label: string; hint?: string }>;
  configFields?: Array<{ name: string; label: string; value: string }>;
  status: string;
  isEnabled: boolean;
  hasCredentials: boolean;
  lastError: string | null;
  lastTestedAt: string | null;
  canTest: boolean;
  authUrl?: string | null;
}) {
  const [saveState, saveAction, saving] = useActionState(saveIntegrationAction, initial);
  const [testState, testAction, testing] = useActionState(testIntegrationAction, initial);

  const tone =
    status === 'CONNECTED' ? 'good' : status === 'ERROR' ? 'bad' : status === 'NOT_CONFIGURED' ? 'neutral' : 'warn';

  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-200 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          <p className="mt-0.5 text-xs text-ink-500">{description}</p>
        </div>
        <Badge tone={tone}>{status.replace(/_/g, ' ').toLowerCase()}</Badge>
      </div>

      <div className="space-y-3 px-5 py-4">
        {saveState.error && <Alert tone="bad">{saveState.error}</Alert>}
        {saveState.ok && <Alert tone="good">{saveState.message}</Alert>}
        {testState.error && <Alert tone="bad">{testState.error}</Alert>}
        {testState.ok && <Alert tone="good">{testState.message}</Alert>}
        {lastError && !testState.ok && <Alert tone="warn" title="Last error">{lastError}</Alert>}

        {authUrl && (
          <Alert tone="info" title="Authorise with Google">
            <a href={authUrl} className="font-medium underline">
              Connect this account
            </a>{' '}
            — you will be asked to grant access, then returned here.
          </Alert>
        )}

        <form action={saveAction} className="space-y-3">
          <input type="hidden" name="kind" value={kind} />

          {secretFields.map((f) => (
            <label key={f.name} className="block">
              <span className="block text-xs font-medium text-ink-700">{f.label}</span>
              {f.hint && <span className="block text-xs text-ink-500">{f.hint}</span>}
              <input
                type="password"
                name={`secret_${f.name}`}
                className={`${inputClass} mt-1`}
                placeholder={hasCredentials ? '•••••••• (leave blank to keep the stored value)' : ''}
                autoComplete="off"
              />
            </label>
          ))}

          {configFields?.map((f) => (
            <label key={f.name} className="block">
              <span className="block text-xs font-medium text-ink-700">{f.label}</span>
              <input name={`config_${f.name}`} defaultValue={f.value} className={`${inputClass} mt-1`} />
            </label>
          ))}

          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={isEnabled}
              className="h-4 w-4 rounded border-ink-300"
            />
            Enabled
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>

        {canTest && hasCredentials && (
          <form action={testAction}>
            <input type="hidden" name="kind" value={kind} />
            <Button type="submit" size="sm" variant="secondary" disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          </form>
        )}

        <p className="text-xs text-ink-400">
          {lastTestedAt ? `Last tested ${lastTestedAt}` : 'Never tested. Nothing claims to work until a test passes.'}
        </p>
      </div>
    </div>
  );
}

export function ScheduleEditor({
  schedules,
}: {
  schedules: Array<{
    id: string;
    key: string;
    name: string;
    jobName: string;
    cron: string;
    timezone: string;
    isActive: boolean;
    nextRunAt: string | null;
    lastRunAt: string | null;
  }>;
}) {
  const [state, formAction, pending] = useActionState(saveScheduleAction, initial);

  return (
    <div className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
        {schedules.map((s) => (
          <li key={s.id} className="px-3 py-3">
            <form action={formAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={s.id} />
              <div className="min-w-[200px] flex-1">
                <div className="text-sm font-medium text-ink-900">{s.name}</div>
                <div className="text-xs text-ink-500">
                  {s.jobName} · next {s.nextRunAt ?? 'not scheduled'}
                  {s.lastRunAt && ` · last ${s.lastRunAt}`}
                </div>
              </div>
              <label>
                <span className="block text-xs font-medium text-ink-700">Cron</span>
                <input name="cron" defaultValue={s.cron} className={`${inputClass} tnum mt-1 w-36`} />
              </label>
              <label>
                <span className="block text-xs font-medium text-ink-700">Timezone</span>
                <input name="timezone" defaultValue={s.timezone} className={`${inputClass} mt-1 w-44`} />
              </label>
              <label className="flex items-center gap-1 pb-2 text-xs text-ink-600">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked={s.isActive}
                  className="h-4 w-4 rounded border-ink-300"
                />
                active
              </label>
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                Save
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeadJobList({
  jobs,
}: {
  jobs: Array<{ id: string; name: string; lastError: string | null; attempts: number; updatedAt: string }>;
}) {
  const [state, formAction, pending] = useActionState(retryJobAction, initial);

  if (jobs.length === 0) {
    return <p className="px-5 py-4 text-sm text-ink-500">No failed jobs. Everything has run cleanly.</p>;
  }

  return (
    <div className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-[220px] flex-1">
              <div className="font-medium text-ink-900">{j.name}</div>
              <div className="text-xs text-red-600">{j.lastError}</div>
              <div className="text-xs text-ink-400">
                {j.attempts} attempts · {j.updatedAt}
              </div>
            </div>
            <form action={formAction}>
              <input type="hidden" name="jobId" value={j.id} />
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                Retry
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SourceToggleList({
  sources,
}: {
  sources: Array<{
    id: string;
    key: string;
    name: string;
    kind: string;
    isActive: boolean;
    lastRunAt: string | null;
    lastError: string | null;
  }>;
}) {
  const [, startTransition] = useTransition();

  return (
    <ul className="divide-y divide-ink-200">
      {sources.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
          <div className="min-w-[220px] flex-1">
            <div className={s.isActive ? 'text-ink-900' : 'text-ink-400'}>{s.name}</div>
            <div className="text-xs text-ink-500">
              {s.kind.replace(/_/g, ' ').toLowerCase()}
              {s.lastRunAt && ` · last run ${s.lastRunAt}`}
            </div>
            {s.lastError && <div className="text-xs text-amber-700">{s.lastError}</div>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => startTransition(() => toggleSourceAction(s.id, !s.isActive))}
          >
            {s.isActive ? 'Pause' : 'Activate'}
          </Button>
        </li>
      ))}
    </ul>
  );
}
