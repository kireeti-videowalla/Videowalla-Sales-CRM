'use server';

import { revalidatePath } from 'next/cache';
import type { IntegrationKind } from '@prisma/client';
import { authorize } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { safeErrorMessage } from '@/lib/logger';
import { writeAuditLog } from '@/lib/auth/service';
import { getSetting, setSetting } from '@/lib/settings/service';
import { SETTING_DEFINITIONS, type SettingKey } from '@/lib/settings/definitions';
import { normalizeText } from '@/lib/normalize';
import { saveIntegration, recordIntegrationTest } from '@/lib/integrations/store';
import { testAiProvider } from '@/lib/ai/provider';
import { testGmailConnection } from '@/lib/integrations/gmail';
import { testCalendarConnection } from '@/lib/integrations/calendar';
import { testPlacesConnection } from '@/lib/integrations/places';
import { isValidCron, refreshSchedule } from '@/lib/jobs/scheduler';
import { retryDeadJob } from '@/lib/jobs/queue';
import { logActivity } from '@/lib/activity/log';

export type SettingsState = { error: string | null; ok?: boolean; message?: string };

function refresh() {
  revalidatePath('/settings', 'layout');
  revalidatePath('/overview');
}

/**
 * Saves one settings group. Values are coerced to the right primitive type and
 * then validated by the group's zod schema, so a bad value is rejected rather
 * than silently corrupting the automation.
 */
