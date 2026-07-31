import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { buildWeeklyReport } from '@/lib/reports/service';
import { listReviewQueue } from '@/lib/pipeline/review';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Alert, Badge, Card, EmptyState, Progress, Stat, formatMoney, formatPercent , PageHeader } from '@/components/ui';
import { ApproveSprintPanel, ReplanPanel, ReviewExceptionsPanel } from '@/components/sprint-panels';

export const dynamic = 'force-dynamic';

export default async function SundayReviewPage() {
  const user = await requireRole('OWNER');
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const now = new Date();

  // The week just finished (or in progress) — what the owner is reviewing.
  const currentSprints = await prisma.weeklySprint.findMany({
    where: { weekStart: { lte: now }, weekEnd: { gte: now } },
    include: { user: true },
    orderBy: { user: { name: 'asc' } },
  });

  // The week being proposed.
  const proposedSprints = await prisma.weeklySprint.findMany({
    where: { weekStart: { gt: now }, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } },
    include: { user: true, targets: { orderBy: { position: 'asc' } }, tickets: { select: { id: true, isCarryover: true } } },
    orderBy: [{ weekStart: 'asc' }, { user: { name: 'asc' } }],
  });

  const reviewQueue = await listReviewQueue(30);

  const latestSundayReport = await prisma.report.findFirst({
    where: { kind: 'SUNDAY_SUMMARY' },
    orderBy: { createdAt: 'desc' },
  });
  const planning = latestSundayReport?.payload as
    | {
        ranAt?: string;
        weekLabel?: string;
        ingestion?: { created: number; duplicates: number; errors: string[] };
        processing?: { created: number; manualReview: number; disqualified: number; failed: number };
        carryover?: { followUps: number; tickets: number; interested: number; invites: number };
        warnings?: string[];
      }
    | null;

  return (
    <div className="space-y-6">
      <PageHeader title="Sunday Review" subtitle={<>The whole week in about two minutes, then approve what happens next.</>} />

      {planning?.warnings && planning.warnings.length > 0 && (
        <Alert tone="warn" title="Planning warnings">
          <ul className="list-inside list-disc">
            {planning.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      {/* ---- The week that just happened -------------------------------- */}
      {currentSprints.length === 0 ? (
        <Card>
          <EmptyState
            title="No week to review yet"
            body="Once a sprint has been created and worked, its full results appear here."
          />
        </Card>
      ) : (
        currentSprints.map(async (sprint) => {
          const report = await buildWeeklyReport(sprint.id);
          const m = report.scorecard.metrics;
          const t = (key: string) => report.targets.find((x) => x.key === key)?.target ?? 0;

          return (
            <Card
              key={sprint.id}
              title={`${sprint.user.name} — week ${sprint.label}`}
              subtitle={`${formatInTz(sprint.weekStart, tz, { dateStyle: 'medium' })} – ${formatInTz(sprint.weekEnd, tz, { dateStyle: 'medium' })}`}
              action={
                <Badge tone={report.scorecard.totalScore >= 80 ? 'good' : report.scorecard.totalScore >= 60 ? 'warn' : 'bad'}>
                  Score {report.scorecard.totalScore}/100
                </Badge>
              }
            >
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-6">
                <Stat
                  label="Hours"
                  value={`${m.completedHours}/${m.scheduledHours}`}
                  sub={`${m.activeHours}h active, ${m.inactiveHours}h idle`}
                  tone={m.completedHours >= m.scheduledHours ? 'good' : 'warn'}
                />
                <Stat
                  label="Contacts"
                  value={`${m.contactsCompleted}/${t('TOTAL_CONTACTS')}`}
                  sub={`${m.verifiedContacts} verified, ${m.manualContacts} reported`}
                />
                <Stat label="Follow-ups" value={`${m.followUpsCompleted}/${t('FOLLOW_UPS')}`} sub={`${m.followUpsOutstanding} still open`} />
                <Stat label="Answered" value={m.answeredCount} sub={`${m.conversations} real conversations`} />
                <Stat label="Interested" value={m.interestedLeads} tone={m.interestedLeads > 0 ? 'good' : 'default'} />
                <Stat
                  label="Meetings"
                  value={`${m.meetingsBooked}`}
                  sub={`${m.meetingInvitesSent} invites sent`}
                  tone={m.meetingsBooked > 0 ? 'good' : 'default'}
                />
              </div>

              {/* Score breakdown — every point explained. */}
              <div className="border-t border-hairline p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink-800">How the score was calculated</h3>
                <ul className="space-y-2">
                  {report.scorecard.breakdown.map((c) => (
                    <li key={c.key}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-ink-700">{c.label}</span>
                        <span className="tnum shrink-0 text-xs text-ink-500">
                          {c.awarded} / {c.weight}
                        </span>
                      </div>
                      <Progress value={c.awarded} max={c.weight} showNumbers={false} />
                      <p className="mt-0.5 text-xs text-ink-500">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Cost and return. */}
              <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-hairline px-4 py-3 text-sm">
                <Metric label="Salesperson cost" value={formatMoney(report.scorecard.cost.salespersonCostCents)} />
                <Metric label="Cost per contact" value={formatMoney(report.scorecard.cost.costPerContactCents)} />
                <Metric label="Cost per conversation" value={formatMoney(report.scorecard.cost.costPerConversationCents)} />
                <Metric label="Cost per meeting" value={formatMoney(report.scorecard.cost.costPerMeetingCents)} />
                <Metric
                  label="Attributed revenue"
                  value={
                    report.scorecard.cost.attributedRevenueCents
                      ? formatMoney(report.scorecard.cost.attributedRevenueCents)
                      : 'No deals linked yet'
                  }
                />
                <Metric label="Contact rate" value={formatPercent(report.rates.contactRate)} />
                <Metric label="Conversation rate" value={formatPercent(report.rates.conversationRate)} />
              </div>

              {report.comparison && (
                <div className="border-t border-hairline px-4 py-3 text-sm text-ink-600">
                  Versus last week: score {report.comparison.scoreDelta >= 0 ? '+' : ''}
                  {report.comparison.scoreDelta}, contacts {report.comparison.contactsDelta >= 0 ? '+' : ''}
                  {report.comparison.contactsDelta}, meetings {report.comparison.meetingsDelta >= 0 ? '+' : ''}
                  {report.comparison.meetingsDelta}.
                </div>
              )}

              {/* What performed. */}
              <div className="grid gap-4 border-t border-hairline p-4 sm:grid-cols-3">
                <PerfList title="Best industries" rows={report.performance.byIndustry} />
                <PerfList title="Best locations" rows={report.performance.byLocation} />
                <PerfList title="Best lead sources" rows={report.performance.bySource} />
              </div>

              {m.unfinishedTasks > 0 && (
                <div className="border-t border-hairline px-4 py-3">
                  <Alert tone="warn" title={`${m.unfinishedTasks} leads were never attempted`}>
                    They carry into next week automatically.
                  </Alert>
                </div>
              )}
            </Card>
          );
        })
      )}

      {/* ---- What has been prepared for next week ----------------------- */}
      <Card
        title="Next week"
        subtitle={
          planning?.ranAt
            ? `Planned ${formatInTz(new Date(planning.ranAt), tz)} · ${planning.weekLabel ?? ''}`
            : 'Planning has not run yet.'
        }
      >
        {planning && (
          <div className="grid grid-cols-2 gap-3 border-b border-hairline p-4 sm:grid-cols-4">
            <Stat label="New leads found" value={planning.ingestion?.created ?? 0} />
            <Stat label="Tickets created" value={planning.processing?.created ?? 0} />
            <Stat
              label="Needing review"
              value={planning.processing?.manualReview ?? 0}
              tone={(planning.processing?.manualReview ?? 0) > 0 ? 'warn' : 'default'}
            />
            <Stat label="Follow-ups carried" value={planning.carryover?.followUps ?? 0} />
          </div>
        )}

        {proposedSprints.length === 0 ? (
          <EmptyState
            title="No sprint proposed yet"
            body="Sunday planning runs automatically at the configured time. You can also run it now below."
          />
        ) : (
          proposedSprints.map((sprint) => (
            <div key={sprint.id} className="border-b border-hairline last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <h3 className="text-sm font-semibold text-ink-900">
                  {sprint.user.name} — week {sprint.label} ({sprint.availableHours}h)
                </h3>
                <div className="flex items-center gap-2">
                  {sprint.leadShortfall > 0 && (
                    <Badge tone="warn">{sprint.leadShortfall} leads short</Badge>
                  )}
                  <Badge tone={sprint.status === 'APPROVED' ? 'good' : 'info'}>
                    {sprint.status.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                </div>
              </div>
              <p className="px-5 pt-1 text-xs text-ink-500">
                {sprint.tickets.length} leads assigned ·{' '}
                {sprint.tickets.filter((t) => t.isCarryover).length} carried over
              </p>
              <ApproveSprintPanel
                sprintId={sprint.id}
                status={sprint.status}
                targets={sprint.targets.map((t) => ({
                  key: t.key,
                  label: t.label,
                  target: t.target,
                  suggested: t.suggestedTarget,
                  overridden: Boolean(t.overriddenById),
                }))}
                rationale={
                  ((sprint.targetRationale as { rationale?: string[] } | null)?.rationale ?? []) as string[]
                }
              />
            </div>
          ))
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Review exceptions (${reviewQueue.length})`}>
          <ReviewExceptionsPanel
            tickets={reviewQueue.map((t) => ({
              id: t.id,
              company: t.company.name,
              headline: t.opportunity.headline,
              score: t.score,
              source: t.opportunity.sourceRecord?.kind.replace(/_/g, ' ').toLowerCase() ?? 'manual',
            }))}
          />
        </Card>

        <Card title="Run planning manually">
          <ReplanPanel />
        </Card>
      </div>

      {planning?.ingestion?.errors && planning.ingestion.errors.length > 0 && (
        <Card title="Lead source problems">
          <ul className="divide-y divide-hairline text-sm">
            {planning.ingestion.errors.map((e, i) => (
              <li key={i} className="px-5 py-2 text-amber-800">
                {e}
              </li>
            ))}
          </ul>
          <p className="border-t border-hairline px-5 py-2 text-xs text-ink-500">
            <Link href="/settings/integrations" className="text-brand-600 hover:underline">
              Check your integrations
            </Link>
          </p>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="tnum font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function PerfList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; attempts: number; conversations: number }>;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-ink-400">Not enough data yet</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {rows.slice(0, 5).map((r) => (
            <li key={r.name} className="flex justify-between gap-2">
              <span className="truncate text-ink-700">{r.name}</span>
              <span className="tnum shrink-0 text-xs text-ink-500">
                {r.conversations}/{r.attempts}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
