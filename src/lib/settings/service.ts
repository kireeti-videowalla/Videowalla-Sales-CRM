import { prisma } from '../db';
import { createLogger } from '../logger';
import {
  SETTING_DEFINITIONS,
  defaultsFor,
  type SettingKey,
  type SettingValue,
} from './definitions';

const log = createLogger('settings');

/**
 * Short-lived process cache. Settings change rarely but are read on nearly
 * every request and inside every job; re-reading Postgres each time is waste.
 */
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const TTL_MS = 15_000;

export function invalidateSettingsCache(key?: SettingKey): void {
  if (key) cache.delete(key);
  else cache.clear();
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as SettingValue<K>;

  const row = await prisma.setting.findUnique({ where: { key } });
  const schema = SETTING_DEFINITIONS[key].schema;
  let value: SettingValue<K>;

  if (!row) {
    value = defaultsFor(key);
  } else {
    const parsed = schema.safeParse(row.value);
    if (parsed.success) {
      value = parsed.data as SettingValue<K>;
    } else {
      // A malformed stored value must not take the whole app down; fall back to
      // documented defaults and make the problem loud in the logs.
      log.error('stored setting failed validation, using defaults', {
        key,
        issues: parsed.error.issues.map((i) => i.message),
      });
      value = defaultsFor(key);
    }
  }

  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: unknown,
  updatedById?: string,
): Promise<SettingValue<K>> {
  const parsed = SETTING_DEFINITIONS[key].schema.parse(value) as SettingValue<K>;
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value: parsed as object,
      description: SETTING_DEFINITIONS[key].description,
      updatedById: updatedById ?? null,
    },
    update: { value: parsed as object, updatedById: updatedById ?? null },
  });
  invalidateSettingsCache(key);
  return parsed;
}

/** Merges a partial update over the current value, then validates the whole. */
export async function patchSetting<K extends SettingKey>(
  key: K,
  patch: Record<string, unknown>,
  updatedById?: string,
): Promise<SettingValue<K>> {
  const current = await getSetting(key);
  return setSetting(key, { ...(current as object), ...patch }, updatedById);
}

export async function getAllSettings(): Promise<Record<SettingKey, unknown>> {
  const keys = Object.keys(SETTING_DEFINITIONS) as SettingKey[];
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting(k)] as const));
  return Object.fromEntries(entries) as Record<SettingKey, unknown>;
}
