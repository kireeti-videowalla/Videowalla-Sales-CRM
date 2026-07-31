'use server';

import { redirect } from 'next/navigation';
import { destroySession, getCurrentUser } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/auth/service';

export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await writeAuditLog({ userId: user.id, action: 'auth.logout', entity: 'User', entityId: user.id });
  }
  redirect('/login');
}
