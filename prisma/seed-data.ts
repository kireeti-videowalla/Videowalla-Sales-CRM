/**
 * Default *configuration* for a fresh install. These are not sample leads —
 * they are the starting values the owner can edit, reorder, deactivate or
 * delete from the Settings screens.
 */

import type { StageCategory } from '@prisma/client';

export const DEFAULT_LOCATIONS: Array<{
  name: string;
  slug: string;
  kind: string;
  province?: string;
  latitude?: number;
  longitude?: number;
  radiusKm: number;
  priority: number;
}> = [
  { name: 'Toronto', slug: 'toronto', kind: 'CITY', province: 'ON', latitude: 43.6532, longitude: -79.3832, radiusKm: 20, priority: 10 },
  { name: 'Greater Toronto Area', slug: 'gta', kind: 'REGION', province: 'ON', latitude: 43.7315, longitude: -79.7624, radiusKm: 55, priority: 20 },
  { name: 'Burlington', slug: 'burlington', kind: 'CITY', province: 'ON', latitude: 43.3255, longitude: -79.799, radiusKm: 15, priority: 30 },
  { name: 'Hamilton', slug: 'hamilton', kind: 'CITY', province: 'ON', latitude: 43.2557, longitude: -79.8711, radiusKm: 20, priority: 40 },
  { name: 'Oakville', slug: 'oakville', kind: 'CITY', province: 'ON', latitude: 43.4675, longitude: -79.6877, radiusKm: 15, priority: 50 },
  { name: 'Mississauga', slug: 'mississauga', kind: 'CITY', province: 'ON', latitude: 43.589, longitude: -79.6441, radiusKm: 18, priority: 60 },
  { name: 'Brampton', slug: 'brampton', kind: 'CITY', province: 'ON', latitude: 43.7315, longitude: -79.7624, radiusKm: 18, priority: 70 },
  { name: 'Milton', slug: 'milton', kind: 'CITY', province: 'ON', latitude: 43.5183, longitude: -79.8774, radiusKm: 15, priority: 80 },
  { name: 'Kitchener-Waterloo', slug: 'kitchener-waterloo', kind: 'REGION', province: 'ON', latitude: 43.4516, longitude: -80.4925, radiusKm: 25, priority: 90 },
  { name: 'Cambridge', slug: 'cambridge', kind: 'CITY', province: 'ON', latitude: 43.3616, longitude: -80.3144, radiusKm: 15, priority: 100 },
  { name: 'Niagara Region', slug: 'niagara-region', kind: 'REGION', province: 'ON', latitude: 43.1594, longitude: -79.2469, radiusKm: 35, priority: 110 },
  { name: 'Niagara Falls', slug: 'niagara-falls', kind: 'CITY', province: 'ON', latitude: 43.0896, longitude: -79.0849, radiusKm: 15, priority: 120 },
  { name: 'St. Catharines', slug: 'st-catharines', kind: 'CITY', province: 'ON', latitude: 43.1594, longitude: -79.2469, radiusKm: 15, priority: 130 },
  { name: 'Muskoka', slug: 'muskoka', kind: 'REGION', province: 'ON', latitude: 45.0333, longitude: -79.3, radiusKm: 45, priority: 140 },
  { name: 'Central Ontario', slug: 'central-ontario', kind: 'REGION', province: 'ON', latitude: 44.3894, longitude: -79.6903, radiusKm: 80, priority: 150 },
  { name: 'Rest of Ontario', slug: 'rest-of-ontario', kind: 'PROVINCE', province: 'ON', latitude: 50.0, longitude: -85.0, radiusKm: 400, priority: 160 },
  { name: 'Rest of Canada', slug: 'rest-of-canada', kind: 'COUNTRY', latitude: 56.1304, longitude: -106.3468, radiusKm: 2500, priority: 170 },
];

