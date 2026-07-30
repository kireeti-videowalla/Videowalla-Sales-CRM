import { z } from 'zod';

/**
 * The contract between the AI layer and the rest of the product.
 *
 * Every provider — Anthropic, OpenAI, or the deterministic rules engine —
 * must return exactly this shape. Nothing downstream parses free-form prose,
 * so a provider swap or a model change cannot silently corrupt the pipeline.
 */

export const confidenceLevel = z.enum(['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

export const extractedCompanySchema = z.object({
  name: z.string().min(1),
  websiteUrl: z.string().nullable().default(null),
  industryGuess: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  province: z.string().nullable().default(null),
  country: z.string().nullable().default('CA'),
  serviceArea: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  employeeCountMin: z.number().int().nullable().default(null),
  employeeCountMax: z.number().int().nullable().default(null),
  employeeCountConfidence: confidenceLevel.default('UNKNOWN'),
  employeeCountSource: z.string().nullable().default(null),
  revenueMinCents: z.number().nullable().default(null),
  revenueMaxCents: z.number().nullable().default(null),
  revenueConfidence: confidenceLevel.default('UNKNOWN'),
  revenueSource: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  linkedinUrl: z.string().nullable().default(null),
  instagramUrl: z.string().nullable().default(null),
});

export const extractedRoleSchema = z.object({
  isHiring: z.boolean().default(false),
  title: z.string().nullable().default(null),
  employmentType: z.string().nullable().default(null),
  locationText: z.string().nullable().default(null),
  salaryText: z.string().nullable().default(null),
  postedAt: z.string().nullable().default(null),
  responsibilities: z.array(z.string()).default([]),
  requiredSkills: z.array(z.string()).default([]),
  matchedKeywords: z.array(z.string()).default([]),
});

export const extractedContactSchema = z.object({
  fullName: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
  roleKind: z
    .enum(['OWNER', 'FOUNDER', 'PRESIDENT', 'CEO', 'MARKETING_DECISION_MAKER', 'MARKETING_MANAGER', 'OTHER'])
    .default('OTHER'),
  phone: z.string().nullable().default(null),
  email: z.string().nullable().default(null),
  linkedinUrl: z.string().nullable().default(null),
  confidence: confidenceLevel.default('UNKNOWN'),
  source: z.string().nullable().default(null),
});

export const qualificationSchema = z.object({
  company: extractedCompanySchema,
  role: extractedRoleSchema,
  contact: extractedContactSchema.nullable().default(null),
  opportunityKind: z.enum(['HIRING_INTENT', 'COLD_OUTBOUND', 'INBOUND', 'REFERRAL']).default('HIRING_INTENT'),
  headline: z.string().min(1),
  summary: z.string().default(''),
  whatTheyAreLookingFor: z.string().default(''),
  marketingProblem: z.string().default(''),
  whyContact: z.string().default(''),
  recommendedService: z.string().default(''),
  suggestedOpening: z.string().default(''),
  suggestedEmail: z.string().default(''),
  suggestedFollowUp: z.string().default(''),
  serviceFit: z.number().min(0).max(1).default(0.5),
  /// Overall confidence in this extraction. Below the configured threshold the
  /// opportunity is routed to Manual Review rather than the call queue.
  confidence: z.number().min(0).max(1).default(0.5),
  missingInformation: z.array(z.string()).default([]),
  disqualify: z.boolean().default(false),
  disqualifyReason: z.string().nullable().default(null),
});

export type QualificationResult = z.infer<typeof qualificationSchema>;
export type ExtractedCompany = z.infer<typeof extractedCompanySchema>;
export type ExtractedRole = z.infer<typeof extractedRoleSchema>;
export type ExtractedContact = z.infer<typeof extractedContactSchema>;

/**
 * JSON Schema handed to the model. Kept in sync with the zod schema above by
 * the ai/provider.test.ts round-trip test.
 */
export const QUALIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['company', 'role', 'headline', 'confidence'],
  properties: {
    company: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Official company name, no job board decoration' },
        websiteUrl: { type: ['string', 'null'] },
        industryGuess: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        province: { type: ['string', 'null'], description: 'Two-letter code where known, e.g. ON' },
        country: { type: ['string', 'null'], description: 'ISO-2, default CA' },
        serviceArea: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        employeeCountMin: { type: ['integer', 'null'] },
        employeeCountMax: { type: ['integer', 'null'] },
        employeeCountConfidence: { type: 'string', enum: ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] },
        employeeCountSource: { type: ['string', 'null'] },
        revenueMinCents: { type: ['number', 'null'], description: 'Estimated annual revenue in cents' },
        revenueMaxCents: { type: ['number', 'null'] },
        revenueConfidence: { type: 'string', enum: ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] },
        revenueSource: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'], description: 'Only if present in the source. Never invent.' },
        email: { type: ['string', 'null'], description: 'Only if present in the source. Never invent.' },
        linkedinUrl: { type: ['string', 'null'] },
        instagramUrl: { type: ['string', 'null'] },
      },
    },
    role: {
      type: 'object',
      additionalProperties: false,
      required: ['isHiring'],
      properties: {
        isHiring: { type: 'boolean' },
        title: { type: ['string', 'null'] },
        employmentType: { type: ['string', 'null'] },
        locationText: { type: ['string', 'null'] },
        salaryText: { type: ['string', 'null'] },
        postedAt: { type: ['string', 'null'], description: 'ISO-8601 date if stated or derivable' },
        responsibilities: { type: 'array', items: { type: 'string' } },
        requiredSkills: { type: 'array', items: { type: 'string' } },
        matchedKeywords: { type: 'array', items: { type: 'string' } },
      },
    },
    contact: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        fullName: { type: ['string', 'null'] },
        title: { type: ['string', 'null'] },
        roleKind: {
          type: 'string',
          enum: ['OWNER', 'FOUNDER', 'PRESIDENT', 'CEO', 'MARKETING_DECISION_MAKER', 'MARKETING_MANAGER', 'OTHER'],
        },
        phone: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        linkedinUrl: { type: ['string', 'null'] },
        confidence: { type: 'string', enum: ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] },
        source: { type: ['string', 'null'] },
      },
    },
    opportunityKind: { type: 'string', enum: ['HIRING_INTENT', 'COLD_OUTBOUND', 'INBOUND', 'REFERRAL'] },
    headline: { type: 'string', description: 'One line the salesperson sees on the ticket' },
    summary: { type: 'string' },
    whatTheyAreLookingFor: { type: 'string' },
    marketingProblem: { type: 'string' },
    whyContact: { type: 'string', description: 'Why Videowalla specifically should call this company' },
    recommendedService: { type: 'string' },
    suggestedOpening: { type: 'string', description: '2-3 sentences the rep can say verbatim' },
    suggestedEmail: { type: 'string' },
    suggestedFollowUp: { type: 'string' },
    serviceFit: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    missingInformation: { type: 'array', items: { type: 'string' } },
    disqualify: { type: 'boolean' },
    disqualifyReason: { type: ['string', 'null'] },
  },
} as const;
