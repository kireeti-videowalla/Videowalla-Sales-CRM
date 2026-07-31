import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { getThisWeek } from '@/lib/workspace/this-week';
import { formatPhone } from '@/lib/normalize';
import { formatInTz } from '@/lib/time';
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
} from '@/components/ui';
import { ShiftControls } from '@/components/shift-controls';

export const dynamic = 'force-dynamic';

export default async function ThisWeekPage() {
  const user = await requireRole('SALES_REP', 'OWNER');
  const data = await getThisWeek(user.id);

  const { sprint, shift, hours, scorecard, previousScorecard, targets, queues, overdueCount, timezone } =
    data;

  const done = scorecard?.metrics ?? {
    contactsCompleted: 0,
    followUpsCompleted: 0,
    conversations: 0,
    interestedLeads: 0,
    meetingsBooked: 0,
  };

  const hoursRemaining = Math.max(
    0,
    Number(((sprint?.availableHours ?? 0) - hours.completedHours).toFixed(2)),
  );

  // One clear instruction, chosen from what actually needs doing right now.
  const nextThing = overdueCount > 0
    ? `Clear ${overdueCount} overdue follow-up${overdueCount === 1 ? '' : 's'} first`
    : queues.interestedQueue.length > 0
      ? `${queues.interestedQueue.length} interested lead${queues.interestedQueue.length === 1 ? '' : 's'} waiting on you`
      : queues.newLeadQueue.length > 0
        ? `${queues.newLeadQueue.length} new compan${queues.newLeadQueue.length === 1 ? 'y' : 'ies'} ready to call`
        : 'Nothing queued right now';

  return (
    <div className="space-y-7">
      <PageHeader
        title="This Week"
        subtitle={
          sprint
            ? `${formatInTz(sprint.weekStart, timezone, { dateStyle: 'medium' })} – ${formatInTz(sprint.weekEnd, timezone, { dateStyle: 'medium' })}`
            : 'No week has been prepared yet.'
        }
        action={
          sprint ? (
            <Badge tone={sprint.status === 'ACTIVE' ? 'good' : 'info'} dot>
              {sprint.status.replace(/_/g, ' ').toLowerCase()}
            </Badge>
          ) : undefined
        }
      />

      {!sprint && (
        <Alert tone="warn" title="No week is active yet">
          The owner has not approved a plan for this week. Your leads will appear here the moment it is.
        </Alert>
      )}

      {sprint?.status === 'PENDING_APPROVAL' && (
        <Alert tone="info" title="Waiting for approval">
          Your week is planned but not approved yet. You can look through it below.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <ShiftControls
            isActive={shift.isActive}
            isPaused={shift.isPaused}
            activeSeconds={shift.activeSeconds}
          />

          {/* The week at a glance — one row, no boxes-within-boxes. */}
          <Card>
            <StatRow className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat
                label="Hours"
                value={hours.completedHours}
                sub={`${hoursRemaining}h left of ${sprint?.availableHours ?? 0}h`}
                tone={hours.completedHours >= (sprint?.availableHours ?? 0) ? 'good' : 'default'}
              />
              <Stat
                label="Contacts"
                value={done.contactsCompleted}
                sub={`of ${targets.totalContacts} target`}
              />
              <Stat
                label="Follow-ups"
                value={done.followUpsCompleted}
                sub={overdueCount > 0 ? `${overdueCount} overdue` : `of ${targets.followUps} target`}
                tone={overdueCount > 0 ? 'warn' : 'default'}
              />
              <Stat label="Interested" value={done.interestedLeads} sub="this week" tone="good" />
              <Stat
                label="Score"
                value={scorecard?.totalScore ?? '—'}
                sub={previousScorecard ? `last week ${previousScorecard.totalScore}` : 'first week'}
                tone={
                  !scorecard ? 'default' : scorecard.totalScore >= 80 ? 'good' : scorecard.totalScore >= 60 ? 'warn' : 'bad'
                }
              />
            </StatRow>
          </Card>

          {/* Priority queue. */}
          <Card
            title="Your queue"
            subtitle={nextThing}
            action={
              <LinkButton href="/call-queue" size="sm">
                Open queue
              </LinkButton>
            }
          >
            {queues.followUpQueue.length === 0 &&
            queues.interestedQueue.length === 0 &&
            queues.newLeadQueue.length === 0 ? (
              <EmptyState
                title="Nothing queued"
                body="Leads are prepared automatically before each week begins. If this looks wrong, tell the owner your queue is empty."
              />
            ) : (
              <ul className="divide-y divide-hairline">
                {queues.followUpQueue.slice(0, 5).map((f) => (
                  <QueueRow
                    key={f.id}
                    href={`/leads/${f.ticketId}`}
                    tone={f.status === 'OVERDUE' ? 'bad' : 'warn'}
                    tag={f.status === 'OVERDUE' ? 'Overdue' : 'Due'}
                    company={f.ticket.company.name}
                    person={f.ticket.primaryContact?.fullName ?? null}
                    phone={f.ticket.primaryContact?.phone ?? f.ticket.company.phone}
                    line={f.reason}
                  />
                ))}
                {queues.interestedQueue.slice(0, 3).map((t) => (
                  <QueueRow
                    key={t.id}
                    href={`/leads/${t.id}`}
                    tone="good"
                    tag="Interested"
                    company={t.company.name}
                    person={t.primaryContact?.fullName ?? null}
                    phone={t.primaryContact?.phone ?? t.company.phone}
                    line={t.opportunity.headline}
                  />
                ))}
                {queues.newLeadQueue.slice(0, 8).map((t) => (
                  <QueueRow
                    key={t.id}
                    href={`/leads/${t.id}`}
                    tone={t.priority === 'PRIORITY' ? 'info' : 'neutral'}
                    tag={String(t.score)}
                    company={t.company.name}
                    person={t.primaryContact?.fullName ?? null}
                    phone={t.primaryContact?.phone ?? t.company.phone}
                    line={t.opportunity.headline}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Sidebar: progress and instructions. */}
        <div className="space-y-6">
          <Card title="Progress">
            <div className="space-y-5 px-6 py-5">
              <Progress label="Paid hours" value={hours.completedHours} max={sprint?.availableHours ?? 8} />
              <Progress label="Total contacts" value={done.contactsCompleted} max={targets.totalContacts} />
              <Progress label="Follow-ups" value={done.followUpsCompleted} max={targets.followUps} />
              <Progress label="Conversations" value={done.conversations} max={targets.conversations} />
              <Progress label="Interested" value={done.interestedLeads} max={targets.interested} />
              <Progress label="Meetings" value={done.meetingsBooked} max={targets.meetings} />
            </div>
          </Card>

          {sprint?.instructions && (
            <Card title="This week">
              <p className="px-6 py-5 text-[13px] leading-relaxed text-ink-700">{sprint.instructions}</p>
            </Card>
          )}

          {overdueCount > 0 && (
            <Alert tone="warn" title={`${overdueCount} overdue`}>
              These were promised. Clearing them is the quickest way to lift your score.
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueRow({
  href,
  tone,
  tag,
  company,
  person,
  phone,
  line,
}: {
  href: string;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral';
  tag: string;
  company: string;
  person: string | null;
  phone: string | null;
  line: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-ink-50"
      >
        <div className="w-20 shrink-0">
          <Badge tone={tone}>{tag}</Badge>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-ink-900">{company}</div>
          <div className="truncate text-[12px] text-ink-500">{line}</div>
        </div>
        <div className="hidden min-w-0 sm:block sm:w-44">
          <div className="truncate text-[13px] text-ink-700">{person ?? 'Ask for the owner'}</div>
          <div className="tnum truncate text-[12px] text-ink-500">
            {phone ? formatPhone(phone) : 'No number yet'}
          </div>
        </div>
      </Link>
    </li>
  );
}