export async function saveSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    const user = await authorize('settings.manage');
    const key = String(formData.get('__key') ?? '') as SettingKey;
    if (!(key in SETTING_DEFINITIONS)) return { error: 'Unknown settings group.' };

    const before = await getSetting(key);
    const patch: Record<string, unknown> = { ...(before as object) };

    for (const [field, raw] of formData.entries()) {
      if (field.startsWith('__')) continue;
      const value = typeof raw === 'string' ? raw : '';
      const current = (before as Record<string, unknown>)[field];

      if (typeof current === 'boolean') {
        patch[field] = value === 'on' || value === 'true';
      } else if (typeof current === 'number') {
        const n = Number(value);
        if (Number.isFinite(n)) patch[field] = n;
      } else if (Array.isArray(current)) {
        patch[field] = value
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        patch[field] = value;
      }
    }

    // Unchecked checkboxes are absent from FormData; restore them to false.
    for (const [field, current] of Object.entries(before as Record<string, unknown>)) {
      if (typeof current === 'boolean' && !formData.has(field)) patch[field] = false;
    }

    const saved = await setSetting(key, patch, user.id);
    await writeAuditLog({
      userId: user.id,
      action: 'settings.updated',
      entity: 'Setting',
      entityId: key,
      before: before as never,
      after: saved as never,
    });
    await logActivity({ userId: user.id, kind: 'SETTINGS_CHANGED', summary: `Changed ${key}` });

    // Sunday planning is driven by a cron row, so keep it in sync.
    if (key === 'sprint.sundayPlanning') {
      const cfg = saved as { weekday: number; hour: number; minute: number; timezone: string; enabled: boolean };
      await prisma.scheduledJob.update({
        where: { key: 'sunday_planning' },
        data: {
          cron: `${cfg.minute} ${cfg.hour} * * ${cfg.weekday}`,
          timezone: cfg.timezone,
          isActive: cfg.enabled,
        },
      });
      await refreshSchedule('sunday_planning');
    }

    refresh();
    return { error: null, ok: true, message: 'Saved.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Keywords, industries, locations
// ---------------------------------------------------------------------------

export async function addKeywordAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    await authorize('settings.manage');
    const term = String(formData.get('term') ?? '').trim();
    if (!term) return { error: 'Enter a keyword.' };

    const normalizedTerm = normalizeText(term);
    const existing = await prisma.keyword.findUnique({ where: { normalizedTerm } });
    if (existing) return { error: 'That keyword already exists.' };

    await prisma.keyword.create({
      data: {
        term,
        normalizedTerm,
        priority: Number(formData.get('priority') ?? 100) || 100,
        scoreBoost: Number(formData.get('scoreBoost') ?? 3) || 0,
        groupId: String(formData.get('groupId') ?? '') || null,
      },
    });
    refresh();
    return { error: null, ok: true, message: `Added "${term}".` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function toggleKeywordAction(id: string, isActive: boolean): Promise<void> {
  await authorize('settings.manage');
  await prisma.keyword.update({ where: { id }, data: { isActive } });
  refresh();
}

export async function deleteKeywordAction(id: string): Promise<void> {
  await authorize('settings.manage');
  await prisma.keyword.delete({ where: { id } });
  refresh();
}

export async function toggleIndustryAction(id: string, isActive: boolean): Promise<void> {
  await authorize('settings.manage');
  await prisma.industry.update({ where: { id }, data: { isActive } });
  refresh();
}

export async function reprioritiseAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    await authorize('settings.manage');
    const kind = String(formData.get('kind') ?? '');
    let changed = 0;

    for (const [field, raw] of formData.entries()) {
      if (!field.startsWith('priority_')) continue;
      const id = field.slice('priority_'.length);
      const priority = Number(raw);
      if (!Number.isFinite(priority)) continue;

      if (kind === 'industry') await prisma.industry.update({ where: { id }, data: { priority } });
      else if (kind === 'location') await prisma.location.update({ where: { id }, data: { priority } });
      changed += 1;
    }

    refresh();
    return { error: null, ok: true, message: `${changed} priorit${changed === 1 ? 'y' : 'ies'} updated.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function toggleLocationAction(id: string, isActive: boolean): Promise<void> {
  await authorize('settings.manage');
  await prisma.location.update({ where: { id }, data: { isActive } });
  refresh();
}

export async function excludeLocationAction(id: string, isExcluded: boolean): Promise<void> {
  await authorize('settings.manage');
  await prisma.location.update({ where: { id }, data: { isExcluded } });
  refresh();
}

export async function addLocationAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    await authorize('settings.manage');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Enter a location name.' };
    const slug = normalizeText(name).replace(/\s+/g, '-');

    const existing = await prisma.location.findUnique({ where: { slug } });
    if (existing) return { error: 'That location already exists.' };

    const latitude = Number(formData.get('latitude'));
    const longitude = Number(formData.get('longitude'));

    await prisma.location.create({
      data: {
        name,
        slug,
        kind: String(formData.get('kind') ?? 'CITY'),
        province: String(formData.get('province') ?? '') || null,
        country: String(formData.get('country') ?? 'CA'),
        latitude: Number.isFinite(latitude) && latitude !== 0 ? latitude : null,
        longitude: Number.isFinite(longitude) && longitude !== 0 ? longitude : null,
        radiusKm: Number(formData.get('radiusKm') ?? 25) || 25,
        priority: Number(formData.get('priority') ?? 200) || 200,
      },
    });
    refresh();
    return {
      error: null,
      ok: true,
      message: Number.isFinite(latitude) && latitude !== 0
        ? `Added ${name}.`
        : `Added ${name}. Add coordinates to include it in Places-based discovery.`,
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function addIndustryAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    await authorize('settings.manage');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Enter an industry name.' };
    const slug = normalizeText(name).replace(/\s+/g, '-');
    if (await prisma.industry.findUnique({ where: { slug } })) {
      return { error: 'That industry already exists.' };
    }

    await prisma.industry.create({
      data: {
        name,
        slug,
        priority: Number(formData.get('priority') ?? 200) || 200,
        keywords: String(formData.get('keywords') ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
    refresh();
    return { error: null, ok: true, message: `Added ${name}.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export async function saveScoringAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const user = await authorize('scoring.manage');
    const profileId = String(formData.get('profileId') ?? '');

    for (const [field, raw] of formData.entries()) {
      if (!field.startsWith('weight_')) continue;
      const key = field.slice('weight_'.length);
      const weight = Number(raw);
      if (!Number.isFinite(weight) || weight < 0) continue;
      await prisma.scoringFactor.update({
        where: { profileId_key: { profileId, key } },
        data: { weight },
      });
    }

    const thresholds = {
      PRIORITY_LEAD: Number(formData.get('threshold_PRIORITY_LEAD') ?? 80) || 80,
      QUALIFIED_LEAD: Number(formData.get('threshold_QUALIFIED_LEAD') ?? 65) || 65,
      REVIEW_REQUIRED: Number(formData.get('threshold_REVIEW_REQUIRED') ?? 50) || 50,
    };
    if (
      thresholds.PRIORITY_LEAD <= thresholds.QUALIFIED_LEAD ||
      thresholds.QUALIFIED_LEAD <= thresholds.REVIEW_REQUIRED
    ) {
      return { error: 'Thresholds must decrease: priority > qualified > review.' };
    }

    await prisma.scoringProfile.update({ where: { id: profileId }, data: { thresholds } });
    await writeAuditLog({ userId: user.id, action: 'scoring.updated', entity: 'ScoringProfile', entityId: profileId });

    refresh();
    return {
      error: null,
      ok: true,
      message: 'Scoring saved. New and re-processed leads use it; existing scores are unchanged until re-scored.',
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function saveFollowUpRulesAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    await authorize('settings.manage');
    let changed = 0;

    for (const [field, raw] of formData.entries()) {
      if (!field.startsWith('delay_')) continue;
      const id = field.slice('delay_'.length);
      const delayDays = Number(raw);
      if (!Number.isFinite(delayDays) || delayDays < 0) continue;
      await prisma.followUpRule.update({
        where: { id },
        data: {
          delayDays,
          delayBusinessDays: formData.get(`business_${id}`) === 'on',
          isActive: formData.get(`active_${id}`) === 'on',
        },
      });
      changed += 1;
    }

    refresh();
    return { error: null, ok: true, message: `${changed} rule${changed === 1 ? '' : 's'} updated.` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export async function saveIntegrationAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    const user = await authorize('integrations.manage');
    const kind = String(formData.get('kind') ?? '') as IntegrationKind;

    const secrets: Record<string, string> = {};
    for (const [field, raw] of formData.entries()) {
      if (!field.startsWith('secret_')) continue;
      const value = String(raw).trim();
      // A blank field means "leave the stored value alone", not "erase it" —
      // secrets are never rendered back into the form.
      if (value) secrets[field.slice('secret_'.length)] = value;
    }

    const config: Record<string, string> = {};
    for (const [field, raw] of formData.entries()) {
      if (!field.startsWith('config_')) continue;
      config[field.slice('config_'.length)] = String(raw);
    }

    await saveIntegration({
      kind,
      secrets: Object.keys(secrets).length ? secrets : undefined,
      config: Object.keys(config).length ? config : undefined,
      isEnabled: formData.get('isEnabled') === 'on',
    });

    await writeAuditLog({
      userId: user.id,
      action: 'integration.updated',
      entity: 'IntegrationConfig',
      entityId: kind,
      // Never log secret material — only which fields were supplied.
      after: { fieldsProvided: Object.keys(secrets) },
    });

    refresh();
    return {
      error: null,
      ok: true,
      message: 'Saved. It stays "configured, untested" until a connection test succeeds.',
    };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function testIntegrationAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  try {
    await authorize('integrations.manage');
    const kind = String(formData.get('kind') ?? '') as IntegrationKind;

    let result: { ok: boolean; message: string };
    switch (kind) {
      case 'GMAIL':
        result = await testGmailConnection();
        break;
      case 'GOOGLE_CALENDAR':
        result = await testCalendarConnection();
        break;
      case 'GOOGLE_PLACES':
        result = await testPlacesConnection();
        break;
      case 'AI_ANTHROPIC':
        result = await testAiProvider('anthropic');
        break;
      case 'AI_OPENAI':
        result = await testAiProvider('openai');
        break;
      default:
        return { error: 'There is no live test for this integration yet.' };
    }

    await recordIntegrationTest(kind, result.ok, result.message);
    refresh();
    return result.ok
      ? { error: null, ok: true, message: result.message }
      : { error: `Test failed: ${result.message}` };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export async function saveScheduleAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    await authorize('jobs.manage');
    const id = String(formData.get('id') ?? '');
    const cron = String(formData.get('cron') ?? '').trim();
    const timezone = String(formData.get('timezone') ?? 'America/Toronto');

    if (!isValidCron(cron, timezone)) {
      return { error: 'That is not a valid 5-field cron expression.' };
    }

    const schedule = await prisma.scheduledJob.update({
      where: { id },
      data: { cron, timezone, isActive: formData.get('isActive') === 'on' },
    });
    await refreshSchedule(schedule.key);

    refresh();
    return { error: null, ok: true, message: 'Schedule updated.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function retryJobAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    await authorize('jobs.manage');
    await retryDeadJob(String(formData.get('jobId') ?? ''));
    refresh();
    return { error: null, ok: true, message: 'Job re-queued.' };
  } catch (err) {
    return { error: safeErrorMessage(err) };
  }
}

export async function toggleSourceAction(id: string, isActive: boolean): Promise<void> {
  await authorize('sources.manage');
  await prisma.leadSource.update({ where: { id }, data: { isActive } });
  refresh();
}
