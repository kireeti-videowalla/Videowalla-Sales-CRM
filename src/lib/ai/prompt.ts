import type { SettingValue } from '../settings/definitions';
import { QUALIFICATION_JSON_SCHEMA } from './schema';

export type QualificationInput = {
  /// Verbatim text the opportunity came from (email body, listing text, profile).
  sourceText: string;
  sourceKind: string;
  sourceUrl?: string | null;
  sourceSubject?: string | null;
  receivedAt?: Date | null;
  /// Hints from cheap deterministic parsing, so the model corrects rather than
  /// starts from nothing.
  hints?: {
    companyName?: string | null;
    jobTitle?: string | null;
    location?: string | null;
    websiteUrl?: string | null;
    matchedKeywords?: string[];
  };
  activeKeywords: string[];
  priorityIndustries: string[];
  priorityLocations: string[];
  icp: SettingValue<'icp.criteria'>;
  companyProfile: SettingValue<'company.profile'>;
};

export function buildSystemPrompt(input: QualificationInput): string {
  const p = input.companyProfile;
  return [
    `You are the lead qualification engine for ${p.companyName}, a Canadian creative agency and marketing company.`,
    ``,
    `${p.companyName} sells: ${p.services.join(', ')}.`,
    `Positioning: ${p.pitchSummary}`,
    ``,
    `Your job: read one raw lead source and turn it into a structured sales opportunity record.`,
    ``,
    `IDEAL CUSTOMER PROFILE`,
    `- Countries: ${input.icp.countries.join(', ')}`,
    `- Employees: ${input.icp.minEmployees}-${input.icp.maxEmployees} (preferred ${input.icp.preferredMinEmployees}-${input.icp.preferredMaxEmployees})`,
    `- Minimum estimated annual revenue: $${(input.icp.minRevenueCents / 100).toLocaleString('en-CA')}`,
    `- Preferred estimated annual revenue: $${(input.icp.preferredRevenueCents / 100).toLocaleString('en-CA')}`,
    `- Priority industries: ${input.priorityIndustries.slice(0, 20).join(', ')}`,
    `- Priority locations: ${input.priorityLocations.slice(0, 20).join(', ')}`,
    ``,
    `BUYING SIGNAL`,
    `A company hiring for any of these roles is a strong prospect, because ${p.companyName} can replace`,
    `the cost and management of those hires: ${input.activeKeywords.slice(0, 40).join(', ')}.`,
    ``,
    `HARD RULES`,
    `1. NEVER invent contact details. If a phone number, email or person's name is not present in the`,
    `   source text, return null for it and add a note to missingInformation. A fabricated phone number`,
    `   is far worse than a missing one.`,
    `2. Revenue and employee counts are ESTIMATES unless the source states them. Set the matching`,
    `   *Confidence field honestly (UNKNOWN when you are guessing from industry alone) and put your`,
    `   reasoning in the matching *Source field, e.g. "inferred from trade + single location".`,
    `3. Do not reject a strong company merely because revenue data is unavailable. Estimate, mark the`,
    `   confidence LOW or UNKNOWN, and continue.`,
    `4. Set disqualify=true only for clear mismatches: not in the target countries, a large enterprise`,
    `   far outside the employee range, a staffing/recruiting agency posting on another company's`,
    `   behalf, another marketing or creative agency (a competitor), or a posting with no identifiable company.`,
    `5. confidence reflects how sure you are of the extraction overall. Use below 0.5 when the company`,
    `   identity itself is uncertain — those go to a human for review.`,
    `6. suggestedOpening must be speakable out loud in under 20 seconds, reference the specific role or`,
    `   need you found, and must not claim any prior relationship.`,
    ``,
    `Respond with JSON only, matching this schema exactly:`,
    JSON.stringify(QUALIFICATION_JSON_SCHEMA),
  ].join('\n');
}

export function buildUserPrompt(input: QualificationInput): string {
  const hints = input.hints ?? {};
  const lines = [
    `SOURCE KIND: ${input.sourceKind}`,
    input.sourceSubject ? `SOURCE SUBJECT: ${input.sourceSubject}` : null,
    input.sourceUrl ? `SOURCE URL: ${input.sourceUrl}` : null,
    input.receivedAt ? `RECEIVED AT: ${input.receivedAt.toISOString()}` : null,
    ``,
    hints.companyName ? `PARSER HINT — company name: ${hints.companyName}` : null,
    hints.jobTitle ? `PARSER HINT — job title: ${hints.jobTitle}` : null,
    hints.location ? `PARSER HINT — location: ${hints.location}` : null,
    hints.websiteUrl ? `PARSER HINT — website: ${hints.websiteUrl}` : null,
    hints.matchedKeywords?.length
      ? `PARSER HINT — matched keywords: ${hints.matchedKeywords.join(', ')}`
      : null,
    `(Hints come from a simple text parser and may be wrong. Correct them if the source disagrees.)`,
    ``,
    `--- RAW SOURCE TEXT START ---`,
    input.sourceText.slice(0, 24_000),
    `--- RAW SOURCE TEXT END ---`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

/**
 * Models sometimes wrap JSON in prose or a code fence despite instructions.
 * Recover the object rather than failing the whole pipeline over formatting.
 */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error('AI response did not contain a JSON object');
}