export const DEFAULT_INDUSTRIES: Array<{
  name: string;
  slug: string;
  priority: number;
  keywords: string[];
}> = [
  { name: 'Custom home builders', slug: 'custom-home-builders', priority: 10, keywords: ['custom home builder', 'home builder', 'custom homes'] },
  { name: 'General contractors', slug: 'general-contractors', priority: 20, keywords: ['general contractor', 'construction company'] },
  { name: 'Renovation companies', slug: 'renovation', priority: 30, keywords: ['renovation', 'remodeling', 'remodelling', 'kitchen and bath'] },
  { name: 'Home improvement companies', slug: 'home-improvement', priority: 40, keywords: ['home improvement', 'windows and doors', 'landscaping'] },
  { name: 'HVAC companies', slug: 'hvac', priority: 50, keywords: ['hvac', 'air conditioning', 'furnace'] },
  { name: 'Heating and cooling companies', slug: 'heating-cooling', priority: 60, keywords: ['heating and cooling', 'heating & cooling'] },
  { name: 'Plumbing companies', slug: 'plumbing', priority: 70, keywords: ['plumbing', 'plumber', 'drain'] },
  { name: 'Roofing companies', slug: 'roofing', priority: 80, keywords: ['roofing', 'roofer', 'eavestrough'] },
  { name: 'Electrical companies', slug: 'electrical', priority: 90, keywords: ['electrical', 'electrician'] },
  { name: 'Construction trades', slug: 'construction-trades', priority: 100, keywords: ['concrete', 'masonry', 'framing', 'excavation'] },
  { name: 'Drywall companies', slug: 'drywall', priority: 110, keywords: ['drywall', 'taping', 'stucco'] },
  { name: 'Architecture and design firms', slug: 'architecture-design', priority: 120, keywords: ['architect', 'architecture', 'interior design'] },
  { name: 'Dental clinics', slug: 'dental', priority: 130, keywords: ['dental', 'dentist', 'orthodontic'] },
  { name: 'Healthcare service businesses', slug: 'healthcare-services', priority: 140, keywords: ['clinic', 'physiotherapy', 'chiropractic', 'medspa', 'med spa'] },
  { name: 'Technology companies', slug: 'technology', priority: 150, keywords: ['software', 'saas', 'technology', 'it services'] },
  { name: 'Professional service companies', slug: 'professional-services', priority: 160, keywords: ['law firm', 'accounting', 'consulting', 'insurance broker', 'mortgage broker', 'real estate'] },
  { name: 'Owner-operated service businesses', slug: 'owner-operated-services', priority: 170, keywords: ['cleaning services', 'moving company', 'auto detailing', 'fitness studio'] },
];

export const DEFAULT_KEYWORD_GROUPS: Array<{
  name: string;
  priority: number;
  keywords: Array<{ term: string; scoreBoost: number; priority: number }>;
}> = [
  {
    name: 'Content and video',
    priority: 10,
    keywords: [
      { term: 'content creator', scoreBoost: 6, priority: 10 },
      { term: 'in-house content creator', scoreBoost: 6, priority: 10 },
      { term: 'videographer', scoreBoost: 6, priority: 10 },
      { term: 'in-house videographer', scoreBoost: 6, priority: 10 },
      { term: 'video editor', scoreBoost: 5, priority: 20 },
      { term: 'video production', scoreBoost: 5, priority: 20 },
      { term: 'content strategist', scoreBoost: 4, priority: 30 },
      { term: 'content marketing', scoreBoost: 4, priority: 30 },
      { term: 'content marketing specialist', scoreBoost: 4, priority: 30 },
      { term: 'creative strategist', scoreBoost: 4, priority: 30 },
    ],
  },
  {
    name: 'Social media',
    priority: 20,
    keywords: [
      { term: 'social media manager', scoreBoost: 6, priority: 10 },
      { term: 'social media coordinator', scoreBoost: 5, priority: 20 },
      { term: 'social media marketing', scoreBoost: 4, priority: 30 },
      { term: 'social media marketing specialist', scoreBoost: 4, priority: 30 },
      { term: 'community manager', scoreBoost: 3, priority: 40 },
    ],
  },
  {
    name: 'Paid advertising',
    priority: 30,
    keywords: [
      { term: 'media buyer', scoreBoost: 6, priority: 10 },
      { term: 'paid ads specialist', scoreBoost: 5, priority: 20 },
      { term: 'paid advertising specialist', scoreBoost: 5, priority: 20 },
      { term: 'performance marketing', scoreBoost: 4, priority: 30 },
      { term: 'lead generation specialist', scoreBoost: 4, priority: 30 },
    ],
  },
  {
    name: 'Marketing leadership',
    priority: 40,
    keywords: [
      { term: 'marketing manager', scoreBoost: 5, priority: 10 },
      { term: 'digital marketing manager', scoreBoost: 5, priority: 10 },
      { term: 'marketing coordinator', scoreBoost: 4, priority: 20 },
      { term: 'marketing specialist', scoreBoost: 4, priority: 20 },
      { term: 'brand manager', scoreBoost: 4, priority: 20 },
      { term: 'communications manager', scoreBoost: 3, priority: 30 },
    ],
  },
];

