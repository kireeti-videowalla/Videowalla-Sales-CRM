'use server';

import { revalidatePath } from 'next/cache';
import type { StageCategory } from '@prisma/client';
import { authorize } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { safeErrorMessage } from '@/lib/logger';
import { writeAuditLog } from '@/lib/auth/service';
import { normalizeText } from '@/lib/normalize';

export type PipelineConfigState = { error: string | null; ok?: boolean; message?: string };

function refresh() {
  revalidatePath('/settings/pipeline');
  revalidatePath('/pipeline');
  revalidatePath('/settings/followups');
}

/**
 * Stage and outcome configuration.
 *
 * System stages carry behaviour the rest of the product depends on — the
 * pipeline routes new leads to `ready_to_contact`, follow-up automation fires
 * from `contacted_no_answer`, suppression lives on `do_not_contact`. Those can
 * be renamed, recoloured and reordered freely, but not deleted or deactivated,
 * because removing them would silently break automation rather than produce a
 * visible error.
 */

export async function saveStagesAction(
  _prev: PipelineConfigState,
  formData: FormData,
): Promise<PipelineConfigState> {
  try {
    const user = await authorize('settings.manage');
    let changed = 0;

    const stages = await prisma.pipelineStage.findMany();
    for (const stage of stages) {
      const name = formData.get(`name_${stage.id}`);
      if (name === null) continue;

      const label = String(name).trim();
      if (!label) return { error: 'A column name cannot be empty.' };

      const position = Number(formData.get(`position_${stage.id}`) ?? stage.position);
      const color = String(formData.get(`color_${stage.id}`) ?? stage.color);

      // A system stage's visibility checkbox is rendered disabled, and a
      // disabled input is never submitted — so its absence here means "the UI
      // did not offer the choice", not "the owner switched it off". The
      // `isActive` assignment below is what actually keeps system stages
      // available to the automation; reading the checkbox for them would
      // reject every save.
      const wantsActive = stage.isSystem || formData.get(`active_${stage.id}`) === 'on';

      await prisma.pipelineStage.update({
        where: { id: stage.id },
        data: {
          name: label,
          position: Number.isFinite(position) ? position : stage.position,
          color,
          isActive: stage.isSystem ? true : wantsActive,
        },
      });
      changed += 1;
    }

    await writeAuditLog({ userId: user.id, action: 'pipeline.stages_updated', entity: 'PipelineStage' });
    refresh();
    return { error: null, ok: true, message: `${changed} column${changed === 1 ? '' : 's'} updated.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function addStageAction(
  _prev: PipelineConfigState,
  formData: FormData,
): Promise<PipelineConfigState> {
  try {
    const user = await authorize('settings.manage');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Give the column a name.' };

    const key = normalizeText(name).replace(/\s+/g, '_');
    if (await prisma.pipelineStage.findUnique({ where: { key } })) {
      return { error: 'A column with that name already exists.' };
    }

    const category = String(formData.get('category') ?? 'ENGAGED') as StageCategory;
    const last = await prisma.pipelineStage.findFirst({ orderBy: { position: 'desc' } });

    await prisma.pipelineStage.create({
      data: {
        key,
        name,
        category,
        position: Number(formData.get('position') ?? (last?.position ?? 0) + 10),
        color: String(formData.get('color') ?? '#64748b'),
        // Custom columns carry no automation: the owner adds a place to put
        // cards, not new behaviour the code does not know how to run.
        isSystem: false,
        requiredFields: [],
        automations: [],
        description: String(formData.get('description') ?? '') || null,
      },
    });

    await writeAuditLog({ userId: user.id, action: 'pipeline.stage_added', entity: 'PipelineStage', after: { key, name } });
    refresh();
    return { error: null, ok: true, message: `Added the "${name}" column.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function deleteStageAction(stageId: string): Promise<PipelineConfigState> {
  try {
    const user = await authorize('settings.manage');
    const stage = await prisma.pipelineStage.findUnique({
      where: { id: stageId },
      include: { _count: { select: { tickets: true } } },
    });
    if (!stage) return { error: 'Column not found.' };
    if (stage.isSystem) {
      return { error: `"${stage.name}" is required by the automation and cannot be removed.` };
    }
    if (stage._count.tickets > 0) {
      return {
        error: `"${stage.name}" still holds ${stage._count.tickets} ticket${stage._count.tickets === 1 ? '' : 's'}. Move them out first — deleting would take their history with them.`,
      };
    }

    await prisma.pipelineStage.delete({ where: { id: stageId } });
    await writeAuditLog({ userId: user.id, action: 'pipeline.stage_deleted', entity: 'PipelineStage', before: { key: stage.key } });
    refresh();
    return { error: null, ok: true, message: `Removed the "${stage.name}" column.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function saveStageRulesAction(
  _prev: PipelineConfigState,
  formData: FormData,
): Promise<PipelineConfigState> {
  try {
    const user = await authorize('settings.manage');
    const stageId = String(formData.get('stageId') ?? '');
    const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
    if (!stage) return { error: 'Column not found.' };

    const requiredFields = formData.getAll('requiredFields').map(String).filter(Boolean);

    await prisma.pipelineStage.update({
      where: { id: stageId },
      // Automations are behaviour implemented in code and are deliberately not
      // editable here — offering a free-text box would let the owner name one
      // that does not exist and silently do nothing.
      data: { requiredFields },
    });

    await writeAuditLog({
      userId: user.id,
      action: 'pipeline.stage_rules_updated',
      entity: 'PipelineStage',
      entityId: stageId,
      after: { requiredFields },
    });
    refresh();
    return { error: null, ok: true, message: `Required information updated for "${stage.name}".` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Contact outcomes
// ---------------------------------------------------------------------------

export async function saveOutcomesAction(
  _prev: PipelineConfigState,
  formData: FormData,
): Promise<PipelineConfigState> {
  try {
    const user = await authorize('settings.manage');
    const outcomes = await prisma.contactOutcomeType.findMany();
    let changed = 0;

    for (const outcome of outcomes) {
      const label = formData.get(`label_${outcome.id}`);
      if (label === null) continue;
      const text = String(label).trim();
      if (!text) return { error: 'An outcome label cannot be empty.' };

      await prisma.contactOutcomeType.update({
        where: { id: outcome.id },
        data: {
          label: text,
          position: Number(formData.get(`position_${outcome.id}`) ?? outcome.position),
          isActive: formData.get(`active_${outcome.id}`) === 'on',
          targetStageKey: String(formData.get(`stage_${outcome.id}`) ?? '') || null,
          countsAsContact: formData.get(`contact_${outcome.id}`) === 'on',
          countsAsConversation: formData.get(`conversation_${outcome.id}`) === 'on',
          requiresNote: formData.get(`note_${outcome.id}`) === 'on',
          requiresFollowUp: formData.get(`followup_${outcome.id}`) === 'on',
        },
      });
      changed += 1;
    }

    const active = await prisma.contactOutcomeType.count({ where: { isActive: true } });
    if (active === 0) {
      return { error: 'At least one outcome must stay active, or she cannot record a call.' };
    }

    await writeAuditLog({ userId: user.id, action: 'pipeline.outcomes_updated', entity: 'ContactOutcomeType' });
    refresh();
    return { error: null, ok: true, message: `${changed} outcome${changed === 1 ? '' : 's'} updated.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function addOutcomeAction(
  _prev: PipelineConfigState,
  formData: FormData,
): Promise<PipelineConfigState> {
  try {
    await authorize('settings.manage');
    const label = String(formData.get('label') ?? '').trim();
    if (!label) return { error: 'Give the outcome a name.' };

    const key = normalizeText(label).replace(/\s+/g, '_');
    if (await prisma.contactOutcomeType.findUnique({ where: { key } })) {
      return { error: 'An outcome with that name already exists.' };
    }

    const last = await prisma.contactOutcomeType.findFirst({ orderBy: { position: 'desc' } });
    await prisma.contactOutcomeType.create({
      data: {
        key,
        label,
        position: (last?.position ?? 0) + 10,
        targetStageKey: String(formData.get('targetStageKey') ?? '') || null,
        countsAsContact: formData.get('countsAsContact') === 'on',
        countsAsConversation: formData.get('countsAsConversation') === 'on',
        requiresNote: formData.get('requiresNote') === 'on',
        requiresFollowUp: formData.get('requiresFollowUp') === 'on',
      },
    });

    refresh();
    return { error: null, ok: true, message: `Added the "${label}" outcome.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}
