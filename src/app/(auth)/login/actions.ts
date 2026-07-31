'use server';

import { redirect } from 'next/navigation';
import { defaultRouteFor } from '@/lib/auth/rbac';
import { createSession, requestMeta } from '@/lib/auth/session';
import { authenticate, checkRateLimit, clearRateLimit, writeAuditLog } from '@/lib/auth/service';

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '');

  if (!email || !password) return { error: 'Enter your email and password.' };

  const meta = await requestMeta();
  // Rate limit on both identifiers so neither a single IP nor a single account
  // can be hammered.
  const ipLimit = checkRateLimit(`ip:${meta.ipAddress ?? 'unknown'}`);
  const emailLimit = checkRateLimit(`email:${email.toLowerCase()}`);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    const retry = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
    return { error: `Too many attempts. Try again in ${Math.ceil(retry / 60)} minute(s).` };
  }

  const result = await authenticate(email, password);
  if (!result.ok) {
    await writeAuditLog({
      action: 'auth.login_failed',
      entity: 'User',
      after: { email },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { error: result.error };
  }

  clearRateLimit(`email:${email.toLowerCase()}`);
  await createSession(result.userId, meta);
  await writeAuditLog({
    userId: result.userId,
    action: 'auth.login',
    entity: 'User',
    entityId: result.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  // Only allow same-origin relative redirects, so `?next=` cannot be used to
  // bounce a freshly authenticated user to an external site.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : defaultRouteFor(result.role);
  redirect(safeNext);
}
