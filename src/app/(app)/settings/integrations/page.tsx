import { getSetting } from '@/lib/settings/service';
import { listIntegrationStatuses } from '@/lib/integrations/store';
import { buildAuthUrl, googleClientConfig } from '@/lib/integrations/google-oauth';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Alert, Card } from '@/components/ui';
import { IntegrationCard, SettingsForm, type FieldSpec } from '@/components/settings-panels';
import { CsvImportPanel } from '@/components/ingestion-panels';

export const dynamic = 'force-dynamic';

const NOTIFICATION_FIELDS: FieldSpec[] = [
  { name: 'emailEnabled', label: 'Send email notifications', type: 'boolean', hint: 'Requires SMTP_URL to be set on the server.' },
  { name: 'slackEnabled', label: 'Send Slack notifications', type: 'boolean', hint: 'Slack delivery is a later phase; in-app alerts still work.' },
  { name: 'alertOnShiftStart', label: 'Alert when a shift starts', type: 'boolean' },
  { name: 'alertOnShiftEnd', label: 'Alert when a shift ends', type: 'boolean' },
  { name: 'alertOnMissedShift', label: 'Alert on a missed planned shift', type: 'boolean' },
  { name: 'alertOnInactivity', label: 'Alert on excessive inactivity', type: 'boolean' },
  { name: 'alertOnHighScoreLead', label: 'Alert on a high-scoring lead', type: 'boolean' },
  { name: 'highScoreLeadThreshold', label: 'High-score threshold', type: 'number', min: 0, max: 100 },
  { name: 'alertOnInterested', label: 'Alert when a lead becomes interested', type: 'boolean' },
  { name: 'alertOnMeetingBooked', label: 'Alert when a meeting is booked', type: 'boolean' },
  { name: 'alertOnLeadShortage', label: 'Alert on a qualified-lead shortage', type: 'boolean' },
  { name: 'alertOnIntegrationFailure', label: 'Alert on integration failures', type: 'boolean' },
];

