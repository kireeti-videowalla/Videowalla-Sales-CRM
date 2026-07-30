import {
  extractDomain,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  titleCase,
  truncate,
} from '../normalize';
import type { QualificationInput } from './prompt';
import { qualificationSchema, type QualificationResult } from './schema';

/**
 * Deterministic, offline qualification.
 *
 * This is a real fallback, not a mock: it runs the same contract as the LLM
 * providers using regex + keyword matching, so the entire ingestion → ticket
 * pipeline works on day one before the owner has supplied any AI credentials.
 * Its `confidence` is deliberately capped below the manual-review threshold for
 * anything it is not sure about, so uncertain leads reach a human rather than
 * the call queue.
 */

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

const AGENCY_MARKERS = [
  'marketing agency', 'digital agency', 'creative agency', 'advertising agency',
  'ad agency', 'media agency', 'branding agency', 'seo agency',
];
const STAFFING_MARKERS = [
  'staffing', 'recruitment agency', 'recruiting agency', 'talent acquisition partner',
  'headhunter', 'placement agency', 'on behalf of our client',
];

const SERVICE_BY_KEYWORD: Array<{ match: RegExp; service: string; problem: string }> = [
  { match: /videograph|video editor|video production|content creator/i, service: 'Video content production and founder-led content', problem: 'They need a steady flow of video content but are trying to solve it with a single in-house hire.' },
  { match: /social media/i, service: 'Social media management and content strategy', problem: 'They need consistent social output and a strategy behind it, not just someone to post.' },
  { match: /media buyer|paid ads|paid advertising|performance marketing/i, service: 'Paid advertising and media buying', problem: 'They are ready to spend on ads and need someone accountable for the return.' },
  { match: /lead generation/i, service: 'Lead generation and marketing automation', problem: 'They need predictable inbound volume rather than another salaried headcount.' },
  { match: /brand manager|communications manager/i, service: 'Content strategy and creative production', problem: 'They want brand consistency across channels without building a full internal team.' },
  { match: /marketing (manager|coordinator|specialist)|digital marketing/i, service: 'Marketing systems, creative production and paid advertising', problem: 'They are hiring a generalist to cover strategy, content and ads — work that usually needs a team.' },
];

function findAll(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[0]);
}

/** Pull a company name out of common alert-email phrasings. */
function guessCompanyName(input: QualificationInput): string | null {
  if (input.hints?.companyName) return input.hints.companyName;
  const text = input.sourceText;

  const patterns = [
    /\bat\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})\s*(?:\||-|–|—|\n|is hiring|has posted)/,
    /^([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})\s+is (?:hiring|looking for|seeking)/m,
    /Company:\s*(.+)/i,
    /Employer:\s*(.+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const value = m?.[1]?.trim();
    if (value && value.length >= 2 && value.length <= 80) return value;
  }

  if (input.sourceSubject) {
    const m = /\bat\s+(.+?)(?:\s*[-|–—]|$)/i.exec(input.sourceSubject);
    if (m?.[1]) return m[1].trim();
  }

  const domain = extractDomain(input.hints?.websiteUrl ?? findAll(text, URL_RE)[0] ?? null);
  if (domain) {
    const label = domain.split('.')[0];
    if (label && label.length > 2) return titleCase(label.replace(/[-_]+/g, ' '));
  }
  return null;
}

function guessJobTitle(input: QualificationInput, matched: string[]): string | null {
  if (input.hints?.jobTitle) return input.hints.jobTitle;
  const text = `${input.sourceSubject ?? ''}\n${input.sourceText}`;
  for (const re of [/(?:Job title|Position|Role|Title):\s*(.+)/i, /\bhiring(?: an?| a)?\s+([A-Za-z][\w\s/-]{3,60})/i]) {
    const m = re.exec(text);
    if (m?.[1]) return m[1].trim().slice(0, 80);
  }
  return matched[0] ? titleCase(matched[0]) : null;
}

