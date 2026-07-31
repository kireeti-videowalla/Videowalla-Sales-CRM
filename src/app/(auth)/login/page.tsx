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
        <div className="mb-10 flex flex-col items-center text-center">
          <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-brand-600 text-[14px] font-bold tracking-tight text-accent-400">
            VW
          </span>
          <h1 className="display-lg text-[26px] font-semibold text-ink-900">Videowalla</h1>
          <p className="mt-1.5 text-[14px] text-ink-500">Sales Command Center</p>
        </div>

        {activeUsers === 0 ? (
          <div className="rounded-card border border-accent-200 bg-accent-50 p-5 text-[13px] leading-relaxed text-ink-800">
            <p className="font-semibold">No accounts exist yet</p>
            <p className="mt-2">Create the owner account on the server:</p>
            <pre className="mt-2 overflow-x-auto rounded-control bg-white px-3 py-2 text-[12px]">
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
