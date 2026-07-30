import 'server-only';
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../db';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../crypto';
import { getEnv } from '../env';
import { createLogger } from '../logger';

const log = createLogger('auth');

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Naive in-process rate limiter. Enough to blunt credential stuffing on a
 * single-instance private tool; swap for a shared store if this ever runs
 * multi-instance.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearRateLimit(key: string): void {
  attempts.delete(key);
}

export type LoginResult =
  | { ok: true; userId: string; role: UserRole }
  | { ok: false; error: string };

export async function authenticate(email: string, password: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  // Uniform failure message and a dummy verification keep response timing and
  // wording from revealing whether an account exists.
  if (!user || !user.passwordHash) {
    await verifyPassword(password, 'scrypt$00$00').catch(() => false);
    return { ok: false, error: 'Incorrect email or password.' };
  }
  if (user.status !== 'ACTIVE') {
    return { ok: false, error: 'This account is not active. Ask the owner to re-invite you.' };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, error: 'Incorrect email or password.' };

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true, userId: user.id, role: user.role };
}

export async function createInvitation(params: {
  email: string;
  name: string;
  role: UserRole;
  invitedById: string;
}): Promise<{ invitation: { id: string; email: string }; token: string; acceptUrl: string }> {
  const email = params.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && existing.status === 'ACTIVE') {
    throw new Error('A user with that email already exists.');
  }

  const token = generateToken(32);
  const invitation = await prisma.invitation.create({
    data: {
      email,
      name: params.name.trim(),
      role: params.role,
      tokenHash: hashToken(token),
      invitedById: params.invitedById,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  // A placeholder user row lets the owner see pending members in the Team page.
  if (!existing) {
    await prisma.user.create({
      data: { email, name: params.name.trim(), role: params.role, status: 'INVITED' },
    });
  }

  const acceptUrl = `${getEnv().APP_URL}/accept-invite?token=${token}`;
  log.info('invitation created', { email, role: params.role });
  return { invitation: { id: invitation.id, email }, token, acceptUrl };
}

export async function findInvitationByToken(token: string) {
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invitation) return null;
  if (invitation.acceptedAt || invitation.revokedAt) return null;
  if (invitation.expiresAt < new Date()) return null;
  return invitation;
}

export async function acceptInvitation(
  token: string,
  password: string,
): Promise<{ ok: true; userId: string; role: UserRole } | { ok: false; error: string }> {
  const invitation = await findInvitationByToken(token);
  if (!invitation) return { ok: false, error: 'This invitation is invalid, expired or already used.' };

  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false, error: passwordError };

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: invitation.email } });
    const record = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            name: invitation.name,
            role: invitation.role,
            status: 'ACTIVE',
            deactivatedAt: null,
          },
        })
      : await tx.user.create({
          data: {
            email: invitation.email,
            name: invitation.name,
            role: invitation.role,
            status: 'ACTIVE',
            passwordHash,
          },
        });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), acceptedById: record.id },
    });
    return record;
  });

  log.info('invitation accepted', { userId: user.id, role: user.role });
  return { ok: true, userId: user.id, role: user.role };
}

export function validatePassword(password: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain a number.';
  return null;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function writeAuditLog(entry: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: entry.before,
        after: entry.after,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent?.slice(0, 500) ?? null,
      },
    })
    .catch((err) => log.error('failed to write audit log', { err: String(err) }));
}
