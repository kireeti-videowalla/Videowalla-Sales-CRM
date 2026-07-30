import type {
  Company,
  Contact,
  Industry,
  JobPosting,
  Location,
  ScoreBand,
  ScoringFactor,
} from '@prisma/client';
import { prisma } from '../db';
import { getSetting } from '../settings/service';
import { confidenceRank } from './dedupe';

/**
 * Configurable 0-100 lead score.
 *
 * Every factor records what it awarded and *why*, in plain language, so the
 * owner can always answer "why did this company get 72?" without reading code.
 */

export type ScoreFactorResult = {
  key: string;
  label: string;
  weight: number;
  awarded: number;
  reason: string;
  /** 0..1 — how much of this factor rests on verified rather than estimated data. */
  confidence: number;
};

export type ScoreResult = {
  score: number;
  band: ScoreBand;
  dataConfidence: number;
  breakdown: ScoreFactorResult[];
  explanation: string;
};

export type ScoreInput = {
  company: Company & { industry?: Industry | null; location?: Location | null };
  contacts: Contact[];
  jobPosting?: (JobPosting & { matchedKeywords: string[] }) | null;
  isHiring: boolean;
  serviceFit: number;
  /** Sum of scoreBoost across matched keywords, from the Keyword table. */
  keywordBoost: number;
  postingAgeDays: number | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function scoreLead(input: ScoreInput): Promise<ScoreResult> {
  const profile = await prisma.scoringProfile.findFirst({
    where: { isActive: true },
    include: { factors: { where: { isActive: true }, orderBy: { position: 'asc' } } },
  });
  if (!profile) throw new Error('No active scoring profile. Run `npm run seed`.');

  const icp = await getSetting('icp.criteria');
  const postingAge = await getSetting('discovery.postingAge');

  const locations = await prisma.location.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });
  const industries = await prisma.industry.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  const byKey = new Map(profile.factors.map((f) => [f.key, f]));
  const results: ScoreFactorResult[] = [];

  const evaluate = (
    key: string,
    fn: (factor: ScoringFactor) => { awarded: number; reason: string; confidence: number },
  ) => {
    const factor = byKey.get(key);
    if (!factor) return;
    const { awarded, reason, confidence } = fn(factor);
    results.push({
      key: factor.key,
      label: factor.label,
      weight: factor.weight,
      awarded: round(clamp(awarded, 0, factor.weight)),
      reason,
      confidence: clamp(confidence, 0, 1),
    });
  };

  // --- Location -------------------------------------------------------------
  evaluate('location_priority', (f) => {
    const company = input.company;
    const matched =
      company.locationId
        ? locations.find((l) => l.id === company.locationId)
        : locations.find(
            (l) =>
              company.city && l.name.toLowerCase() === company.city.toLowerCase(),
          );

    if (matched) {
      // Priority 10 (Toronto) → full marks; priority tapers to ~30% at the tail.
      const best = locations[0]?.priority ?? 10;
      const worst = locations[locations.length - 1]?.priority ?? 200;
      const span = Math.max(1, worst - best);
      const ratio = 1 - (matched.priority - best) / span;
      const awarded = f.weight * clamp(0.3 + 0.7 * ratio, 0.3, 1);
      return {
        awarded,
        reason: `In ${matched.name}, priority ${matched.priority} of ${locations.length} configured locations.`,
        confidence: 0.9,
      };
    }
    if (company.country && icp.countries.includes(company.country)) {
      return {
        awarded: f.weight * 0.35,
        reason: `In ${company.country} but not in a configured priority location.`,
        confidence: 0.6,
      };
    }
    return {
      awarded: 0,
      reason: company.country
        ? `Outside the target countries (${icp.countries.join(', ')}).`
        : 'Location unknown.',
      confidence: 0.2,
    };
  });

  // --- Company size ---------------------------------------------------------
  evaluate('company_size', (f) => {
    const min = input.company.employeeCountMin;
    const max = input.company.employeeCountMax ?? min;
    if (min == null) {
      return {
        awarded: f.weight * 0.4,
        reason: 'Employee count unknown — neutral partial credit rather than a penalty.',
        confidence: 0,
      };
    }
    const mid = (min + (max ?? min)) / 2;
    const conf = confidenceRank(input.company.employeeCountConfidence) / 4;
    if (mid >= icp.preferredMinEmployees && mid <= icp.preferredMaxEmployees) {
      return {
        awarded: f.weight * (0.7 + 0.3 * conf),
        reason: `Estimated ${min}-${max} employees, inside the preferred ${icp.preferredMinEmployees}-${icp.preferredMaxEmployees} range (${input.company.employeeCountConfidence.toLowerCase()} confidence).`,
        confidence: conf,
      };
    }
    if (mid >= icp.minEmployees && mid <= icp.maxEmployees) {
      return {
        awarded: f.weight * (0.5 + 0.2 * conf),
        reason: `Estimated ${min}-${max} employees, inside the acceptable ${icp.minEmployees}-${icp.maxEmployees} range.`,
        confidence: conf,
      };
    }
    return {
      awarded: 0,
      reason: `Estimated ${min}-${max} employees, outside the ${icp.minEmployees}-${icp.maxEmployees} range.`,
      confidence: conf,
    };
  });

  // --- Revenue --------------------------------------------------------------
  evaluate('revenue_estimate', (f) => {
    const min = input.company.revenueMinCents ? Number(input.company.revenueMinCents) : null;
    if (min == null) {
      // Explicitly do NOT reject a strong company for missing revenue data.
      return {
        awarded: f.weight * 0.4,
        reason: 'Revenue not available — neutral partial credit, verify on the call.',
        confidence: 0,
      };
    }
    const conf = confidenceRank(input.company.revenueConfidence) / 4;
    const dollars = min / 100;
    if (min >= icp.preferredRevenueCents) {
      return {
        awarded: f.weight * (0.75 + 0.25 * conf),
        reason: `Estimated revenue $${dollars.toLocaleString('en-CA')}+ meets the preferred threshold (${input.company.revenueConfidence.toLowerCase()} confidence).`,
        confidence: conf,
      };
    }
    if (min >= icp.minRevenueCents) {
      return {
        awarded: f.weight * (0.55 + 0.2 * conf),
        reason: `Estimated revenue $${dollars.toLocaleString('en-CA')} meets the minimum threshold.`,
        confidence: conf,
      };
    }
    return {
      awarded: f.weight * 0.15,
      reason: `Estimated revenue $${dollars.toLocaleString('en-CA')} is below the $${(icp.minRevenueCents / 100).toLocaleString('en-CA')} minimum.`,
      confidence: conf,
    };
  });

  // --- Hiring signal --------------------------------------------------------
  evaluate('actively_hiring', (f) => {
    if (!input.isHiring) {
      return { awarded: 0, reason: 'Not currently known to be hiring — cold outbound.', confidence: 0.5 };
    }
    return {
      awarded: f.weight,
      reason: input.jobPosting?.title
        ? `Actively hiring: ${input.jobPosting.title}.`
        : 'Actively hiring for a marketing or content role.',
      confidence: 0.9,
    };
  });

  evaluate('hiring_role_fit', (f) => {
    const matched = input.jobPosting?.matchedKeywords ?? [];
    if (matched.length === 0) {
      return {
        awarded: input.isHiring ? f.weight * 0.25 : 0,
        reason: input.isHiring
          ? 'Hiring, but the role does not match a configured Videowalla keyword.'
          : 'No hiring role to match.',
        confidence: 0.5,
      };
    }
    // keywordBoost is the sum of configured per-keyword boosts; 12 is the
    // effective ceiling (two top-priority keywords).
    const ratio = clamp(input.keywordBoost / 12, 0.4, 1);
    return {
      awarded: f.weight * ratio,
      reason: `Matched ${matched.length} Videowalla keyword${matched.length === 1 ? '' : 's'}: ${matched.join(', ')}.`,
      confidence: 0.85,
    };
  });

  // --- Industry -------------------------------------------------------------
  evaluate('priority_industry', (f) => {
    const industry =
      input.company.industry ??
      industries.find((i) => i.slug === input.company.industryLabel?.toLowerCase());
    if (!industry) {
      return {
        awarded: f.weight * 0.3,
        reason: input.company.industryLabel
          ? `Industry "${input.company.industryLabel}" is not one of the configured priorities.`
          : 'Industry not identified.',
        confidence: 0.3,
      };
    }
    const best = industries[0]?.priority ?? 10;
    const worst = industries[industries.length - 1]?.priority ?? 200;
    const ratio = 1 - (industry.priority - best) / Math.max(1, worst - best);
    return {
      awarded: f.weight * clamp(0.4 + 0.6 * ratio, 0.4, 1),
      reason: `${industry.name} — priority ${industry.priority} of ${industries.length} configured industries.`,
      confidence: 0.8,
    };
  });

  // --- Recency --------------------------------------------------------------
  evaluate('posting_recency', (f) => {
    const age = input.postingAgeDays;
    if (age == null) {
      return {
        awarded: input.isHiring ? f.weight * 0.3 : 0,
        reason: 'Posting date unknown.',
        confidence: 0.2,
      };
    }
    if (age <= postingAge.highPriorityDays) {
      return { awarded: f.weight, reason: `Posted ${age} day${age === 1 ? '' : 's'} ago — high priority window.`, confidence: 0.9 };
    }
    if (age <= postingAge.mediumPriorityDays) {
      return { awarded: f.weight * 0.7, reason: `Posted ${age} days ago — medium priority window.`, confidence: 0.9 };
    }
    if (age <= postingAge.lowPriorityDays) {
      return { awarded: f.weight * 0.35, reason: `Posted ${age} days ago — lower priority window.`, confidence: 0.9 };
    }
    return { awarded: 0, reason: `Posted ${age} days ago — beyond the ${postingAge.lowPriorityDays}-day window.`, confidence: 0.9 };
  });

  // --- Reachability ---------------------------------------------------------
  const decisionMaker = input.contacts.find((c) =>
    ['OWNER', 'FOUNDER', 'PRESIDENT', 'CEO'].includes(c.roleKind),
  );
  const marketingContact = input.contacts.find((c) =>
    ['MARKETING_DECISION_MAKER', 'MARKETING_MANAGER'].includes(c.roleKind),
  );

  evaluate('decision_maker', (f) => {
    if (decisionMaker) {
      return {
        awarded: f.weight,
        reason: `${decisionMaker.fullName}${decisionMaker.title ? ` (${decisionMaker.title})` : ''} identified as owner or founder.`,
        confidence: confidenceRank(decisionMaker.confidence) / 4,
      };
    }
    if (marketingContact) {
      return {
        awarded: f.weight * 0.6,
        reason: `${marketingContact.fullName} identified as a marketing decision-maker.`,
        confidence: confidenceRank(marketingContact.confidence) / 4,
      };
    }
    return { awarded: 0, reason: 'No decision-maker identified yet.', confidence: 0 };
  });

  evaluate('phone_available', (f) => {
    const withPhone = input.contacts.find((c) => c.normalizedPhone);
    const phone = withPhone?.normalizedPhone ?? input.company.normalizedPhone;
    if (!phone) return { awarded: 0, reason: 'No phone number found.', confidence: 0 };
    const verified = withPhone?.phoneStatus === 'VERIFIED';
    return {
      awarded: verified ? f.weight : f.weight * 0.7,
      reason: verified
        ? 'Verified phone number available.'
        : 'Phone number available but unverified.',
      confidence: verified ? 1 : 0.5,
    };
  });

  evaluate('email_available', (f) => {
    const withEmail = input.contacts.find((c) => c.email);
    const email = withEmail?.email ?? input.company.email;
    if (!email) return { awarded: 0, reason: 'No email address found.', confidence: 0 };
    const verified = withEmail?.emailStatus === 'VERIFIED';
    return {
      awarded: verified ? f.weight : f.weight * 0.7,
      reason: verified ? 'Verified email available.' : 'Email available but unverified.',
      confidence: verified ? 1 : 0.5,
    };
  });

  evaluate('web_presence', (f) => {
    const hasSite = Boolean(input.company.websiteUrl);
    const socials = [input.company.linkedinUrl, input.company.instagramUrl, input.company.facebookUrl].filter(Boolean).length;
    if (!hasSite && socials === 0) {
      return { awarded: 0, reason: 'No website or social presence found.', confidence: 0.4 };
    }
    const awarded = (hasSite ? f.weight * 0.7 : 0) + Math.min(f.weight * 0.3, socials * f.weight * 0.15);
    return {
      awarded,
      reason: `${hasSite ? 'Active website' : 'No website'}${socials ? `, ${socials} social profile${socials === 1 ? '' : 's'}` : ''}.`,
      confidence: 0.8,
    };
  });

  evaluate('service_fit', (f) => ({
    awarded: f.weight * clamp(input.serviceFit, 0, 1),
    reason: `Service fit assessed at ${Math.round(input.serviceFit * 100)}%.`,
    confidence: 0.6,
  }));

  // --- Totals ---------------------------------------------------------------
  const totalWeight = results.reduce((s, r) => s + r.weight, 0) || 1;
  const rawScore = results.reduce((s, r) => s + r.awarded, 0);
  // Normalise so a customised profile whose weights do not total 100 still
  // produces a 0-100 score.
  const score = Math.round(clamp((rawScore / totalWeight) * 100, 0, 100));

  const dataConfidence =
    results.reduce((s, r) => s + r.confidence * r.weight, 0) / totalWeight;

  const thresholds = profile.thresholds as Record<string, number>;
  const band: ScoreBand =
    score >= (thresholds.PRIORITY_LEAD ?? 80)
      ? 'PRIORITY_LEAD'
      : score >= (thresholds.QUALIFIED_LEAD ?? 65)
        ? 'QUALIFIED_LEAD'
        : score >= (thresholds.REVIEW_REQUIRED ?? 50)
          ? 'REVIEW_REQUIRED'
          : 'LOW_PRIORITY';

  const top = [...results].sort((a, b) => b.awarded - a.awarded).slice(0, 3);
  const lost = [...results]
    .filter((r) => r.awarded < r.weight * 0.5)
    .sort((a, b) => b.weight - a.weight - (b.awarded - a.awarded))
    .slice(0, 2);

  const explanation = [
    `Scored ${score}/100 (${band.replace(/_/g, ' ').toLowerCase()}).`,
    top.length ? `Strongest: ${top.map((t) => `${t.label.toLowerCase()} (+${t.awarded})`).join(', ')}.` : '',
    lost.length ? `Weakest: ${lost.map((t) => `${t.label.toLowerCase()} (${t.awarded}/${t.weight})`).join(', ')}.` : '',
    `Data confidence ${Math.round(dataConfidence * 100)}% — the rest is estimated.`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    score,
    band,
    dataConfidence: Number(dataConfidence.toFixed(3)),
    breakdown: results,
    explanation,
  };
}

export function bandLabel(band: ScoreBand): string {
  switch (band) {
    case 'PRIORITY_LEAD':
      return 'Priority lead';
    case 'QUALIFIED_LEAD':
      return 'Qualified lead';
    case 'REVIEW_REQUIRED':
      return 'Review required';
    case 'LOW_PRIORITY':
      return 'Low priority';
    default:
      return 'Disqualified';
  }
}
