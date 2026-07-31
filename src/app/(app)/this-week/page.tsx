import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { getThisWeek } from '@/lib/workspace/this-week';
import { formatPhone } from '@/lib/normalize';
import { formatInTz } from '@/lib/time';
import { Alert, Badge, Card, EmptyState, LinkButton, Progress, Stat } from '@/components/ui';
import { ShiftControls } from '@/components/shift-controls';

export const dynamic = 'force-dynamic';

export default async function ThisWeekPage() {
  const user = await requireRole('SALES_REP', 'OWNER');
  const data = await getThisWeek(user.id);

  const {
    sprint,
    shift,
    hours,
    scorecard,
    previousScorecard,
    targets,
    queues,
    overdueCount,
    timezone,
  } = data;

  const done = scorecard?.metrics ?? {
    contactsCompleted: 0,
    followUpsCompleted: 0,
    conversations: 0,
    interestedLeads: 0,
    meetingsBooked: 0,
  };

  const hoursRemaining = Math.max(0, Number(((sprint?.availableHours ?? 0) - hours.completedHours).toFixed(2)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">This Week</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {sprint
              ? `Week ${sprint.label} · ${formatInTz(sprint.weekStart, timezone, { dateStyle: 'medium' })} – ${formatInTz(sprint.weekEnd, timezone, { dateStyle: 'medium' })}`
              : 'No week has been prepared yet.'}
          </p>
        </div>
        {sprint && <Badge tone={sprint.status === 'ACTIVE' ? 'good' : 'info'}>{sprint.status.replace(/_/g, ' ')}</Badge>}
      </div>

      {!sprint && (
        <Alert tone="warn" title="No sprint is active for this week">
          The owner has not approved a plan for this week yet. Your prepared leads will appear here as soon
          as it is approved.
        </Alert>
      )}

      {sprint && sprint.status === 'PENDING_APPROVAL' && (
        <Alert tone="info" title="Waiting for owner approval">
          Your week has been planned but is not approved yet. You can review it below.
        </Alert>
      )}

      {overdueCount > 0 && (
        <Alert tone="warn" title={`${overdueCount} follow-up${overdueCount === 1 ? ' is' : 's are'} overdue`}>
          Overdue follow-ups are at the top of your queue. Clearing them first is the fastest way to hit
          your weekly score.
        </Alert>
      )}

      <ShiftControls
        isActive={shift.isActive}
        isPaused={shift.isPaused}
        activeSeconds={shift.activeSeconds}
      />

      {/* ---- Weekly numbers -------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Hours done"
          value={hours.completedHours}
          sub={`${hoursRemaining}h remaining of ${sprint?.availableHours ?? 0}h`}
          tone={hours.completedHours >= (sprint?.availableHours ?? 0) ? 'good' : 'default'}
        />
        <Stat
          label="Contacts"
          value={`${done.contactsCompleted}/${targets.totalContacts}`}
          sub={`${Math.max(0, targets.totalContacts - done.contactsCompleted)} to go`}
        />
        <Stat
          label="Follow-ups"
          value={`${done.followUpsCompleted}/${targets.followUps}`}
          sub={overdueCount > 0 ? `${overdueCount} overdue` : 'On track'}
          tone={overdueCount > 0 ? 'warn' : 'default'}
        />
        <Stat label="Conversations" value={`${done.conversations}/${targets.conversations}`} />
        <Stat label="Interested" value={`${done.interestedLeads}/${targets.interested}`} tone="good" />
        <Stat
          label="Weekly score"
          value={scorecard ? `${scorecard.totalScore}` : '—'}
          sub={previousScorecard ? `Last week: ${previousScorecard.totalScore}` : 'No previous week yet'}
          tone={
            !scorecard ? 'default' : scorecard.totalScore >= 80 ? 'good' : scorecard.totalScore >= 60 ? 'warn' : 'bad'
          }
        />
      </div>

      <Card title="Progress" className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Progress label="Paid hours" value={hours.completedHours} max={sprint?.availableHours ?? 8} />
          <Progress label="Total contacts" value={done.contactsCompleted} max={targets.totalContacts} />
          <Progress label="Follow-ups" value={done.followUpsCompleted} max={targets.followUps} />
          <Progress label="Conversations" value={done.conversations} max={targets.conversations} />
          <Progress label="Interested leads" value={done.interestedLeads} max={targets.interested} />
          <Progress label="Meetings booked" value={done.meetingsBooked} max={targets.meetings} />
        </div>
      </Card>

      {sprint?.instructions && (
        <Card title="This week's instructions" className="px-5 py-4">
          <p className="text-sm text-ink-700">{sprint.instructions}</p>
        </Card>
      )}

      {/* ---- Priority queue --------------------------------------------- */}
      <Card
        title="Your call queue"
        subtitle="Worked top to bottom. Commitments first, then new companies."
        action={<LinkButton href="/call-queue" size="sm">Open full queue</LinkButton>}
      >
        {queues.followUpQueue.length === 0 &&
        queues.interestedQueue.length === 0 &&
        queues.newLeadQueue.length === 0 ? (
          <EmptyState
            title="Nothing queued right now"
            body="New leads are prepared automatically before each week starts. If this is unexpected, tell the owner your queue is empty."
          />
        ) : (
          <div className="divide-y divide-ink-200">
            {queues.followUpQueue.slice(0, 5).map((f) => (
              <QueueRow
                key={f.id}
                href={`/leads/${f.ticketId}`}
                badge={f.status === 'OVERDUE' ? { tone: 'bad', text: 'Overdue' } : { tone: 'warn', text: 'Due' }}
                company={f.ticket.company.name}
                person={f.ticket.primaryContact?.fullName ?? null}
                phone={f.ticket.primaryContact?.phone ?? f.ticket.company.phone}
                line={f.reason}
                meta={`Due ${formatInTz(f.dueAt, timezone, { dateStyle: 'medium' })}`}
              />
            ))}

            {queues.interestedQueue.slice(0, 3).map((t) => (
              <QueueRow
                key={t.id}
                href={`/leads/${t.id}`}
                badge={{ tone: 'good', text: 'Interested' }}
                company={t.company.name}
                person={t.primaryContact?.fullName ?? null}
                phone={t.primaryContact?.phone ?? t.company.phone}
                line={t.opportunity.headline}
                meta="Waiting on your next step"
              />
            ))}

            {queues.newLeadQueue.slice(0, 8).map((t) => (
              <QueueRow
                key={t.id}
                href={`/leads/${t.id}`}
                badge={{ tone: t.priority === 'PRIORITY' ? 'info' : 'neutral', text: `Score ${t.score}` }}
                company={t.company.name}
                person={t.primaryContact?.fullName ?? null}
                phone={t.primaryContact?.phone ?? t.company.phone}
                line={t.opportunity.headline}
                meta={[t.company.city, t.company.industryLabel].filter(Boolean).join(' · ')}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function QueueRow({
  href,
  badge,
  company,
  person,
  phone,
  line,
  meta,
}: {
  href: string;
  badge: { tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral'; text: string };
  company: string;
  person: string | null;
  phone: string | null;
  line: string;
  meta: string;
}) {
  return (
    <Link href={href} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-ink-50">
      <div className="w-24 shrink-0">
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <div className="min-w-[180px] flex-1">
        <div className="text-sm font-medium text-ink-900">{company}</div>
        <div className="text-xs text-ink-500">{line}</div>
      </div>
      <div className="min-w-[160px]">
        <div className="text-sm text-ink-800">{person ?? 'Contact not identified'}</div>
        <div className="tnum text-xs text-ink-500">
          {phone ? formatPhone(phone) : 'No phone number yet'}
        </div>
      </div>
      <div className="hidden text-xs text-ink-400 lg:block">{meta}</div>
    </Link>
  );
}
