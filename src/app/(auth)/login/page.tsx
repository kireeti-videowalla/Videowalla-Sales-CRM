import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { defaultRouteFor } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(defaultRouteFor(user.role));

  const params = await searchParams;

  // On a brand-new install there is nobody to sign in as; point the operator at
  // the bootstrap command instead of a dead login form.
  const activeUsers = await prisma.user.count({ where: { status: 'ACTIVE' } });

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-100 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-ink-900">Videowalla</h1>
          <p className="mt-1 text-sm text-ink-500">Sales Command Center</p>
        </div>

        {activeUsers === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">No accounts exist yet</p>
            <p className="mt-2">Create the owner account on the server:</p>
            <pre className="mt-2 overflow-x-auto rounded bg-amber-100 px-3 py-2 text-xs">
              npm run bootstrap:owner
            </pre>
            <p className="mt-2 text-xs">
              Everyone else joins by invitation from Settings → Team. This system has no public sign-up.
            </p>
          </div>
        ) : (
          <LoginForm nextPath={params.next} />
        )}
      </div>
    </main>
  );
}
