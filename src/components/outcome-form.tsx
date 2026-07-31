'use client';

import { useActionState, useState } from 'react';
import { Alert, Button, Field, inputClass } from './ui';
import { recordOutcomeAction, type ActionState } from '@/app/actions/tickets';

const initialState: ActionState = { error: null };

export type OutcomeOption = {
  key: string;
  label: string;
  requiresNote: boolean;
  requiresFollowUp: boolean;
  targetStageKey: string | null;
};

/**
 * The salesperson's core interaction: pick an outcome, add a note, done.
 *
 * Extra fields appear only when the chosen outcome's target stage requires
 * them, so the common case (no answer) stays a two-click action.
 */
export function OutcomeForm({
  ticketId,
  outcomes,
  suggestedFollowUpDate,
}: {
  ticketId: string;
  outcomes: OutcomeOption[];
  suggestedFollowUpDate: string;
}) {
  const [state, formAction, pending] = useActionState(recordOutcomeAction, initialState);
  const [selected, setSelected] = useState<string>('');

  const outcome = outcomes.find((o) => o.key === selected);
  const stage = outcome?.targetStageKey;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ticketId" value={ticketId} />

      {state.error && (
        <Alert tone="bad">
          {state.error}
          {state.missing?.length ? (
            <ul className="mt-1 list-inside list-disc">
              {state.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      )}
      {state.ok && state.message && <Alert tone="good">{state.message}</Alert>}

      <div>
        <span className="block text-sm font-medium text-ink-700">What happened?</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {outcomes.map((o) => (
            <label key={o.key} className="cursor-pointer">
              <input
                type="radio"
                name="outcomeKey"
                value={o.key}
                className="peer sr-only"
                checked={selected === o.key}
                onChange={() => setSelected(o.key)}
                required
              />
              <span className="inline-block rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset ring-ink-300 transition-colors peer-checked:bg-brand-600 peer-checked:text-white peer-checked:ring-brand-600 hover:bg-ink-50 peer-checked:hover:bg-brand-700">
                {o.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How did you contact them?">
          <select name="channel" className={inputClass} defaultValue="PHONE">
            <option value="PHONE">Phone call</option>
            <option value="EMAIL">Email</option>
            <option value="SMS">Text message</option>
            <option value="LINKEDIN">LinkedIn</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="WEBSITE_FORM">Website form</option>
            <option value="IN_PERSON">In person</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
      </div>

      <Field
        label="Note"
        required={outcome?.requiresNote}
        hint={outcome?.requiresNote ? 'Required for this outcome.' : 'Optional, but useful next time.'}
      >
        <textarea
          name="note"
          rows={3}
          className={inputClass}
          placeholder="What was said, who you spoke to, what they need…"
          required={outcome?.requiresNote}
        />
      </Field>

      {/* --- Stage-specific required fields ---------------------------- */}
      {stage === 'contacted_connected' && (
        <div className="grid gap-4 rounded-lg bg-ink-50 p-4 sm:grid-cols-2">
          <Field label="Conversation summary" required>
            <input name="conversationSummary" className={inputClass} required />
          </Field>
          <Field label="Interest level" required>
            <select name="interestLevel" className={inputClass} required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
              <option value="NONE">None</option>
            </select>
          </Field>
          <Field label="Main problem discussed" required>
            <input name="mainProblem" className={inputClass} required />
          </Field>
          <Field label="Next action" required>
            <input name="nextAction" className={inputClass} required />
          </Field>
        </div>
      )}

      {stage === 'interested' && (
        <div className="grid gap-4 rounded-lg bg-emerald-50 p-4 sm:grid-cols-2">
          <Field label="What are they interested in?" required>
            <input name="interestSummary" className={inputClass} required />
          </Field>
          <Field label="Main business problem" required>
            <input name="mainProblem" className={inputClass} required />
          </Field>
          <Field label="Recommended Videowalla service" required>
            <input name="recommendedService" className={inputClass} required />
          </Field>
          <Field label="Expected next step" required>
            <input name="expectedNextStep" className={inputClass} required />
          </Field>
          <Field label="Follow-up date" hint="Leave blank to use the configured default.">
            <input type="date" name="followUpDate" className={inputClass} defaultValue={suggestedFollowUpDate} />
          </Field>
        </div>
      )}

      {stage === 'follow_up_required' && (
        <div className="grid gap-4 rounded-lg bg-amber-50 p-4 sm:grid-cols-2">
          <Field label="Follow-up date" required>
            <input type="date" name="followUpDate" className={inputClass} required defaultValue={suggestedFollowUpDate} />
          </Field>
          <Field label="Follow-up reason" required>
            <input name="followUpReason" className={inputClass} required />
          </Field>
        </div>
      )}

      {stage === 'not_interested' && (
        <div className="grid gap-4 rounded-lg bg-orange-50 p-4 sm:grid-cols-2">
          <Field label="Reason" required>
            <input name="notInterestedReason" className={inputClass} required />
          </Field>
          <Field label="Worth revisiting later?" required>
            <select name="reactivationAppropriate" className={inputClass} required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              <option value="true">Yes — schedule a reactivation</option>
              <option value="false">No</option>
            </select>
          </Field>
          <Field label="Revisit on (optional)">
            <input type="date" name="reactivationDate" className={inputClass} />
          </Field>
        </div>
      )}

      {stage === 'disqualified' && (
        <div className="rounded-lg bg-red-50 p-4">
          <Field label="Disqualification reason" required>
            <input name="disqualificationReason" className={inputClass} required />
          </Field>
        </div>
      )}

      {stage === 'do_not_contact' && (
        <div className="rounded-lg bg-red-50 p-4">
          <Alert tone="bad" title="This is permanent">
            The company will never re-enter a call queue. Only the owner can reverse it.
          </Alert>
          <div className="mt-3">
            <Field label="Reason" required>
              <input name="doNotContactReason" className={inputClass} required />
            </Field>
          </div>
        </div>
      )}

      {stage === 'meeting_invite_sent' && (
        <Alert tone="info">
          To actually send a Google Calendar invitation, use the “Book a meeting” panel below. This outcome
          only records that an invitation was sent.
        </Alert>
      )}

      <Button type="submit" size="lg" disabled={pending || !selected}>
        {pending ? 'Saving…' : 'Record outcome'}
      </Button>
    </form>
  );
}
