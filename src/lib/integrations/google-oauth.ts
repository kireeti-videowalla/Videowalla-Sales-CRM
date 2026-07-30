import type { IntegrationKind } from '@prisma/client';
import { getEnv } from '../env';
import { createLogger } from '../logger';
import { getIntegrationSecrets, saveIntegration } from './store';

const log = createLogger('google.oauth');

export const GMAIL_SCOPES = [
  // Read-only. The system never sends, modifies or deletes the owner's mail.
  'https://www.googleapis.com/auth/gmail.readonly',
];

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: string;
};

export function googleClientConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? `${env.APP_URL}/api/integrations/google/callback`,
  };
}

export function buildAuthUrl(kind: 'GMAIL' | 'GOOGLE_CALENDAR', state: string): string | null {
  const config = googleClientConfig();
  if (!config) return null;
  const scopes = kind === 'GMAIL' ? GMAIL_SCOPES : CALENDAR_SCOPES;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    // offline + consent is what actually returns a refresh token; without it a
    // re-authorisation silently yields an access token that expires in an hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}> {
  const config = googleClientConfig();
  if (!config) throw new Error('Google OAuth client is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const json = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description ?? json.error ?? 'Token exchange failed');
  }
  if (!json.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and authorise again.',
    );
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 3600,
  };
}

/**
 * Returns a valid access token, refreshing and persisting it when needed.
 * Returns null (rather than throwing) when the integration simply is not set
 * up, so callers can report "not configured" honestly.
 */
export async function getAccessToken(kind: IntegrationKind): Promise<string | null> {
  const secrets = await getIntegrationSecrets(kind);
  if (!secrets?.refreshToken) return null;

  const expiresAt = secrets.accessTokenExpiresAt ? Date.parse(secrets.accessTokenExpiresAt) : 0;
  if (secrets.accessToken && expiresAt > Date.now() + 60_000) {
    return secrets.accessToken;
  }

  const config = googleClientConfig();
  const clientId = secrets.clientId ?? config?.clientId;
  const clientSecret = secrets.clientSecret ?? config?.clientSecret;
  if (!clientId || !clientSecret) {
    log.error('cannot refresh Google token: no client credentials', { kind });
    return null;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: secrets.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`Google token refresh failed: ${json.error_description ?? json.error ?? res.status}`);
  }

  await saveIntegration({
    kind,
    secrets: {
      accessToken: json.access_token,
      accessTokenExpiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    },
  });

  return json.access_token;
}

export async function googleApiRequest<T>(
  kind: IntegrationKind,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken(kind);
  if (!token) throw new Error(`${kind} is not connected. Authorise it in Settings → Integrations.`);

  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}
