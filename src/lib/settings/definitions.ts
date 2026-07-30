import { z } from 'zod';

/**
 * Every tunable knob in the product lives here. Nothing that the owner is
 * allowed to change is hard-coded elsewhere — code reads these values through
 * `getSetting()` and receives the documented default when unset.
 */

export const icpSchema = z.object({
  minEmployees: z.number().int().min(0).default(1),
  maxEmployees: z.number().int().min(1).default(25),
  preferredMinEmployees: z.number().int().min(0).default(1),
  preferredMaxEmployees: z.number().int().min(1).default(20),
  minRevenueCents: z.number().int().min(0).default(50_000_000), // $500,000
  preferredRevenueCents: z.number().int().min(0).default(100_000_000), // $1,000,000
  countries: z.array(z.string()).default(['CA']),
  requireWebsiteOrListing: z.boolean().default(true),
  requireReachableContact: z.boolean().default(false),
  /// Companies with no contact data at all still get a ticket, but land in
  /// Review Required rather than Ready to Contact.
  disqualifyWithoutContact: z.boolean().default(false),
  disqualificationNotes: z.array(z.string()).default([]),
});

export const postingAgeSchema = z.object({
  highPriorityDays: z.number().int().min(1).default(7),
  mediumPriorityDays: z.number().int().min(1).default(14),
  lowPriorityDays: z.number().int().min(1).default(30),
  /// Older than lowPriorityDays: ARCHIVE | MANUAL_REVIEW | REACTIVATE
  olderBehaviour: z.enum(['ARCHIVE', 'MANUAL_REVIEW', 'REACTIVATE']).default('MANUAL_REVIEW'),
});

export const capacitySchema = z.object({
  weeklyHours: z.number().min(0).default(8),
  /// Minutes reserved per shift for clocking in/out and admin.
  shiftOverheadMinutes: z.number().min(0).default(10),
  /// Minutes reserved per week for general admin work.
  weeklyAdminMinutes: z.number().min(0).default(20),
  minutesPerNewContact: z.number().min(1).default(9),
  minutesPerFollowUp: z.number().min(1).default(6),
  minutesPerInterestedAction: z.number().min(1).default(12),
  minutesPerMeetingAction: z.number().min(1).default(15),
  minTotalContacts: z.number().int().min(1).default(20),
  maxTotalContacts: z.number().int().min(1).default(50),
  defaultTotalContactsMin: z.number().int().min(1).default(30),
  defaultTotalContactsMax: z.number().int().min(1).default(40),
  /// Share of connected calls that historically become real conversations,
  /// used only as a starting point until real history exists.
  baselineConversationRate: z.number().min(0).max(1).default(0.25),
  baselineInterestRate: z.number().min(0).max(1).default(0.12),
  baselineMeetingRate: z.number().min(0).max(1).default(0.05),
  /// How many spare qualified leads to prepare beyond the new-contact target.
  leadBufferMultiplier: z.number().min(1).default(1.4),
});

export const sundayPlanningSchema = z.object({
  enabled: z.boolean().default(true),
  timezone: z.string().default('America/Toronto'),
  /// 0 = Sunday
  weekday: z.number().int().min(0).max(6).default(0),
  hour: z.number().int().min(0).max(23).default(18),
  minute: z.number().int().min(0).max(59).default(0),
  autoApprove: z.boolean().default(false),
  discoveryEnabled: z.boolean().default(true),
  /// Max new companies to pull from location/industry discovery per run.
  maxDiscoveryResults: z.number().int().min(0).default(60),
});

export const shiftPolicySchema = z.object({
  lateThresholdMinutes: z.number().int().min(0).default(10),
  inactivityAlertMinutes: z.number().int().min(1).default(15),
  noTicketOpenedMinutes: z.number().int().min(1).default(10),
  noContactInFirstHour: z.boolean().default(true),
  halfShiftProgressThreshold: z.number().min(0).max(1).default(0.25),
  requireEndOfShiftNotes: z.boolean().default(true),
  autoEndAfterHours: z.number().min(1).default(12),
  autoPauseAfterInactiveMinutes: z.number().int().min(0).default(0), // 0 = never
});

