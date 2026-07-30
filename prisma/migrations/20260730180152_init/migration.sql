-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'SALES_REP', 'MANAGER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'HIGH_CONFIDENCE', 'MEDIUM_CONFIDENCE', 'LOW_CONFIDENCE', 'UNVERIFIED', 'INVALID');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('GMAIL_MESSAGE', 'GOOGLE_ALERT', 'JOB_ALERT_EMAIL', 'INDEED_ALERT_EMAIL', 'LINKEDIN_ALERT_EMAIL', 'CAREER_PAGE', 'JOB_BOARD_API', 'PLACES_API', 'BUSINESS_DIRECTORY', 'COMPANY_WEBSITE', 'RSS_FEED', 'CSV_IMPORT', 'MANUAL_URL', 'MANUAL_ENTRY', 'EXISTING_CRM');

-- CreateEnum
CREATE TYPE "SourceRecordStatus" AS ENUM ('RECEIVED', 'PARSED', 'EXTRACTED', 'DUPLICATE', 'QUALIFIED', 'DISQUALIFIED', 'MANUAL_REVIEW', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OpportunityKind" AS ENUM ('HIRING_INTENT', 'COLD_OUTBOUND', 'INBOUND', 'REFERRAL');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'PROCESSING', 'QUALIFIED', 'MANUAL_REVIEW', 'DISQUALIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('PRIORITY', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "ScoreBand" AS ENUM ('PRIORITY_LEAD', 'QUALIFIED_LEAD', 'REVIEW_REQUIRED', 'LOW_PRIORITY', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "StageCategory" AS ENUM ('INTAKE', 'READY', 'CONTACTED', 'ENGAGED', 'MEETING', 'CLOSED_WON', 'CLOSED_LOST', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('PHONE', 'EMAIL', 'SMS', 'LINKEDIN', 'INSTAGRAM', 'WEBSITE_FORM', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactVerification" AS ENUM ('VERIFIED_BY_INTEGRATION', 'MANUALLY_REPORTED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SCHEDULED', 'DUE', 'OVERDUE', 'COMPLETED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FollowUpReasonKind" AS ENUM ('NO_ANSWER_RETRY', 'LONG_TERM_RETRY', 'INTERESTED_PROMISED', 'MEETING_INVITE_UNCONFIRMED', 'REACTIVATION', 'ENRICHMENT_REQUIRED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ShiftEventKind" AS ENUM ('STARTED', 'PAUSED', 'RESUMED', 'ENDED', 'AUTO_ENDED');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('SHIFT_STARTED', 'SHIFT_PAUSED', 'SHIFT_RESUMED', 'SHIFT_ENDED', 'LEAD_OPENED', 'LEAD_RESEARCHED', 'CONTACT_INFO_VIEWED', 'TICKET_MOVED', 'CONTACT_ATTEMPT_LOGGED', 'NOTE_ADDED', 'NOTE_EDITED', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_COMPLETED', 'MEETING_INVITE_SENT', 'MEETING_BOOKED', 'STAGE_CHANGED', 'LEAD_ASSIGNED', 'SETTINGS_CHANGED');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SLACK');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('SHIFT', 'WEEKLY', 'MONTHLY', 'SUNDAY_SUMMARY');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('GMAIL', 'GOOGLE_CALENDAR', 'GOOGLE_PLACES', 'AI_ANTHROPIC', 'AI_OPENAI', 'ENRICHMENT_HTTP', 'CALLING_TWILIO', 'CALLING_GOHIGHLEVEL', 'SMTP_EMAIL', 'SLACK');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'CONFIGURED_UNTESTED', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('INVITE_DRAFTED', 'INVITE_SENT', 'CONFIRMED', 'DECLINED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "passwordHash" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "phone" TEXT,
    "avatarColor" TEXT NOT NULL DEFAULT '#2563eb',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CITY',
    "country" TEXT NOT NULL DEFAULT 'CA',
    "province" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radiusKm" INTEGER NOT NULL DEFAULT 25,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rotationOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryLocation" (
    "territoryId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "TerritoryLocation_pkey" PRIMARY KEY ("territoryId","locationId")
);

-- CreateTable
CREATE TABLE "TerritoryIndustry" (
    "territoryId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,

    CONSTRAINT "TerritoryIndustry_pkey" PRIMARY KEY ("territoryId","industryId")
);

-- CreateTable
CREATE TABLE "KeywordGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalizedTerm" TEXT NOT NULL,
    "groupId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "industrySlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scoreBoost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StageCategory" NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "description" TEXT,
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "automations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactOutcomeType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "targetStageKey" TEXT,
    "countsAsConversation" BOOLEAN NOT NULL DEFAULT false,
    "countsAsContact" BOOLEAN NOT NULL DEFAULT true,
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "requiresFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactOutcomeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "thresholds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringFactor" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 100,
    "description" TEXT,

    CONSTRAINT "ScoringFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reasonKind" "FollowUpReasonKind" NOT NULL,
    "attemptNumber" INTEGER,
    "delayDays" INTEGER NOT NULL,
    "delayBusinessDays" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompensationSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weeklyPayCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "hourlyRateCents" INTEGER,
    "weeklyHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "payCadence" TEXT NOT NULL DEFAULT 'BIWEEKLY',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompensationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weeklyHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "plannedShifts" JSONB NOT NULL DEFAULT '[]',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "kind" "SourceKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" "SourceRecordStatus" NOT NULL DEFAULT 'RECEIVED',
    "subject" TEXT,
    "sender" TEXT,
    "receivedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "rawPayload" JSONB NOT NULL,
    "parsedPayload" JSONB,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "websiteDomain" TEXT,
    "description" TEXT,
    "industryId" TEXT,
    "industryLabel" TEXT,
    "locationId" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "province" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'CA',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "serviceArea" TEXT,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "email" TEXT,
    "linkedinUrl" TEXT,
    "instagramUrl" TEXT,
    "facebookUrl" TEXT,
    "logoUrl" TEXT,
    "locationCount" INTEGER,
    "yearsInBusiness" INTEGER,
    "reviewCount" INTEGER,
    "reviewRating" DOUBLE PRECISION,
    "isActiveBusiness" BOOLEAN NOT NULL DEFAULT true,
    "employeeCountMin" INTEGER,
    "employeeCountMax" INTEGER,
    "employeeCountSource" TEXT,
    "employeeCountConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "employeeCountCheckedAt" TIMESTAMP(3),
    "employeeCountVerified" BOOLEAN NOT NULL DEFAULT false,
    "revenueMinCents" BIGINT,
    "revenueMaxCents" BIGINT,
    "revenueSource" TEXT,
    "revenueConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "revenueCheckedAt" TIMESTAMP(3),
    "revenueVerified" BOOLEAN NOT NULL DEFAULT false,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "doNotContactReason" TEXT,
    "doNotContactAt" TIMESTAMP(3),
    "doNotContactById" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "title" TEXT,
    "roleKind" TEXT NOT NULL DEFAULT 'OTHER',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "phoneSource" TEXT,
    "phoneStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "phoneCheckedAt" TIMESTAMP(3),
    "email" TEXT,
    "emailSource" TEXT,
    "emailStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "emailCheckedAt" TIMESTAMP(3),
    "linkedinUrl" TEXT,
    "instagramUrl" TEXT,
    "discoverySource" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPosting" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "externalPostingId" TEXT,
    "roleCategory" TEXT,
    "employmentType" TEXT,
    "locationText" TEXT,
    "salaryText" TEXT,
    "postedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUrl" TEXT,
    "sourcePlatform" TEXT,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "descriptionText" TEXT,
    "matchedKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "jobPostingId" TEXT,
    "sourceRecordId" TEXT,
    "kind" "OpportunityKind" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
    "dedupeKey" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT,
    "whatTheyAreLookingFor" TEXT,
    "marketingProblem" TEXT,
    "whyContact" TEXT,
    "recommendedService" TEXT,
    "suggestedOpening" TEXT,
    "suggestedEmail" TEXT,
    "suggestedFollowUp" TEXT,
    "likelyDecisionMaker" TEXT,
    "missingInformation" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiRawOutput" JSONB,
    "aiProcessedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postingAgeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB,
    "source" TEXT,
    "sourceUrl" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
    "status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScore" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "ticketId" TEXT,
    "score" INTEGER NOT NULL,
    "band" "ScoreBand" NOT NULL,
    "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "explanation" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTicket" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "primaryContactId" TEXT,
    "stageId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "sprintId" TEXT,
    "territoryId" TEXT,
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "score" INTEGER NOT NULL DEFAULT 0,
    "band" "ScoreBand" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "queuePosition" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastOutcomeKey" TEXT,
    "connectedCount" INTEGER NOT NULL DEFAULT 0,
    "nextActionLabel" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "interestLevel" TEXT,
    "disqualifiedReason" TEXT,
    "notInterestedReason" TEXT,
    "reactivationAt" TIMESTAMP(3),
    "isCarryover" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageHistory" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "userId" TEXT,
    "sprintId" TEXT,
    "shiftId" TEXT,
    "requiredNextAction" TEXT,
    "followUpId" TEXT,
    "automated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StageHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactAttempt" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT NOT NULL,
    "shiftId" TEXT,
    "sprintId" TEXT,
    "channel" "ContactChannel" NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "outcomeKey" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "verification" "ContactVerification" NOT NULL,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "isConversation" BOOLEAN NOT NULL DEFAULT false,
    "durationSeconds" INTEGER,
    "providerEventId" TEXT,
    "providerName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,
    "followUpId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "companyId" TEXT,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteRevision" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "previousBody" TEXT NOT NULL,
    "editedById" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "ownerId" TEXT,
    "sprintId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reasonKind" "FollowUpReasonKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "channel" "ContactChannel" NOT NULL DEFAULT 'PHONE',
    "ruleKey" TEXT,
    "attemptNumber" INTEGER,
    "note" TEXT,
    "automated" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "createdById" TEXT NOT NULL,
    "sprintId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE_CALENDAR',
    "externalEventId" TEXT,
    "calendarId" TEXT,
    "htmlLink" TEXT,
    "meetingType" TEXT NOT NULL DEFAULT 'DISCOVERY_CALL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "attendees" JSONB NOT NULL DEFAULT '[]',
    "status" "MeetingStatus" NOT NULL DEFAULT 'INVITE_DRAFTED',
    "inviteSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sprintId" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
    "lastResumedAt" TIMESTAMP(3),
    "plannedStartAt" TIMESTAMP(3),
    "plannedHours" DOUBLE PRECISION,
    "startedLateMinutes" INTEGER,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftEvent" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "kind" "ShiftEventKind" NOT NULL,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "ticketId" TEXT,
    "shiftId" TEXT,
    "sprintId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklySprint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'DRAFT',
    "availableHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "plannedShifts" JSONB NOT NULL DEFAULT '[]',
    "priorityLocationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priorityIndustryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instructions" TEXT,
    "planningNotes" TEXT,
    "targetRationale" JSONB,
    "leadShortfall" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklySprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintTerritory" (
    "sprintId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,

    CONSTRAINT "SprintTerritory_pkey" PRIMARY KEY ("sprintId","territoryId")
);

-- CreateTable
CREATE TABLE "SprintTarget" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "suggestedTarget" INTEGER NOT NULL,
    "overriddenById" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "rationale" TEXT,
    "position" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "SprintTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyScorecard" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduledHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inactiveHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contactsCompleted" INTEGER NOT NULL DEFAULT 0,
    "verifiedContacts" INTEGER NOT NULL DEFAULT 0,
    "manualContacts" INTEGER NOT NULL DEFAULT 0,
    "newContacts" INTEGER NOT NULL DEFAULT 0,
    "followUpsCompleted" INTEGER NOT NULL DEFAULT 0,
    "followUpsOutstanding" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "interestedLeads" INTEGER NOT NULL DEFAULT 0,
    "meetingInvitesSent" INTEGER NOT NULL DEFAULT 0,
    "meetingsBooked" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesCreated" INTEGER NOT NULL DEFAULT 0,
    "notesWritten" INTEGER NOT NULL DEFAULT 0,
    "notesRequired" INTEGER NOT NULL DEFAULT 0,
    "unfinishedTasks" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "scoreBreakdown" JSONB NOT NULL DEFAULT '[]',
    "targetCompletion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salespersonCostCents" INTEGER NOT NULL DEFAULT 0,
    "costPerContactCents" INTEGER,
    "costPerConversationCents" INTEGER,
    "costPerMeetingCents" INTEGER,
    "attributedRevenueCents" BIGINT,
    "isFrozen" BOOLEAN NOT NULL DEFAULT false,
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueAttribution" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "amountCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "stage" TEXT NOT NULL DEFAULT 'WON',
    "closedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "linkUrl" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deliveryError" TEXT,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "slack" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "userId" TEXT,
    "sprintId" TEXT,
    "shiftId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secretsCiphertext" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationFailure" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "idempotencyKey" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobFailure" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_acceptedById_key" ON "Invitation"("acceptedById");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_name_key" ON "Industry"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_slug_key" ON "Industry"("slug");

-- CreateIndex
CREATE INDEX "Industry_isActive_priority_idx" ON "Industry"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- CreateIndex
CREATE INDEX "Location_isActive_priority_idx" ON "Location"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_name_key" ON "Territory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordGroup_name_key" ON "KeywordGroup"("name");

-- CreateIndex
CREATE INDEX "Keyword_isActive_priority_idx" ON "Keyword"("isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_normalizedTerm_key" ON "Keyword"("normalizedTerm");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_key_key" ON "PipelineStage"("key");

-- CreateIndex
CREATE INDEX "PipelineStage_isActive_position_idx" ON "PipelineStage"("isActive", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ContactOutcomeType_key_key" ON "ContactOutcomeType"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringProfile_name_key" ON "ScoringProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringFactor_profileId_key_key" ON "ScoringFactor"("profileId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpRule_key_key" ON "FollowUpRule"("key");

-- CreateIndex
CREATE INDEX "CompensationSetting_userId_effectiveFrom_idx" ON "CompensationSetting"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkSchedule_userId_effectiveFrom_idx" ON "WorkSchedule"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_key_key" ON "LeadSource"("key");

-- CreateIndex
CREATE INDEX "LeadSource_isActive_priority_idx" ON "LeadSource"("isActive", "priority");

-- CreateIndex
CREATE INDEX "SourceRecord_status_createdAt_idx" ON "SourceRecord"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SourceRecord_sourceUrl_idx" ON "SourceRecord"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_kind_externalId_key" ON "SourceRecord"("kind", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_websiteDomain_key" ON "Company"("websiteDomain");

-- CreateIndex
CREATE INDEX "Company_normalizedName_idx" ON "Company"("normalizedName");

-- CreateIndex
CREATE INDEX "Company_normalizedPhone_idx" ON "Company"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Company_city_province_idx" ON "Company"("city", "province");

-- CreateIndex
CREATE INDEX "Company_doNotContact_idx" ON "Company"("doNotContact");

-- CreateIndex
CREATE UNIQUE INDEX "Company_normalizedName_city_key" ON "Company"("normalizedName", "city");

-- CreateIndex
CREATE INDEX "Contact_companyId_isPrimary_idx" ON "Contact"("companyId", "isPrimary");

-- CreateIndex
CREATE INDEX "Contact_normalizedPhone_idx" ON "Contact"("normalizedPhone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_companyId_email_key" ON "Contact"("companyId", "email");

-- CreateIndex
CREATE INDEX "JobPosting_companyId_normalizedTitle_idx" ON "JobPosting"("companyId", "normalizedTitle");

-- CreateIndex
CREATE INDEX "JobPosting_postedAt_idx" ON "JobPosting"("postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobPosting_externalPostingId_key" ON "JobPosting"("externalPostingId");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_dedupeKey_key" ON "Opportunity"("dedupeKey");

-- CreateIndex
CREATE INDEX "Opportunity_status_discoveredAt_idx" ON "Opportunity"("status", "discoveredAt");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_idx" ON "Opportunity"("companyId");

-- CreateIndex
CREATE INDEX "EnrichmentRecord_companyId_field_idx" ON "EnrichmentRecord"("companyId", "field");

-- CreateIndex
CREATE INDEX "LeadScore_opportunityId_isCurrent_idx" ON "LeadScore"("opportunityId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "LeadTicket_reference_key" ON "LeadTicket"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "LeadTicket_opportunityId_key" ON "LeadTicket"("opportunityId");

-- CreateIndex
CREATE INDEX "LeadTicket_assigneeId_sprintId_idx" ON "LeadTicket"("assigneeId", "sprintId");

-- CreateIndex
CREATE INDEX "LeadTicket_stageId_queuePosition_idx" ON "LeadTicket"("stageId", "queuePosition");

-- CreateIndex
CREATE INDEX "LeadTicket_nextFollowUpAt_idx" ON "LeadTicket"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "LeadTicket_score_idx" ON "LeadTicket"("score");

-- CreateIndex
CREATE INDEX "StageHistory_ticketId_occurredAt_idx" ON "StageHistory"("ticketId", "occurredAt");

-- CreateIndex
CREATE INDEX "ContactAttempt_ticketId_createdAt_idx" ON "ContactAttempt"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactAttempt_userId_createdAt_idx" ON "ContactAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactAttempt_sprintId_idx" ON "ContactAttempt"("sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactAttempt_providerName_providerEventId_key" ON "ContactAttempt"("providerName", "providerEventId");

-- CreateIndex
CREATE INDEX "Note_ticketId_createdAt_idx" ON "Note"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteRevision_noteId_editedAt_idx" ON "NoteRevision"("noteId", "editedAt");

-- CreateIndex
CREATE INDEX "FollowUp_status_dueAt_idx" ON "FollowUp"("status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_ticketId_status_idx" ON "FollowUp"("ticketId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_ownerId_status_dueAt_idx" ON "FollowUp"("ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Meeting_ticketId_idx" ON "Meeting"("ticketId");

-- CreateIndex
CREATE INDEX "Meeting_startsAt_idx" ON "Meeting"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_provider_externalEventId_key" ON "Meeting"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "Shift_userId_startedAt_idx" ON "Shift"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- CreateIndex
CREATE INDEX "ShiftEvent_shiftId_occurredAt_idx" ON "ShiftEvent"("shiftId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_userId_occurredAt_idx" ON "ActivityEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_sprintId_kind_idx" ON "ActivityEvent"("sprintId", "kind");

-- CreateIndex
CREATE INDEX "ActivityEvent_ticketId_occurredAt_idx" ON "ActivityEvent"("ticketId", "occurredAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_occurredAt_idx" ON "ActivityEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "WeeklySprint_status_weekStart_idx" ON "WeeklySprint"("status", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklySprint_userId_weekStart_key" ON "WeeklySprint"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "SprintTarget_sprintId_key_key" ON "SprintTarget"("sprintId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyScorecard_sprintId_key" ON "WeeklyScorecard"("sprintId");

-- CreateIndex
CREATE INDEX "WeeklyScorecard_userId_createdAt_idx" ON "WeeklyScorecard"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyTarget_userId_year_month_key_key" ON "MonthlyTarget"("userId", "year", "month", "key");

-- CreateIndex
CREATE INDEX "RevenueAttribution_companyId_idx" ON "RevenueAttribution"("companyId");

-- CreateIndex
CREATE INDEX "RevenueAttribution_closedAt_idx" ON "RevenueAttribution"("closedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key_key" ON "NotificationPreference"("userId", "key");

-- CreateIndex
CREATE INDEX "Report_kind_periodStart_idx" ON "Report"("kind", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "Report_kind_userId_periodStart_key" ON "Report"("kind", "userId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_kind_key" ON "IntegrationConfig"("kind");

-- CreateIndex
CREATE INDEX "IntegrationFailure_occurredAt_idx" ON "IntegrationFailure"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Job_status_runAt_priority_idx" ON "Job"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "Job_name_status_idx" ON "Job"("name", "status");

-- CreateIndex
CREATE INDEX "JobFailure_jobId_idx" ON "JobFailure"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_key_key" ON "ScheduledJob"("key");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryLocation" ADD CONSTRAINT "TerritoryLocation_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryLocation" ADD CONSTRAINT "TerritoryLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryIndustry" ADD CONSTRAINT "TerritoryIndustry_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryIndustry" ADD CONSTRAINT "TerritoryIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoringFactor" ADD CONSTRAINT "ScoringFactor_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScoringProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompensationSetting" ADD CONSTRAINT "CompensationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPosting" ADD CONSTRAINT "JobPosting_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "JobPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "SourceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentRecord" ADD CONSTRAINT "EnrichmentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScoringProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScore" ADD CONSTRAINT "LeadScore_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTicket" ADD CONSTRAINT "LeadTicket_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageHistory" ADD CONSTRAINT "StageHistory_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactAttempt" ADD CONSTRAINT "ContactAttempt_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "ContactOutcomeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteRevision" ADD CONSTRAINT "NoteRevision_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftEvent" ADD CONSTRAINT "ShiftEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklySprint" ADD CONSTRAINT "WeeklySprint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTerritory" ADD CONSTRAINT "SprintTerritory_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTerritory" ADD CONSTRAINT "SprintTerritory_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintTarget" ADD CONSTRAINT "SprintTarget_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyScorecard" ADD CONSTRAINT "WeeklyScorecard_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyScorecard" ADD CONSTRAINT "WeeklyScorecard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "LeadTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAttribution" ADD CONSTRAINT "RevenueAttribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "WeeklySprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationFailure" ADD CONSTRAINT "IntegrationFailure_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFailure" ADD CONSTRAINT "JobFailure_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
