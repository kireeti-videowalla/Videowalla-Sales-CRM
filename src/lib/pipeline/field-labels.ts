/**
 * Human labels for the fields a pipeline stage can require.
 *
 * Kept in its own module with no server imports so client components (the stage
 * configuration editor) can use it without pulling Prisma into the browser
 * bundle.
 */
export const FIELD_LABELS: Record<string, string> = {
  contactMethod: 'Contact method',
  attemptNumber: 'Attempt number',
  conversationSummary: 'Conversation summary',
  interestLevel: 'Interest level',
  mainProblem: 'Main problem discussed',
  nextAction: 'Next action',
  followUpDate: 'Follow-up date',
  followUpReason: 'Follow-up reason',
  interestSummary: 'What they are interested in',
  recommendedService: 'Recommended Videowalla service',
  expectedNextStep: 'Expected next step',
  contactEmail: 'Contact email',
  meetingType: 'Meeting type',
  proposedDate: 'Proposed date or booking method',
  notInterestedReason: 'Reason for not being interested',
  reactivationAppropriate: 'Whether reactivation is appropriate',
  disqualificationReason: 'Disqualification reason',
  doNotContactReason: 'Do-not-contact reason',
};

export const FIELD_LABEL_ENTRIES = Object.entries(FIELD_LABELS);
