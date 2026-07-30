import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { User, UserRole } from '@prisma/client';
import { prisma } from '../db';
import { generateToken, hashToken } from '../crypto';
import { can, defaultRouteFor, type Permission } from './rbac';

export const SESSION_COOKIE = 'vw_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const SLIDING_REFRESH_MS = 1000 * 60 * 30;

export type SessionUser = Pick<
  User,
  'id' | 'email' | 'name' | 'role' | 'status' | 'timezone' | 'avatarColor'
>;

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<string> {
  const token = generateToken(32);
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session
      .updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }
  store.delete(SESSION_COOKIE);
}

/** Resolves the signed-in user, or null. Safe to call from any server context. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.user.status !== 'ACTIVE') return null;

  // Sliding refresh keeps active sessions alive without writing on every request.
  if (Date.now() - session.lastSeenAt.getTime() > SLIDING_REFRESH_MS) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      })
      .catch(() => undefined);
  }

  const { id, email, name, role, status, timezone, avatarColor } = session.user;
  return { id, email, name, role, status, timezone, avatarColor };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(defaultRouteFor(user.role));
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect(defaultRouteFor(user.role));
  return user;
}

/**
 * For server actions and route handlers: throws instead of redirecting, so the
 * caller can return a structured error to the client.
 */
export class AuthorizationError extends Error {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export async function authorize(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthorizationError('You must be signed in.');
  if (!can(user.role, permission)) throw new AuthorizationError();
  return user;
}

export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : h.get('x-real-ip'),
    userAgent: h.get('user-agent'),
  };
}
