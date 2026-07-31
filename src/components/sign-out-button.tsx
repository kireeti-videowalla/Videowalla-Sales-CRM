'use client';

import { signOutAction } from '@/app/actions/auth';

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-lg px-2.5 py-1.5 text-sm text-ink-500 hover:bg-ink-100 hover:text-ink-900"
      >
        Sign out
      </button>
    </form>
  );
}
