'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, inputClass } from './ui';
import {
  addNoteAction,
  createFollowUpAction,
  createMeetingAction,
  reviewDecisionAction,
  type ActionState,
} from '@/app/actions/tickets';

const initial: ActionState = { error: null };

export function NoteComposer({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState(addNoteAction, initial);

  return (
    <form action={formAction} className="space-y-2 px-5 py-4">
      <input type="hidden" name="ticketId" value={ticketId} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      <textarea
        name="body"
        rows={2}
        className={inputClass}
        placeholder="Add a note or comment…"
        required
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Add note'}
      </Button>
    </form>
  );
}

export function FollowUpComposer({
  ticketId,
  defaultDate,
}: {
  ticketId: string;
  defaultDate: string;
}) {
  const [state, formAction, pending] = useActionState(createFollowUpAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      <input type="hidden" name="ticketId" value={ticketId} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone="good">{state.message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Follow up on" required>
          <input type="date" name="dueAt" className={inputClass} defaultValue={defaultDate} required />
        </Field>
        <Field label="How" required>
          <select name="channel" className={inputClass} defaultValue="PHONE">
            <option value="PHONE">Phone call</option>
            <option value="EMAIL">Email</option>
            <option value="SMS">Text message</option>
            <option value="LINKEDIN">LinkedIn</option>
          </select>
        </Field>
      </div>
      <Field label="What for?" required>
        <input name="reason" className={inputClass} placeholder="Send the proposal, call back after their trip…" required />
      </Field>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Scheduling…' : 'Schedule follow-up'}
      </Button>
    </form>
  );
}

export function MeetingComposer({
  ticketId,
  defaultEmail,
  calendarConnected,
  minDateTime,
}: {
  ticketId: string;
  defaultEmail: string;
  calendarConnected: boolean;
  minDateTime: string;
}) {
  const [state, formAction, pending] = useActionState(createMeetingAction, initial);

  return (
    <form action={formAction} className="space-y-3 px-5 py-4">
      <input type="hidden" name="ticketId" value={ticketId} />

      {!calendarConnected && (
        <Alert tone="warn" title="Google Calendar is not connected">
          You can still record the meeting, but no invitation will actually be sent until the owner
          connects Google Calendar in Settings → Integrations.
        </Alert>
      )}
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && state.message && <Alert tone={state.message.includes('not connected') ? 'warn' : 'good'}>{state.message}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Their email" required>
          <input type="email" name="contactEmail" className={inputClass} defaultValue={defaultEmail} required />
        </Field>
        <Field label="Meeting type" required>
          <select name="meetingType" className={inputClass} defaultValue="Discovery call">
            <option>Discovery call</option>
            <option>Strategy call</option>
            <option>Proposal review</option>
            <option>In-person meeting</option>
          </select>
        </Field>
        <Field label="When" required>
          <input type="datetime-local" name="startsAt" className={inputClass} min={minDateTime} required />
        </Field>
        <Field label="Length" required>
          <select name="durationMinutes" className={inputClass} defaultValue="30">
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">60 minutes</option>
          </select>
        </Field>
      </div>
      <Field label="Notes for the invitation">
        <textarea name="notes" rows={2} className={inputClass} placeholder="Context for the owner and the attendee" />
      </Field>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Creating…' : calendarConnected ? 'Send calendar invitation' : 'Record meeting'}
      </Button>
    </form>
  );
}

export function ReviewDecisionPanel({ ticketId }: { ticketId: string }) {
  const [state, formAction, pending] = useActionState(reviewDecisionAction, initial);

  return (
    <div className="px-5 py-4">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      <p className="text-sm text-ink-600">
        This lead needs a decision before it enters the call queue — either the extraction confidence or
        the score fell below the configured threshold.
      </p>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="ticketId" value={ticketId} />
        <Field label="Reason (optional)">
          <input name="reason" className={inputClass} placeholder="Why you approved or rejected it" />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" name="decision" value="APPROVE" disabled={pending}>
            Approve for calling
          </Button>
          <Button type="submit" name="decision" value="DISQUALIFY" variant="secondary" disabled={pending}>
            Disqualify
          </Button>
        </div>
      </form>
    </div>
  );
}
