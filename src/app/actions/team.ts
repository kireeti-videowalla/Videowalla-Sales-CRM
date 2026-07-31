'use server';

import { revalidatePath } from 'next/cache';
import type { UserRole } from '@prisma/client';
import { authorize } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { safeErrorMessage } from '@/lib/logger';
import { createInvitation, revokeAllSessions, writeAuditLog } from '@/lib/auth/service';

export type TeamState = { error: string | null; ok?: boolean; message?: string; acceptUrl?: string };

function refresh() {
  revalidatePath('/team');
  revalidatePath('/overview');
}

export async function inviteUserAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  try {
    const user = await authorize('users.manage');
    const email = String(formData.get('email') ?? '').trim();
    const name = String(formData.get('name') ?? '').trim();
    const role = String(formData.get('role') ?? '') as UserRole;

    if (!email || !name) return { error: 'Name and email are both required.' };
    if (!['OWNER', 'SALES_REP', 'MANAGER'].includes(role)) return { error: 'Choose a valid role.' };

    const result = await createInvitation({ email, name, role, invitedById: user.id });
    await writeAuditLog({
      userId: user.id,
      action: 'user.invited',
      entity: 'Invitation',
      entityId: result.invitation.id,
      after: { email, role },
    });

    refresh();
    return {
      error: null,
      ok: true,
      // No email transport is configured by default, so the owner is given the
      // link to share rather than being told an email was sent.
      message: 'Invitation created. Send this link to them directly — it expires in 7 days.',
      acceptUrl: result.acceptUrl,
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function updateScheduleAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  try {
    const owner = await authorize('users.manage');
    const userId = String(formData.get('userId') ?? '');
    const weeklyHours = Number(formData.get('weeklyHours') ?? 8);
    if (!Number.isFinite(weeklyHours) || weeklyHours < 0 || weeklyHours > 80) {
      return { error: 'Weekly hours must be between 0 and 80.' };
    }

    // Collect the flexible day/time/hours rows.
    const plannedShifts: Array<{ weekday: number; startTime: string; hours: number }> = [];
    for (let i = 0; i < 7; i += 1) {
      const enabled = formData.get(`day_${i}_enabled`);
      if (!enabled) continue;
      const startTime = String(formData.get(`day_${i}_start`) ?? '09:00');
      const hours = Number(formData.get(`day_${i}_hours`) ?? 0);
      if (hours > 0) plannedShifts.push({ weekday: i, startTime, hours });
    }

    const plannedTotal = plannedShifts.reduce((s, p) => s + p.hours, 0);
    if (plannedShifts.length > 0 && Math.abs(plannedTotal - weeklyHours) > 0.01) {
      return {
        error: `Planned shifts total ${plannedTotal}h but the weekly total is ${weeklyHours}h. Make them match.`,
      };
    }

    // Close the previous schedule rather than overwriting it, so history stays
    // interpretable when reviewing an old week.
    const now = new Date();
    await prisma.workSchedule.updateMany({
      where: { userId, effectiveTo: null },
      data: { effectiveTo: now },
    });
    await prisma.workSchedule.create({
      data: { userId, weeklyHours, plannedShifts, effectiveFrom: now },
    });

    await writeAuditLog({
      userId: owner.id,
      action: 'user.schedule_updated',
      entity: 'WorkSchedule',
      entityId: userId,
      after: { weeklyHours, plannedShifts },
    });

    refresh();
    return { error: null, ok: true, message: 'Schedule saved.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function updateCompensationAction(
  _prev: TeamState,
  formData: FormData,
): Promise<TeamState> {
  try {
    const owner = await authorize('users.manage');
    const userId = String(formData.get('userId') ?? '');
    const weeklyPay = Number(formData.get('weeklyPay') ?? 0);
    const weeklyHours = Number(formData.get('weeklyHours') ?? 8);
    const payCadence = String(formData.get('payCadence') ?? 'BIWEEKLY');

    if (!Number.isFinite(weeklyPay) || weeklyPay < 0) return { error: 'Enter a valid weekly pay amount.' };

    const now = new Date();
    await prisma.compensationSetting.updateMany({
      where: { userId, effectiveTo: null },
      data: { effectiveTo: now },
    });
    await prisma.compensationSetting.create({
      data: {
        userId,
        weeklyPayCents: Math.round(weeklyPay * 100),
        weeklyHours,
        payCadence,
        hourlyRateCents: weeklyHours > 0 ? Math.round((weeklyPay * 100) / weeklyHours) : null,
        effectiveFrom: now,
      },
    });

    await writeAuditLog({
      userId: owner.id,
      action: 'user.compensation_updated',
      entity: 'CompensationSetting',
      entityId: userId,
      after: { weeklyPay, weeklyHours, payCadence },
    });

    refresh();
    return { error: null, ok: true, message: 'Compensation saved. New weeks will use it.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function setUserStatusAction(_prev: TeamState, formData: FormData): Promise<TeamState> {
  try {
    const owner = await authorize('users.manage');
    const userId = String(formData.get('userId') ?? '');
    const suspend = String(formData.get('suspend') ?? '') === 'true';

    if (userId === owner.id) return { error: 'You cannot suspend your own account.' };

    if (suspend) {
      const owners = await prisma.user.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
      const target = await prisma.user.findUnique({ where: { id: userId } });
      // Never allow the last owner to be locked out.
      if (target?.role === 'OWNER' && owners <= 1) {
        return { error: 'This is the only active owner. Promote another owner first.' };
      }
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        status: suspend ? 'SUSPENDED' : 'ACTIVE',
        deactivatedAt: suspend ? new Date() : null,
      },
    });
    if (suspend) await revokeAllSessions(userId);

    await writeAuditLog({
      userId: owner.id,
      action: suspend ? 'user.suspended' : 'user.reactivated',
      entity: 'User',
      entityId: userId,
    });

    refresh();
    return { error: null, ok: true, message: suspend ? 'Account suspended.' : 'Account reactivated.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
