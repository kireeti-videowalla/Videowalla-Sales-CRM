/**
 * Regression test for the product's hardest guarantee:
 *
 *   "Never silently lose a follow-up."
 *
 * The failure this pins down: a second unanswered call on a lead that is
 * already sitting in "Contacted – No Answer". Because the ticket does not
 * change stage, an early return used to skip the retry automation and the lead
 * fell out of the queue with nothing chasing it.
 *
 * Runs against a real database using the production code paths.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env', quiet: true });

import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/crypto';
import { logContactAttempt } from '../src/lib/pipeline/contact-attempts';
import { setSetting } from '../src/lib/settings/service';
import { stableKey, ticketReference } from '../src/lib/normalize';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  [31m✗[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const MARKER = 'followup-continuity';

async function cleanup(): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { websiteDomain: `${MARKER}.example` },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id);
  if (ids.length) {
    await prisma.leadTicket.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.opportunity.deleteMany({ where: { companyId: { in: ids } } });
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.user.deleteMany({ where: { email: `${MARKER}@videowalla.test` } });
}

async function main(): Promise<void> {
  console.log('[1mFollow-up continuity regression test[0m');
  await cleanup();
  await setSetting('ai.config', { provider: 'rules' });

  const rep = await prisma.user.create({
    data: {
      email: `${MARKER}@videowalla.test`,
      name: 'Continuity Rep',
      role: 'SALES_REP',
      status: 'ACTIVE',
      passwordHash: await hashPassword('ContinuityTest123'),
    },
  });

  const company = await prisma.company.create({
    data: {
      name: 'Continuity Roofing Ltd',
      normalizedName: 'continuity roofing',
      websiteDomain: `${MARKER}.example`,
      websiteUrl: `https://${MARKER}.example`,
      city: 'Hamilton',
      province: 'ON',
      phone: '+19055550199',
      normalizedPhone: '+19055550199',
    },
  });

  const opportunity = await prisma.opportunity.create({
    data: {
      companyId: company.id,
      kind: 'HIRING_INTENT',
      dedupeKey: stableKey(MARKER, company.id),
      headline: 'Continuity Roofing is hiring a content creator',
      status: 'QUALIFIED',
    },
  });

  const readyStage = await prisma.pipelineStage.findUniqueOrThrow({ where: { key: 'ready_to_contact' } });
  const ticket = await prisma.leadTicket.create({
    data: {
      reference: ticketReference(`${MARKER}:${opportunity.id}`),
      companyId: company.id,
      opportunityId: opportunity.id,
      stageId: readyStage.id,
      assigneeId: rep.id,
      score: 72,
      band: 'QUALIFIED_LEAD',
    },
  });

  const openFollowUps = () =>
    prisma.followUp.count({
      where: { ticketId: ticket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
    });

  // ---- Attempt 1: Ready to Contact -> Contacted – No Answer --------------
  const first = await logContactAttempt({
    ticketId: ticket.id,
    userId: rep.id,
    outcomeKey: 'no_answer',
    channel: 'PHONE',
  });
  check('first no-answer is recorded', first.ok, 'error' in first ? first.error : '');
  check('an open follow-up exists after attempt 1', (await openFollowUps()) === 1);

  const afterFirst = await prisma.leadTicket.findUniqueOrThrow({
    where: { id: ticket.id },
    include: { stage: true },
  });
  check('ticket moved to Contacted – No Answer', afterFirst.stage.key === 'contacted_no_answer');

  // ---- Attempt 2: already in that stage — the regression ----------------
  const second = await logContactAttempt({
    ticketId: ticket.id,
    userId: rep.id,
    outcomeKey: 'no_answer',
    channel: 'PHONE',
  });
  check('second no-answer is recorded', second.ok, 'error' in second ? second.error : '');

  const afterSecond = await prisma.leadTicket.findUniqueOrThrow({ where: { id: ticket.id } });
  check('attempt counter reached 2', afterSecond.attemptCount === 2, String(afterSecond.attemptCount));

  // This is the assertion that used to fail.
  check(
    'the lead still has an open follow-up after a repeat same-stage outcome',
    (await openFollowUps()) === 1,
    'the lead would otherwise sit in the pipeline with nothing chasing it',
  );

  const retry = await prisma.followUp.findFirst({
    where: { ticketId: ticket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
  });
  check('the new follow-up used the attempt-2 rule', retry?.ruleKey === 'no_answer_attempt_2', String(retry?.ruleKey));
  check('the ticket points at the new follow-up date', afterSecond.nextFollowUpAt !== null);

  // ---- Attempt 3: long-term retry ---------------------------------------
  const third = await logContactAttempt({
    ticketId: ticket.id,
    userId: rep.id,
    outcomeKey: 'no_answer',
    channel: 'PHONE',
  });
  check('third no-answer is recorded', third.ok);
  const longTerm = await prisma.followUp.findFirst({
    where: { ticketId: ticket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
  });
  check(
    'the third attempt moves to a long-term follow-up',
    longTerm?.reasonKind === 'LONG_TERM_RETRY',
    String(longTerm?.reasonKind),
  );
  check('there is still exactly one open follow-up', (await openFollowUps()) === 1);

  // Superseded follow-ups are retained, never deleted.
  const allFollowUps = await prisma.followUp.count({ where: { ticketId: ticket.id } });
  check('every earlier follow-up is retained for history', allFollowUps >= 3, `${allFollowUps} total`);

  // ---- No duplicate stage history for a non-move ------------------------
  const history = await prisma.stageHistory.count({ where: { ticketId: ticket.id } });
  check(
    'a repeat outcome does not fabricate a stage-change entry',
    history === 1,
    `${history} stage history rows (expected 1: ready -> no answer)`,
  );

  const attempts = await prisma.contactAttempt.count({ where: { ticketId: ticket.id } });
  check('all three attempts are recorded individually', attempts === 3, `${attempts} attempts`);

  await cleanup();

  console.log(`\n[1mResult: ${passed} passed, ${failed} failed[0m`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('\nTest crashed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
