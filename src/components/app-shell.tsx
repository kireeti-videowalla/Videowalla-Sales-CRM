import Link from 'next/link';
import type { UserRole } from '@prisma/client';
import { unreadCount } from '@/lib/notifications/service';
import type { SessionUser } from '@/lib/auth/session';
import { NavLinks } from './nav-links';
import { SignOutButton } from './sign-out-button';

/**
 * Navigation is deliberately short. The brief asks for no unnecessary pages,
 * and a non-technical salesperson should never have to hunt for the one screen
 * she needs.
 */
const OWNER_NAV = [
  { href: '/overview', label: 'Overview' },
  { href: '/sunday-review', label: 'Sunday Review' },
  { href: '/live-activity', label: 'Live Activity' },
  { href: '/leads', label: 'Leads' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/sprints', label: 'Weekly Sprints' },
  { href: '/reports', label: 'Reports' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
];

const REP_NAV = [
  { href: '/this-week', label: 'This Week' },
  { href: '/call-queue', label: 'Call Queue' },
  { href: '/pipeline', label: 'Kanban' },
  { href: '/follow-ups', label: 'Follow-Ups' },
  { href: '/performance', label: 'Performance' },
];

const MANAGER_NAV = [
  { href: '/overview', label: 'Overview' },
  { href: '/live-activity', label: 'Live Activity' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/sprints', label: 'Weekly Sprints' },
  { href: '/reports', label: 'Reports' },
];

function navFor(role: UserRole) {
  if (role === 'SALES_REP') return REP_NAV;
  if (role === 'MANAGER') return MANAGER_NAV;
  return OWNER_NAV;
}

export async function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const unread = await unreadCount(user.id);
  const nav = navFor(user.role);

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-20 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href={nav[0]!.href} className="flex shrink-0 items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-xs font-bold text-white">
              VW
            </span>
            <span className="hidden text-sm font-semibold text-ink-900 sm:block">Sales Command Center</span>
          </Link>

          <NavLinks items={nav} />

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/notifications"
              className="relative rounded-lg px-2.5 py-1.5 text-sm text-ink-600 hover:bg-ink-100"
            >
              Alerts
              {unread > 0 && (
                <span className="tnum absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            <div className="flex items-center gap-2">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                style={{ backgroundColor: user.avatarColor }}
                title={user.name}
              >
                {user.name.charAt(0).toUpperCase()}
              </span>
              <div className="hidden leading-tight sm:block">
                <div className="text-xs font-medium text-ink-900">{user.name}</div>
                <div className="text-[11px] text-ink-500">
                  {user.role === 'OWNER' ? 'Owner' : user.role === 'MANAGER' ? 'Manager' : 'Sales rep'}
                </div>
              </div>
            </div>

            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
