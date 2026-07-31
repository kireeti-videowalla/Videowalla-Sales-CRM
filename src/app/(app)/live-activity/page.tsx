import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { ACTIVITY_LABELS, recentActivity } from '@/lib/activity/log';
import { computeActiveSeconds } from '@/lib/shifts/service';
import { DEFAULT_TIMEZONE, formatInTz, humanDuration, secondsToHours } from '@/lib/time';
import { Alert, Badge, Card, EmptyState, Stat } from '@/components/ui';

export const dynamic = 'force-dynamic';
// The page refreshes itself so the owner can leave it open during a shift.
export const revalidate = 0;

export default async function LiveActivityPage() {
  const user = await requireRole('OWNER', 'MANAGER');
  const tz = user.timezone || DEFAULT_TIMEZONE;
  const now = new Date();

  const openShifts = await prisma.shift.findMany({
    where: { status: { in: ['ACTIVE', 'PAUSED'] } },
    include: {
      user: { select: { id: true, name: true, avatarColor: true } },
      sprint: { include: { targets: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  const activity = await recentActivity(60);

  const todayStart = new Date(now.getTime() - 24 * 3_600_000);
  const recentAttempts = await prisma.contactAttempt.findMany({
    where: { createdAt: { gte: todayStart } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: {
      user: { select: { name: true } },
      outcome: { select: { label: true } },
      ticket: { select: { id: true, company: { select: { name: true } } } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Live Activity</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Built from real events inside this application — not screenshots or computer monitoring.
        </p>
      </div>

      {openShifts.length === 0 ? (
        <Card>
          <EmptyState title="Nobody is currently clocked in" />
        </Card>
      ) : (
        openShifts.map((shift) => {
          const activeSeconds = computeActiveSeconds(shift, now);
          const elapsed = Math.floor((now.getTime() - shift.startedAt.getTime()) / 1000);
          const idleSeconds = Math.floor((now.getTime() - shift.lastActivityAt.getTime()) / 1000);
          const shiftActivity = activity.filter((a) => a.shiftId === shift.id);
          const attemptsThisShift = recentAttempts.filter((a) => a.shiftId === shift.id);
          const lastAction = shiftActivity[0];

          return (
            <Card
              key={shift.id}
              title={shift.user.name}
              subtitle={`Started ${formatInTz(shift.startedAt, tz)}${
                shift.startedLateMinutes ? ` — ${shift.startedLateMinutes} minutes late` : ''
              }`}
              action={<Badge tone={shift.status === 'ACTIVE' ? 'good' : 'warn'}>{shift.status.toLowerCase()}</Badge>}
            >
              {idleSeconds > 900 && (
                <div className="px-4 pt-4">
                  <Alert tone="warn" title={`No activity for ${humanDuration(idleSeconds)}`}>
                    The last recorded action was {formatInTz(shift.lastActivityAt, tz)}.
                  </Alert>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-5">
                <Stat label="Active" value={humanDuration(activeSeconds)} />
                <Stat label="Elapsed" value={humanDuration(elapsed)} />
                <Stat
                  label="Idle / paused"
                  value={humanDuration(Math.max(0, elapsed - activeSeconds))}
                  tone={elapsed - activeSeconds > 1800 ? 'warn' : 'default'}
                />
                <Stat label="Contacts this shift" value={attemptsThisShift.length} />
                <Stat
                  label="Since last action"
                  value={humanDuration(idleSeconds)}
                  tone={idleSeconds > 900 ? 'bad' : idleSeconds > 600 ? 'warn' : 'good'}
                />
              </div>

              {lastAction && (
                <div className="border-t border-ink-200 px-4 py-3 text-sm">
                  <span className="text-ink-500">Last action: </span>
                  <span className="text-ink-900">{ACTIVITY_LABELS[lastAction.kind]}</span>
                  {lastAction.ticket && (
                    <Link href={`/leads/${lastAction.ticket.id}`} className="ml-1 text-brand-600 hover:underline">
                      {lastAction.ticket.company.name}
                    </Link>
                  )}
                  <span className="ml-2 text-xs text-ink-400">{formatInTz(lastAction.occurredAt, tz)}</span>
                </div>
              )}

              {shiftActivity.length > 0 && (
                <ul className="max-h-64 divide-y divide-ink-200 overflow-y-auto border-t border-ink-200 text-sm">
                  {shiftActivity.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                      <span className="w-40 shrink-0 text-xs text-ink-500">{ACTIVITY_LABELS[a.kind]}</span>
                      <span className="flex-1 truncate text-ink-800">{a.summary}</span>
                      <span className="shrink-0 text-xs text-ink-400">
                        {formatInTz(a.occurredAt, tz, { timeStyle: 'medium' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}

      <Card title="Contact outcomes in the last 24 hours">
        {recentAttempts.length === 0 ? (
          <EmptyState title="No contact attempts recorded in the last day" />
        ) : (
          <ul className="divide-y divide-ink-200 text-sm">
            {recentAttempts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <Badge tone={a.isConversation ? 'good' : 'neutral'}>{a.outcome.label}</Badge>
                <Link href={`/leads/${a.ticket.id}`} className="font-medium text-ink-900 hover:underline">
                  {a.ticket.company.name}
                </Link>
                <Badge tone={a.verification === 'VERIFIED_BY_INTEGRATION' ? 'info' : 'estimate'}>
                  {a.verification === 'VERIFIED_BY_INTEGRATION' ? 'Verified' : 'Manually reported'}
                </Badge>
                <span className="text-xs text-ink-500">{a.user.name}</span>
                <span className="ml-auto text-xs text-ink-400">{formatInTz(a.createdAt, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="All recent activity">
        <ul className="max-h-96 divide-y divide-ink-200 overflow-y-auto text-sm">
          {activity.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2">
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                style={{ backgroundColor: a.user.avatarColor }}
              >
                {a.user.name.charAt(0)}
              </span>
              <span className="flex-1 truncate text-ink-800">{a.summary}</span>
              <span className="shrink-0 text-xs text-ink-400">{formatInTz(a.occurredAt, tz)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-ink-500">
        Total tracked active time today:{' '}
        {secondsToHours(openShifts.reduce((s, shift) => s + computeActiveSeconds(shift, now), 0))}h
      </p>
    </div>
  );
}
