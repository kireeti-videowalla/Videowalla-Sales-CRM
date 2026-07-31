'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { markAllRead, markRead } from '@/lib/notifications/service';

export async function markAllReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(user.id);
  revalidatePath('/notifications');
  revalidatePath('/overview');
}

export async function markReadAction(notificationId: string): Promise<void> {
  const user = await requireUser();
  // Scoped to the caller's own notifications — one user cannot mark another's.
  await markRead(user.id, notificationId);
  revalidatePath('/notifications');
}