export default async function IntegrationsSettingsPage() {
  const statuses = await listIntegrationStatuses();
  const notifications = await getSetting('notifications.policy');
  const google = googleClientConfig();

  const byKind = new Map(statuses.map((s) => [s.kind, s]));
  const fmt = (d: Date | null) => (d ? formatInTz(d, DEFAULT_TIMEZONE) : null);

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Nothing claims to work until it has been tested">
        An integration stays &ldquo;configured, untested&rdquo; until a live connection test succeeds. Credentials
        are encrypted at rest and never shown back to you.
      </Alert>

      {!google && (
        <Alert tone="warn" title="Google OAuth client is not configured">
          Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the server environment,
          then reload this page to authorise Gmail and Calendar.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <IntegrationCard
          kind="GMAIL"
          title="Gmail — lead inbox"
          description="Reads labelled alert emails (Google Alerts, Indeed, LinkedIn, forwards). Read-only: nothing in your mailbox is modified."
          secretFields={[
            { name: 'refreshToken', label: 'OAuth refresh token', hint: 'Filled automatically by the authorise flow.' },
          ]}
          configFields={[]}
          status={byKind.get('GMAIL')?.status ?? 'NOT_CONFIGURED'}
          isEnabled={byKind.get('GMAIL')?.isEnabled ?? false}
          hasCredentials={byKind.get('GMAIL')?.hasCredentials ?? false}
          lastError={byKind.get('GMAIL')?.lastError ?? null}
          lastTestedAt={fmt(byKind.get('GMAIL')?.lastTestedAt ?? null)}
          canTest
          authUrl={google ? buildAuthUrl('GMAIL', 'gmail') : null}
        />

        <IntegrationCard
          kind="GOOGLE_CALENDAR"
          title="Google Calendar — meeting invitations"
          description="Creates invitations from inside a lead ticket and marks the ticket booked when the contact accepts."
          secretFields={[{ name: 'refreshToken', label: 'OAuth refresh token' }]}
          status={byKind.get('GOOGLE_CALENDAR')?.status ?? 'NOT_CONFIGURED'}
          isEnabled={byKind.get('GOOGLE_CALENDAR')?.isEnabled ?? false}
          hasCredentials={byKind.get('GOOGLE_CALENDAR')?.hasCredentials ?? false}
          lastError={byKind.get('GOOGLE_CALENDAR')?.lastError ?? null}
          lastTestedAt={fmt(byKind.get('GOOGLE_CALENDAR')?.lastTestedAt ?? null)}
          canTest
          authUrl={google ? buildAuthUrl('GOOGLE_CALENDAR', 'calendar') : null}
        />

        <IntegrationCard
          kind="GOOGLE_PLACES"
          title="Google Places — local company discovery"
          description="Finds companies by industry and geography for cold outbound, through the official paid API."
          secretFields={[{ name: 'apiKey', label: 'Places API key' }]}
          status={byKind.get('GOOGLE_PLACES')?.status ?? 'NOT_CONFIGURED'}
          isEnabled={byKind.get('GOOGLE_PLACES')?.isEnabled ?? false}
          hasCredentials={byKind.get('GOOGLE_PLACES')?.hasCredentials ?? false}
          lastError={byKind.get('GOOGLE_PLACES')?.lastError ?? null}
          lastTestedAt={fmt(byKind.get('GOOGLE_PLACES')?.lastTestedAt ?? null)}
          canTest
        />

        <IntegrationCard
          kind="AI_ANTHROPIC"
          title="Anthropic"
          description="Structured lead qualification. Without a key the pipeline still runs on the offline rules engine, at lower confidence."
          secretFields={[{ name: 'apiKey', label: 'Anthropic API key' }]}
          status={byKind.get('AI_ANTHROPIC')?.status ?? 'NOT_CONFIGURED'}
          isEnabled={byKind.get('AI_ANTHROPIC')?.isEnabled ?? false}
          hasCredentials={byKind.get('AI_ANTHROPIC')?.hasCredentials ?? false}
          lastError={byKind.get('AI_ANTHROPIC')?.lastError ?? null}
          lastTestedAt={fmt(byKind.get('AI_ANTHROPIC')?.lastTestedAt ?? null)}
          canTest
        />

        <IntegrationCard
          kind="AI_OPENAI"
          title="OpenAI"
          description="Alternative qualification provider. Switch between providers on the General settings page."
          secretFields={[{ name: 'apiKey', label: 'OpenAI API key' }]}
          status={byKind.get('AI_OPENAI')?.status ?? 'NOT_CONFIGURED'}
          isEnabled={byKind.get('AI_OPENAI')?.isEnabled ?? false}
          hasCredentials={byKind.get('AI_OPENAI')?.hasCredentials ?? false}
          lastError={byKind.get('AI_OPENAI')?.lastError ?? null}
          lastTestedAt={fmt(byKind.get('AI_OPENAI')?.lastTestedAt ?? null)}
          canTest
        />

        <IntegrationCard
          kind="CALLING_TWILIO"
          title="Twilio — verified call logging (Phase 3)"
          description="Once connected, call attempts are captured automatically and labelled Verified instead of Manually reported."
          secretFields={[
            { name: 'accountSid', label: 'Account SID' },
            { name: 'authToken', label: 'Auth token' },
          ]}
          status={byKind.get('CALLING_TWILIO')?.status ?? 'NOT_CONFIGURED'}
          isEnabled={byKind.get('CALLING_TWILIO')?.isEnabled ?? false}
          hasCredentials={byKind.get('CALLING_TWILIO')?.hasCredentials ?? false}
          lastError={byKind.get('CALLING_TWILIO')?.lastError ?? null}
          lastTestedAt={fmt(byKind.get('CALLING_TWILIO')?.lastTestedAt ?? null)}
          canTest={false}
        />
      </div>

      <Card title="Notification rules">
        <SettingsForm settingKey="notifications.policy" fields={NOTIFICATION_FIELDS} values={notifications} />
      </Card>

      <Card title="CSV import" subtitle="Bring an existing list in. Every row becomes a preserved source record.">
        <CsvImportPanel />
      </Card>
    </div>
  );
}
