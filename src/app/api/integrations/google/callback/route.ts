import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { createLogger } from '@/lib/logger';
import { exchangeCodeForTokens } from '@/lib/integrations/google-oauth';
import { saveIntegration } from '@/lib/integrations/store';
import { writeAuditLog } from '@/lib/auth/service';

export const dynamic = 'force-dynamic';

const log = createLogger('api.google.callback');

/** Completes the Google OAuth flow and stores the refresh token, encrypted. */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !can(user.role, 'integrations.manage')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  const redirect = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/settings/integrations?${new URLSearchParams(params)}`, request.url),
    );

  if (error) return redirect({ oauth: 'error', message: error });
  if (!code || !state) return redirect({ oauth: 'error', message: 'Missing authorisation code.' });

  const kind = state === 'calendar' ? 'GOOGLE_CALENDAR' : 'GMAIL';

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveIntegration({
      kind,
      secrets: {
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
      },
      isEnabled: true,
    });
    await writeAuditLog({
      userId: user.id,
      action: 'integration.authorised',
      entity: 'IntegrationConfig',
      entityId: kind,
    });
    return redirect({ oauth: 'connected', kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('google oauth callback failed', { kind, message });
    return redirect({ oauth: 'error', message: message.slice(0, 200) });
  }
}
