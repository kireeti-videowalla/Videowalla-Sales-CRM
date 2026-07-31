'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/lib/auth/session';
import { safeErrorMessage } from '@/lib/logger';
import { endShift, pauseShift, resumeShift, startShift } from '@/lib/shifts/service';
import { enqueue } from '@/lib/jobs/queue';
import { notify } from '@/lib/notifications/service';
import { getSetting } from '@/lib/settings/service';

export type ShiftActionState = { error: string | null; warnings?: string[]; ok?: boolean };

function refresh() {
  revalidatePath('/this-week');
  revalidatePath('/call-queue');
  revalidatePath('/overview');
  revalidatePath('/live-activity');
}

export async function startShiftAction(): Promise<ShiftActionState> {
  try {
    const user = await authorize('shifts.manage_own');
    const result = await startShift(user.id);
    if (!result.ok) return { error: result.error ?? 'Could not start the shift.' };

    const policy = await getSetting('notifications.policy');
    if (policy.alertOnShiftStart) {
      await notify({
        key: 'shift.started',
        roles: ['OWNER'],
        title: `${user.name} started a shift`,
        body: result.shift?.startedLateMinutes
          ? `Started ${result.shift.startedLateMinutes} minutes after the planned time.`
          : 'Shift started on time.',
        severity: result.shift?.startedLateMinutes ? 'WARNING' : 'INFO',
        linkUrl: '/live-activity',
        dedupeKey: `shift-started:${result.shift?.id}`,
      });
    }

    refresh();
    return { error: null, ok: true };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function pauseShiftAction(
  _prev: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  try {
    const user = await authorize('shifts.manage_own');
    const reason = String(formData.get('reason') ?? '').trim();
    const result = await pauseShift(user.id, reason || undefined);
    refresh();
    return { error: result.ok ? null : (result.error ?? 'Could not pause the shift.'), ok: result.ok };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function resumeShiftAction(): Promise<ShiftActionState> {
  try {
    const user = await authorize('shifts.manage_own');
    const result = await resumeShift(user.id);
    refresh();
    return { error: result.ok ? null : (result.error ?? 'Could not resume the shift.'), ok: result.ok };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function endShiftAction(
  _prev: ShiftActionState,
  formData: FormData,
): Promise<ShiftActionState> {
  try {
    const user = await authorize('shifts.manage_own');
    const note = String(formData.get('note') ?? '').trim();
    const result = await endShift(user.id, note || undefined);
    if (!result.ok) return { error: result.error ?? 'Could not end the shift.', warnings: result.warnings };

    if (result.shift) {
      // The shift report is generated in the background so ending a shift is
      // instant for the rep.
      await enqueue(
        'reports.shift',
        { shiftId: result.shift.id },
        { idempotencyKey: `shift-report:${result.shift.id}` },
      );

      const policy = await getSetting('notifications.policy');
      if (policy.alertOnShiftEnd) {
        await notify({
          key: 'shift.ended',
          roles: ['OWNER'],
          title: `${user.name} ended a shift`,
          body: `${(result.shift.activeSeconds / 3600).toFixed(2)}h active.${
            result.warnings.length ? ` ${result.warnings.join(' ')}` : ''
          }`,
          severity: result.warnings.length ? 'WARNING' : 'INFO',
          linkUrl: '/live-activity',
          dedupeKey: `shift-ended:${result.shift.id}`,
        });
      }
    }

    refresh();
    return { error: null, ok: true, warnings: result.warnings };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
