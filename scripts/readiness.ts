/**
 * Go-live readiness check.
 *
 *   npm run check
 *
 * Answers one question honestly: is this system ready for the salesperson to
 * start work on Monday, and if not, exactly what is missing?
 *
 * Read-only. It changes nothing.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env', quiet: true });

import { PrismaClient } from '@prisma/client';
import { startOfWeekInTz, endOfWeekInTz, formatInTz, DEFAULT_TIMEZONE } from '../src/lib/time';

const prisma = new PrismaClient();

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

type Level = 'ok' | 'warn' | 'blocker';

const results: Array<{ level: Level; label: string; detail: string; fix?: string }> = [];

function record(level: Level, label: string, detail: string, fix?: string): void {
  results.push({ level, label, detail, fix });
}

function section(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function report(level: Level, label: string, detail: string): void {
  const icon = level === 'ok' ? `${GREEN}✓${RESET}` : level === 'warn' ? `${YELLOW}!${RESET}` : `${RED}✗${RESET}`;
  console.log(`  ${icon} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
}

function check(level: Level, label: string, detail: string, fix?: string): void {
  record(level, label, detail, fix);
  report(level, label, detail);
}

async function main(): Promise<void> {
  console.log(`${BOLD}Videowalla Sales Command Center — go-live readiness${RESET}`);
  console.log(`${DIM}${new Date().toISOString()}${RESET}`);

  // ---- 1. Foundations -----------------------------------------------------
  section('1. Foundations');

  try {
    await prisma.$queryRaw`SELECT 1`;
    check('ok', 'Database reachable', '');
  } catch {
    check('blocker', 'Database unreachable', '', 'Check DATABASE_URL and that PostgreSQL is running.');
    finish();
    return;
  }

  const sessionSecret = process.env.SESSION_SECRET ?? '';
  check(
    sessionSecret.length >= 32 ? 'ok' : 'blocker',
    'SESSION_SECRET set',
    sessionSecret.length >= 32 ? '' : 'must be 32+ characters',
    'Generate with: openssl rand -base64 48',
  );

  const encKey = process.env.ENCRYPTION_KEY ?? '';
  check(
    /^[0-9a-fA-F]{64}$/.test(encKey) ? 'ok' : 'blocker',
    'ENCRYPTION_KEY set',
    /^[0-9a-fA-F]{64}$/.test(encKey) ? '' : 'must be exactly 64 hex characters',
    'Generate with: openssl rand -hex 32',
  );

  const appUrl = process.env.APP_URL ?? '';
  check(
    appUrl.startsWith('https://') ? 'ok' : appUrl ? 'warn' : 'blocker',
    'APP_URL set',
    appUrl || 'not set',
    appUrl.startsWith('http://localhost')
      ? 'Fine for local testing. Set the real https:// URL before the salesperson uses it.'
      : 'Set the public URL this app is served from.',
  );

  const stages = await prisma.pipelineStage.count();
  const keywords = await prisma.keyword.count({ where: { isActive: true } });
  const profile = await prisma.scoringProfile.findFirst({ where: { isActive: true } });
  const configured = stages > 0 && keywords > 0 && profile !== null;
  check(
    configured ? 'ok' : 'blocker',
    'Default configuration installed',
    configured ? `${stages} stages, ${keywords} keywords, scoring profile active` : 'missing',
    'Run: npm run seed',
  );

  // ---- 2. People ----------------------------------------------------------
  section('2. People');

  const owners = await prisma.user.count({ where: { role: 'OWNER', status: 'ACTIVE' } });
  check(
    owners > 0 ? 'ok' : 'blocker',
    'Owner account exists',
    owners > 0 ? `${owners} active` : 'none',
    'Run: npm run bootstrap:owner',
  );

  const reps = await prisma.user.findMany({
    where: { role: 'SALES_REP' },
    include: {
      workSchedules: { where: { effectiveTo: null }, take: 1 },
      compensations: { where: { effectiveTo: null }, take: 1 },
    },
  });
  const activeReps = reps.filter((r) => r.status === 'ACTIVE');
  const invitedReps = reps.filter((r) => r.status === 'INVITED');

  check(
    activeReps.length > 0 ? 'ok' : invitedReps.length > 0 ? 'warn' : 'blocker',
    'Salesperson account',
    activeReps.length > 0
      ? `${activeReps.map((r) => r.name).join(', ')}`
      : invitedReps.length > 0
        ? `${invitedReps.length} invited but has not signed in yet`
        : 'none',
    'Invite her from Settings → Team and send her the link the page shows you.',
  );

  for (const rep of activeReps) {
    const schedule = rep.workSchedules[0];
    const planned = (schedule?.plannedShifts as Array<{ weekday: number; hours: number }>) ?? [];
    check(
      schedule && planned.length > 0 ? 'ok' : 'blocker',
      `${rep.name}: working schedule`,
      schedule
        ? `${schedule.weeklyHours}h across ${planned.length} day${planned.length === 1 ? '' : 's'}`
        : 'not set',
      'Settings → Team → set her weekly hours and planned shifts.',
    );

    const comp = rep.compensations[0];
    check(
      comp ? 'ok' : 'warn',
      `${rep.name}: compensation`,
      comp ? `$${(comp.weeklyPayCents / 100).toFixed(2)} per working week` : 'not set',
      'Without it, every cost and ROI figure will read as zero.',
    );
  }

  // ---- 3. Automation ------------------------------------------------------
  section('3. Automation');

  const lastJob = await prisma.job.findFirst({
    where: { status: 'SUCCEEDED' },
    orderBy: { finishedAt: 'desc' },
  });
  const minutesSince = lastJob?.finishedAt
    ? Math.round((Date.now() - lastJob.finishedAt.getTime()) / 60_000)
    : null;
  check(
    minutesSince !== null && minutesSince < 60 ? 'ok' : 'blocker',
    'Background worker running',
    minutesSince === null
      ? 'no job has ever completed'
      : `last completed job was ${minutesSince} minutes ago`,
    'Start it with: npm run worker   (or point a scheduler at POST /api/cron/tick)',
  );

  const sunday = await prisma.scheduledJob.findUnique({ where: { key: 'sunday_planning' } });
  check(
    sunday?.isActive ? 'ok' : 'blocker',
    'Weekly planning scheduled',
    sunday
      ? `${sunday.cron} ${sunday.timezone}${sunday.nextRunAt ? ` — next ${formatInTz(sunday.nextRunAt, sunday.timezone)}` : ' — not yet scheduled'}`
      : 'missing',
    'Settings → Sprint & shifts.',
  );

  const deadJobs = await prisma.job.count({ where: { status: 'DEAD' } });
  check(
    deadJobs === 0 ? 'ok' : 'warn',
    'No failed background jobs',
    deadJobs === 0 ? '' : `${deadJobs} in the dead-letter queue`,
    'Settings → Automation to review and retry.',
  );

  // ---- 4. Lead supply -----------------------------------------------------
  section('4. Where leads come from');

  const integrations = await prisma.integrationConfig.findMany();
  const byKind = new Map(integrations.map((i) => [i.kind, i]));

  const gmail = byKind.get('GMAIL');
  check(
    gmail?.status === 'CONNECTED' ? 'ok' : gmail?.secretsCiphertext ? 'warn' : 'blocker',
    'Gmail connected (the main lead source)',
    gmail?.status === 'CONNECTED'
      ? 'connected and tested'
      : gmail?.secretsCiphertext
        ? 'credentials saved but the connection test has not passed'
        : 'not connected',
    'Settings → Integrations → authorise Gmail, then press Test connection.',
  );

  const ai = ['AI_ANTHROPIC', 'AI_OPENAI'].map((k) => byKind.get(k as never)).filter(Boolean);
  const aiReady = ai.some((i) => i!.status === 'CONNECTED');
  check(
    aiReady ? 'ok' : 'warn',
    'AI qualification',
    aiReady
      ? 'connected'
      : 'not connected — the offline rules engine will run instead, at lower confidence',
    'Optional. Without it more leads land in Review Required for you to approve by hand.',
  );

  const calendar = byKind.get('GOOGLE_CALENDAR');
  check(
    calendar?.status === 'CONNECTED' ? 'ok' : 'warn',
    'Google Calendar',
    calendar?.status === 'CONNECTED' ? 'connected and tested' : 'not connected',
    'Without it, meeting invitations are recorded but not actually sent.',
  );

  const places = byKind.get('GOOGLE_PLACES');
  check(
    places?.status === 'CONNECTED' ? 'ok' : 'warn',
    'Google Places (companies that are not hiring)',
    places?.status === 'CONNECTED' ? 'connected and tested' : 'not connected',
    'Without it, only hiring-intent and manually added leads are found.',
  );

  const activeSources = await prisma.leadSource.count({ where: { isActive: true } });
  const failingSources = await prisma.leadSource.findMany({
    where: { isActive: true, lastError: { not: null } },
    select: { key: true, lastError: true },
  });
  check(
    failingSources.length === 0 ? 'ok' : 'warn',
    'Lead sources healthy',
    failingSources.length === 0
      ? `${activeSources} active`
      : `${failingSources.length} of ${activeSources} reporting errors: ${failingSources.map((s) => s.key).join(', ')}`,
    'Settings → Discovery.',
  );

  // ---- 5. Is the week actually ready? ------------------------------------
  section("5. Is next week's work prepared?");

  const now = new Date();
  const weekStart = startOfWeekInTz(now, DEFAULT_TIMEZONE);
  const weekEnd = endOfWeekInTz(now, DEFAULT_TIMEZONE);

  const currentSprint = await prisma.weeklySprint.findFirst({
    where: { weekStart: { lte: now }, weekEnd: { gte: now } },
    include: { targets: true, user: { select: { name: true } }, _count: { select: { tickets: true } } },
  });
  const upcomingSprint = await prisma.weeklySprint.findFirst({
    where: { weekStart: { gt: now } },
    include: { targets: true, user: { select: { name: true } }, _count: { select: { tickets: true } } },
    orderBy: { weekStart: 'asc' },
  });

  const sprint = upcomingSprint ?? currentSprint;
  if (!sprint) {
    check(
      'blocker',
      'A weekly sprint exists',
      'none',
      'Sunday Review → Run planning now. Do not wait for Sunday for the first one.',
    );
  } else {
    const total = sprint.targets.find((t) => t.key === 'TOTAL_CONTACTS')?.target ?? 0;
    check(
      sprint.status === 'APPROVED' || sprint.status === 'ACTIVE' ? 'ok' : 'blocker',
      `Sprint ${sprint.label} for ${sprint.user.name}`,
      `${sprint.status.replace(/_/g, ' ').toLowerCase()} — ${total} contacts, ${sprint._count.tickets} leads assigned`,
      'Sunday Review → Approve next week. She cannot see her queue until it is approved.',
    );

    check(
      sprint.leadShortfall === 0 ? 'ok' : 'warn',
      'Enough qualified leads prepared',
      sprint.leadShortfall === 0 ? '' : `${sprint.leadShortfall} short of what the hours allow`,
      'Widen locations, industries or keywords in Settings → Discovery, then re-run planning.',
    );
  }

  const readyToCall = await prisma.leadTicket.count({
    where: { stage: { key: 'ready_to_contact' }, closedAt: null, company: { doNotContact: false } },
  });
  check(
    readyToCall > 0 ? 'ok' : 'blocker',
    'Leads waiting in the call queue',
    `${readyToCall} ready to contact`,
    'Sunday Review → Run planning now, then approve any leads sitting in Review Exceptions.',
  );

  const needsReview = await prisma.leadTicket.count({
    where: { stage: { key: 'review_required' }, closedAt: null },
  });
  if (needsReview > 0) {
    check(
      'warn',
      'Leads awaiting your review',
      `${needsReview} held back for a decision`,
      'Sunday Review → Review exceptions. Approving them puts them in her queue.',
    );
  }

  const withPhone = await prisma.leadTicket.count({
    where: {
      stage: { key: 'ready_to_contact' },
      closedAt: null,
      OR: [{ company: { normalizedPhone: { not: null } } }, { primaryContact: { normalizedPhone: { not: null } } }],
    },
  });
  if (readyToCall > 0) {
    const pct = Math.round((withPhone / readyToCall) * 100);
    check(
      pct >= 60 ? 'ok' : 'warn',
      'Queued leads have a phone number',
      `${withPhone} of ${readyToCall} (${pct}%)`,
      'She can still work the rest, but will have to find the number herself.',
    );
  }

  finish();
}

function finish(): void {
  const blockers = results.filter((r) => r.level === 'blocker');
  const warnings = results.filter((r) => r.level === 'warn');

  console.log(`\n${BOLD}${'─'.repeat(64)}${RESET}`);

  if (blockers.length === 0) {
    console.log(`${GREEN}${BOLD}READY.${RESET} Everything required for the salesperson to start is in place.`);
    if (warnings.length > 0) {
      console.log(`\n${YELLOW}${warnings.length} thing${warnings.length === 1 ? '' : 's'} would make it work better:${RESET}`);
      for (const w of warnings) console.log(`  • ${w.label} — ${w.fix ?? w.detail}`);
    }
  } else {
    console.log(`${RED}${BOLD}NOT READY.${RESET} ${blockers.length} thing${blockers.length === 1 ? '' : 's'} must be fixed first:\n`);
    blockers.forEach((b, i) => {
      console.log(`  ${BOLD}${i + 1}. ${b.label}${RESET}${b.detail ? ` — ${b.detail}` : ''}`);
      if (b.fix) console.log(`     ${DIM}${b.fix}${RESET}`);
    });
    if (warnings.length > 0) {
      console.log(`\n${YELLOW}Also worth doing:${RESET}`);
      for (const w of warnings) console.log(`  • ${w.label} — ${w.fix ?? w.detail}`);
    }
    process.exitCode = 1;
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error(`\n${RED}Readiness check failed:${RESET}`, err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
