import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { getThisWeek } from '@/lib/workspace/this-week';
import { formatPhone } from '@/lib/normalize';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Alert, Badge, Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function CallQueuePage() {
  const user = await requireRole('SALES_REP', 'OWNER');
  const data = await getThisWeek(user.id);
  const tz = data.timezone || DEFAULT_TIMEZONE;
  const { followUpQueue, interestedQueue, newLeadQueue } = data.queues;

  const isEmpty =
    followUpQueue.length === 0 && interestedQueue.length === 0 && newLeadQueue.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Call Queue</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Work from the top. Commitments come before new companies.
        </p>
      </div>

      {!data.shift.isActive && !data.shift.isPaused && (
        <Alert tone="warn" title="Your shift is not running">
          Start your shift on <Link href="/this-week" className="font-medium underline">This Week</Link> so
          your hours and work are counted.
        </Alert>
      )}

      {isEmpty && (
        <Card>
          <EmptyState
            title="Nothing to call right now"
            body="Leads are prepared automatically before each week begins. If your queue is unexpectedly empty, tell the owner — it usually means not enough qualified leads were found."
          />
        </Card>
      )}

      {followUpQueue.length > 0 && (
        <Card
          title={`Follow-ups (${followUpQueue.length})`}
          subtitle="Promises already made. These come first."
        >
          <ul className="divide-y divide-ink-200">
            {followUpQueue.map((f) => (
              <li key={f.id}>
                <Link href={`/leads/${f.ticketId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-ink-50">
                  <Badge tone={f.status === 'OVERDUE' ? 'bad' : 'warn'}>
                    {f.status === 'OVERDUE' ? 'Overdue' : 'Due'}
                  </Badge>
                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-medium text-ink-900">{f.ticket.company.name}</div>
                    <div className="text-xs text-ink-500">{f.reason}</div>
                  </div>
                  <div className="min-w-[170px]">
                    <div className="text-sm text-ink-800">
                      {f.ticket.primaryContact?.fullName ?? 'Ask for the owner'}
                    </div>
                    <div className="tnum text-xs text-ink-500">
                      {formatPhone(f.ticket.primaryContact?.phone ?? f.ticket.company.phone) || 'No phone yet'}
                    </div>
                  </div>
                  <div className="text-xs text-ink-400">
                    Due {formatInTz(f.dueAt, tz, { dateStyle: 'medium' })}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {interestedQueue.length > 0 && (
        <Card
          title={`Interested leads (${interestedQueue.length})`}
          subtitle="They said yes to something. Keep them moving."
        >
          <ul className="divide-y divide-ink-200">
            {interestedQueue.map((t) => (
              <li key={t.id}>
                <Link href={`/leads/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-ink-50">
                  <Badge tone="good">Interested</Badge>
                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-medium text-ink-900">{t.company.name}</div>
                    <div className="text-xs text-ink-500">{t.opportunity.headline}</div>
                  </div>
                  <div className="min-w-[170px]">
                    <div className="text-sm text-ink-800">{t.primaryContact?.fullName ?? '—'}</div>
                    <div className="tnum text-xs text-ink-500">
                      {formatPhone(t.primaryContact?.phone ?? t.company.phone) || 'No phone yet'}
                    </div>
                  </div>
                  <div className="text-xs text-ink-400">{t.nextActionLabel ?? 'Decide the next step'}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {newLeadQueue.length > 0 && (
        <Card
          title={`New companies (${newLeadQueue.length})`}
          subtitle="Prepared for you before the week started. Highest scoring first."
        >
          <ul className="divide-y divide-ink-200">
            {newLeadQueue.map((t) => (
              <li key={t.id}>
                <Link href={`/leads/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-ink-50">
                  <Badge tone={t.priority === 'PRIORITY' ? 'info' : 'neutral'}>Score {t.score}</Badge>
                  <div className="min-w-[200px] flex-1">
                    <div className="text-sm font-medium text-ink-900">{t.company.name}</div>
                    <div className="text-xs text-ink-500">{t.opportunity.headline}</div>
                  </div>
                  <div className="min-w-[170px]">
                    <div className="text-sm text-ink-800">
                      {t.primaryContact?.fullName ?? 'Ask for the owner'}
                    </div>
                    <div className="tnum text-xs text-ink-500">
                      {formatPhone(t.primaryContact?.phone ?? t.company.phone) || 'No phone yet'}
                    </div>
                  </div>
                  <div className="hidden text-xs text-ink-400 lg:block">
                    {[t.company.city, t.company.industryLabel].filter(Boolean).join(' · ')}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