export const DEFAULT_STAGES: Array<{
  key: string;
  name: string;
  category: StageCategory;
  position: number;
  color: string;
  isSystem: boolean;
  requiredFields: string[];
  automations: string[];
  description: string;
}> = [
  { key: 'new_leads', name: 'New Leads', category: 'INTAKE', position: 10, color: '#94a3b8', isSystem: true, requiredFields: [], automations: [], description: 'Freshly discovered, not yet processed.' },
  { key: 'ai_processing', name: 'AI Processing', category: 'INTAKE', position: 20, color: '#8b5cf6', isSystem: true, requiredFields: [], automations: [], description: 'Queued for or undergoing AI qualification.' },
  { key: 'review_required', name: 'Review Required', category: 'INTAKE', position: 30, color: '#f59e0b', isSystem: true, requiredFields: [], automations: [], description: 'Low confidence or missing data — needs a human decision.' },
  { key: 'ready_to_contact', name: 'Ready to Contact', category: 'READY', position: 40, color: '#2563eb', isSystem: true, requiredFields: [], automations: [], description: 'Fully prepared ticket in the call queue.' },
  { key: 'contacted_no_answer', name: 'Contacted – No Answer', category: 'CONTACTED', position: 50, color: '#64748b', isSystem: true, requiredFields: ['contactMethod', 'attemptNumber'], automations: ['record_attempt', 'schedule_retry_follow_up'], description: 'Attempted, nobody reached.' },
  { key: 'contacted_connected', name: 'Contacted – Connected', category: 'CONTACTED', position: 60, color: '#0ea5e9', isSystem: true, requiredFields: ['conversationSummary', 'interestLevel', 'mainProblem', 'nextAction'], automations: ['record_attempt'], description: 'Spoke to a person.' },
  { key: 'follow_up_required', name: 'Follow-Up Required', category: 'ENGAGED', position: 70, color: '#eab308', isSystem: true, requiredFields: ['followUpDate', 'followUpReason', 'contactMethod'], automations: ['create_follow_up'], description: 'A specific next touch is owed.' },
  { key: 'interested', name: 'Interested', category: 'ENGAGED', position: 80, color: '#22c55e', isSystem: true, requiredFields: ['interestSummary', 'mainProblem', 'recommendedService', 'expectedNextStep'], automations: ['create_follow_up', 'notify_owner_interested'], description: 'Company expressed genuine interest.' },
  { key: 'meeting_invite_sent', name: 'Meeting Invite Sent', category: 'MEETING', position: 90, color: '#14b8a6', isSystem: true, requiredFields: ['contactEmail', 'meetingType', 'proposedDate'], automations: ['schedule_invite_follow_up'], description: 'Calendar invitation issued, awaiting confirmation.' },
  { key: 'meeting_booked', name: 'Meeting Booked', category: 'MEETING', position: 100, color: '#10b981', isSystem: true, requiredFields: [], automations: ['remove_from_call_queue', 'notify_owner_meeting'], description: 'Meeting confirmed on the calendar.' },
  { key: 'proposal', name: 'Proposal or Opportunity', category: 'MEETING', position: 110, color: '#6366f1', isSystem: false, requiredFields: [], automations: [], description: 'Active commercial opportunity.' },
  { key: 'won', name: 'Won', category: 'CLOSED_WON', position: 120, color: '#16a34a', isSystem: false, requiredFields: [], automations: ['remove_from_call_queue'], description: 'Closed won.' },
  { key: 'not_interested', name: 'Not Interested', category: 'CLOSED_LOST', position: 130, color: '#f97316', isSystem: true, requiredFields: ['notInterestedReason', 'reactivationAppropriate'], automations: ['maybe_schedule_reactivation', 'remove_from_call_queue'], description: 'Declined; may be revisited later.' },
  { key: 'disqualified', name: 'Disqualified', category: 'CLOSED_LOST', position: 140, color: '#ef4444', isSystem: true, requiredFields: ['disqualificationReason'], automations: ['remove_from_call_queue'], description: 'Does not fit the ideal customer profile.' },
  { key: 'do_not_contact', name: 'Do Not Contact', category: 'SUPPRESSED', position: 150, color: '#991b1b', isSystem: true, requiredFields: ['doNotContactReason'], automations: ['apply_do_not_contact', 'remove_from_call_queue'], description: 'Permanently suppressed. Never re-enters a call queue.' },
];

