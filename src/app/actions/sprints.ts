'use server';

import { revalidatePath } from 'next/cache';
import { authorize } from '@/lib/auth/session';
import { safeErrorMessage } from '@/lib/logger';
import { approveSprint, overrideTarget } from '@/lib/sprint/planner';
import { approveReviewBatch } from '@/lib/pipeline/review';
import { enqueue } from '@/lib/jobs/queue';
import { writeAuditLog } from '@/lib/auth/service';

export type SprintActionState = { error: string | null; ok?: boolean; message?: string };

function refresh() {
  revalidatePath('/sunday-review');
  revalidatePath('/sprints');
  revalidatePath('/overview');
  revalidatePath('/this-week');
}

export async function approveSprintAction(
  _prev: SprintActionState,
  formData: FormData,
): Promise<SprintActionState> {
  try {
    const user = await authorize('sprints.approve');
    const sprintId = String(formData.get('sprintId') ?? '');
    const result = await approveSprint(sprintId, user.id);
    await writeAuditLog({
      userId: user.id,
      action: 'sprint.approved',
      entity: 'WeeklySprint',
      entityId: sprintId,
    });
    refresh();
    return result.ok
      ? { error: null, ok: true, message: 'Week approved. The salesperson has been notified.' }
      : { error: result.error ?? 'Could not approve the sprint.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function overrideTargetsAction(
  _prev: SprintActionState,
  formData: FormData,
): Promise<SprintActionState> {
  try {
    const user = await authorize('sprints.override_targets');
    const sprintId = String(formData.get('sprintId') ?? '');
    let changed = 0;

    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('target_')) continue;
      const targetKey = key.slice('target_'.length);
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      await overrideTarget({ sprintId, key: targetKey, target: parsed, ownerId: user.id });
      changed += 1;
    }

    await writeAuditLog({
      userId: user.id,
      action: 'sprint.targets_overridden',
      entity: 'WeeklySprint',
      entityId: sprintId,
      after: { changed },
    });

    refresh();
    return { error: null, ok: true, message: `${changed} target${changed === 1 ? '' : 's'} updated.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function approveReviewBatchAction(
  _prev: SprintActionState,
  formData: FormData,
): Promise<SprintActionState> {
  try {
    const user = await authorize('leads.assign');
    const ids = formData.getAll('ticketIds').map(String).filter(Boolean);
    if (ids.length === 0) return { error: 'Select at least one lead.' };

    const result = await approveReviewBatch(ids, user.id);
    refresh();
    revalidatePath('/leads');
    return {
      error: result.errors.length ? result.errors.join('; ') : null,
      ok: result.approved > 0,
      message: `${result.approved} lead${result.approved === 1 ? '' : 's'} approved for calling.`,
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

/** Runs the Sunday planning workflow on demand, in the background. */
export async function replanAction(
  _prev: SprintActionState,
  formData: FormData,
): Promise<SprintActionState> {
  try {
    const user = await authorize('sprints.approve');
    const skipIngestion = String(formData.get('skipIngestion') ?? '') === 'on';

    await enqueue(
      'sprint.replan',
      { skipIngestion },
      { idempotencyKey: `replan:${new Date().toISOString().slice(0, 13)}`, priority: 20 },
    );
    await writeAuditLog({ userId: user.id, action: 'sprint.replan_requested', entity: 'WeeklySprint' });

    refresh();
    return {
      error: null,
      ok: true,
      message:
        'Re-planning has been queued. It runs in the background — refresh this page in a minute to see the result.',
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
