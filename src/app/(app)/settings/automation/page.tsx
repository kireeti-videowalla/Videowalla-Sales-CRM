import { prisma } from '@/lib/db';
import { queueStats } from '@/lib/jobs/queue';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Alert, Card, Stat } from '@/components/ui';
import { DeadJobList, ScheduleEditor } from '@/components/settings-panels';

export const dynamic = 'force-dynamic';

export default async function AutomationSettingsPage() {
  const [schedules, stats, deadJobs, recentJobs, failures] = await Promise.all([
    prisma.scheduledJob.findMany({ orderBy: { key: 'asc' } }),
    queueStats(),
    prisma.job.findMany({ where: { status: 'DEAD' }, orderBy: { updatedAt: 'desc' }, take: 25 }),
    prisma.job.findMany({ orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.integrationFailure.findMany({ orderBy: { occurredAt: 'desc' }, take: 20 }),
  ]);

  const lastSuccess = recentJobs.find((j) => j.status === 'SUCCEEDED');
  const workerLooksIdle =
    !lastSuccess || Date.now() - lastSuccess.finishedAt!.getTime() > 6 * 3_600_000;

  const fmt = (d: Date | null) => (d ? formatInTz(d, DEFAULT_TIMEZONE) : null);

  return (
    <div className="space-y-6">
      {workerLooksIdle && (
        <Alert tone="warn" title="No job has completed recently">
          Background automation runs in a separate process. Make sure <code>npm run worker</code> is running,
          or that your host is calling <code>/api/cron/tick</code> on a schedule. Without it, nothing is
          ingested and no week is planned.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Pending" value={stats.PENDING} />
        <Stat label="Running" value={stats.RUNNING} />
        <Stat label="Succeeded" value={stats.SUCCEEDED} tone="good" />
        <Stat label="Failed (retrying)" value={stats.FAILED} tone={stats.FAILED ? 'warn' : 'default'} />
        <Stat label="Dead" value={stats.DEAD} tone={stats.DEAD ? 'bad' : 'good'} />
      </div>

      <Card
        title="Schedules"
        subtitle="Standard 5-field cron, evaluated in the given timezone. Weekly planning is the important one."
      >
        <ScheduleEditor
          schedules={schedules.map((s) => ({
            id: s.id,
            key: s.key,
            name: s.name,
            jobName: s.jobName,
            cron: s.cron,
            timezone: s.timezone,
            isActive: s.isActive,
            nextRunAt: fmt(s.nextRunAt),
            lastRunAt: fmt(s.lastRunAt),
          }))}
        />
      </Card>

      <Card title="Failed jobs" subtitle="Jobs that exhausted their retries. They are kept, not discarded.">
        <DeadJobList
          jobs={deadJobs.map((j) => ({
            id: j.id,
            name: j.name,
            lastError: j.lastError,
            attempts: j.attempts,
            updatedAt: formatInTz(j.updatedAt, DEFAULT_TIMEZONE),
          }))}
        />
      </Card>

      <Card title="Recent jobs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2 font-medium">Job</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Attempts</th>
                <th className="px-5 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {recentJobs.map((j) => (
                <tr key={j.id}>
                  <td className="px-5 py-2 text-ink-800">{j.name}</td>
                  <td className="px-5 py-2">
                    <span
                      className={
                        j.status === 'SUCCEEDED'
                          ? 'text-emerald-600'
                          : j.status === 'DEAD'
                            ? 'text-red-600'
                            : 'text-ink-600'
                      }
                    >
                      {j.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="tnum px-5 py-2 text-ink-600">{j.attempts}</td>
                  <td className="px-5 py-2 text-xs text-ink-400">
                    {formatInTz(j.updatedAt, DEFAULT_TIMEZONE)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {failures.length > 0 && (
        <Card title="Integration failures">
          <ul className="divide-y divide-hairline text-sm">
            {failures.map((f) => (
              <li key={f.id} className="px-5 py-2">
                <div className="text-ink-800">{f.kind}</div>
                <div className="text-xs text-amber-700">{f.message}</div>
                <div className="text-xs text-ink-400">{formatInTz(f.occurredAt, DEFAULT_TIMEZONE)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
