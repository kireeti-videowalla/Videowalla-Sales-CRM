import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { getOwnerOverview } from '@/lib/workspace/overview';
import { recentActivity, ACTIVITY_LABELS } from '@/lib/activity/log';
import { DEFAULT_TIMEZONE, formatInTz, humanDuration } from '@/lib/time';
import { Alert, Badge, Card, EmptyState, LinkButton, Progress, Stat, formatMoney } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const user = await requireRole('OWNER', 'MANAGER');
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const data = await getOwnerOverview(tz);
  const activity = await recentActivity(15);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Overview</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Week of {formatInTz(data.weekStart, tz, { dateStyle: 'medium' })}
          </p>
        </div>
        <div className="flex gap-2">
          {data.pendingApproval > 0 && (
            <LinkButton href="/sunday-review" variant="primary" size="sm">
              Approve next week ({data.pendingApproval})
            </LinkButton>
          )}
          <LinkButton href="/live-activity" size="sm">
            Live activity
          </LinkButton>
        </div>
      </div>

      {/* --- Things needing attention ---------------------------------- */}
      {(data.reviewQueueCount > 0 || data.integrationErrors > 0 || data.deadJobs > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.reviewQueueCount > 0 && (
            <Alert tone="info" title={`${data.reviewQueueCount} leads need review`}>
              <Link href="/leads?stage=review_required" className="font-medium underline">
                Approve or disqualify them
              </Link>
            </Alert>
          )}
          {data.integrationErrors > 0 && (
            <Alert tone="warn" title={`${data.integrationErrors} integration${data.integrationErrors === 1 ? '' : 's'} failing`}>
              <Link href="/settings/integrations" className="font-medium underline">
                Check integrations
              </Link>
            </Alert>
          )}
          {data.deadJobs > 0 && (
            <Alert tone="bad" title={`${data.deadJobs} background job${data.deadJobs === 1 ? '' : 's'} failed`}>
              <Link href="/settings/automation" className="font-medium underline">
                Review and retry
              </Link>
            </Alert>
          )}
        </div>
      )}

      {data.reps.length === 0 ? (
        <Card>
          <EmptyState
            title="No sales representatives yet"
            body="Invite a salesperson from the Team page. Once they have a schedule, the Sunday automation will prepare their week."
            action={<LinkButton href="/team" variant="primary">Go to Team</LinkButton>}
          />
        </Card>
      ) : (
        data.reps.map((r) => {
          const target = (key: string) => r.sprint?.targets.find((t) => t.key === key)?.target ?? 0;
          const done = r.scorecard?.metrics;
          const score = r.scorecard?.totalScore ?? null;
          const lastScore = r.previousScorecards[0]?.totalScore ?? null;

          return (
            <div key={r.rep.id} className="space-y-3">
              {/* --- The ten-second answer ------------------------------ */}
              <Card
                title={r.rep.name}
                subtitle={
                  r.isWorking
                    ? `Working now — started ${formatInTz(r.openShift!.startedAt, tz, { timeStyle: 'short' })}, ${humanDuration(r.currentShiftSeconds)} active`
                    : r.isPaused
                      ? 'Shift paused'
                      : 'Not currently working'
                }
                action={
                  <Badge tone={r.isWorking ? 'good' : r.isPaused ? 'warn' : 'neutral'}>
                    {r.isWorking ? 'Clocked in' : r.isPaused ? 'Paused' : 'Clocked out'}
                  </Badge>
                }
              >
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-7">
                  <Stat
                    label="Hours"
                    value={`${r.completedHours}`}
                    sub={`of ${r.scheduledHours} scheduled`}
                    tone={r.completedHours >= r.scheduledHours ? 'good' : 'default'}
                  />
                  <Stat label="Today" value={r.contactsToday} sub="contacts" />
                  <Stat
                    label="Contacts"
                    value={`${done?.contactsCompleted ?? 0}/${target('TOTAL_CONTACTS')}`}
                  />
                  <Stat
                    label="Follow-ups"
                    value={`${done?.followUpsCompleted ?? 0}/${target('FOLLOW_UPS')}`}
                    tone={r.overdueFollowUps > 0 ? 'warn' : 'default'}
                    sub={r.overdueFollowUps > 0 ? `${r.overdueFollowUps} overdue` : undefined}
                  />
                  <Stat label="Conversations" value={done?.conversations ?? 0} sub={`${done?.answeredCount ?? 0} answered`} />
                  <Stat label="Interested" value={done?.interestedLeads ?? 0} tone="good" />
                  <Stat
                    label="Meetings"
                    value={`${done?.meetingsBooked ?? 0}/${target('MEETINGS')}`}
                    sub={`${done?.meetingInvitesSent ?? 0} invites sent`}
                    tone={(done?.meetingsBooked ?? 0) > 0 ? 'good' : 'default'}
                  />
                </div>

                <div className="grid gap-4 border-t border-ink-200 p-4 sm:grid-cols-3">
                  <Progress label="Paid hours" value={r.completedHours} max={r.scheduledHours || 8} />
                  <Progress
                    label="Contact target"
                    value={done?.contactsCompleted ?? 0}
                    max={target('TOTAL_CONTACTS') || 1}
                  />
                  <Progress
                    label="Follow-up target"
                    value={done?.followUpsCompleted ?? 0}
                    max={target('FOLLOW_UPS') || 1}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink-200 px-4 py-3 text-sm">
                  <div>
                    <span className="text-ink-500">Weekly score </span>
                    <span className="tnum font-semibold text-ink-900">{score ?? '—'}</span>
                    {lastScore !== null && (
                      <span className="ml-1 text-xs text-ink-500">
                        (last week {lastScore}
                        {score !== null && (
                          <span className={score >= lastScore ? ' text-emerald-600' : ' text-red-600'}>
                            {' '}
                            {score >= lastScore ? '▲' : '▼'} {Math.abs(score - lastScore)}
                          </span>
                        )}
                        )
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-ink-500">Cost this week </span>
                    <span className="tnum font-semibold text-ink-900">
                      {formatMoney(r.scorecard?.cost.salespersonCostCents ?? null)}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-500">Cost per conversation </span>
                    <span className="tnum font-semibold text-ink-900">
                      {r.scorecard?.cost.costPerConversationCents
                        ? formatMoney(r.scorecard.cost.costPerConversationCents)
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-500">Cost per meeting </span>
                    <span className="tnum font-semibold text-ink-900">
                      {r.scorecard?.cost.costPerMeetingCents
                        ? formatMoney(r.scorecard.cost.costPerMeetingCents)
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-500">Attributed revenue </span>
                    <span className="tnum font-semibold text-ink-900">
                      {r.scorecard?.cost.attributedRevenueCents
                        ? formatMoney(r.scorecard.cost.attributedRevenueCents)
                        : 'None linked'}
                    </span>
                  </div>
                  {r.unfinished > 0 && (
                    <Badge tone="warn">{r.unfinished} untouched leads</Badge>
                  )}
                </div>

                {r.lastActivity && (
                  <div className="border-t border-ink-200 px-4 py-2 text-xs text-ink-500">
                    Last meaningful activity: {ACTIVITY_LABELS[r.lastActivity.kind]}
                    {r.lastActivity.ticket && ` — ${r.lastActivity.ticket.company.name}`} ·{' '}
                    {formatInTz(r.lastActivity.occurredAt, tz)}
                  </div>
                )}

                {r.previousScorecards.length > 0 && (
                  <div className="flex items-center gap-3 border-t border-ink-200 px-4 py-2">
                    <span className="text-xs text-ink-500">Four-week trend</span>
                    <div className="flex items-end gap-1">
                      {[...r.previousScorecards].reverse().map((c) => (
                        <div
                          key={c.id}
                          title={`${c.sprint.label}: ${c.totalScore}/100`}
                          className="w-6 rounded-t bg-brand-500"
                          style={{ height: `${Math.max(3, (c.totalScore / 100) * 32)}px` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          );
        })
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Lead supply">
          <div className="grid grid-cols-2 gap-3 p-4">
            <Stat label="New qualified this week" value={data.newQualifiedLeads} />
            <Stat
              label="Awaiting your review"
              value={data.reviewQueueCount}
              tone={data.reviewQueueCount > 0 ? 'warn' : 'good'}
            />
          </div>
        </Card>

        <Card title="Recent activity" action={<LinkButton href="/live-activity" size="sm">See all</LinkButton>}>
          {activity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <ul className="divide-y divide-ink-200 text-sm">
              {activity.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2">
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: a.user.avatarColor }}
                  >
                    {a.user.name.charAt(0)}
                  </span>
                  <span className="flex-1 truncate text-ink-800">{a.summary}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {formatInTz(a.occurredAt, tz, { timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
