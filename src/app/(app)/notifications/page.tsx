import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listNotifications } from '@/lib/notifications/service';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Badge, Card, EmptyState , PageHeader } from '@/components/ui';
import { MarkAllReadButton } from '@/components/notification-panels';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requireUser();
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const notifications = await listNotifications(user.id, 100);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Alerts" subtitle={<>{unread} unread of {notifications.length}</>} />
        {unread > 0 && <MarkAllReadButton />}
      </div>

      <Card>
        {notifications.length === 0 ? (
          <EmptyState title="No alerts yet" body="Shift, target, lead and integration alerts appear here." />
        ) : (
          <ul className="divide-y divide-hairline">
            {notifications.map((n) => {
              const body = (
                <div className={`px-5 py-3 ${n.readAt ? '' : 'bg-blue-50/50'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        n.severity === 'CRITICAL'
                          ? 'bad'
                          : n.severity === 'WARNING'
                            ? 'warn'
                            : n.severity === 'SUCCESS'
                              ? 'good'
                              : 'info'
                      }
                    >
                      {n.severity.toLowerCase()}
                    </Badge>
                    <span className="text-sm font-medium text-ink-900">{n.title}</span>
                    {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />}
                    <span className="ml-auto text-xs text-ink-400">{formatInTz(n.createdAt, tz)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
                  {n.deliveryError && (
                    <p className="mt-1 text-xs text-amber-700">Delivery note: {n.deliveryError}</p>
                  )}
                </div>
              );

              return (
                <li key={n.id}>
                  {n.linkUrl ? (
                    <Link href={n.linkUrl} className="block hover:bg-ink-50">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
