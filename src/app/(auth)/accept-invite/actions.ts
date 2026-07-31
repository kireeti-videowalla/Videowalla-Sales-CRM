'use server';

import { redirect } from 'next/navigation';
import { defaultRouteFor } from '@/lib/auth/rbac';
import { createSession, requestMeta } from '@/lib/auth/session';
import { acceptInvitation, writeAuditLog } from '@/lib/auth/service';

export type AcceptState = { error: string | null };

export async function acceptInviteAction(
  _prev: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!token) return { error: 'Missing invitation token.' };
  if (password !== confirm) return { error: 'The two passwords do not match.' };

  const result = await acceptInvitation(token, password);
  if (!result.ok) return { error: result.error };

  const meta = await requestMeta();
  await createSession(result.userId, meta);
  await writeAuditLog({
    userId: result.userId,
    action: 'auth.invitation_accepted',
    entity: 'User',
    entityId: result.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  redirect(defaultRouteFor(result.role));
}
