import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { getThisWeek } from '@/lib/workspace/this-week';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Alert, Badge, Card, EmptyState, Progress, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';

type Category = { key: string; label: string; weight: number; awarded: number; detail: string };

export default async function PerformancePage() {
  const user = await requireRole('SALES_REP', 'OWNER');
  const data = await getThisWeek(user.id);
  const tz = data.timezone || DEFAULT_TIMEZONE;

  const history = await prisma.weeklyScorecard.findMany({
    where: { userId: user.id, isFrozen: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
    include: { sprint: { select: { label: true, weekStart: true } } },
  });

  const current = data.scorecard;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Performance</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Every point is calculated from recorded work. There is no subjective judgement in this score.
        </p>
      </div>

      {!current ? (
        <Card>
          <EmptyState title="No active week yet" body="Your score appears once a sprint is running." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="This week"
              value={current.totalScore}
              sub="out of 100"
              tone={current.totalScore >= 80 ? 'good' : current.totalScore >= 60 ? 'warn' : 'bad'}
            />
            <Stat
              label="Last week"
              value={history[0]?.totalScore ?? '—'}
              sub={history[0]?.sprint.label ?? 'No previous week'}
            />
            <Stat
              label="Target completion"
              value={`${Math.round(current.targetCompletion * 100)}%`}
            />
            <Stat
              label="Missing points"
              value={100 - current.totalScore}
              tone={100 - current.totalScore > 30 ? 'warn' : 'default'}
            />
          </div>

          <Card title="Where your points came from">
            <ul className="divide-y divide-ink-200">
              {current.breakdown.map((c: Category) => {
                const missing = Number((c.weight - c.awarded).toFixed(1));
                return (
                  <li key={c.key} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink-800">{c.label}</span>
                      <span className="tnum text-sm text-ink-600">
                        {c.awarded} / {c.weight}
                      </span>
                    </div>
                    <div className="mt-1">
                      <Progress value={c.awarded} max={c.weight} showNumbers={false} />
                    </div>
                    <p className="mt-1 text-xs text-ink-500">{c.detail}</p>
                    {missing > 0.5 && (
                      <p className="mt-0.5 text-xs text-amber-700">
                        {missing} point{missing === 1 ? '' : 's'} still available here.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {current.totalScore < 80 && (
            <Alert tone="info" title="Where the easiest points are">
              <ul className="list-inside list-disc">
                {[...current.breakdown]
                  .filter((c: Category) => c.weight - c.awarded > 1)
                  .sort((a: Category, b: Category) => b.weight - b.awarded - (a.weight - a.awarded))
                  .slice(0, 3)
                  .map((c: Category) => (
                    <li key={c.key}>
                      {c.label}: {Number((c.weight - c.awarded).toFixed(1))} points available. {c.detail}
                    </li>
                  ))}
              </ul>
            </Alert>
          )}
        </>
      )}

      <Card title="Previous weeks">
        {history.length === 0 ? (
          <EmptyState title="No completed weeks yet" body="Frozen weekly scorecards appear here after each Sunday." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Week</th>
                  <th className="px-4 py-2 text-right font-medium">Score</th>
                  <th className="px-4 py-2 text-right font-medium">Hours</th>
                  <th className="px-4 py-2 text-right font-medium">Contacts</th>
                  <th className="px-4 py-2 text-right font-medium">Follow-ups</th>
                  <th className="px-4 py-2 text-right font-medium">Conversations</th>
                  <th className="px-4 py-2 text-right font-medium">Interested</th>
                  <th className="px-4 py-2 text-right font-medium">Meetings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-2">
                      <div className="text-ink-800">{h.sprint.label}</div>
                      <div className="text-xs text-ink-400">
                        {formatInTz(h.sprint.weekStart, tz, { dateStyle: 'medium' })}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Badge tone={h.totalScore >= 80 ? 'good' : h.totalScore >= 60 ? 'warn' : 'bad'}>
                        {h.totalScore}
                      </Badge>
                    </td>
                    <td className="tnum px-4 py-2 text-right">
                      {h.completedHours}/{h.scheduledHours}
                    </td>
                    <td className="tnum px-4 py-2 text-right">{h.contactsCompleted}</td>
                    <td className="tnum px-4 py-2 text-right">{h.followUpsCompleted}</td>
                    <td className="tnum px-4 py-2 text-right">{h.conversations}</td>
                    <td className="tnum px-4 py-2 text-right">{h.interestedLeads}</td>
                    <td className="tnum px-4 py-2 text-right">{h.meetingsBooked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
