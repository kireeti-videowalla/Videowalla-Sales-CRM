import type { SettingValue } from '../settings/definitions';

/**
 * Dynamic weekly target calculation.
 *
 * Deliberately NOT a fixed number. The engine starts from the hours actually
 * available, subtracts overhead, prices each activity type from configuration,
 * then allocates the remaining minutes across the work that already exists
 * (overdue follow-ups, interested leads, unconfirmed invites) before spending
 * whatever is left on new contacts.
 *
 * Pure function — no database, no clock — so it is fully unit-tested.
 */

export type CapacityConfig = SettingValue<'sprint.capacity'>;

export type TargetInputs = {
  availableHours: number;
  plannedShiftCount: number;
  /** Work carried in from the previous week. */
  overdueFollowUps: number;
  dueFollowUps: number;
  interestedAwaitingAction: number;
  unconfirmedInvites: number;
  /** How many prepared, contactable tickets actually exist. */
  availableNewLeads: number;
  /** Observed rates from history; null falls back to configured baselines. */
  historicalConversationRate: number | null;
  historicalInterestRate: number | null;
  historicalMeetingRate: number | null;
};

export type TargetSet = {
  totalContacts: number;
  newContacts: number;
  followUps: number;
  conversations: number;
  interested: number;
  meetings: number;
  /** Minutes of work the plan represents, for transparency. */
  plannedMinutes: number;
  availableMinutes: number;
  leadShortfall: number;
  rationale: string[];
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function calculateTargets(inputs: TargetInputs, config: CapacityConfig): TargetSet {
  const rationale: string[] = [];

  // --- 1. Usable minutes ---------------------------------------------------
  const grossMinutes = Math.max(0, inputs.availableHours) * 60;
  const overhead =
    inputs.plannedShiftCount * config.shiftOverheadMinutes + config.weeklyAdminMinutes;
  const availableMinutes = Math.max(0, grossMinutes - overhead);

  rationale.push(
    `${inputs.availableHours}h paid time = ${grossMinutes} minutes, minus ${overhead} minutes of shift and admin overhead (${inputs.plannedShiftCount} planned shift${inputs.plannedShiftCount === 1 ? '' : 's'}) leaves ${availableMinutes} working minutes.`,
  );

  if (availableMinutes === 0) {
    return {
      totalContacts: 0, newContacts: 0, followUps: 0, conversations: 0, interested: 0, meetings: 0,
      plannedMinutes: 0, availableMinutes: 0, leadShortfall: 0,
      rationale: [...rationale, 'No working time available, so no targets were set.'],
    };
  }

  let remaining = availableMinutes;

  // --- 2. Committed work first --------------------------------------------
  // Overdue and due follow-ups are obligations, not choices, so they are
  // funded before any new outbound.
  const followUpDemand = inputs.overdueFollowUps + inputs.dueFollowUps;
  const followUpMinutesEach = config.minutesPerFollowUp;
  const affordableFollowUps = Math.floor(remaining / followUpMinutesEach);
  const followUps = Math.min(followUpDemand, affordableFollowUps);
  remaining -= followUps * followUpMinutesEach;

  if (followUpDemand > 0) {
    rationale.push(
      `${followUpDemand} follow-up${followUpDemand === 1 ? '' : 's'} carried in (${inputs.overdueFollowUps} overdue, ${inputs.dueFollowUps} due). Scheduled ${followUps} at ${followUpMinutesEach} min each.` +
        (followUps < followUpDemand ? ` ${followUpDemand - followUps} did not fit and stay queued.` : ''),
    );
  }

  const interestedActions = Math.min(
    inputs.interestedAwaitingAction,
    Math.floor(remaining / config.minutesPerInterestedAction),
  );
  remaining -= interestedActions * config.minutesPerInterestedAction;
  if (inputs.interestedAwaitingAction > 0) {
    rationale.push(
      `${interestedActions} interested lead${interestedActions === 1 ? '' : 's'} need follow-through at ${config.minutesPerInterestedAction} min each.`,
    );
  }

  const inviteActions = Math.min(
    inputs.unconfirmedInvites,
    Math.floor(remaining / config.minutesPerMeetingAction),
  );
  remaining -= inviteActions * config.minutesPerMeetingAction;
  if (inputs.unconfirmedInvites > 0) {
    rationale.push(
      `${inviteActions} meeting invitation${inviteActions === 1 ? '' : 's'} awaiting confirmation at ${config.minutesPerMeetingAction} min each.`,
    );
  }

  // --- 3. New contacts with what is left -----------------------------------
  const affordableNewContacts = Math.max(0, Math.floor(remaining / config.minutesPerNewContact));
  let newContacts = affordableNewContacts;

  // Capped by leads that actually exist. Promising 35 calls with 12 tickets
  // prepared would be a target the rep cannot meet.
  const leadShortfall = Math.max(0, newContacts - inputs.availableNewLeads);
  if (leadShortfall > 0) {
    rationale.push(
      `Time allowed ${newContacts} new contacts but only ${inputs.availableNewLeads} qualified leads are prepared — target reduced and a lead shortage flagged.`,
    );
    newContacts = inputs.availableNewLeads;
  } else {
    rationale.push(`Remaining ${remaining} minutes fund ${newContacts} new contacts at ${config.minutesPerNewContact} min each.`);
  }

  // --- 4. Total contacts, bounded by policy --------------------------------
  let totalContacts = newContacts + followUps + interestedActions + inviteActions;
  const softMin = config.defaultTotalContactsMin;
  const softMax = config.defaultTotalContactsMax;
  const hardMin = config.minTotalContacts;
  const hardMax = config.maxTotalContacts;

  if (totalContacts > hardMax) {
    const excess = totalContacts - hardMax;
    newContacts = Math.max(0, newContacts - excess);
    totalContacts = hardMax;
    rationale.push(`Capped at the configured maximum of ${hardMax} total contacts.`);
  } else if (totalContacts > softMax && newContacts > 0) {
    const excess = totalContacts - softMax;
    newContacts = Math.max(0, newContacts - excess);
    totalContacts = newContacts + followUps + interestedActions + inviteActions;
    rationale.push(`Trimmed toward the ${softMin}-${softMax} default weekly range.`);
  }

  // The configured minimum is a policy floor for a normal week, never a licence
  // to assign more work than the paid hours can hold. A short week correctly
  // produces a small target instead of an impossible one.
  if (totalContacts < hardMin) {
    const roomFromLeads = Math.max(0, inputs.availableNewLeads - newContacts);
    const roomFromTime = Math.max(0, affordableNewContacts - newContacts);
    const room = Math.min(hardMin - totalContacts, roomFromLeads, roomFromTime);
    if (room > 0) {
      newContacts += room;
      totalContacts += room;
      rationale.push(`Raised toward the configured minimum of ${hardMin} total contacts.`);
    }
    if (totalContacts < hardMin) {
      rationale.push(
        `Below the configured ${hardMin}-contact minimum because ${
          roomFromTime === 0 ? 'the available hours do not allow more' : 'not enough qualified leads are prepared'
        }. The plan matches real capacity rather than the policy floor.`,
      );
    }
  }

  // --- 5. Downstream targets from conversion rates --------------------------
  const conversationRate = inputs.historicalConversationRate ?? config.baselineConversationRate;
  const interestRate = inputs.historicalInterestRate ?? config.baselineInterestRate;
  const meetingRate = inputs.historicalMeetingRate ?? config.baselineMeetingRate;

  const conversations = Math.round(totalContacts * conversationRate);
  const interested = Math.max(
    interestedActions > 0 ? 1 : 0,
    Math.round(totalContacts * interestRate),
  );
  const meetings = Math.max(
    inviteActions > 0 ? 1 : 0,
    Math.round(totalContacts * meetingRate),
  );

  rationale.push(
    `Downstream targets use a ${Math.round(conversationRate * 100)}% conversation rate, ${Math.round(interestRate * 100)}% interest rate and ${Math.round(meetingRate * 100)}% meeting rate` +
      `${inputs.historicalConversationRate === null ? ' (configured baselines — no history yet)' : ' (from this salesperson’s own history)'}.`,
  );

  const plannedMinutes =
    newContacts * config.minutesPerNewContact +
    followUps * config.minutesPerFollowUp +
    interestedActions * config.minutesPerInterestedAction +
    inviteActions * config.minutesPerMeetingAction;

  return {
    totalContacts,
    newContacts,
    followUps: followUps + interestedActions + inviteActions,
    conversations,
    interested,
    meetings,
    plannedMinutes,
    availableMinutes,
    leadShortfall,
    rationale,
  };
}

/**
 * How many qualified tickets to prepare. Slightly more than the target, so a
 * few disqualifications mid-week do not leave the rep idle.
 */
export function leadsToPrepare(newContactTarget: number, config: CapacityConfig): number {
  return Math.ceil(clamp(newContactTarget * config.leadBufferMultiplier, 0, config.maxTotalContacts * 2));
}

export const TARGET_DEFINITIONS: Array<{ key: string; label: string; position: number }> = [
  { key: 'TOTAL_CONTACTS', label: 'Total contacts', position: 10 },
  { key: 'NEW_CONTACTS', label: 'New companies contacted', position: 20 },
  { key: 'FOLLOW_UPS', label: 'Follow-ups completed', position: 30 },
  { key: 'CONVERSATIONS', label: 'Real conversations', position: 40 },
  { key: 'INTERESTED', label: 'Interested leads', position: 50 },
  { key: 'MEETINGS', label: 'Meetings booked', position: 60 },
];
