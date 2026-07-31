'use client';

import { useActionState } from 'react';
import { Alert, Button, Field, inputClass } from '@/components/ui';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
      <input type="hidden" name="next" value={nextPath ?? ''} />

      {state.error && <Alert tone="bad">{state.error}</Alert>}

      <Field label="Email" required>
        <input
          className={inputClass}
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus
        />
      </Field>

      <Field label="Password" required>
        <input
          className={inputClass}
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </Field>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-center text-xs text-ink-500">
        Access is by invitation only.
      </p>
    </form>
  );
}
