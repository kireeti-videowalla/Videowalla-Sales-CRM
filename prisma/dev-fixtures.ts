/**
 * DEVELOPMENT FIXTURES — clearly labelled fake data.
 *
 * This exists so a developer can see populated screens without waiting for a
 * real Sunday run. It is NOT sample data for production: every company it
 * creates uses a reserved `.example` domain, is named with a "[DEV]" prefix,
 * and can be removed again with `--clean`.
 *
 * It refuses to run when NODE_ENV=production.
 *
 * Usage:
 *   npm run seed:dev-fixtures
 *   npm run seed:dev-fixtures -- --clean
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env', quiet: true });

import { PrismaClient } from '@prisma/client';
import { parseEmail, type RawEmail } from '../src/lib/ingestion/email-parser';
import { recordSource } from '../src/lib/ingestion/ingest';
import { processSourceRecord } from '../src/lib/pipeline/process';

const prisma = new PrismaClient();

const DEV_DOMAIN_SUFFIX = '.example';
const DEV_PREFIX = '[DEV]';

/** Fabricated alert emails standing in for a week of real Gmail ingestion. */
const FIXTURE_EMAILS: RawEmail[] = [
  {
    messageId: 'devfixture-alert-1',
    subject: 'Google Alert - videographer Toronto',
    from: 'googlealerts-noreply@google.com',
    receivedAt: new Date(Date.now() - 3 * 86_400_000),
    textBody: '',
    htmlBody: `
      <a href="https://devfixture-harborline.example/careers/videographer">
        Videographer - ${DEV_PREFIX} Harborline Custom Homes Inc. - Toronto, ON
      </a>
      <p>Harborline Custom Homes is hiring an in-house videographer to film builds,
         run Instagram and produce short-form content. Toronto, ON. Full-time,
         $58,000-$68,000. Contact (416) 555-0110.</p>
      <a href="https://devfixture-pinegrove.example/jobs/social-media-manager">
        Social Media Manager - ${DEV_PREFIX} Pinegrove Renovations Ltd - Mississauga, ON
      </a>
      <p>Pinegrove Renovations seeks a social media manager to own content strategy
         and paid advertising. Mississauga, ON. Call (905) 555-0121.</p>`,
  },
  {
    messageId: 'devfixture-alert-2',
    subject: 'New jobs for media buyer',
    from: 'alert@indeed.com',
    receivedAt: new Date(Date.now() - 2 * 86_400_000),
    textBody: '',
    htmlBody: `
      <a href="https://ca.indeed.com/viewjob?jk=devfixture11223344">Media Buyer</a>
      <p>${DEV_PREFIX} Clearview HVAC Services — Burlington, ON<br>2 days ago<br>
      We need a media buyer to manage our Google and Meta ad spend and report on
      return. Phone (905) 555-0132.</p>`,
  },
  {
    messageId: 'devfixture-alert-3',
    subject: 'Fwd: this dental group might need us',
    from: 'kireeti@videowalla.co',
    receivedAt: new Date(Date.now() - 1 * 86_400_000),
    textBody: `Worth a call — ${DEV_PREFIX} Rosewood Dental Group in Oakville is advertising
for a content creator to run their social media and film patient stories.
https://devfixture-rosewood.example/careers/content-creator
Their office number is (905) 555-0143.`,
    htmlBody: null,
  },
];

async function clean(): Promise<number> {
  const companies = await prisma.company.findMany({
    where: { OR: [{ name: { startsWith: DEV_PREFIX } }, { websiteDomain: { contains: 'devfixture-' } }] },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id);
  if (ids.length === 0) return 0;

  await prisma.leadTicket.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.opportunity.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.jobPosting.deleteMany({ where: { companyId: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
  await prisma.sourceRecord.deleteMany({
    where: { rawPayload: { path: ['messageId'], string_starts_with: 'devfixture-' } },
  });
  return ids.length;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development fixtures must never be loaded into production.');
  }

  if (process.argv.includes('--clean')) {
    const removed = await clean();
    console.log(`Removed ${removed} development fixture companies and their tickets.`);
    return;
  }

  const stageCount = await prisma.pipelineStage.count();
  if (stageCount === 0) {
    throw new Error('Configuration is not seeded. Run `npm run seed` first.');
  }

  console.log('Loading DEVELOPMENT FIXTURES (clearly labelled fake data)…');
  console.log(`Every company created is prefixed "${DEV_PREFIX}" and uses a reserved ${DEV_DOMAIN_SUFFIX} domain.\n`);

  await clean();

  let created = 0;
  for (const email of FIXTURE_EMAILS) {
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
      if (!record.isNew) continue;

      const outcome = await processSourceRecord(record.id);
      if (outcome.ticketId) created += 1;
      console.log(`  ${outcome.status.padEnd(14)} score ${outcome.score ?? '—'}`);
    }
  }

  console.log(`\n${created} development lead tickets created.`);
  console.log('Run `npm run seed:dev-fixtures -- --clean` to remove them again.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
