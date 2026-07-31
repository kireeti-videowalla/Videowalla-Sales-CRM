import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { getTicketDetail } from '@/lib/workspace/ticket';
import { prisma } from '@/lib/db';
import { listOutcomes } from '@/lib/pipeline/contact-attempts';
import { isIntegrationReady } from '@/lib/integrations/store';
import { markLeadOpenedAction } from '@/app/actions/tickets';
import { formatPhone } from '@/lib/normalize';
import { addDays, formatDateInTz, formatInTz, DEFAULT_TIMEZONE } from '@/lib/time';
import { bandLabel } from '@/lib/pipeline/scoring';
import { Alert, Badge, Card, EstimatedValue, formatMoney } from '@/components/ui';
import { OutcomeForm } from '@/components/outcome-form';
import { AssignLead } from '@/components/assign-lead';
import {
  FollowUpComposer,
  MeetingComposer,
  NoteComposer,
  ReviewDecisionPanel,
} from '@/components/ticket-panels';

export const dynamic = 'force-dynamic';

type ScoreFactor = { key: string; label: string; weight: number; awarded: number; reason: string };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ticket = await getTicketDetail(id);
  if (!ticket) notFound();

  // Reps only see their own leads.
  if (user.role === 'SALES_REP' && ticket.assigneeId !== user.id) {
    return (
      <Alert tone="bad" title="Not your lead">
        This lead is assigned to someone else. Ask the owner to reassign it if you need to work it.
      </Alert>
    );
  }

  // Fire-and-forget: records that the ticket was genuinely opened and read.
  void markLeadOpenedAction(id);

  const tz = user.timezone || DEFAULT_TIMEZONE;
  const outcomes = await listOutcomes();
  const calendarConnected = await isIntegrationReady('GOOGLE_CALENDAR');
  // Only the owner may reassign, so only fetch the rep list for them.
  const reps = can(user.role, 'leads.assign')
    ? await prisma.user.findMany({
        where: { role: 'SALES_REP', status: 'ACTIVE' },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : [];

  const opp = ticket.opportunity;
  const company = ticket.company;
  const score = opp.scores[0];
  const breakdown = (score?.breakdown ?? []) as ScoreFactor[];
  const contact = ticket.primaryContact ?? company.contacts[0] ?? null;
  const openFollowUp = ticket.followUps.find((f) => ['SCHEDULED', 'DUE', 'OVERDUE'].includes(f.status));

  const canAct = user.role === 'OWNER' || (user.role === 'SALES_REP' && ticket.assigneeId === user.id);
  const isReviewStage = ticket.stage.key === 'review_required';

  return (
    <div className="space-y-6">
      {/* ---- Header ---------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink-900">{company.name}</h1>
            <Badge tone="neutral">{ticket.reference}</Badge>
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ backgroundColor: ticket.stage.color }}
            >
              {ticket.stage.name}
            </span>
            {company.doNotContact && <Badge tone="bad">Do not contact</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink-600">{opp.headline}</p>
        </div>
        <div className="text-right">
          <div className="tnum text-3xl font-semibold text-ink-900">{ticket.score}</div>
          <div className="text-xs text-ink-500">{bandLabel(ticket.band)}</div>
        </div>
      </div>

      {company.doNotContact && (
        <Alert tone="bad" title="This company must not be contacted">
          {company.doNotContactReason}
          {company.doNotContactAt && ` — set ${formatInTz(company.doNotContactAt, tz, { dateStyle: 'medium' })}.`}
        </Alert>
      )}

      {isReviewStage && can(user.role, 'leads.assign') && (
        <Card title="Owner review required">
          <ReviewDecisionPanel ticketId={ticket.id} />
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ================= LEFT: what she needs to make the call ======== */}
        <div className="space-y-6 lg:col-span-2">
          {/* 1-2. Person and phone number, first and largest. */}
          <Card title="Who to contact">
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-500">Person</div>
                <div className="mt-0.5 text-lg font-semibold text-ink-900">
                  {contact?.fullName ?? 'Not identified yet'}
                </div>
                {contact?.title && <div className="text-sm text-ink-500">{contact.title}</div>}
                {!contact && (
                  <p className="mt-1 text-xs text-amber-700">
                    Ask for the owner or whoever handles marketing.
                  </p>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-500">Phone</div>
                {contact?.phone || company.phone ? (
                  <a
                    href={`tel:${contact?.phone ?? company.phone}`}
                    className="tnum mt-0.5 block text-lg font-semibold text-brand-600 hover:underline"
                  >
                    {formatPhone(contact?.phone ?? company.phone)}
                  </a>
                ) : (
                  <div className="mt-0.5 text-sm text-ink-400">No phone number found</div>
                )}
                {contact?.phoneStatus && contact.phone && (
                  <Badge tone={contact.phoneStatus === 'VERIFIED' ? 'good' : 'estimate'}>
                    {contact.phoneStatus.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-500">Email</div>
                {contact?.email || company.email ? (
                  <a
                    href={`mailto:${contact?.email ?? company.email}`}
                    className="mt-0.5 block text-sm text-brand-600 hover:underline"
                  >
                    {contact?.email ?? company.email}
                  </a>
                ) : (
                  <div className="mt-0.5 text-sm text-ink-400">No email found</div>
                )}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-500">Website</div>
                {company.websiteUrl ? (
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-0.5 block truncate text-sm text-brand-600 hover:underline"
                  >
                    {company.websiteDomain ?? company.websiteUrl}
                  </a>
                ) : (
                  <div className="mt-0.5 text-sm text-ink-400">Not found</div>
                )}
              </div>
            </div>

            {company.contacts.length > 1 && (
              <div className="border-t border-hairline px-5 py-3">
                <div className="text-xs uppercase tracking-wide text-ink-500">Other contacts</div>
                <ul className="mt-1 space-y-1">
                  {company.contacts.slice(1).map((c) => (
                    <li key={c.id} className="text-sm text-ink-700">
                      {c.fullName}
                      {c.title && <span className="text-ink-500"> — {c.title}</span>}
                      {c.phone && <span className="tnum text-ink-500"> · {formatPhone(c.phone)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* 4-6. What they want, why to call, and the opening line. */}
          <Card title="Why you are calling">
            <div className="space-y-4 px-5 py-4">
              <Block label="What they are looking for" body={opp.whatTheyAreLookingFor} />
              <Block label="Their likely problem" body={opp.marketingProblem} />
              <Block label="Why Videowalla should contact them" body={opp.whyContact} />
              <Block label="Recommended service" body={opp.recommendedService} />

              {opp.suggestedOpening && (
                <div className="rounded-lg border border-brand-200 bg-blue-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                    Suggested opening — say this
                  </div>
                  <p className="mt-1 text-sm text-ink-900">{opp.suggestedOpening}</p>
                </div>
              )}

              {opp.missingInformation.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                    Not known — confirm on the call
                  </div>
                  <ul className="mt-1 list-inside list-disc text-sm text-amber-900">
                    {opp.missingInformation.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>

          {/* 10-12. Outcome, notes, follow-up controls. */}
          {canAct && !company.doNotContact && (
            <Card title="Record what happened" subtitle="This is the only step that has to be completed after a call.">
              <div className="px-5 py-4">
                <OutcomeForm
                  ticketId={ticket.id}
                  outcomes={outcomes.map((o) => ({
                    key: o.key,
                    label: o.label,
                    requiresNote: o.requiresNote,
                    requiresFollowUp: o.requiresFollowUp,
                    targetStageKey: o.targetStageKey,
                  }))}
                  suggestedFollowUpDate={formatDateInTz(addDays(new Date(), 3), tz)}
                />
              </div>
            </Card>
          )}

          {/* 8. Previous attempts. */}
          <Card title="Previous attempts" subtitle={`${ticket.attemptCount} attempt${ticket.attemptCount === 1 ? '' : 's'} so far`}>
            {ticket.attempts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-500">No contact has been attempted yet.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {ticket.attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                    <Badge tone={a.isConversation ? 'good' : 'neutral'}>{a.outcome.label}</Badge>
                    <span className="text-ink-500">Attempt {a.attemptNumber}</span>
                    <span className="text-ink-500">{a.channel.toLowerCase()}</span>
                    <Badge tone={a.verification === 'VERIFIED_BY_INTEGRATION' ? 'info' : 'estimate'}>
                      {a.verification === 'VERIFIED_BY_INTEGRATION' ? 'Verified' : 'Manually reported'}
                    </Badge>
                    <span className="ml-auto text-xs text-ink-400">
                      {a.user.name} · {formatInTz(a.createdAt, tz)}
                    </span>
                    {a.note && <p className="w-full text-ink-700">{a.note}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Notes and comments. */}
          <Card title="Notes and comments">
            {canAct && <NoteComposer ticketId={ticket.id} />}
            {ticket.notes.length === 0 ? (
              <p className="px-5 pb-4 text-sm text-ink-500">No notes yet.</p>
            ) : (
              <ul className="divide-y divide-hairline border-t border-hairline">
                {ticket.notes.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-ink-500">
                      <span
                        className="grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold text-white"
                        style={{ backgroundColor: n.user.avatarColor }}
                      >
                        {n.user.name.charAt(0)}
                      </span>
                      <span className="font-medium text-ink-700">{n.user.name}</span>
                      <span>{formatInTz(n.createdAt, tz)}</span>
                      {n.kind === 'OWNER_COMMENT' && <Badge tone="info">Owner</Badge>}
                      {n.revisions.length > 0 && (
                        <Badge
                          tone="warn"
                          title={n.revisions
                            .map((r) => `Was: ${r.previousBody}`)
                            .join('\n\n')}
                        >
                          Edited {n.revisions.length}×
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ================= RIGHT: context and controls ================== */}
        <div className="space-y-6">
          {openFollowUp && (
            <Alert
              tone={openFollowUp.status === 'OVERDUE' ? 'warn' : 'info'}
              title={openFollowUp.status === 'OVERDUE' ? 'Follow-up overdue' : 'Follow-up scheduled'}
            >
              {openFollowUp.reason} — due {formatInTz(openFollowUp.dueAt, tz, { dateStyle: 'medium' })}.
            </Alert>
          )}

          <Card title="Next action">
            <div className="px-5 py-4">
              <p className="text-sm font-medium text-ink-900">
                {ticket.nextActionLabel ?? 'Call the company'}
              </p>
              {ticket.nextFollowUpAt && (
                <p className="mt-1 text-xs text-ink-500">
                  Due {formatInTz(ticket.nextFollowUpAt, tz, { dateStyle: 'medium' })}
                </p>
              )}
              {ticket.assignee && (
                <p className="mt-2 text-xs text-ink-500">
                  Assigned to {ticket.assignee.name}
                  {ticket.sprint && ` · week ${ticket.sprint.label}`}
                </p>
              )}
              {ticket.isCarryover && (
                <div className="mt-2">
                  <Badge tone="warn">Carried over from a previous week</Badge>
                </div>
              )}
            </div>
          </Card>

          {can(user.role, 'leads.assign') && (
            <Card title="Assignment">
              <AssignLead ticketId={ticket.id} currentAssigneeId={ticket.assigneeId} reps={reps} />
            </Card>
          )}

          <Card title="The company">
            <dl className="divide-y divide-hairline text-sm">
              <Row label="Industry" value={company.industry?.name ?? company.industryLabel ?? '—'} />
              <Row
                label="Location"
                value={[company.city, company.province].filter(Boolean).join(', ') || '—'}
              />
              <Row label="Service area" value={company.serviceArea ?? '—'} />
              <Row
                label="Employees"
                value={
                  <EstimatedValue
                    value={
                      company.employeeCountMin
                        ? `${company.employeeCountMin}${company.employeeCountMax ? `–${company.employeeCountMax}` : '+'}`
                        : null
                    }
                    confidence={company.employeeCountConfidence}
                    source={company.employeeCountSource}
                    checkedAt={company.employeeCountCheckedAt}
                    verified={company.employeeCountVerified}
                  />
                }
              />
              <Row
                label="Revenue"
                value={
                  <EstimatedValue
                    value={
                      company.revenueMinCents
                        ? `${formatMoney(company.revenueMinCents)}${company.revenueMaxCents ? ` – ${formatMoney(company.revenueMaxCents)}` : '+'}`
                        : null
                    }
                    confidence={company.revenueConfidence}
                    source={company.revenueSource}
                    checkedAt={company.revenueCheckedAt}
                    verified={company.revenueVerified}
                  />
                }
              />
              {company.reviewCount != null && (
                <Row label="Reviews" value={`${company.reviewCount} · ${company.reviewRating ?? '—'}★`} />
              )}
              {(company.linkedinUrl || company.instagramUrl) && (
                <Row
                  label="Social"
                  value={
                    <span className="flex gap-2">
                      {company.linkedinUrl && (
                        <a className="text-brand-600 hover:underline" href={company.linkedinUrl} target="_blank" rel="noreferrer noopener">
                          LinkedIn
                        </a>
                      )}
                      {company.instagramUrl && (
                        <a className="text-brand-600 hover:underline" href={company.instagramUrl} target="_blank" rel="noreferrer noopener">
                          Instagram
                        </a>
                      )}
                    </span>
                  }
                />
              )}
            </dl>
          </Card>

          {/* 7. Original source, always preserved. */}
          <Card title="Where this came from">
            <dl className="divide-y divide-hairline text-sm">
              <Row label="Source" value={opp.sourceRecord?.kind.replace(/_/g, ' ').toLowerCase() ?? 'manual'} />
              {opp.sourceRecord?.subject && <Row label="Subject" value={opp.sourceRecord.subject} />}
              {opp.jobPosting?.postedAt && (
                <Row
                  label="Posted"
                  value={`${formatInTz(opp.jobPosting.postedAt, tz, { dateStyle: 'medium' })}${
                    opp.postingAgeDays !== null ? ` (${opp.postingAgeDays} days ago)` : ''
                  }`}
                />
              )}
              {opp.jobPosting?.matchedKeywords.length ? (
                <Row label="Matched keywords" value={opp.jobPosting.matchedKeywords.join(', ')} />
              ) : null}
              {opp.sourceRecord?.sourceUrl && (
                <Row
                  label="Original link"
                  value={
                    <a
                      className="break-all text-brand-600 hover:underline"
                      href={opp.sourceRecord.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open the original
                    </a>
                  }
                />
              )}
              <Row
                label="Processed by"
                value={`${opp.aiProvider ?? 'unknown'} (${opp.aiModel ?? 'n/a'})${
                  opp.aiConfidence !== null ? ` · ${Math.round(opp.aiConfidence * 100)}% confidence` : ''
                }`}
              />
            </dl>
          </Card>

          <Card title={`Score: ${ticket.score}/100`} subtitle={score?.explanation ?? undefined}>
            <ul className="divide-y divide-hairline text-sm">
              {breakdown.map((f) => (
                <li key={f.key} className="px-5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-700">{f.label}</span>
                    <span className="tnum shrink-0 text-xs text-ink-500">
                      {f.awarded} / {f.weight}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">{f.reason}</p>
                </li>
              ))}
            </ul>
            {score && (
              <p className="border-t border-hairline px-5 py-2 text-xs text-ink-500">
                Data confidence {Math.round(score.dataConfidence * 100)}% — the remainder rests on estimates.
              </p>
            )}
          </Card>

          {canAct && !company.doNotContact && (
            <>
              <Card title="Schedule a follow-up">
                <FollowUpComposer ticketId={ticket.id} defaultDate={formatDateInTz(addDays(new Date(), 3), tz)} />
              </Card>

              <Card title="Book a meeting">
                <MeetingComposer
                  ticketId={ticket.id}
                  defaultEmail={contact?.email ?? company.email ?? ''}
                  calendarConnected={calendarConnected}
                  minDateTime={new Date(Date.now() + 3_600_000).toISOString().slice(0, 16)}
                />
              </Card>
            </>
          )}

          {ticket.meetings.length > 0 && (
            <Card title="Meetings">
              <ul className="divide-y divide-hairline text-sm">
                {ticket.meetings.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink-900">{m.meetingType}</span>
                      <Badge
                        tone={
                          m.status === 'CONFIRMED' ? 'good' : m.status === 'DECLINED' ? 'bad' : 'info'
                        }
                      >
                        {m.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </div>
                    <div className="text-xs text-ink-500">{formatInTz(m.startsAt, tz)}</div>
                    {m.htmlLink && (
                      <a className="text-xs text-brand-600 hover:underline" href={m.htmlLink} target="_blank" rel="noreferrer noopener">
                        Open in Google Calendar
                      </a>
                    )}
                    {m.syncError && <p className="mt-1 text-xs text-amber-700">{m.syncError}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="History" subtitle="Immutable — every movement is kept.">
            <ul className="divide-y divide-hairline text-sm">
              {ticket.stageHistory.slice(0, 12).map((h) => (
                <li key={h.id} className="px-5 py-2">
                  <div className="text-ink-800">
                    {h.fromStage ? `${h.fromStage.name} → ` : 'Created in '}
                    <span className="font-medium">{h.toStage.name}</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {h.user?.name ?? (h.automated ? 'Automation' : 'System')} · {formatInTz(h.occurredAt, tz)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div>
        <Link href="/call-queue" className="text-sm text-brand-600 hover:underline">
          ← Back to the call queue
        </Link>
      </div>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</div>
      <p className="mt-0.5 text-sm text-ink-800">{body}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="text-right text-ink-800">{value}</dd>
    </div>
  );
}
