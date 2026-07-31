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
  { href: '/live-activity', label: 'Live' },
  { href: '/leads', label: 'Leads' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/sprints', label: 'Sprints' },
  { href: '/reports', label: 'Reports' },
  { href: '/team', label: 'Team' },
  { href: '/settings', label: 'Settings' },
];

const REP_NAV = [
  { href: '/this-week', label: 'This Week' },
  { href: '/call-queue', label: 'Call Queue' },
  { href: '/pipeline', label: 'Board' },
  { href: '/follow-ups', label: 'Follow-Ups' },
  { href: '/performance', label: 'Performance' },
];

const MANAGER_NAV = [
  { href: '/overview', label: 'Overview' },
  { href: '/live-activity', label: 'Live' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/sprints', label: 'Sprints' },
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
    <div className="min-h-screen bg-ink-100">
      {/* Translucent, hairline-bottomed bar — stays out of the way. */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-white/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:gap-5 sm:px-8">
          <Link href={nav[0]!.href} className="flex shrink-0 items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-[10px] font-bold tracking-tight text-accent-400">
              VW
            </span>
            <span className="display hidden text-[14px] font-semibold text-ink-900 lg:block">
              Sales Command Center
            </span>
          </Link>

          <NavLinks items={nav} />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Link
              href="/notifications"
              className="relative rounded-full px-3 py-1.5 text-[13px] text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              Alerts
              {unread > 0 && (
                <span className="tnum absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad-600 px-1 text-[10px] font-semibold leading-none text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            <div className="mx-1 hidden h-5 w-px bg-hairline sm:block" />

            <div className="flex items-center gap-2.5">
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: user.avatarColor }}
                title={user.name}
              >
                {user.name.charAt(0).toUpperCase()}
              </span>
              <div className="hidden leading-tight md:block">
                <div className="text-[12px] font-medium text-ink-900">{user.name}</div>
                <div className="text-[11px] text-ink-500">
                  {user.role === 'OWNER' ? 'Owner' : user.role === 'MANAGER' ? 'Manager' : 'Sales'}
                </div>
              </div>
            </div>

            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="rise mx-auto max-w-[1600px] overflow-x-hidden px-4 py-7 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