export const DEFAULT_OUTCOMES: Array<{
  key: string;
  label: string;
  position: number;
  targetStageKey: string | null;
  countsAsConversation: boolean;
  countsAsContact: boolean;
  requiresNote: boolean;
  requiresFollowUp: boolean;
}> = [
  { key: 'no_answer', label: 'No answer', position: 10, targetStageKey: 'contacted_no_answer', countsAsConversation: false, countsAsContact: true, requiresNote: false, requiresFollowUp: false },
  { key: 'voicemail', label: 'Voicemail', position: 20, targetStageKey: 'contacted_no_answer', countsAsConversation: false, countsAsContact: true, requiresNote: false, requiresFollowUp: false },
  { key: 'wrong_number', label: 'Wrong number', position: 30, targetStageKey: 'review_required', countsAsConversation: false, countsAsContact: true, requiresNote: true, requiresFollowUp: false },
  { key: 'gatekeeper', label: 'Gatekeeper', position: 40, targetStageKey: 'follow_up_required', countsAsConversation: false, countsAsContact: true, requiresNote: true, requiresFollowUp: true },
  { key: 'connected', label: 'Connected', position: 50, targetStageKey: 'contacted_connected', countsAsConversation: true, countsAsContact: true, requiresNote: true, requiresFollowUp: false },
  { key: 'interested', label: 'Interested', position: 60, targetStageKey: 'interested', countsAsConversation: true, countsAsContact: true, requiresNote: true, requiresFollowUp: true },
  { key: 'follow_up_later', label: 'Follow up later', position: 70, targetStageKey: 'follow_up_required', countsAsConversation: true, countsAsContact: true, requiresNote: true, requiresFollowUp: true },
  { key: 'meeting_invite_sent', label: 'Meeting invite sent', position: 80, targetStageKey: 'meeting_invite_sent', countsAsConversation: true, countsAsContact: true, requiresNote: false, requiresFollowUp: false },
  { key: 'meeting_booked', label: 'Meeting booked', position: 90, targetStageKey: 'meeting_booked', countsAsConversation: true, countsAsContact: true, requiresNote: false, requiresFollowUp: false },
  { key: 'not_interested', label: 'Not interested', position: 100, targetStageKey: 'not_interested', countsAsConversation: true, countsAsContact: true, requiresNote: true, requiresFollowUp: false },
  { key: 'unqualified', label: 'Unqualified', position: 110, targetStageKey: 'disqualified', countsAsConversation: false, countsAsContact: true, requiresNote: true, requiresFollowUp: false },
  { key: 'do_not_contact', label: 'Do not contact', position: 120, targetStageKey: 'do_not_contact', countsAsConversation: false, countsAsContact: true, requiresNote: true, requiresFollowUp: false },
];

/**
 * Scoring factors. `weight` is the maximum points the factor can contribute;
 * the engine awards a fraction of it and records the reason.
 * Total of all weights = 100 so the raw sum is already a 0-100 score.
 */
