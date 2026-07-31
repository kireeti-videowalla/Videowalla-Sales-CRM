'use client';

import { signOutAction } from '@/app/actions/auth';

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-full px-3 py-1.5 text-[13px] text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        Sign out
      </button>
    </form>
  );
}
