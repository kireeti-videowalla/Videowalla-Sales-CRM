import { getSetting } from '@/lib/settings/service';
import { Card } from '@/components/ui';
import { SettingsForm, type FieldSpec } from '@/components/settings-panels';

export const dynamic = 'force-dynamic';

const CAPACITY_FIELDS: FieldSpec[] = [
  { name: 'weeklyHours', label: 'Default weekly paid hours', type: 'number', step: '0.5', min: 0, hint: 'Per-person schedules on the Team page override this.' },
  { name: 'shiftOverheadMinutes', label: 'Overhead per shift (minutes)', type: 'number', min: 0, hint: 'Clocking in and out, reading the plan.' },
  { name: 'weeklyAdminMinutes', label: 'Weekly admin allowance (minutes)', type: 'number', min: 0 },
  { name: 'minutesPerNewContact', label: 'Minutes per new contact', type: 'number', min: 1 },
  { name: 'minutesPerFollowUp', label: 'Minutes per follow-up', type: 'number', min: 1 },
  { name: 'minutesPerInterestedAction', label: 'Minutes per interested-lead action', type: 'number', min: 1 },
  { name: 'minutesPerMeetingAction', label: 'Minutes per meeting action', type: 'number', min: 1 },
  { name: 'defaultTotalContactsMin', label: 'Default weekly range — minimum', type: 'number', min: 1 },
  { name: 'defaultTotalContactsMax', label: 'Default weekly range — maximum', type: 'number', min: 1 },
  { name: 'minTotalContacts', label: 'Hard minimum contacts', type: 'number', min: 1, hint: 'Never applied beyond what the paid hours allow.' },
  { name: 'maxTotalContacts', label: 'Hard maximum contacts', type: 'number', min: 1 },
  { name: 'baselineConversationRate', label: 'Baseline conversation rate', type: 'number', step: '0.01', min: 0, max: 1, hint: 'Used only until this salesperson has 20+ contacts of real history.' },
  { name: 'baselineInterestRate', label: 'Baseline interest rate', type: 'number', step: '0.01', min: 0, max: 1 },
  { name: 'baselineMeetingRate', label: 'Baseline meeting rate', type: 'number', step: '0.01', min: 0, max: 1 },
  { name: 'leadBufferMultiplier', label: 'Lead buffer multiplier', type: 'number', step: '0.1', min: 1, hint: '1.4 prepares 40% more leads than the new-contact target.' },
];

const SUNDAY_FIELDS: FieldSpec[] = [
  { name: 'enabled', label: 'Run weekly planning automatically', type: 'boolean' },
  { name: 'timezone', label: 'Timezone', type: 'text' },
  {
    name: 'weekday',
    label: 'Day',
    type: 'select',
    options: [
      { value: '0', label: 'Sunday' },
      { value: '1', label: 'Monday' },
      { value: '2', label: 'Tuesday' },
      { value: '3', label: 'Wednesday' },
      { value: '4', label: 'Thursday' },
      { value: '5', label: 'Friday' },
      { value: '6', label: 'Saturday' },
    ],
  },
  { name: 'hour', label: 'Hour (0-23)', type: 'number', min: 0, max: 23 },
  { name: 'minute', label: 'Minute', type: 'number', min: 0, max: 59 },
  { name: 'autoApprove', label: 'Approve the plan automatically', type: 'boolean', hint: 'Off by default so you always see the week before it starts.' },
  { name: 'discoveryEnabled', label: 'Search for new companies during planning', type: 'boolean' },
  { name: 'maxDiscoveryResults', label: 'Maximum new companies per run', type: 'number', min: 0 },
];

const SHIFT_FIELDS: FieldSpec[] = [
  { name: 'lateThresholdMinutes', label: 'Late after (minutes)', type: 'number', min: 0 },
  { name: 'inactivityAlertMinutes', label: 'Inactivity alert after (minutes)', type: 'number', min: 1 },
  { name: 'noTicketOpenedMinutes', label: 'Alert if no lead opened within (minutes)', type: 'number', min: 1 },
  { name: 'noContactInFirstHour', label: 'Alert if no contact in the first hour', type: 'boolean' },
  { name: 'halfShiftProgressThreshold', label: 'Behind-pace threshold at half shift', type: 'number', step: '0.05', min: 0, max: 1, hint: '0.25 means alert below 25% of the expected pace.' },
  { name: 'requireEndOfShiftNotes', label: 'Warn about missing notes at shift end', type: 'boolean' },
  { name: 'autoEndAfterHours', label: 'Auto-end a forgotten shift after (hours)', type: 'number', min: 1, hint: 'Credits time only up to the last real activity.' },
];

const SCORE_FIELDS: FieldSpec[] = [
  { name: 'attendanceWeight', label: 'Attendance and scheduled hours', type: 'number', min: 0 },
  { name: 'contactsWeight', label: 'Completion of assigned contacts', type: 'number', min: 0 },
  { name: 'followUpsWeight', label: 'Completion of follow-ups', type: 'number', min: 0 },
  { name: 'notesQualityWeight', label: 'Quality and completeness of notes', type: 'number', min: 0 },
  { name: 'conversationsWeight', label: 'Real conversations', type: 'number', min: 0 },
  { name: 'interestedWeight', label: 'Interested opportunities', type: 'number', min: 0 },
  { name: 'meetingsWeight', label: 'Meetings booked', type: 'number', min: 0 },
  { name: 'minimumNoteLength', label: 'A note must be this long to count', type: 'number', min: 0 },
];

export default async function SprintSettingsPage() {
  const [capacity, sunday, shifts, score] = await Promise.all([
    getSetting('sprint.capacity'),
    getSetting('sprint.sundayPlanning'),
    getSetting('shifts.policy'),
    getSetting('performance.score'),
  ]);

  return (
    <div className="space-y-6">
      <Card
        title="Weekly planning schedule"
        subtitle="When the automation closes the week, gathers leads and proposes the next plan."
      >
        <SettingsForm settingKey="sprint.sundayPlanning" fields={SUNDAY_FIELDS} values={sunday} />
      </Card>

      <Card
        title="Capacity and targets"
        subtitle="How weekly targets are derived from the paid hours. The plan can never exceed the available time."
      >
        <SettingsForm settingKey="sprint.capacity" fields={CAPACITY_FIELDS} values={capacity} />
      </Card>

      <Card title="Shift policy" subtitle="Lateness, inactivity and end-of-shift rules.">
        <SettingsForm settingKey="shifts.policy" fields={SHIFT_FIELDS} values={shifts} />
      </Card>

      <Card
        title="Weekly performance score"
        subtitle="Weights for the 0-100 salesperson score. Only measurable data is used."
      >
        <SettingsForm settingKey="performance.score" fields={SCORE_FIELDS} values={score} />
      </Card>
    </div>
  );
}
