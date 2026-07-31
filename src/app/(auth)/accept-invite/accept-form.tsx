'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { acceptInviteAction, type AcceptState } from './actions';

const initialState: AcceptState = { error: null };

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error && <Alert tone="bad">{state.error}</Alert>}

      <Field
        label="Choose a password"
        hint="At least 12 characters, with an uppercase letter, a lowercase letter and a number."
        required
      >
        <input className={inputClass} type="password" name="password" autoComplete="new-password" required />
      </Field>

      <Field label="Confirm password" required>
        <input className={inputClass} type="password" name="confirm" autoComplete="new-password" required />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'}
      </Button>
    </form>
  );
}
