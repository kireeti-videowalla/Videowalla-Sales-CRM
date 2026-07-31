import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listFollowUps } from '@/lib/followups/service';
import { formatPhone } from '@/lib/normalize';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Badge, Card, EmptyState, Stat , PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function FollowUpsPage() {
  const user = await requireUser();
  const tz = user.timezone || DEFAULT_TIMEZONE;

  // Reps see only their own; owners and managers see everyone's.
  const scope = user.role === 'SALES_REP' ? { userId: user.id } : {};

  const open = await listFollowUps({ ...scope, statuses: ['OVERDUE', 'DUE', 'SCHEDULED'], limit: 200 });
  const completed = await listFollowUps({ ...scope, statuses: ['COMPLETED'], limit: 25 });

  const overdue = open.filter((f) => f.status === 'OVERDUE');
  const due = open.filter((f) => f.status === 'DUE');
  const scheduled = open.filter((f) => f.status === 'SCHEDULED');

  return (
    <div className="space-y-6">
      <PageHeader title="Follow-Ups" subtitle={<>Created automatically from your outcomes. Nothing here is ever dropped silently.</>} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Overdue" value={overdue.length} tone={overdue.length ? 'bad' : 'good'} />
        <Stat label="Due now" value={due.length} tone={due.length ? 'warn' : 'default'} />
        <Stat label="Scheduled" value={scheduled.length} />
        <Stat label="Completed recently" value={completed.length} tone="good" />
      </div>

      {open.length === 0 ? (
        <Card>
          <EmptyState
            title="No open follow-ups"
            body="Follow-ups appear here automatically when a call goes unanswered, when a company is interested, or when a meeting invitation is waiting for a reply."
          />
        </Card>
      ) : (
        <>
          {[
            { title: 'Overdue', items: overdue, tone: 'bad' as const },
            { title: 'Due now', items: due, tone: 'warn' as const },
            { title: 'Scheduled', items: scheduled, tone: 'neutral' as const },
          ]
            .filter((g) => g.items.length > 0)
            .map((group) => (
              <Card key={group.title} title={`${group.title} (${group.items.length})`}>
                <ul className="divide-y divide-hairline">
                  {group.items.map((f) => (
                    <li key={f.id}>
                      <Link
                        href={`/leads/${f.ticketId}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-ink-50"
                      >
                        <Badge tone={group.tone}>{f.reasonKind.replace(/_/g, ' ').toLowerCase()}</Badge>
                        <div className="min-w-[200px] flex-1">
                          <div className="text-sm font-medium text-ink-900">{f.ticket.company.name}</div>
                          <div className="text-xs text-ink-500">{f.reason}</div>
                        </div>
                        <div className="min-w-[160px]">
                          <div className="text-sm text-ink-800">
                            {f.ticket.primaryContact?.fullName ?? '—'}
                          </div>
                          <div className="tnum text-xs text-ink-500">
                            {formatPhone(f.ticket.primaryContact?.phone ?? f.ticket.company.phone) || 'No phone'}
                          </div>
                        </div>
                        <div className="text-xs text-ink-400">
                          {formatInTz(f.dueAt, tz, { dateStyle: 'medium' })}
                          {f.automated && <span className="ml-1">· automatic</span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </>
      )}
    </div>
  );
}
