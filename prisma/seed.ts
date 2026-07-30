/**
 * Idempotent configuration seed. Safe to re-run: it upserts defaults and never
 * overwrites owner customisations to `isActive`, `priority` or `weight`.
 *
 * This seeds CONFIGURATION ONLY. It creates no companies, leads or activity.
 */
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_FOLLOW_UP_RULES,
  DEFAULT_INDUSTRIES,
  DEFAULT_KEYWORD_GROUPS,
  DEFAULT_LEAD_SOURCES,
  DEFAULT_LOCATIONS,
  DEFAULT_OUTCOMES,
  DEFAULT_SCHEDULED_JOBS,
  DEFAULT_SCORE_THRESHOLDS,
  DEFAULT_SCORING_FACTORS,
  DEFAULT_STAGES,
} from './seed-data';

const prisma = new PrismaClient();

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function main() {
  console.log('Seeding Videowalla Sales Command Center configuration…');

  // --- Locations -----------------------------------------------------------
  for (const loc of DEFAULT_LOCATIONS) {
    await prisma.location.upsert({
      where: { slug: loc.slug },
      create: {
        name: loc.name,
        slug: loc.slug,
        kind: loc.kind,
        province: loc.province ?? null,
        latitude: loc.latitude ?? null,
        longitude: loc.longitude ?? null,
        radiusKm: loc.radiusKm,
        priority: loc.priority,
      },
      update: { name: loc.name, latitude: loc.latitude ?? null, longitude: loc.longitude ?? null },
    });
  }
  console.log(`  locations: ${DEFAULT_LOCATIONS.length}`);

  // --- Industries ----------------------------------------------------------
  for (const ind of DEFAULT_INDUSTRIES) {
    await prisma.industry.upsert({
      where: { slug: ind.slug },
      create: { name: ind.name, slug: ind.slug, priority: ind.priority, keywords: ind.keywords },
      update: { name: ind.name, keywords: ind.keywords },
    });
  }
  console.log(`  industries: ${DEFAULT_INDUSTRIES.length}`);

  // --- Keyword groups and keywords ----------------------------------------
  let keywordCount = 0;
  for (const group of DEFAULT_KEYWORD_GROUPS) {
    const g = await prisma.keywordGroup.upsert({
      where: { name: group.name },
      create: { name: group.name, priority: group.priority },
      update: {},
    });
    for (const kw of group.keywords) {
      await prisma.keyword.upsert({
        where: { normalizedTerm: normalizeTerm(kw.term) },
        create: {
          term: kw.term,
          normalizedTerm: normalizeTerm(kw.term),
          groupId: g.id,
          priority: kw.priority,
          scoreBoost: kw.scoreBoost,
        },
        update: { groupId: g.id },
      });
      keywordCount += 1;
    }
  }
  console.log(`  keywords: ${keywordCount}`);

  // --- Pipeline stages -----------------------------------------------------
  for (const stage of DEFAULT_STAGES) {
    await prisma.pipelineStage.upsert({
      where: { key: stage.key },
      create: {
        key: stage.key,
        name: stage.name,
        category: stage.category,
        position: stage.position,
        color: stage.color,
        isSystem: stage.isSystem,
        requiredFields: stage.requiredFields,
        automations: stage.automations,
        description: stage.description,
      },
      // Automations and required fields are behaviour, not preference: keep
      // them in sync with the code that implements them.
      update: {
        category: stage.category,
        isSystem: stage.isSystem,
        requiredFields: stage.requiredFields,
        automations: stage.automations,
        description: stage.description,
      },
    });
  }
  console.log(`  pipeline stages: ${DEFAULT_STAGES.length}`);

  // --- Contact outcomes ----------------------------------------------------
  for (const outcome of DEFAULT_OUTCOMES) {
    await prisma.contactOutcomeType.upsert({
      where: { key: outcome.key },
      create: outcome,
      update: {
        targetStageKey: outcome.targetStageKey,
        countsAsConversation: outcome.countsAsConversation,
        countsAsContact: outcome.countsAsContact,
        requiresNote: outcome.requiresNote,
        requiresFollowUp: outcome.requiresFollowUp,
      },
    });
  }
  console.log(`  contact outcomes: ${DEFAULT_OUTCOMES.length}`);

  // --- Scoring profile -----------------------------------------------------
  const profile = await prisma.scoringProfile.upsert({
    where: { name: 'Videowalla default' },
    create: {
      name: 'Videowalla default',
      isActive: true,
      description: 'Default 0-100 lead score. Every weight and threshold is editable.',
      thresholds: DEFAULT_SCORE_THRESHOLDS,
    },
    update: {},
  });
  for (const factor of DEFAULT_SCORING_FACTORS) {
    await prisma.scoringFactor.upsert({
      where: { profileId_key: { profileId: profile.id, key: factor.key } },
      create: { profileId: profile.id, ...factor },
      update: { label: factor.label, description: factor.description, position: factor.position },
    });
  }
  const totalWeight = DEFAULT_SCORING_FACTORS.reduce((s, f) => s + f.weight, 0);
  console.log(`  scoring factors: ${DEFAULT_SCORING_FACTORS.length} (total weight ${totalWeight})`);

  // --- Follow-up rules -----------------------------------------------------
  for (const rule of DEFAULT_FOLLOW_UP_RULES) {
    await prisma.followUpRule.upsert({
      where: { key: rule.key },
      create: rule,
      update: { label: rule.label, reasonKind: rule.reasonKind },
    });
  }
  console.log(`  follow-up rules: ${DEFAULT_FOLLOW_UP_RULES.length}`);

  // --- Lead sources --------------------------------------------------------
  for (const source of DEFAULT_LEAD_SOURCES) {
    await prisma.leadSource.upsert({
      where: { key: source.key },
      create: {
        key: source.key,
        name: source.name,
        kind: source.kind,
        priority: source.priority,
        isActive: source.isActive,
        config: source.config as object,
      },
      update: { name: source.name, kind: source.kind },
    });
  }
  console.log(`  lead sources: ${DEFAULT_LEAD_SOURCES.length}`);

  // --- Scheduled jobs ------------------------------------------------------
  for (const job of DEFAULT_SCHEDULED_JOBS) {
    await prisma.scheduledJob.upsert({
      where: { key: job.key },
      create: {
        key: job.key,
        name: job.name,
        jobName: job.jobName,
        cron: job.cron,
        timezone: job.timezone,
        payload: job.payload as object,
      },
      update: { name: job.name, jobName: job.jobName },
    });
  }
  console.log(`  scheduled jobs: ${DEFAULT_SCHEDULED_JOBS.length}`);

  // --- Integration placeholders -------------------------------------------
  const integrationKinds = [
    'GMAIL',
    'GOOGLE_CALENDAR',
    'GOOGLE_PLACES',
    'AI_ANTHROPIC',
    'AI_OPENAI',
    'ENRICHMENT_HTTP',
    'CALLING_TWILIO',
    'CALLING_GOHIGHLEVEL',
    'SMTP_EMAIL',
    'SLACK',
  ] as const;
  for (const kind of integrationKinds) {
    await prisma.integrationConfig.upsert({
      where: { kind },
      create: { kind, status: 'NOT_CONFIGURED', isEnabled: false },
      update: {},
    });
  }
  console.log(`  integration slots: ${integrationKinds.length}`);

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
