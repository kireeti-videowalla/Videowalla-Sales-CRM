import { redirect } from 'next/navigation';
import { defaultRouteFor } from '@/lib/auth/rbac';
import { getCurrentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? defaultRouteFor(user.role) : '/login');
}
