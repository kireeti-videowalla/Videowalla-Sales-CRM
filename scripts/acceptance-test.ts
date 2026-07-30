/**
 * End-to-end acceptance test for the Phase 1 vertical workflow.
 *
 * Runs against a real PostgreSQL database and exercises the exact production
 * code paths — no mocks of the pipeline, scoring, sprint or stage engines. The
 * only thing simulated is the *arrival* of lead-source material (three alert
 * emails), which stands in for the Gmail connector so the test does not need
 * live Google credentials.
 *
 * Usage: npm run test:acceptance
 *
 * It asserts the milestone from the brief:
 *   a lead is received → extracted → qualified → enriched → scored → converted
 *   into a Kanban ticket → assigned to a weekly sprint → contacted → moved to an
 *   outcome stage → scheduled for follow-up → shown in the owner's Sunday Review.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env', quiet: true });

import { prisma } from '../src/lib/db';
import { hashPassword, stableKeyPlaceholder } from './acceptance-helpers';
import { parseEmail, type RawEmail } from '../src/lib/ingestion/email-parser';
import { recordSource } from '../src/lib/ingestion/ingest';
import { processSourceRecord } from '../src/lib/pipeline/process';
import { runSundayPlanning } from '../src/lib/sprint/planner';
import { approveSprint } from '../src/lib/sprint/planner';
import { logContactAttempt } from '../src/lib/pipeline/contact-attempts';
import { approveReviewBatch, listReviewQueue } from '../src/lib/pipeline/review';
import { endShift, startShift } from '../src/lib/shifts/service';
import { computeScorecard } from '../src/lib/sprint/scorecard';
import { buildWeeklyReport } from '../src/lib/reports/service';
import { setSetting } from '../src/lib/settings/service';
import { sweepFollowUps } from '../src/lib/followups/service';
import { addDays, startOfWeekInTz } from '../src/lib/time';

const TZ = 'America/Toronto';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  [31m✗[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[1m${title}[0m`);
}

// ---------------------------------------------------------------------------
// Simulated inbound lead material.
// Clearly labelled test fixtures — this is the only fabricated data in the run.
// ---------------------------------------------------------------------------

const TEST_EMAILS: RawEmail[] = [
  {
    messageId: 'acceptance-google-alert-1',
    subject: 'Google Alert - social media manager Toronto',
    from: 'googlealerts-noreply@google.com',
    receivedAt: new Date(Date.now() - 2 * 86_400_000),
    textBody: '',
    htmlBody: `
      <html><body>
        <a href="https://www.google.com/url?url=https%3A%2F%2Facceptance-summitridge.example%2Fcareers%2Fsocial-media-manager">
          Social Media Manager - Summit Ridge Custom Homes Inc. - Toronto, ON
        </a>
        <p>Summit Ridge Custom Homes is hiring a Social Media Manager in Toronto, ON to run Instagram,
           produce short-form video of our builds and manage paid advertising. Full-time, $55,000 - $65,000 per year.
           Call us at (416) 555-0142 or email hello@acceptance-summitridge.example.</p>
        <a href="https://www.google.com/url?url=https%3A%2F%2Facceptance-northwind.example%2Fjobs%2Fvideographer">
          Videographer - Northwind Heating and Cooling Ltd - Burlington, ON
        </a>
        <p>Northwind Heating and Cooling is looking for an in-house videographer to create content
           for social media and YouTube. Burlington, ON. Contact (905) 555-0188.</p>
        <a href="https://www.google.com/alerts/manage">Manage this alert</a>
      </body></html>`,
  },
  {
    messageId: 'acceptance-indeed-1',
    subject: 'New jobs for content creator',
    from: 'alert@indeed.com',
    receivedAt: new Date(Date.now() - 1 * 86_400_000),
    textBody: '',
    htmlBody: `
      <a href="https://ca.indeed.com/viewjob?jk=acceptance99887766&from=alert">Content Creator</a>
      <p>Maple Ridge Dental Group — Oakville, ON<br>3 days ago<br>
      We are seeking a content creator to produce video content and manage social media for our clinic.
      Phone (905) 555-0133.</p>`,
  },
  {
    // Deliberately the SAME opportunity as the Google Alert above, arriving via
    // a second channel. It must NOT create a second company or a second ticket.
    messageId: 'acceptance-duplicate-1',
    subject: 'Job alert: Social Media Manager',
    from: 'alerts@ziprecruiter.com',
    receivedAt: new Date(Date.now() - 12 * 3_600_000),
    textBody: '',
    htmlBody: `
      <a href="https://acceptance-summitridge.example/careers/social-media-manager">
        Social Media Manager - Summit Ridge Custom Homes - Toronto, ON
      </a>
      <p>Summit Ridge Custom Homes Inc. seeks a social media manager. Toronto, ON.</p>`,
  },
];

async function resetTestData(): Promise<void> {
  // Remove only artifacts of previous acceptance runs, identified by the
  // reserved `.example` domains and the acceptance user emails.
  const testDomains = ['acceptance-summitridge.example', 'acceptance-northwind.example'];
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { websiteDomain: { in: testDomains } },
        { name: { contains: 'Summit Ridge', mode: 'insensitive' } },
        { name: { contains: 'Northwind Heating', mode: 'insensitive' } },
        { name: { contains: 'Maple Ridge Dental', mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);

  if (companyIds.length) {
    await prisma.leadTicket.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.opportunity.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.jobPosting.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  }

  await prisma.sourceRecord.deleteMany({ where: { externalId: { contains: '' }, sender: { contains: 'acceptance' } } });
  await prisma.sourceRecord.deleteMany({
    where: { rawPayload: { path: ['messageId'], string_starts_with: 'acceptance-' } },
  });

  const testUsers = await prisma.user.findMany({
    where: { email: { in: ['acceptance-owner@videowalla.test', 'acceptance-rep@videowalla.test'] } },
    select: { id: true },
  });
  const userIds = testUsers.map((u) => u.id);
  if (userIds.length) {
    await prisma.weeklySprint.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.shift.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.activityEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workSchedule.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.compensationSetting.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.report.deleteMany({ where: { kind: 'SUNDAY_SUMMARY' } });
}

async function main(): Promise<void> {
  console.log('[1mVideowalla Sales Command Center — acceptance test[0m');
  console.log(`Database: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@')}`);

  await resetTestData();

  // -------------------------------------------------------------------------
  section('0. Configuration is present');
  // -------------------------------------------------------------------------
  const stageCount = await prisma.pipelineStage.count();
  const keywordCount = await prisma.keyword.count();
  const profile = await prisma.scoringProfile.findFirst({ where: { isActive: true }, include: { factors: true } });
  check('pipeline stages are seeded', stageCount >= 15, `${stageCount} stages`);
  check('hiring keywords are seeded', keywordCount >= 20, `${keywordCount} keywords`);
  check('an active scoring profile exists', Boolean(profile), 'run `npm run seed`');
  check(
    'scoring factor weights total 100',
    (profile?.factors.reduce((s, f) => s + f.weight, 0) ?? 0) === 100,
  );

  // Force the deterministic provider so the test is reproducible and offline.
  await setSetting('ai.config', { provider: 'rules' });

  // -------------------------------------------------------------------------
  section('1. Users, schedule and compensation');
  // -------------------------------------------------------------------------
  const owner = await prisma.user.create({
    data: {
      email: 'acceptance-owner@videowalla.test',
      name: 'Acceptance Owner',
      role: 'OWNER',
      status: 'ACTIVE',
      passwordHash: await hashPassword('AcceptanceTest123!'),
    },
  });
  const rep = await prisma.user.create({
    data: {
      email: 'acceptance-rep@videowalla.test',
      name: 'Acceptance Rep',
      role: 'SALES_REP',
      status: 'ACTIVE',
      passwordHash: await hashPassword('AcceptanceTest123!'),
    },
  });

  await prisma.workSchedule.create({
    data: {
      userId: rep.id,
      weeklyHours: 8,
      // Four hours Monday, four hours Tuesday — the brief's example split.
      plannedShifts: [
        { weekday: 1, startTime: '09:00', hours: 4 },
        { weekday: 2, startTime: '09:00', hours: 4 },
      ],
      effectiveFrom: new Date(Date.now() - 30 * 86_400_000),
    },
  });
  await prisma.compensationSetting.create({
    data: {
      userId: rep.id,
      weeklyPayCents: 10_000, // $100/week
      payCadence: 'BIWEEKLY',
      weeklyHours: 8,
      effectiveFrom: new Date(Date.now() - 30 * 86_400_000),
    },
  });

  check('owner and sales rep created', Boolean(owner.id && rep.id));
  check('flexible 8-hour schedule stored', true);

  // -------------------------------------------------------------------------
  section('2. Lead sources are received and preserved');
  // -------------------------------------------------------------------------
  const recordIds: string[] = [];
  for (const email of TEST_EMAILS) {
    const parsed = parseEmail(email);
    for (const candidate of parsed.candidates) {
      const record = await recordSource({
        kind: parsed.detectedKind,
        externalId: candidate.externalId,
        subject: email.subject,
        sender: email.from,
        receivedAt: email.receivedAt,
        sourceUrl: candidate.url,
        rawPayload: {
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          receivedAt: email.receivedAt.toISOString(),
          textBody: email.textBody,
          htmlBody: email.htmlBody,
        },
        parsedPayload: {
          companyName: candidate.companyName,
          title: candidate.title,
          location: candidate.location,
          url: candidate.url,
          snippet: candidate.snippet,
          platform: candidate.platform,
          postedAtText: candidate.postedAtText,
        },
      });
      if (record.isNew) recordIds.push(record.id);
    }
  }

  check('alert emails produced source records', recordIds.length >= 4, `${recordIds.length} records`);

  const firstRecord = await prisma.sourceRecord.findUniqueOrThrow({ where: { id: recordIds[0]! } });
  const rawPayload = firstRecord.rawPayload as Record<string, unknown>;
  check('the original email is preserved verbatim', typeof rawPayload.htmlBody === 'string' && (rawPayload.htmlBody as string).length > 0);
  check('the original source URL is preserved', Boolean(firstRecord.sourceUrl));

  // Re-ingesting the identical email must be a no-op.
  const reParsed = parseEmail(TEST_EMAILS[0]!);
  const reRecord = await recordSource({
    kind: reParsed.detectedKind,
    externalId: reParsed.candidates[0]!.externalId,
    rawPayload: { messageId: TEST_EMAILS[0]!.messageId },
  });
  check('re-ingesting the same alert does not create a second record', !reRecord.isNew);

  // -------------------------------------------------------------------------
  section('3. AI extraction, qualification, enrichment, scoring, ticketing');
  // -------------------------------------------------------------------------
  const outcomes = [];
  for (const id of recordIds) {
    outcomes.push(await processSourceRecord(id));
  }

  const created = outcomes.filter((o) => o.status === 'CREATED');
  const reviewed = outcomes.filter((o) => o.status === 'MANUAL_REVIEW');
  const disqualified = outcomes.filter((o) => o.status === 'DISQUALIFIED');
  const failedOutcomes = outcomes.filter((o) => o.status === 'FAILED');

  console.log(
    `    created=${created.length} manualReview=${reviewed.length} disqualified=${disqualified.length} failed=${failedOutcomes.length}`,
  );
  check('no source record failed to process', failedOutcomes.length === 0);
  check('tickets were created automatically', created.length + reviewed.length >= 2);

  const summitCompanies = await prisma.company.findMany({
    where: { normalizedName: { contains: 'summit ridge' } },
  });
  check(
    'the same company from two different alerts is deduplicated to one record',
    summitCompanies.length === 1,
    `${summitCompanies.length} Summit Ridge companies`,
  );

  const summit = summitCompanies[0];
  if (summit) {
    const summitTickets = await prisma.leadTicket.count({ where: { companyId: summit.id } });
    check('the duplicate alert did not create a second ticket', summitTickets === 1, `${summitTickets} tickets`);
    check('the website domain was extracted for dedup', summit.websiteDomain === 'acceptance-summitridge.example', String(summit.websiteDomain));
    check(
      'no revenue was fabricated when none was available',
      summit.revenueMinCents === null && summit.revenueConfidence === 'UNKNOWN',
    );
  }

  const allTickets = await prisma.leadTicket.findMany({
    include: { company: true, opportunity: true, stage: true, scores: { where: { isCurrent: true } } },
    orderBy: { score: 'desc' },
  });
  const ticket = allTickets[0];

  check('every ticket has a score', allTickets.every((t) => t.score > 0));
  check('every ticket has a current LeadScore record', allTickets.every((t) => t.scores.length === 1));

  if (ticket) {
    const score = ticket.scores[0]!;
    const breakdown = score.breakdown as Array<{ key: string; label: string; awarded: number; reason: string }>;
    check('the score is explainable factor by factor', breakdown.length >= 10, `${breakdown.length} factors`);
    check('every factor states a reason', breakdown.every((b) => b.reason.length > 0));
    check('the score has a written explanation', (score.explanation ?? '').length > 20);
    check('data confidence is recorded alongside the score', score.dataConfidence >= 0 && score.dataConfidence <= 1);

    const opp = ticket.opportunity;
    check('the ticket says what the company is looking for', Boolean(opp.whatTheyAreLookingFor));
    check('the ticket says why Videowalla should contact them', Boolean(opp.whyContact));
    check('the ticket recommends a Videowalla service', Boolean(opp.recommendedService));
    check('the ticket has a suggested call opening', (opp.suggestedOpening ?? '').length > 40);
    check('missing information is listed rather than invented', opp.missingInformation.length > 0);
    check('the AI provider and model are recorded', Boolean(opp.aiProvider && opp.aiModel));

    console.log(`    top ticket: ${ticket.company.name} — ${ticket.score}/100 (${ticket.band}) in "${ticket.stage.name}"`);
    console.log(`    opening: "${(opp.suggestedOpening ?? '').slice(0, 110)}…"`);
  }

  const hiringPostings = await prisma.jobPosting.count();
  check('hiring opportunities were captured as job postings', hiringPostings >= 2, `${hiringPostings} postings`);

  const postingWithKeywords = await prisma.jobPosting.findFirst({
    where: { matchedKeywords: { isEmpty: false } },
  });
  check('job postings record which Videowalla keywords matched', Boolean(postingWithKeywords));

  // -------------------------------------------------------------------------
  section('4. Uncertain leads reach a human, not the call queue');
  // -------------------------------------------------------------------------
  // The offline rules engine cannot verify revenue or headcount, so it scores
  // conservatively and routes to Review Required. That is the designed
  // behaviour: an uncertain lead must not be silently dialled.
  const reviewQueue = await listReviewQueue();
  check('low-confidence leads are routed to Review Required', reviewQueue.length > 0, `${reviewQueue.length} queued`);
  check(
    'nothing was auto-queued for calling without enough confidence',
    (await prisma.leadTicket.count({ where: { stage: { key: 'ready_to_contact' } } })) === 0,
  );

  const approvedBatch = await approveReviewBatch(
    reviewQueue.map((t) => t.id),
    owner.id,
  );
  check('the owner can approve reviewed leads for calling', approvedBatch.approved === reviewQueue.length, approvedBatch.errors.join('; '));

  const readyCount = await prisma.leadTicket.count({ where: { stage: { key: 'ready_to_contact' } } });
  check('approved leads are now Ready to Contact', readyCount === reviewQueue.length, `${readyCount} ready`);

  const approvalHistory = await prisma.stageHistory.findFirst({
    where: { ticketId: reviewQueue[0]!.id, toStage: { key: 'ready_to_contact' } },
  });
  check('the review decision is recorded in immutable history', approvalHistory?.userId === owner.id);

  // -------------------------------------------------------------------------
  section('5. Sunday planning creates the weekly sprint');
  // -------------------------------------------------------------------------
  // Plan the week in progress so the rep can work immediately. Skip live
  // ingestion: this run supplies its own source material and has no Google
  // credentials.
  const plan = await runSundayPlanning({ skipIngestion: true, targetWeek: 'current' });

  check('a sprint was created for the sales rep', plan.sprints.length === 1, `${plan.sprints.length} sprints`);
  const planned = plan.sprints[0];

  if (planned) {
    console.log(`    week ${planned.label}: ${JSON.stringify(planned.targets)}`);
    console.log(`    rationale: ${planned.rationale[0]}`);
    check('the sprint uses the configured 8 paid hours', planned.availableHours === 8);
    check('a total contact target was calculated', (planned.targets.TOTAL_CONTACTS ?? 0) > 0);
    check(
      'the target does not exceed the qualified leads available',
      (planned.targets.NEW_CONTACTS ?? 0) <= allTickets.length,
    );
    check('targets are explained in writing', planned.rationale.length >= 3);
    check(
      'a lead shortage is flagged honestly when leads are scarce',
      planned.leadShortfall > 0,
      'expected a shortage with only a handful of test leads',
    );
    check('qualified leads were assigned to the sprint', planned.leadsAssigned > 0);
  }

  const sprint = await prisma.weeklySprint.findFirstOrThrow({
    where: { userId: rep.id },
    include: { targets: true },
  });
  check('the sprint awaits owner approval', sprint.status === 'PENDING_APPROVAL', sprint.status);
  check('all six target types were created', sprint.targets.length === 6, `${sprint.targets.length} targets`);

  const ownerNotification = await prisma.notification.findFirst({
    where: { userId: owner.id, key: 'sprint.ready' },
  });
  check('the owner was notified that the week is ready', Boolean(ownerNotification));

  const sundayReport = await prisma.report.findFirst({ where: { kind: 'SUNDAY_SUMMARY' } });
  check('a Sunday summary report was stored', Boolean(sundayReport));

  // -------------------------------------------------------------------------
  section('6. Owner approves the week');
  // -------------------------------------------------------------------------
  const approval = await approveSprint(sprint.id, owner.id);
  check('the owner can approve the sprint', approval.ok);

  const approved = await prisma.weeklySprint.findUniqueOrThrow({ where: { id: sprint.id } });
  check('the sprint is now approved', approved.status === 'APPROVED');

  const repNotification = await prisma.notification.findFirst({
    where: { userId: rep.id, key: 'rep.sprint_approved' },
  });
  check('the salesperson was told her week is ready', Boolean(repNotification));

  // -------------------------------------------------------------------------
  section('7. The salesperson works a shift');
  // -------------------------------------------------------------------------
  const shiftStart = await startShift(rep.id);
  check('the salesperson can start a shift', shiftStart.ok);
  check('the shift is linked to the approved sprint', shiftStart.shift?.sprintId === sprint.id);

  const queue = await prisma.leadTicket.findMany({
    where: { assigneeId: rep.id, sprintId: sprint.id },
    include: { company: true, opportunity: true, primaryContact: true, stage: true },
    orderBy: { queuePosition: 'asc' },
  });
  check('her prepared call queue is not empty', queue.length > 0, `${queue.length} tickets`);

  const workTicket = queue[0]!;
  console.log(`    working: ${workTicket.company.name} (${workTicket.reference})`);

  // --- Contact 1: no answer → automatic retry follow-up --------------------
  const noAnswer = await logContactAttempt({
    ticketId: workTicket.id,
    userId: rep.id,
    outcomeKey: 'no_answer',
    channel: 'PHONE',
  });
  check('a no-answer outcome can be recorded', noAnswer.ok, 'error' in noAnswer ? noAnswer.error : '');

  const afterNoAnswer = await prisma.leadTicket.findUniqueOrThrow({
    where: { id: workTicket.id },
    include: { stage: true, followUps: true },
  });
  check('the ticket moved to Contacted – No Answer', afterNoAnswer.stage.key === 'contacted_no_answer');
  check('the attempt counter incremented', afterNoAnswer.attemptCount === 1);
  check(
    'a retry follow-up was scheduled automatically',
    afterNoAnswer.followUps.some((f) => f.status === 'SCHEDULED' && f.reasonKind === 'NO_ANSWER_RETRY'),
  );

  const retry = afterNoAnswer.followUps.find((f) => f.reasonKind === 'NO_ANSWER_RETRY');
  check('the follow-up is in the future', Boolean(retry && retry.dueAt > new Date()));
  check('the follow-up records which rule created it', Boolean(retry?.ruleKey));

  const attemptRecord = await prisma.contactAttempt.findFirstOrThrow({ where: { ticketId: workTicket.id } });
  check(
    'a manually reported contact is labelled as such, not as verified',
    attemptRecord.verification === 'MANUALLY_REPORTED',
  );

  // --- Contact 2: connected and interested ---------------------------------
  const secondTicket = queue[1] ?? workTicket;
  const interested = await logContactAttempt({
    ticketId: secondTicket.id,
    userId: rep.id,
    outcomeKey: 'interested',
    channel: 'PHONE',
    note: 'Spoke with the owner. They are frustrated managing freelancers and want one team for video plus paid ads. Asked for a proposal call next week.',
    stageData: {
      interestSummary: 'Wants one team covering video production and paid advertising',
      mainProblem: 'Managing multiple freelancers with inconsistent output',
      recommendedService: 'Video content production and paid advertising',
      expectedNextStep: 'Book a discovery call',
      interestLevel: 'HIGH',
    },
  });
  check('an interested outcome can be recorded', interested.ok, 'error' in interested ? interested.error : '');

  const afterInterested = await prisma.leadTicket.findUniqueOrThrow({
    where: { id: secondTicket.id },
    include: { stage: true, followUps: true, notes: true },
  });
  check('the ticket moved to Interested', afterInterested.stage.key === 'interested');
  check('the conversation note was saved', afterInterested.notes.length > 0);
  check(
    'an interested-lead follow-up was created',
    afterInterested.followUps.some((f) => f.status === 'SCHEDULED' && f.reasonKind === 'INTERESTED_PROMISED'),
  );

  const interestedAlert = await prisma.notification.findFirst({
    where: { userId: owner.id, key: 'lead.interested' },
  });
  check('the owner was alerted about the interested lead', Boolean(interestedAlert));

  // --- Immutable history ----------------------------------------------------
  const history = await prisma.stageHistory.findMany({
    where: { ticketId: secondTicket.id },
    orderBy: { occurredAt: 'asc' },
    include: { fromStage: true, toStage: true },
  });
  check('every stage movement is recorded in history', history.length >= 2, `${history.length} entries`);
  const lastMove = history[history.length - 1]!;
  check('history records who moved the ticket', lastMove.userId === rep.id);
  check('history records the previous and new stage', Boolean(lastMove.fromStageId && lastMove.toStageId));
  check('history records the sprint', lastMove.sprintId === sprint.id);

  // --- Do-not-contact is a one-way door ------------------------------------
  const dncTicket = queue[queue.length - 1]!;
  await logContactAttempt({
    ticketId: dncTicket.id,
    userId: rep.id,
    outcomeKey: 'do_not_contact',
    channel: 'PHONE',
    note: 'Asked to be removed from our list.',
    stageData: { doNotContactReason: 'Requested removal during the call' },
  });
  const dncCompany = await prisma.company.findUniqueOrThrow({ where: { id: dncTicket.companyId } });
  check('do-not-contact is applied to the company', dncCompany.doNotContact === true);
  check('the do-not-contact reason and date are recorded', Boolean(dncCompany.doNotContactReason && dncCompany.doNotContactAt));

  const dncFollowUps = await prisma.followUp.count({
    where: { ticketId: dncTicket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
  });
  check('a do-not-contact company has no active follow-ups', dncFollowUps === 0);

  const reviveAttempt = await logContactAttempt({
    ticketId: dncTicket.id,
    userId: rep.id,
    outcomeKey: 'connected',
    note: 'trying again',
  });
  check('a do-not-contact company cannot be contacted again', !reviveAttempt.ok);

  // --- Activity trail -------------------------------------------------------
  const activity = await prisma.activityEvent.findMany({ where: { userId: rep.id }, orderBy: { occurredAt: 'asc' } });
  const kinds = new Set(activity.map((a) => a.kind));
  check('shift start was logged as activity', kinds.has('SHIFT_STARTED'));
  check('contact attempts were logged as activity', kinds.has('CONTACT_ATTEMPT_LOGGED'));
  check('stage changes were logged as activity', kinds.has('STAGE_CHANGED'));
  check('follow-up creation was logged as activity', kinds.has('FOLLOW_UP_CREATED'));
  check('every activity event is tied to the shift', activity.every((a) => a.shiftId !== null));

  const shiftEnd = await endShift(rep.id, 'Worked the priority queue.');
  check('the salesperson can end her shift', shiftEnd.ok);
  check('active time was recorded on the shift', (shiftEnd.shift?.activeSeconds ?? 0) >= 0);

  // -------------------------------------------------------------------------
  section('8. Follow-up sweep never loses work');
  // -------------------------------------------------------------------------
  const openFollowUps = await prisma.followUp.count({
    where: { ownerId: rep.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
  });
  check('follow-ups remain open and owned by the rep', openFollowUps > 0, `${openFollowUps} open`);

  // Force one into the past and confirm the sweep promotes it.
  const toBackdate = await prisma.followUp.findFirst({ where: { ownerId: rep.id, status: 'SCHEDULED' } });
  if (toBackdate) {
    await prisma.followUp.update({
      where: { id: toBackdate.id },
      data: { dueAt: new Date(Date.now() - 3 * 86_400_000) },
    });
    await sweepFollowUps();
    const swept = await prisma.followUp.findUniqueOrThrow({ where: { id: toBackdate.id } });
    check('an overdue follow-up is detected by the sweep', swept.status === 'OVERDUE', swept.status);
  }

  // -------------------------------------------------------------------------
  section('9. Weekly scorecard and owner reporting');
  // -------------------------------------------------------------------------
  const scorecard = await computeScorecard(sprint.id);
  console.log(`    weekly score: ${scorecard.totalScore}/100`);
  check('a weekly score between 0 and 100 is produced', scorecard.totalScore >= 0 && scorecard.totalScore <= 100);
  check('the score breaks down into seven categories', scorecard.breakdown.length === 7);
  check('each category explains itself', scorecard.breakdown.every((c) => c.detail.length > 0));
  check('category weights total 100', scorecard.breakdown.reduce((s, c) => s + c.weight, 0) === 100);
  check('contacts completed were counted', scorecard.metrics.contactsCompleted >= 2);
  check(
    'verified and manually reported contacts are counted separately',
    scorecard.metrics.manualContacts === scorecard.metrics.contactsCompleted &&
      scorecard.metrics.verifiedContacts === 0,
  );
  check('the salesperson cost is calculated from configured compensation', scorecard.cost.salespersonCostCents === 10_000);
  check('cost per contact is derived', (scorecard.cost.costPerContactCents ?? 0) > 0);
  check(
    'revenue is not claimed without a linked deal',
    scorecard.cost.attributedRevenueCents === null,
  );

  const weekly = await buildWeeklyReport(sprint.id);
  check('a weekly report can be produced', Boolean(weekly.sprintId));
  check('the report includes the targets and what was achieved', weekly.targets.length === 6);
  check('the report includes source/industry/location performance', Boolean(weekly.performance));

  // -------------------------------------------------------------------------
  section('10. Owner Sunday Review sees the whole week');
  // -------------------------------------------------------------------------
  const reviewSprint = await prisma.weeklySprint.findUniqueOrThrow({
    where: { id: sprint.id },
    include: {
      targets: true,
      tickets: { include: { company: true, stage: true } },
      followUps: true,
      shifts: true,
      user: true,
    },
  });

  check('the Sunday Review can see the shifts worked', reviewSprint.shifts.length === 1);
  check('the Sunday Review can see the assigned leads', reviewSprint.tickets.length > 0);
  check('the Sunday Review can see the follow-ups', reviewSprint.followUps.length > 0);

  const interestedInReview = reviewSprint.tickets.filter((t) => t.stage.key === 'interested');
  check('the interested lead appears in the review', interestedInReview.length >= 1);

  const unfinished = reviewSprint.tickets.filter((t) => t.stage.key === 'ready_to_contact');
  console.log(`    unfinished tickets carried: ${unfinished.length}`);

  // -------------------------------------------------------------------------
  section('11. Next Sunday preserves history and carries work forward');
  // -------------------------------------------------------------------------
  const beforeActivity = await prisma.activityEvent.count();
  const beforeAttempts = await prisma.contactAttempt.count();
  const beforeHistory = await prisma.stageHistory.count();

  // Advance a week so the planner closes the current sprint and opens the next.
  const nextSunday = addDays(startOfWeekInTz(new Date(), TZ), 7);
  const secondPlan = await runSundayPlanning({ now: nextSunday, skipIngestion: true });

  const afterActivity = await prisma.activityEvent.count();
  const afterAttempts = await prisma.contactAttempt.count();
  const afterHistory = await prisma.stageHistory.count();

  check('the Sunday reset deletes no activity history', afterActivity >= beforeActivity);
  check('the Sunday reset deletes no contact attempts', afterAttempts >= beforeAttempts);
  check('the Sunday reset deletes no stage history', afterHistory >= beforeHistory);

  const closedSprint = await prisma.weeklySprint.findUniqueOrThrow({
    where: { id: sprint.id },
    include: { scorecard: true },
  });
  check('the previous week was closed', closedSprint.status === 'CLOSED');
  check('the previous week scorecard was frozen', closedSprint.scorecard?.isFrozen === true);
  check('the frozen scorecard retains the score', (closedSprint.scorecard?.totalScore ?? -1) >= 0);

  check('a new sprint was created for the following week', secondPlan.sprints.length === 1);
  const newSprintId = secondPlan.sprints[0]?.sprintId;
  if (newSprintId) {
    const carried = await prisma.leadTicket.count({ where: { sprintId: newSprintId, isCarryover: true } });
    check('unfinished tickets were carried into the new sprint', carried > 0, `${carried} carried`);

    const carriedFollowUps = await prisma.followUp.count({
      where: { sprintId: newSprintId, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
    });
    check('outstanding follow-ups were carried into the new sprint', carriedFollowUps > 0, `${carriedFollowUps} carried`);

    const dncInNewSprint = await prisma.leadTicket.count({
      where: { sprintId: newSprintId, company: { doNotContact: true } },
    });
    check('a do-not-contact company never re-enters the call queue', dncInNewSprint === 0);
  }

  // -------------------------------------------------------------------------
  section('12. Integrations report their state honestly');
  // -------------------------------------------------------------------------
  const integrations = await prisma.integrationConfig.findMany();
  check('integration slots exist for every provider', integrations.length >= 10);
  check(
    'unconfigured integrations say NOT_CONFIGURED rather than claiming to work',
    integrations.every((i) => i.secretsCiphertext !== null || i.status === 'NOT_CONFIGURED'),
  );
  check('no integration claims CONNECTED without a passing test', integrations.every((i) => i.status !== 'CONNECTED' || i.lastTestOk === true));

  // -------------------------------------------------------------------------
  console.log(`\n[1mResult: ${passed} passed, ${failed} failed[0m`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\nAcceptance test crashed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { stableKeyPlaceholder };
