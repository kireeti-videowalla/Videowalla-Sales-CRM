import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Badge, Card, EmptyState, Progress, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SprintsPage() {
  const user = await requireRole('OWNER', 'MANAGER');
  const tz = user.timezone || DEFAULT_TIMEZONE;

  const sprints = await prisma.weeklySprint.findMany({
    orderBy: { weekStart: 'desc' },
    take: 20,
    include: {
      user: { select: { name: true } },
      targets: { orderBy: { position: 'asc' } },
      scorecard: true,
      _count: { select: { tickets: true, shifts: true, followUps: true } },
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Weekly Sprints</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Every week is preserved. Closed weeks keep a frozen scorecard.
        </p>
      </div>

      {sprints.length === 0 ? (
        <Card>
          <EmptyState
            title="No sprints yet"
            body="The Sunday automation creates the first sprint. You can also trigger it from the Sunday Review page."
          />
        </Card>
      ) : (
        sprints.map((sprint) => {
          const t = (key: string) => sprint.targets.find((x) => x.key === key)?.target ?? 0;
          const s = sprint.scorecard;

          return (
            <Card
              key={sprint.id}
              title={`${sprint.user.name} — ${sprint.label}`}
              subtitle={`${formatInTz(sprint.weekStart, tz, { dateStyle: 'medium' })} – ${formatInTz(sprint.weekEnd, tz, { dateStyle: 'medium' })} · ${sprint.availableHours}h`}
              action={
                <div className="flex items-center gap-2">
                  {sprint.leadShortfall > 0 && <Badge tone="warn">{sprint.leadShortfall} short</Badge>}
                  <Badge
                    tone={
                      sprint.status === 'CLOSED'
                        ? 'neutral'
                        : sprint.status === 'ACTIVE'
                          ? 'good'
                          : sprint.status === 'APPROVED'
                            ? 'info'
                            : 'warn'
                    }
                  >
                    {sprint.status.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                  {s?.isFrozen && <Badge tone="neutral">Frozen</Badge>}
                </div>
              }
            >
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-6">
                <Stat label="Score" value={s?.totalScore ?? '—'} />
                <Stat label="Hours" value={`${s?.completedHours ?? 0}/${sprint.availableHours}`} />
                <Stat label="Contacts" value={`${s?.contactsCompleted ?? 0}/${t('TOTAL_CONTACTS')}`} />
                <Stat label="Follow-ups" value={`${s?.followUpsCompleted ?? 0}/${t('FOLLOW_UPS')}`} />
                <Stat label="Interested" value={s?.interestedLeads ?? 0} />
                <Stat label="Meetings" value={`${s?.meetingsBooked ?? 0}/${t('MEETINGS')}`} />
              </div>

              <div className="grid gap-4 border-t border-ink-200 p-4 sm:grid-cols-3">
                <Progress label="Hours" value={s?.completedHours ?? 0} max={sprint.availableHours || 8} />
                <Progress label="Contacts" value={s?.contactsCompleted ?? 0} max={t('TOTAL_CONTACTS') || 1} />
                <Progress label="Follow-ups" value={s?.followUpsCompleted ?? 0} max={t('FOLLOW_UPS') || 1} />
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-ink-200 px-4 py-2 text-xs text-ink-500">
                <span>{sprint._count.tickets} leads assigned</span>
                <span>{sprint._count.shifts} shifts</span>
                <span>{sprint._count.followUps} follow-ups</span>
                {sprint.approvedAt && <span>Approved {formatInTz(sprint.approvedAt, tz, { dateStyle: 'medium' })}</span>}
                {sprint.closedAt && <span>Closed {formatInTz(sprint.closedAt, tz, { dateStyle: 'medium' })}</span>}
              </div>

              {sprint.planningNotes && (
                <details className="border-t border-ink-200 px-4 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-600">
                    Why these targets were chosen
                  </summary>
                  <p className="mt-1 text-xs text-ink-500">{sprint.planningNotes}</p>
                </details>
              )}
            </Card>
          );
        })
      )}

      <p className="text-sm text-ink-500">
        <Link href="/sunday-review" className="text-brand-600 hover:underline">
          Go to the Sunday Review to approve the next week →
        </Link>
      </p>
    </div>
  );
}
