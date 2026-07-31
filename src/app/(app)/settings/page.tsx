import { getSetting } from '@/lib/settings/service';
import { Card } from '@/components/ui';
import { SettingsForm, type FieldSpec } from '@/components/settings-panels';

export const dynamic = 'force-dynamic';

const COMPANY_FIELDS: FieldSpec[] = [
  { name: 'companyName', label: 'Company name', type: 'text' },
  { name: 'leadInboxAddress', label: 'Dedicated lead inbox', type: 'text', hint: 'The address alerts are forwarded to.' },
  {
    name: 'pitchSummary',
    label: 'Positioning',
    type: 'textarea',
    hint: 'Used verbatim in the AI prompt when writing call openings.',
  },
  {
    name: 'services',
    label: 'Services offered',
    type: 'list',
    hint: 'One per line. These are what the AI matches a prospect’s need against.',
  },
];

const ICP_FIELDS: FieldSpec[] = [
  { name: 'minEmployees', label: 'Minimum employees', type: 'number', min: 0 },
  { name: 'maxEmployees', label: 'Maximum employees', type: 'number', min: 1 },
  { name: 'preferredMinEmployees', label: 'Preferred minimum employees', type: 'number', min: 0 },
  { name: 'preferredMaxEmployees', label: 'Preferred maximum employees', type: 'number', min: 1 },
  {
    name: 'minRevenueCents',
    label: 'Minimum estimated revenue (cents)',
    type: 'number',
    min: 0,
    hint: '50000000 = $500,000',
  },
  {
    name: 'preferredRevenueCents',
    label: 'Preferred estimated revenue (cents)',
    type: 'number',
    min: 0,
    hint: '100000000 = $1,000,000',
  },
  { name: 'countries', label: 'Target countries', type: 'list', hint: 'ISO-2 codes, one per line.' },
  { name: 'requireWebsiteOrListing', label: 'Require a website or business listing', type: 'boolean' },
  {
    name: 'disqualifyWithoutContact',
    label: 'Disqualify companies with no contact details',
    type: 'boolean',
    hint: 'Off by default — a strong company with missing contact data goes to Review Required instead of being thrown away.',
  },
];

const AI_FIELDS: FieldSpec[] = [
  {
    name: 'provider',
    label: 'Provider',
    type: 'select',
    options: [
      { value: 'auto', label: 'Automatic (Anthropic, then OpenAI, then rules)' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'rules', label: 'Offline rules engine only' },
    ],
    hint: 'The offline rules engine always works, with lower confidence, so the pipeline never stops.',
  },
  { name: 'anthropicModel', label: 'Anthropic model', type: 'text' },
  { name: 'openaiModel', label: 'OpenAI model', type: 'text' },
  { name: 'maxTokens', label: 'Max tokens per call', type: 'number', min: 256, max: 16000 },
  { name: 'temperature', label: 'Temperature', type: 'number', step: '0.1', min: 0, max: 1 },
  {
    name: 'manualReviewConfidenceThreshold',
    label: 'Manual review below this confidence',
    type: 'number',
    step: '0.05',
    min: 0,
    max: 1,
    hint: 'Anything less confident goes to a human instead of the call queue.',
  },
];

export default async function GeneralSettingsPage() {
  const [company, icp, ai] = await Promise.all([
    getSetting('company.profile'),
    getSetting('icp.criteria'),
    getSetting('ai.config'),
  ]);

  return (
    <div className="space-y-6">
      <Card title="Videowalla profile" subtitle="Feeds directly into every AI qualification prompt.">
        <SettingsForm settingKey="company.profile" fields={COMPANY_FIELDS} values={company} />
      </Card>

      <Card title="Ideal customer profile" subtitle="What counts as a good fit. Used by scoring and qualification.">
        <SettingsForm settingKey="icp.criteria" fields={ICP_FIELDS} values={icp} />
      </Card>

      <Card title="AI provider" subtitle="Not tied to one vendor — switch at any time.">
        <SettingsForm settingKey="ai.config" fields={AI_FIELDS} values={ai} />
      </Card>
    </div>
  );
}
