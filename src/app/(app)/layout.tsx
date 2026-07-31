import { AppShell } from '@/components/app-shell';
import { requireUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every authenticated page resolves the session server-side. The middleware
  // cookie check is a convenience, not the authorisation boundary.
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
