import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings/service';
import { Card } from '@/components/ui';
import { FollowUpRulesEditor, SettingsForm, type FieldSpec } from '@/components/settings-panels';

export const dynamic = 'force-dynamic';

const POLICY_FIELDS: FieldSpec[] = [
  { name: 'interestedDefaultDelayDays', label: 'Interested lead default delay (business days)', type: 'number', min: 0 },
  { name: 'meetingInviteUnconfirmedBusinessDays', label: 'Chase an unconfirmed invite after (business days)', type: 'number', min: 0 },
  { name: 'reactivationDays', label: 'Reactivation after (days)', type: 'number', min: 1 },
  { name: 'longTermRetryDays', label: 'Long-term retry after (days)', type: 'number', min: 1 },
  { name: 'maxAttemptsBeforeLongTerm', label: 'Attempts before switching to long-term', type: 'number', min: 1 },
  { name: 'dueHourLocal', label: 'Follow-ups become due at (local hour)', type: 'number', min: 0, max: 23 },
];

export default async function FollowUpSettingsPage() {
  const [policy, rules, outcomes] = await Promise.all([
    getSetting('followups.policy'),
    prisma.followUpRule.findMany({ orderBy: { position: 'asc' } }),
    prisma.contactOutcomeType.findMany({ orderBy: { position: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <Card
        title="Follow-up rules"
        subtitle="Applied automatically when an outcome is recorded. A follow-up is only ever closed by being completed or explicitly cancelled."
      >
        <FollowUpRulesEditor
          rules={rules.map((r) => ({
            id: r.id,
            key: r.key,
            label: r.label,
            delayDays: r.delayDays,
            delayBusinessDays: r.delayBusinessDays,
            isActive: r.isActive,
          }))}
        />
      </Card>

      <Card title="Timing policy">
        <SettingsForm settingKey="followups.policy" fields={POLICY_FIELDS} values={policy} />
      </Card>

      <Card title="Contact outcomes" subtitle="What the salesperson can choose after a call, and what each triggers.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-2 font-medium">Outcome</th>
                <th className="px-5 py-2 font-medium">Moves to</th>
                <th className="px-5 py-2 font-medium">Counts as</th>
                <th className="px-5 py-2 font-medium">Requires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200">
              {outcomes.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-2 text-ink-900">{o.label}</td>
                  <td className="px-5 py-2 text-ink-600">
                    {o.targetStageKey?.replace(/_/g, ' ') ?? '—'}
                  </td>
                  <td className="px-5 py-2 text-ink-600">
                    {[o.countsAsContact ? 'contact' : null, o.countsAsConversation ? 'conversation' : null]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                  <td className="px-5 py-2 text-ink-600">
                    {[o.requiresNote ? 'note' : null, o.requiresFollowUp ? 'follow-up' : null]
                      .filter(Boolean)
                      .join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
