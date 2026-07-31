'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, inputClass } from './ui';
import {
  inviteUserAction,
  setUserStatusAction,
  updateCompensationAction,
  updateScheduleAction,
  type TeamState,
} from '@/app/actions/team';

const initial: TeamState = { error: null };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function InvitePanel() {
  const [state, formAction, pending] = useActionState(inviteUserAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && (
        <Alert tone="good" title={state.message}>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{state.acceptUrl}</code>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <input name="name" className={inputClass} required />
        </Field>
        <Field label="Email" required>
          <input type="email" name="email" className={inputClass} required />
        </Field>
        <Field label="Role" required>
          <select name="role" className={inputClass} defaultValue="SALES_REP">
            <option value="SALES_REP">Sales representative</option>
            <option value="MANAGER">Manager (view only)</option>
            <option value="OWNER">Owner / Admin</option>
          </select>
        </Field>
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Creating…' : 'Create invitation'}
      </Button>
    </form>
  );
}

export function SchedulePanel({
  userId,
  weeklyHours,
  plannedShifts,
}: {
  userId: string;
  weeklyHours: number;
  plannedShifts: Array<{ weekday: number; startTime: string; hours: number }>;
}) {
  const [state, formAction, pending] = useActionState(updateScheduleAction, initial);
  const byDay = new Map(plannedShifts.map((p) => [p.weekday, p]));

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      <input type="hidden" name="userId" value={userId} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <Field label="Total paid hours per week" required hint="Planned shifts below must add up to this.">
        <input
          type="number"
          step="0.5"
          min="0"
          max="80"
          name="weeklyHours"
          defaultValue={weeklyHours}
          className={`${inputClass} tnum max-w-[140px]`}
          required
        />
      </Field>

      <div className="space-y-2">
        <span className="block text-sm font-medium text-ink-700">Planned shifts</span>
        <p className="text-xs text-ink-500">
          Any combination is allowed — four hours on two days, two hours on four days, or anything else
          that totals the weekly hours.
        </p>
        {DAYS.map((day, i) => {
          const existing = byDay.get(i);
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <label className="flex w-32 items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  name={`day_${i}_enabled`}
                  defaultChecked={Boolean(existing)}
                  className="h-4 w-4 rounded border-ink-300"
                />
                {day}
              </label>
              <input
                type="time"
                name={`day_${i}_start`}
                defaultValue={existing?.startTime ?? '09:00'}
                className={`${inputClass} tnum max-w-[130px]`}
              />
              <input
                type="number"
                step="0.5"
                min="0"
                max="12"
                name={`day_${i}_hours`}
                defaultValue={existing?.hours ?? 0}
                className={`${inputClass} tnum max-w-[90px]`}
                aria-label={`${day} hours`}
              />
              <span className="text-xs text-ink-500">hours</span>
            </div>
          );
        })}
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save schedule'}
      </Button>
    </form>
  );
}

export function CompensationPanel({
  userId,
  weeklyPayCents,
  weeklyHours,
  payCadence,
}: {
  userId: string;
  weeklyPayCents: number;
  weeklyHours: number;
  payCadence: string;
}) {
  const [state, formAction, pending] = useActionState(updateCompensationAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      <input type="hidden" name="userId" value={userId} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">{state.message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Pay per working week (CAD)" required>
          <input
            type="number"
            step="0.01"
            min="0"
            name="weeklyPay"
            defaultValue={(weeklyPayCents / 100).toFixed(2)}
            className={`${inputClass} tnum`}
            required
          />
        </Field>
        <Field label="Paid hours per week" required>
          <input
            type="number"
            step="0.5"
            min="0"
            name="weeklyHours"
            defaultValue={weeklyHours}
            className={`${inputClass} tnum`}
            required
          />
        </Field>
        <Field label="Pay cadence">
          <select name="payCadence" className={inputClass} defaultValue={payCadence}>
            <option value="WEEKLY">Weekly</option>
            <option value="BIWEEKLY">Every two weeks</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </Field>
      </div>

      <p className="text-xs text-ink-500">
        Hourly equivalent is derived automatically and drives every cost-per-contact and ROI figure.
      </p>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save compensation'}
      </Button>
    </form>
  );
}

export function StatusToggle({ userId, suspended }: { userId: string; suspended: boolean }) {
  const [state, formAction, pending] = useActionState(setUserStatusAction, initial);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="suspend" value={String(!suspended)} />
      <Button type="submit" size="sm" variant={suspended ? 'secondary' : 'danger'} disabled={pending}>
        {pending ? '…' : suspended ? 'Reactivate' : 'Suspend'}
      </Button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