export const DEFAULT_SCORING_FACTORS: Array<{
  key: string;
  label: string;
  weight: number;
  position: number;
  description: string;
}> = [
  { key: 'location_priority', label: 'Location priority (Toronto/GTA highest)', weight: 12, position: 10, description: 'Toronto and the GTA score full points; other priority regions and the rest of Canada taper down.' },
  { key: 'company_size', label: 'Employee count within the ideal range', weight: 10, position: 20, description: 'Full points inside the preferred range, partial inside the wider range.' },
  { key: 'revenue_estimate', label: 'Estimated revenue can afford Videowalla', weight: 10, position: 30, description: 'Scaled by the estimated revenue and reduced when confidence is low.' },
  { key: 'actively_hiring', label: 'Actively hiring right now', weight: 10, position: 40, description: 'A live marketing/content hire is the strongest buying signal.' },
  { key: 'hiring_role_fit', label: 'Hiring role matches Videowalla services', weight: 12, position: 50, description: 'Boosted by the matched keyword priorities (content creator, social media manager, videographer, media buyer, marketing manager).' },
  { key: 'priority_industry', label: 'Priority industry', weight: 8, position: 60, description: 'Higher-priority industries score more.' },
  { key: 'posting_recency', label: 'Recent job posting', weight: 8, position: 70, description: 'Within 7 days scores full, tapering to zero past the low-priority window.' },
  { key: 'decision_maker', label: 'Owner or decision-maker identified', weight: 8, position: 80, description: 'Full points for an identified owner/founder, partial for another decision-maker.' },
  { key: 'phone_available', label: 'Phone number available', weight: 7, position: 90, description: 'Reduced when the number is unverified.' },
  { key: 'email_available', label: 'Email available', weight: 5, position: 100, description: 'Reduced when the address is unverified.' },
  { key: 'web_presence', label: 'Active website and social presence', weight: 5, position: 110, description: 'Website counts more than social profiles.' },
  { key: 'service_fit', label: 'Clear Videowalla service fit', weight: 5, position: 120, description: 'From the AI qualification: how clearly a Videowalla service maps to the stated need.' },
];

export const DEFAULT_SCORE_THRESHOLDS = {
  PRIORITY_LEAD: 80,
  QUALIFIED_LEAD: 65,
  REVIEW_REQUIRED: 50,
};

export const DEFAULT_FOLLOW_UP_RULES: Array<{
  key: string;
  label: string;
  reasonKind: 'NO_ANSWER_RETRY' | 'LONG_TERM_RETRY' | 'INTERESTED_PROMISED' | 'MEETING_INVITE_UNCONFIRMED' | 'REACTIVATION' | 'ENRICHMENT_REQUIRED' | 'MANUAL';
  attemptNumber: number | null;
  delayDays: number;
  delayBusinessDays: boolean;
  position: number;
}> = [
  { key: 'no_answer_attempt_1', label: 'First unanswered attempt — retry next working shift', reasonKind: 'NO_ANSWER_RETRY', attemptNumber: 1, delayDays: 1, delayBusinessDays: true, position: 10 },
  { key: 'no_answer_attempt_2', label: 'Second unanswered attempt — retry in 5–7 days', reasonKind: 'NO_ANSWER_RETRY', attemptNumber: 2, delayDays: 6, delayBusinessDays: false, position: 20 },
  { key: 'no_answer_attempt_3', label: 'Third unanswered attempt — long-term follow-up', reasonKind: 'LONG_TERM_RETRY', attemptNumber: 3, delayDays: 30, delayBusinessDays: false, position: 30 },
  { key: 'interested_promised', label: 'Interested company — follow up on the promised date', reasonKind: 'INTERESTED_PROMISED', attemptNumber: null, delayDays: 3, delayBusinessDays: true, position: 40 },
  { key: 'invite_unconfirmed', label: 'Meeting invite sent but not booked — 2 business days', reasonKind: 'MEETING_INVITE_UNCONFIRMED', attemptNumber: null, delayDays: 2, delayBusinessDays: true, position: 50 },
  { key: 'reactivation', label: 'Not interested but possible later — 60-day reactivation', reasonKind: 'REACTIVATION', attemptNumber: null, delayDays: 60, delayBusinessDays: false, position: 60 },
  { key: 'enrichment_required', label: 'Invalid contact — return to enrichment', reasonKind: 'ENRICHMENT_REQUIRED', attemptNumber: null, delayDays: 2, delayBusinessDays: true, position: 70 },
];

