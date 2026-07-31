'use client';

import { useActionState } from 'react';
import { Alert, Button, inputClass } from './ui';
import { assignTicketAction, type ActionState } from '@/app/actions/tickets';

const initial: ActionState = { error: null };

/** Owner-only control for assigning or reassigning a lead. */
export function AssignLead({
  ticketId,
  currentAssigneeId,
  reps,
}: {
  ticketId: string;
  currentAssigneeId: string | null;
  reps: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(assignTicketAction, initial);

  return (
    <form action={formAction} className="space-y-2 px-5 py-4">
      <input type="hidden" name="ticketId" value={ticketId} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="good">Assignment updated.</Alert>}

      <label className="block">
        <span className="block text-xs font-medium text-ink-700">Assigned to</span>
        <select name="assigneeId" defaultValue={currentAssigneeId ?? ''} className={`${inputClass} mt-1`}>
          <option value="">Nobody — leave in the unassigned pool</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-ink-500">
        Reassigning also moves any open follow-ups to the new owner, so nothing is left chasing a person
        who is no longer working the lead.
      </p>

      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save assignment'}
      </Button>
    </form>
  );
}