function guessLocation(input: QualificationInput): { city: string | null; province: string | null } {
  const text = `${input.sourceSubject ?? ''}\n${input.sourceText}`;
  for (const loc of input.priorityLocations) {
    const re = new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(text)) {
      return { city: loc, province: /ontario|\bON\b/i.test(text) || loc !== 'Rest of Canada' ? 'ON' : null };
    }
  }
  const m = /([A-Z][a-zA-Z.\s-]{2,30}),\s*(ON|Ontario|BC|AB|QC|MB|SK|NS|NB|NL|PE)\b/.exec(text);
  if (m?.[1]) return { city: m[1].trim(), province: (m[2] ?? 'ON').slice(0, 2).toUpperCase() };
  return { city: null, province: null };
}

function guessIndustry(text: string, industries: string[]): string | null {
  const normalized = normalizeText(text);
  for (const industry of industries) {
    const head = normalizeText(industry).split(' ')[0];
    if (head && head.length > 3 && normalized.includes(head)) return industry;
  }
  return null;
}

export function qualifyWithRules(input: QualificationInput): QualificationResult {
  const text = `${input.sourceSubject ?? ''}\n${input.sourceText}`;
  const lower = text.toLowerCase();

  const matchedKeywords = input.activeKeywords.filter((kw) => lower.includes(kw.toLowerCase()));
  const isHiring =
    matchedKeywords.length > 0 ||
    /\b(hiring|job alert|new job|we're looking for|now hiring|job posting|apply now)\b/i.test(text);

  const companyName = guessCompanyName(input);
  const urls = findAll(text, URL_RE);
  const websiteUrl =
    input.hints?.websiteUrl ??
    urls.find((u) => {
      const d = extractDomain(u);
      return d && !/indeed|linkedin|glassdoor|ziprecruiter|google|workopolis|jobbank/i.test(d);
    }) ??
    null;

  // Contact details are only ever copied out of the source text, never generated.
  const phone = findAll(text, PHONE_RE).map(normalizePhone).find(Boolean) ?? null;
  const email =
    findAll(text, EMAIL_RE)
      .map(normalizeEmail)
      .filter((e): e is string => Boolean(e))
      .find((e) => !/noreply|no-reply|donotreply|alerts?@|notification/i.test(e)) ?? null;

  const { city, province } = guessLocation(input);
  const jobTitle = guessJobTitle(input, matchedKeywords);
  const industryGuess = guessIndustry(text, input.priorityIndustries);

  const fit = SERVICE_BY_KEYWORD.find((s) => s.match.test(`${jobTitle ?? ''} ${matchedKeywords.join(' ')}`));

  const isAgency = AGENCY_MARKERS.some((m) => lower.includes(m));
  const isStaffing = STAFFING_MARKERS.some((m) => lower.includes(m));
  const disqualify = !companyName || isAgency || isStaffing;
  const disqualifyReason = !companyName
    ? 'No identifiable company name in the source.'
    : isAgency
      ? 'Appears to be another marketing or creative agency (competitor).'
      : isStaffing
        ? 'Appears to be a staffing or recruiting agency posting on a client’s behalf.'
        : null;

  // Confidence is earned, not assumed. A rules match with a company name, a
  // matched keyword and a location is decent; anything thinner goes to a human.
  let confidence = 0.25;
  if (companyName) confidence += 0.15;
  if (matchedKeywords.length > 0) confidence += 0.15;
  if (jobTitle) confidence += 0.05;
  if (city) confidence += 0.05;
  if (websiteUrl) confidence += 0.05;
  if (phone || email) confidence += 0.05;
  confidence = Math.min(0.75, Number(confidence.toFixed(2)));

  const missing: string[] = [];
  if (!phone) missing.push('Direct phone number');
  if (!email) missing.push('Email address');
  if (!websiteUrl) missing.push('Company website');
  if (!city) missing.push('Confirmed city');
  missing.push('Owner or decision-maker name');
  missing.push('Verified employee count and revenue');

  const displayName = companyName ?? 'Unidentified company';
  const roleLabel = jobTitle ?? 'a marketing or content role';

  const headline = isHiring
    ? `${displayName} is hiring ${roleLabel}`
    : `${displayName} — ${industryGuess ?? 'local business'} in ${city ?? 'Canada'}`;

  const result = {
    company: {
      name: displayName,
      websiteUrl,
      industryGuess,
      city,
      province,
      country: 'CA',
      serviceArea: city,
      description: null,
      // The rules engine deliberately makes no revenue or headcount claim.
      // An honest UNKNOWN is more useful than a manufactured range.
      employeeCountMin: null,
      employeeCountMax: null,
      employeeCountConfidence: 'UNKNOWN' as const,
      employeeCountSource: null,
      revenueMinCents: null,
      revenueMaxCents: null,
      revenueConfidence: 'UNKNOWN' as const,
      revenueSource: null,
      phone,
      email,
      linkedinUrl: urls.find((u) => /linkedin\.com/i.test(u)) ?? null,
      instagramUrl: urls.find((u) => /instagram\.com/i.test(u)) ?? null,
    },
    role: {
      isHiring,
      title: jobTitle,
      employmentType: /part[- ]?time/i.test(text) ? 'Part-time' : /full[- ]?time/i.test(text) ? 'Full-time' : null,
      locationText: city ? `${city}${province ? `, ${province}` : ''}` : null,
      salaryText: /\$[\d,]+(?:\s*(?:-|–|to)\s*\$?[\d,]+)?(?:\s*(?:per|\/)\s*(?:hour|hr|year|yr|annum))?/i.exec(text)?.[0] ?? null,
      postedAt: input.receivedAt?.toISOString() ?? null,
      responsibilities: [],
      requiredSkills: [],
      matchedKeywords,
    },
    contact: null,
    opportunityKind: (isHiring ? 'HIRING_INTENT' : 'COLD_OUTBOUND') as 'HIRING_INTENT' | 'COLD_OUTBOUND',
    headline: truncate(headline, 160),
    summary: isHiring
      ? `${displayName} posted ${roleLabel}${city ? ` in ${city}` : ''}. Extracted by the offline rules engine from a ${input.sourceKind.toLowerCase().replace(/_/g, ' ')}.`
      : `${displayName} matched the target profile${city ? ` in ${city}` : ''}.`,
    whatTheyAreLookingFor: isHiring
      ? `${roleLabel}${matchedKeywords.length ? ` — matched on: ${matchedKeywords.join(', ')}` : ''}.`
      : 'Not stated in the source.',
    marketingProblem: fit?.problem ?? 'Marketing need not yet confirmed — verify on the call.',
    whyContact: isHiring
      ? `They are actively spending to solve a marketing problem in-house. ${input.companyProfile.companyName} can deliver the same output without the salary, hiring risk and management overhead.`
      : `They fit the target profile and may need help with content, social or paid advertising.`,
    recommendedService: fit?.service ?? input.companyProfile.services[0] ?? 'Content strategy',
    suggestedOpening: isHiring
      ? `Hi, is the owner available? I saw ${displayName} is hiring ${roleLabel}. We're ${input.companyProfile.companyName} — we do that work as a team for less than one salary, so you'd get the video, social and ads handled without another hire to manage. Worth a ten-minute conversation?`
      : `Hi, is the owner available? I'm calling from ${input.companyProfile.companyName}. We handle video, social and paid ads for ${industryGuess ?? 'businesses'} in ${city ?? 'your area'}. Can I ask who looks after your marketing right now?`,
    suggestedEmail: '',
    suggestedFollowUp: `Following up on my call about ${roleLabel} — happy to share what we'd do in the first 30 days.`,
    serviceFit: fit ? 0.8 : matchedKeywords.length ? 0.6 : 0.35,
    confidence,
    missingInformation: missing,
    disqualify,
    disqualifyReason,
  };

  return qualificationSchema.parse(result);
}

export { normalizeCompanyName };
