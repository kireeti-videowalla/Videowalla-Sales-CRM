import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { getOwnerOverview } from '@/lib/workspace/overview';
import { recentActivity, ACTIVITY_LABELS } from '@/lib/activity/log';
import { DEFAULT_TIMEZONE, formatInTz, humanDuration } from '@/lib/time';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  Progress,
  Stat,
  StatRow,
  formatMoney,
} from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const user = await requireRole('OWNER', 'MANAGER');
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const data = await getOwnerOverview(tz);
  const activity = await recentActivity(12);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Overview"
        subtitle={`Week of ${formatInTz(data.weekStart, tz, { dateStyle: 'long' })}`}
        action={
          <>
            {data.pendingApproval > 0 && (
              <LinkButton href="/sunday-review" variant="primary" size="md">
                Approve next week ({data.pendingApproval})
              </LinkButton>
            )}
            <LinkButton href="/live-activity" size="md">
              Live
            </LinkButton>
          </>
        }
      />

      {(data.reviewQueueCount > 0 || data.integrationErrors > 0 || data.deadJobs > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {data.reviewQueueCount > 0 && (
            <Alert tone="info" title={`${data.reviewQueueCount} leads need your review`}>
              <Link href="/leads?stage=review_required" className="font-medium underline underline-offset-2">
                Approve or disqualify
              </Link>
            </Alert>
          )}
          {data.integrationErrors > 0 && (
            <Alert tone="warn" title={`${data.integrationErrors} integration${data.integrationErrors === 1 ? '' : 's'} failing`}>
              <Link href="/settings/integrations" className="font-medium underline underline-offset-2">
                Check integrations
              </Link>
            </Alert>
          )}
          {data.deadJobs > 0 && (
            <Alert tone="bad" title={`${data.deadJobs} background job${data.deadJobs === 1 ? '' : 's'} failed`}>
              <Link href="/settings/automation" className="font-medium underline underline-offset-2">
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
            body="Invite a salesperson from the Team page. Once she has a schedule, the Sunday automation prepares her week for her."
            action={<LinkButton href="/team" variant="primary">Go to Team</LinkButton>}
          />
        </Card>
      ) : (
        data.reps.map((r) => {
          const target = (key: string) => r.sprint?.targets.find((t) => t.key === key)?.target ?? 0;
          const done = r.scorecard?.metrics;
          const score = r.scorecard?.totalScore ?? null;
          const lastScore = r.previousScorecards[0]?.totalScore ?? null;
          const delta = score !== null && lastScore !== null ? score - lastScore : null;

          return (
            <div key={r.rep.id} className="space-y-6">
              {/* --- The ten-second answer -------------------------------- */}
              <Card
                title={r.rep.name}
                subtitle={
                  r.isWorking
                    ? `On shift since ${formatInTz(r.openShift!.startedAt, tz, { timeStyle: 'short' })} · ${humanDuration(r.currentShiftSeconds)} active`
                    : r.isPaused
                      ? 'Shift paused'
                      : 'Not working right now'
                }
                action={
                  <Badge tone={r.isWorking ? 'good' : r.isPaused ? 'warn' : 'neutral'} dot>
                    {r.isWorking ? 'Clocked in' : r.isPaused ? 'Paused' : 'Clocked out'}
                  </Badge>
                }
              >
                <StatRow className="grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
                  <Stat
                    label="Hours"
                    value={r.completedHours}
                    sub={`of ${r.scheduledHours} paid`}
                    tone={r.completedHours >= r.scheduledHours ? 'good' : 'default'}
                  />
                  <Stat label="Today" value={r.contactsToday} sub="contacts" />
                  <Stat
                    label="Contacts"
                    value={done?.contactsCompleted ?? 0}
                    sub={`of ${target('TOTAL_CONTACTS')}`}
                  />
                  <Stat
                    label="Follow-ups"
                    value={done?.followUpsCompleted ?? 0}
                    sub={r.overdueFollowUps > 0 ? `${r.overdueFollowUps} overdue` : `of ${target('FOLLOW_UPS')}`}
                    tone={r.overdueFollowUps > 0 ? 'warn' : 'default'}
                  />
                  <Stat
                    label="Talked to"
                    value={done?.conversations ?? 0}
                    sub={`${done?.answeredCount ?? 0} answered`}
                  />
                  <Stat label="Interested" value={done?.interestedLeads ?? 0} sub="this week" tone="good" />
                  <Stat
                    label="Meetings"
                    value={done?.meetingsBooked ?? 0}
                    sub={`${done?.meetingInvitesSent ?? 0} invites sent`}
                    tone={(done?.meetingsBooked ?? 0) > 0 ? 'good' : 'default'}
                  />
                </StatRow>

                <div className="grid gap-6 border-t border-hairline px-6 py-5 sm:grid-cols-3">
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

                {/* Is the money working? */}
                <div className="flex flex-wrap gap-x-10 gap-y-4 border-t border-hairline bg-ink-50 px-6 py-5">
                  <Metric
                    label="Weekly score"
                    value={score ?? '—'}
                    hint={
                      delta !== null
                        ? `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} vs last week`
                        : 'no previous week'
                    }
                    tone={delta === null ? 'flat' : delta >= 0 ? 'up' : 'down'}
                  />
                  <Metric label="Cost this week" value={formatMoney(r.scorecard?.cost.salespersonCostCents ?? null)} />
                  <Metric
                    label="Per conversation"
                    value={r.scorecard?.cost.costPerConversationCents ? formatMoney(r.scorecard.cost.costPerConversationCents) : '—'}
                  />
                  <Metric
                    label="Per meeting"
                    value={r.scorecard?.cost.costPerMeetingCents ? formatMoney(r.scorecard.cost.costPerMeetingCents) : '—'}
                  />
                  <Metric
                    label="Attributed revenue"
                    value={
                      r.scorecard?.cost.attributedRevenueCents
                        ? formatMoney(r.scorecard.cost.attributedRevenueCents)
                        : 'None linked'
                    }
                  />
                  {r.unfinished > 0 && (
                    <div className="self-center">
                      <Badge tone="warn">{r.unfinished} leads untouched</Badge>
                    </div>
                  )}
                </div>

                {r.lastActivity && (
                  <div className="border-t border-hairline px-6 py-3 text-[12px] text-ink-500">
                    Last action: {ACTIVITY_LABELS[r.lastActivity.kind]}
                    {r.lastActivity.ticket && ` — ${r.lastActivity.ticket.company.name}`} ·{' '}
                    {formatInTz(r.lastActivity.occurredAt, tz)}
                  </div>
                )}
              </Card>

              {/* --- Monthly pressure ------------------------------------- */}
              <div className="grid gap-6 lg:grid-cols-3">
                <Card title={`${r.monthlyProgress.label}`} subtitle="Month to date against target" className="lg:col-span-2">
                  {r.monthlyProgress.targets.every((t) => t.target === 0) ? (
                    <p className="px-6 py-6 text-[13px] text-ink-500">
                      Monthly targets appear once weekly sprints exist — they are summed from the weeks that
                      make up the month, so they can never exceed what the paid hours allow.
                    </p>
                  ) : (
                    <div className="grid gap-5 px-6 py-5 sm:grid-cols-2 lg:grid-cols-3">
                      {r.monthlyProgress.targets
                        .filter((t) => t.target > 0)
                        .map((t) => (
                          <Progress
                            key={t.key}
                            label={`${t.label}${t.isOverridden ? ' *' : ''}`}
                            value={t.achieved}
                            max={t.target}
                          />
                        ))}
                    </div>
                  )}
                </Card>

                <Card title="Four-week trend" subtitle="Weekly score">
                  {r.previousScorecards.length === 0 ? (
                    <p className="px-6 py-6 text-[13px] text-ink-500">No completed weeks yet.</p>
                  ) : (
                    <div className="flex items-end justify-center gap-5 px-6 py-6" style={{ height: 150 }}>
                      {[...r.previousScorecards].reverse().map((c) => (
                        <div key={c.id} className="flex w-14 flex-col items-center justify-end gap-2">
                          <span className="tnum text-[12px] font-medium text-ink-700">{c.totalScore}</span>
                          <div
                            className="w-full rounded-md bg-brand-500 transition-all"
                            style={{ height: `${Math.max(6, (c.totalScore / 100) * 84)}px` }}
                            title={`${c.sprint.label}: ${c.totalScore}/100`}
                          />
                          <span className="text-[10px] text-ink-400">{c.sprint.label.slice(-3)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          );
        })
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Lead supply">
          <StatRow className="grid-cols-2">
            <Stat label="New qualified this week" value={data.newQualifiedLeads} />
            <Stat
              label="Awaiting your review"
              value={data.reviewQueueCount}
              tone={data.reviewQueueCount > 0 ? 'warn' : 'good'}
            />
          </StatRow>
        </Card>

        <Card title="Recent activity" action={<LinkButton href="/live-activity" size="sm">See all</LinkButton>}>
          {activity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <ul className="divide-y divide-hairline">
              {activity.slice(0, 7).map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-6 py-2.5">
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                    style={{ backgroundColor: a.user.avatarColor }}
                  >
                    {a.user.name.charAt(0)}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-ink-700">{a.summary}</span>
                  <span className="tnum shrink-0 text-[11px] text-ink-400">
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

function Metric({
  label,
  value,
  hint,
  tone = 'flat',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'up' | 'down' | 'flat';
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500">{label}</div>
      <div className="tnum mt-1 text-[19px] font-semibold leading-none text-ink-900">{value}</div>
      {hint && (
        <div
          className={`mt-1 text-[11px] ${
            tone === 'up' ? 'text-good-600' : tone === 'down' ? 'text-bad-600' : 'text-ink-500'
          }`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