export const DEFAULT_LEAD_SOURCES: Array<{
  key: string;
  name: string;
  kind:
    | 'GMAIL_MESSAGE'
    | 'GOOGLE_ALERT'
    | 'JOB_ALERT_EMAIL'
    | 'INDEED_ALERT_EMAIL'
    | 'LINKEDIN_ALERT_EMAIL'
    | 'PLACES_API'
    | 'CAREER_PAGE'
    | 'CSV_IMPORT'
    | 'MANUAL_URL';
  priority: number;
  isActive: boolean;
  config: Record<string, unknown>;
}> = [
  { key: 'gmail_google_alerts', name: 'Gmail — Google Alerts label', kind: 'GOOGLE_ALERT', priority: 10, isActive: true, config: { label: 'Google Alerts', maxMessages: 50 } },
  { key: 'gmail_job_alerts', name: 'Gmail — Job Alerts label', kind: 'JOB_ALERT_EMAIL', priority: 20, isActive: true, config: { label: 'Job Alerts', maxMessages: 50 } },
  { key: 'gmail_hiring_opportunities', name: 'Gmail — Hiring Opportunities label', kind: 'JOB_ALERT_EMAIL', priority: 30, isActive: true, config: { label: 'Hiring Opportunities', maxMessages: 50 } },
  { key: 'gmail_local_businesses', name: 'Gmail — Local Businesses label', kind: 'GMAIL_MESSAGE', priority: 40, isActive: true, config: { label: 'Local Businesses', maxMessages: 50 } },
  { key: 'gmail_lead_sources', name: 'Gmail — Lead Sources label', kind: 'GMAIL_MESSAGE', priority: 50, isActive: true, config: { label: 'Lead Sources', maxMessages: 50 } },
  { key: 'gmail_manual_review', name: 'Gmail — Manual Review label', kind: 'GMAIL_MESSAGE', priority: 60, isActive: true, config: { label: 'Manual Review', maxMessages: 50 } },
  { key: 'places_local_discovery', name: 'Local company discovery (Places API)', kind: 'PLACES_API', priority: 70, isActive: true, config: {} },
  { key: 'manual_url', name: 'Manually submitted URLs', kind: 'MANUAL_URL', priority: 80, isActive: true, config: {} },
  { key: 'csv_import', name: 'CSV import', kind: 'CSV_IMPORT', priority: 90, isActive: true, config: {} },
];

export const DEFAULT_SCHEDULED_JOBS: Array<{
  key: string;
  name: string;
  jobName: string;
  cron: string;
  timezone: string;
  payload: Record<string, unknown>;
}> = [
  { key: 'sunday_planning', name: 'Sunday weekly planning', jobName: 'sprint.sunday_planning', cron: '0 18 * * 0', timezone: 'America/Toronto', payload: {} },
  { key: 'ingest_all_sources', name: 'Ingest all active lead sources', jobName: 'ingest.all_sources', cron: '0 */3 * * *', timezone: 'America/Toronto', payload: {} },
  { key: 'process_pending_records', name: 'Process pending source records', jobName: 'pipeline.process_pending', cron: '*/15 * * * *', timezone: 'America/Toronto', payload: {} },
  { key: 'followup_sweep', name: 'Follow-up due/overdue sweep', jobName: 'followups.sweep', cron: '*/10 * * * *', timezone: 'America/Toronto', payload: {} },
  { key: 'shift_monitor', name: 'Shift inactivity and lateness monitor', jobName: 'shifts.monitor', cron: '*/5 * * * *', timezone: 'America/Toronto', payload: {} },
  { key: 'daily_reports', name: 'Daily rollups and integration health', jobName: 'reports.daily', cron: '30 23 * * *', timezone: 'America/Toronto', payload: {} },
  { key: 'monthly_report', name: 'Monthly report', jobName: 'reports.monthly', cron: '0 7 1 * *', timezone: 'America/Toronto', payload: {} },
  { key: 'calendar_sync', name: 'Google Calendar meeting sync', jobName: 'calendar.sync', cron: '*/20 * * * *', timezone: 'America/Toronto', payload: {} },
  { key: 'session_cleanup', name: 'Expire old sessions', jobName: 'maintenance.cleanup', cron: '0 4 * * *', timezone: 'America/Toronto', payload: {} },
];
