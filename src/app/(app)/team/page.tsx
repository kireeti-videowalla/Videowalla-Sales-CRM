import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { ROLE_LABELS } from '@/lib/auth/rbac';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Badge, Card, EmptyState, formatMoney , PageHeader } from '@/components/ui';
import {
  CompensationPanel,
  InvitePanel,
  SchedulePanel,
  StatusToggle,
} from '@/components/team-panels';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const user = await requireRole('OWNER');
  const tz = user.timezone || DEFAULT_TIMEZONE;

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    include: {
      workSchedules: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
      compensations: { where: { effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, take: 1 },
    },
  });

  const pendingInvites = await prisma.invitation.findMany({
    where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    include: { invitedBy: { select: { name: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Team" subtitle={<>Access is invitation-only. There is no public sign-up.</>} />

      <Card title="Invite someone">
        <InvitePanel />
      </Card>

      {pendingInvites.length > 0 && (
        <Card title={`Pending invitations (${pendingInvites.length})`}>
          <ul className="divide-y divide-hairline text-sm">
            {pendingInvites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className="font-medium text-ink-900">{i.name}</span>
                <span className="text-ink-500">{i.email}</span>
                <Badge tone="info">{ROLE_LABELS[i.role]}</Badge>
                <span className="ml-auto text-xs text-ink-400">
                  Expires {formatInTz(i.expiresAt, tz, { dateStyle: 'medium' })} · invited by {i.invitedBy.name}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {users.length === 0 ? (
        <Card>
          <EmptyState title="No users yet" />
        </Card>
      ) : (
        users.map((u) => {
          const schedule = u.workSchedules[0];
          const comp = u.compensations[0];
          const planned =
            (schedule?.plannedShifts as Array<{ weekday: number; startTime: string; hours: number }>) ?? [];

          return (
            <Card
              key={u.id}
              title={u.name}
              subtitle={`${u.email} · ${ROLE_LABELS[u.role]}`}
              action={
                <div className="flex items-center gap-2">
                  <Badge tone={u.status === 'ACTIVE' ? 'good' : u.status === 'INVITED' ? 'info' : 'bad'}>
                    {u.status.toLowerCase()}
                  </Badge>
                  {u.status !== 'INVITED' && (
                    <StatusToggle userId={u.id} suspended={u.status === 'SUSPENDED'} />
                  )}
                </div>
              }
            >
              <div className="px-5 py-2 text-xs text-ink-500">
                {u.lastLoginAt
                  ? `Last signed in ${formatInTz(u.lastLoginAt, tz)}`
                  : 'Has never signed in'}
                {comp && ` · ${formatMoney(comp.weeklyPayCents)} per working week (${comp.payCadence.toLowerCase()})`}
              </div>

              {u.role === 'SALES_REP' && (
                <div className="grid gap-0 border-t border-hairline lg:grid-cols-2">
                  <div className="border-b border-hairline lg:border-b-0 lg:border-r">
                    <h3 className="px-5 pt-4 text-sm font-semibold text-ink-800">Working schedule</h3>
                    <SchedulePanel
                      userId={u.id}
                      weeklyHours={schedule?.weeklyHours ?? 8}
                      plannedShifts={planned}
                    />
                  </div>
                  <div>
                    <h3 className="px-5 pt-4 text-sm font-semibold text-ink-800">Compensation</h3>
                    <CompensationPanel
                      userId={u.id}
                      weeklyPayCents={comp?.weeklyPayCents ?? 10_000}
                      weeklyHours={comp?.weeklyHours ?? 8}
                      payCadence={comp?.payCadence ?? 'BIWEEKLY'}
                    />
                  </div>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
