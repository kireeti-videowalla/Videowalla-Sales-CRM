import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings/service';
import { DEFAULT_TIMEZONE, formatInTz } from '@/lib/time';
import { Card } from '@/components/ui';
import {
  AddIndustryForm,
  AddLocationForm,
  KeywordManager,
  PriorityList,
  SettingsForm,
  SourceToggleList,
  type FieldSpec,
} from '@/components/settings-panels';
import { RunIngestionPanel } from '@/components/ingestion-panels';

export const dynamic = 'force-dynamic';

const POSTING_AGE_FIELDS: FieldSpec[] = [
  { name: 'highPriorityDays', label: 'High priority within (days)', type: 'number', min: 1 },
  { name: 'mediumPriorityDays', label: 'Medium priority within (days)', type: 'number', min: 1 },
  { name: 'lowPriorityDays', label: 'Lower priority within (days)', type: 'number', min: 1 },
  {
    name: 'olderBehaviour',
    label: 'Older than that',
    type: 'select',
    options: [
      { value: 'MANUAL_REVIEW', label: 'Send to manual review' },
      { value: 'ARCHIVE', label: 'Archive' },
      { value: 'REACTIVATE', label: 'Keep for reactivation' },
    ],
  },
];

export default async function DiscoverySettingsPage() {
  const [postingAge, keywords, groups, industries, locations, sources] = await Promise.all([
    getSetting('discovery.postingAge'),
    prisma.keyword.findMany({ orderBy: [{ priority: 'asc' }, { term: 'asc' }], include: { group: true } }),
    prisma.keywordGroup.findMany({ orderBy: { priority: 'asc' } }),
    prisma.industry.findMany({ orderBy: { priority: 'asc' } }),
    prisma.location.findMany({ orderBy: { priority: 'asc' } }),
    prisma.leadSource.findMany({ orderBy: { priority: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <Card
        title="Lead sources"
        subtitle="Only compliant sources: your own mailbox labels, approved APIs and public pages. No scraping of protected platforms."
      >
        <SourceToggleList
          sources={sources.map((s) => ({
            id: s.id,
            key: s.key,
            name: s.name,
            kind: s.kind,
            isActive: s.isActive,
            lastRunAt: s.lastRunAt ? formatInTz(s.lastRunAt, DEFAULT_TIMEZONE) : null,
            lastError: s.lastError,
          }))}
        />
        <div className="border-t border-hairline">
          <RunIngestionPanel sources={sources.map((s) => ({ key: s.key, name: s.name }))} />
        </div>
      </Card>

      <Card
        title={`Hiring keywords (${keywords.filter((k) => k.isActive).length} active)`}
        subtitle="A company hiring for any of these is a buying signal. Score boost feeds the hiring-role factor."
      >
        <KeywordManager
          keywords={keywords.map((k) => ({
            id: k.id,
            term: k.term,
            isActive: k.isActive,
            priority: k.priority,
            scoreBoost: k.scoreBoost,
            groupName: k.group?.name ?? null,
          }))}
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        />
      </Card>

      <Card title="Locations" subtitle="Search order for company discovery. Toronto and the GTA lead by default.">
        <PriorityList
          kind="location"
          items={locations.map((l) => ({
            id: l.id,
            name: l.name,
            priority: l.priority,
            isActive: l.isActive,
            isExcluded: l.isExcluded,
            detail: l.latitude ? `${l.radiusKm}km radius` : 'no coordinates — not searchable',
          }))}
        />
        <div className="border-t border-hairline">
          <AddLocationForm />
        </div>
      </Card>

      <Card title="Industries" subtitle="Which businesses to target, and in what order.">
        <PriorityList
          kind="industry"
          items={industries.map((i) => ({
            id: i.id,
            name: i.name,
            priority: i.priority,
            isActive: i.isActive,
            detail: i.keywords.slice(0, 2).join(', '),
          }))}
        />
        <div className="border-t border-hairline">
          <AddIndustryForm />
        </div>
      </Card>

      <Card title="Job posting age" subtitle="How much a posting's age matters to its priority and score.">
        <SettingsForm settingKey="discovery.postingAge" fields={POSTING_AGE_FIELDS} values={postingAge} />
      </Card>
    </div>
  );
}
