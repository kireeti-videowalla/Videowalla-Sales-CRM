import type { IntegrationKind, IntegrationStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { decryptJson, encryptJson } from '../crypto';
import { createLogger } from '../logger';

const log = createLogger('integrations');

export type IntegrationSecrets = Record<string, string>;

/**
 * Secrets are AES-256-GCM encrypted at rest and only ever decrypted inside
 * server-side code paths. Nothing in this module is safe to import into a
 * client component, and none of it is ever serialised into a page payload.
 */
export async function getIntegrationSecrets(kind: IntegrationKind): Promise<IntegrationSecrets | null> {
  const row = await prisma.integrationConfig.findUnique({ where: { kind } });
  if (!row?.secretsCiphertext || !row.isEnabled) return null;
  try {
    return decryptJson<IntegrationSecrets>(row.secretsCiphertext);
  } catch (err) {
    log.error('failed to decrypt integration secrets', { kind, err: String(err) });
    return null;
  }
}

export async function getIntegrationConfig(kind: IntegrationKind) {
  return prisma.integrationConfig.findUnique({ where: { kind } });
}

export async function saveIntegration(params: {
  kind: IntegrationKind;
  config?: Prisma.InputJsonValue;
  secrets?: IntegrationSecrets | null;
  isEnabled?: boolean;
}): Promise<void> {
  const existing = await prisma.integrationConfig.findUnique({ where: { kind: params.kind } });

  // Merge, so saving only a config change does not silently wipe stored
  // credentials the owner cannot re-enter (they are never displayed back).
  let ciphertext = existing?.secretsCiphertext ?? null;
  if (params.secrets === null) {
    ciphertext = null;
  } else if (params.secrets) {
    const current = existing?.secretsCiphertext
      ? (() => {
          try {
            return decryptJson<IntegrationSecrets>(existing.secretsCiphertext!);
          } catch {
            return {};
          }
        })()
      : {};
    const merged = { ...current };
    for (const [key, value] of Object.entries(params.secrets)) {
      if (value === '') delete merged[key];
      else merged[key] = value;
    }
    ciphertext = Object.keys(merged).length > 0 ? encryptJson(merged) : null;
  }

  const isEnabled = params.isEnabled ?? existing?.isEnabled ?? false;
  const hasSecrets = Boolean(ciphertext);

  // Status is derived, never asserted: having credentials is "configured but
  // untested" until a live test actually succeeds.
  let status: IntegrationStatus;
  if (!hasSecrets) status = 'NOT_CONFIGURED';
  else if (!isEnabled) status = 'DISABLED';
  else if (existing?.lastTestOk && existing.status === 'CONNECTED') status = 'CONNECTED';
  else status = 'CONFIGURED_UNTESTED';

  await prisma.integrationConfig.upsert({
    where: { kind: params.kind },
    create: {
      kind: params.kind,
      config: params.config ?? {},
      secretsCiphertext: ciphertext,
      isEnabled,
      status,
    },
    update: {
      ...(params.config !== undefined ? { config: params.config } : {}),
      secretsCiphertext: ciphertext,
      isEnabled,
      status,
    },
  });
}

export async function recordIntegrationTest(
  kind: IntegrationKind,
  ok: boolean,
  message: string,
): Promise<void> {
  await prisma.integrationConfig.update({
    where: { kind },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: ok,
      status: ok ? 'CONNECTED' : 'ERROR',
      lastError: ok ? null : message.slice(0, 1000),
    },
  });
  if (!ok) await recordIntegrationFailure(kind, 'connection_test', message);
}

export async function recordIntegrationFailure(
  kind: IntegrationKind,
  failureKind: string,
  message: string,
  detail?: Prisma.InputJsonValue,
): Promise<void> {
  const integration = await prisma.integrationConfig.findUnique({ where: { kind } });
  await prisma.integrationFailure.create({
    data: {
      integrationId: integration?.id ?? null,
      kind: failureKind,
      message: message.slice(0, 2000),
      detail,
    },
  });
  if (integration) {
    await prisma.integrationConfig.update({
      where: { id: integration.id },
      data: { status: 'ERROR', lastError: message.slice(0, 1000) },
    });
  }
}

export async function markIntegrationSync(kind: IntegrationKind): Promise<void> {
  await prisma.integrationConfig
    .update({ where: { kind }, data: { lastSyncAt: new Date(), lastError: null, status: 'CONNECTED' } })
    .catch(() => undefined);
}

export async function isIntegrationReady(kind: IntegrationKind): Promise<boolean> {
  const row = await prisma.integrationConfig.findUnique({ where: { kind } });
  return Boolean(row?.isEnabled && row.secretsCiphertext);
}

/** Safe for the UI: reports state without ever returning secret material. */
export async function listIntegrationStatuses() {
  const rows = await prisma.integrationConfig.findMany({ orderBy: { kind: 'asc' } });
  return rows.map((row) => ({
    kind: row.kind,
    status: row.status,
    isEnabled: row.isEnabled,
    hasCredentials: Boolean(row.secretsCiphertext),
    config: row.config as Record<string, unknown>,
    lastTestedAt: row.lastTestedAt,
    lastTestOk: row.lastTestOk,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
  }));
}
