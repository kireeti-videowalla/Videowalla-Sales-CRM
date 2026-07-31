import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { buildMonthlyReport } from '@/lib/reports/service';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Badge, Card, EmptyState, Stat, formatMoney, formatPercent } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const user = await requireRole('OWNER', 'MANAGER');
  const tz = user.timezone || DEFAULT_TIMEZONE;

  const reps = await prisma.user.findMany({
    where: { role: 'SALES_REP', status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  const monthly = await Promise.all(
    reps.map(async (rep) => ({ rep, report: await buildMonthlyReport(rep.id, new Date(), tz) })),
  );

  const storedReports = await prisma.report.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { user: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Reports</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Generated automatically. Where a number cannot be computed honestly, it says so rather than
          showing zero.
        </p>
      </div>

      {monthly.length === 0 ? (
        <Card>
          <EmptyState title="No sales representatives yet" />
        </Card>
      ) : (
        monthly.map(({ rep, report }) => (
          <Card key={rep.id} title={`${rep.name} — ${report.label}`} subtitle="Month to date">
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Paid hours" value={report.totals.paidHours} />
              <Stat label="Contacts" value={report.totals.totalContacts} sub={`${report.totals.newContacts} new`} />
              <Stat label="Follow-ups" value={report.totals.followUps} />
              <Stat label="Conversations" value={report.totals.conversations} sub={formatPercent(report.rates.conversationRate)} />
              <Stat label="Meetings booked" value={report.totals.meetingsBooked} sub={formatPercent(report.rates.meetingRate)} tone={report.totals.meetingsBooked > 0 ? 'good' : 'default'} />
              <Stat label="Opportunities" value={report.totals.opportunities} />
            </div>

            <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-ink-200 px-4 py-3 text-sm">
              <Metric label="Total cost" value={formatMoney(report.cost.totalCostCents)} />
              <Metric label="Cost per contact" value={formatMoney(report.cost.costPerContactCents)} />
              <Metric label="Cost per conversation" value={formatMoney(report.cost.costPerConversationCents)} />
              <Metric label="Cost per meeting" value={formatMoney(report.cost.costPerMeetingCents)} />
              <Metric
                label="Won revenue"
                value={report.cost.wonRevenueCents ? formatMoney(report.cost.wonRevenueCents) : 'No deals linked'}
              />
              <Metric
                label="Return on cost"
                value={report.cost.returnOnCost !== null ? `${report.cost.returnOnCost}×` : 'Not computable yet'}
              />
              <Metric
                label="Revenue per paid hour"
                value={
                  report.cost.revenuePerPaidHourCents !== null
                    ? formatMoney(report.cost.revenuePerPaidHourCents)
                    : 'Not computable yet'
                }
              />
            </div>

            {report.weeks.length > 0 && (
              <div className="border-t border-ink-200 p-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Weeks this month
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-left text-xs text-ink-500">
                      <tr>
                        <th className="py-1 font-medium">Week</th>
                        <th className="py-1 text-right font-medium">Score</th>
                        <th className="py-1 text-right font-medium">Hours</th>
                        <th className="py-1 text-right font-medium">Contacts</th>
                        <th className="py-1 text-right font-medium">Conversations</th>
                        <th className="py-1 text-right font-medium">Meetings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-200">
                      {report.weeks.map((w) => (
                        <tr key={w.label}>
                          <td className="py-1.5 text-ink-800">{w.label}</td>
                          <td className="tnum py-1.5 text-right font-semibold">{w.score}</td>
                          <td className="tnum py-1.5 text-right">{w.hours}</td>
                          <td className="tnum py-1.5 text-right">{w.contacts}</td>
                          <td className="tnum py-1.5 text-right">{w.conversations}</td>
                          <td className="tnum py-1.5 text-right">{w.meetings}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid gap-4 border-t border-ink-200 p-4 sm:grid-cols-3">
              <Ranked title="Strongest industries" rows={report.strongest.industries} />
              <Ranked title="Strongest locations" rows={report.strongest.locations} />
              <Ranked title="Strongest sources" rows={report.strongest.sources} />
            </div>

            {report.recommendations.length > 0 && (
              <div className="border-t border-ink-200 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Recommended changes
                </h3>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-ink-700">
                  {report.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        ))
      )}

      <Card title="Stored reports" subtitle="Shift, weekly, monthly and Sunday summaries generated by the automation.">
        {storedReports.length === 0 ? (
          <EmptyState title="No reports stored yet" body="They appear automatically as shifts and weeks complete." />
        ) : (
          <ul className="divide-y divide-ink-200 text-sm">
            {storedReports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <Badge tone="neutral">{r.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                <span className="flex-1 text-ink-800">{r.title}</span>
                {r.user && <span className="text-xs text-ink-500">{r.user.name}</span>}
                <span className="text-xs text-ink-400">{formatInTz(r.createdAt, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
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

function Ranked({
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
          {rows.map((r) => (
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
