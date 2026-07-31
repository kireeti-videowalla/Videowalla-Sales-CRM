import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { defaultRouteFor, ROLE_LABELS } from '@/lib/auth/rbac';
import { findInvitationByToken } from '@/lib/auth/service';
import { AcceptInviteForm } from './accept-form';

export const dynamic = 'force-dynamic';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(defaultRouteFor(user.role));

  const { token } = await searchParams;
  const invitation = token ? await findInvitationByToken(token) : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-ink-900">Videowalla</h1>
          <p className="mt-1 text-sm text-ink-500">Sales Command Center</p>
        </div>

        {!invitation ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
            <p className="font-semibold">This invitation is not valid</p>
            <p className="mt-1">
              It may have expired, already been used, or been revoked. Ask the owner to send a new one.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-ink-600">
              Welcome, <span className="font-semibold text-ink-900">{invitation.name}</span>.
            </p>
            <p className="mt-1 text-xs text-ink-500">
              {invitation.email} · {ROLE_LABELS[invitation.role]}
            </p>
            <div className="mt-5">
              <AcceptInviteForm token={token!} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