export const performanceScoreSchema = z.object({
  attendanceWeight: z.number().int().min(0).default(15),
  contactsWeight: z.number().int().min(0).default(20),
  followUpsWeight: z.number().int().min(0).default(20),
  notesQualityWeight: z.number().int().min(0).default(10),
  conversationsWeight: z.number().int().min(0).default(10),
  interestedWeight: z.number().int().min(0).default(10),
  meetingsWeight: z.number().int().min(0).default(15),
  /// A note must be at least this long to count toward note quality.
  minimumNoteLength: z.number().int().min(0).default(25),
});

export const followUpPolicySchema = z.object({
  /// Business days added when an interested lead has no promised date.
  interestedDefaultDelayDays: z.number().int().min(0).default(3),
  meetingInviteUnconfirmedBusinessDays: z.number().int().min(0).default(2),
  reactivationDays: z.number().int().min(1).default(60),
  longTermRetryDays: z.number().int().min(1).default(30),
  maxAttemptsBeforeLongTerm: z.number().int().min(1).default(3),
  /// Follow-ups due before this hour appear in the morning queue.
  dueHourLocal: z.number().int().min(0).max(23).default(9),
});

export const aiSchema = z.object({
  provider: z.enum(['auto', 'anthropic', 'openai', 'rules']).default('auto'),
  anthropicModel: z.string().default('claude-opus-5'),
  openaiModel: z.string().default('gpt-4o-mini'),
  maxTokens: z.number().int().min(256).max(16_000).default(3_000),
  temperature: z.number().min(0).max(1).default(0.2),
  /// Below this confidence the opportunity is routed to Manual Review instead
  /// of straight into the call queue.
  manualReviewConfidenceThreshold: z.number().min(0).max(1).default(0.55),
});

export const notificationPolicySchema = z.object({
  emailEnabled: z.boolean().default(false),
  slackEnabled: z.boolean().default(false),
  ownerDigestHour: z.number().int().min(0).max(23).default(18),
  alertOnShiftStart: z.boolean().default(true),
  alertOnShiftEnd: z.boolean().default(true),
  alertOnMissedShift: z.boolean().default(true),
  alertOnInactivity: z.boolean().default(true),
  alertOnHighScoreLead: z.boolean().default(true),
  highScoreLeadThreshold: z.number().int().min(0).max(100).default(85),
  alertOnInterested: z.boolean().default(true),
  alertOnMeetingBooked: z.boolean().default(true),
  alertOnLeadShortage: z.boolean().default(true),
  alertOnIntegrationFailure: z.boolean().default(true),
});

export const companySchema = z.object({
  companyName: z.string().default('Videowalla'),
  services: z
    .array(z.string())
    .default([
      'Video content production',
      'Founder-led content',
      'Social media management',
      'Content strategy',
      'Paid advertising',
      'Media buying',
      'Lead generation',
      'Marketing automation',
      'Creative production',
      'Sales and marketing systems',
    ]),
  pitchSummary: z
    .string()
    .default(
      'Videowalla replaces the cost and management overhead of hiring several in-house marketing employees with one senior creative and performance team.',
    ),
  leadInboxAddress: z.string().default('sales-leads@videowalla.co'),
});

export const SETTING_DEFINITIONS = {
  'icp.criteria': { schema: icpSchema, description: 'Ideal customer profile filters' },
  'discovery.postingAge': { schema: postingAgeSchema, description: 'Job posting age priority bands' },
  'sprint.capacity': { schema: capacitySchema, description: 'Weekly capacity and target maths' },
  'sprint.sundayPlanning': { schema: sundayPlanningSchema, description: 'Sunday automation schedule' },
  'shifts.policy': { schema: shiftPolicySchema, description: 'Shift, lateness and inactivity rules' },
  'performance.score': { schema: performanceScoreSchema, description: 'Weekly performance score weights' },
  'followups.policy': { schema: followUpPolicySchema, description: 'Follow-up timing policy' },
  'ai.config': { schema: aiSchema, description: 'AI provider configuration' },
  'notifications.policy': { schema: notificationPolicySchema, description: 'Notification rules' },
  'company.profile': { schema: companySchema, description: 'Videowalla profile used in AI prompts' },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export function defaultsFor<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTING_DEFINITIONS[key].schema.parse({}) as SettingValue<K>;
}

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];
