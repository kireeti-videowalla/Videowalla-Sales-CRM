import { prisma } from '@/lib/db';
import { Alert, Card } from '@/components/ui';
import { ScoringEditor } from '@/components/settings-panels';

export const dynamic = 'force-dynamic';

export default async function ScoringSettingsPage() {
  const profile = await prisma.scoringProfile.findFirst({
    where: { isActive: true },
    include: { factors: { where: { isActive: true }, orderBy: { position: 'asc' } } },
  });

  if (!profile) {
    return (
      <Alert tone="bad" title="No active scoring profile">
        Run <code>npm run seed</code> to install the default configuration.
      </Alert>
    );
  }

  const thresholds = profile.thresholds as Record<string, number>;

  return (
    <div className="space-y-6">
      <Card
        title="Lead scoring"
        subtitle="Weights decide how many points each factor can contribute. Thresholds decide the band."
      >
        <ScoringEditor
          profileId={profile.id}
          factors={profile.factors.map((f) => ({
            key: f.key,
            label: f.label,
            weight: f.weight,
            description: f.description,
          }))}
          thresholds={thresholds}
        />
      </Card>

      <Card title="How the score is used">
        <div className="space-y-2 px-5 py-4 text-sm text-ink-700">
          <p>
            <strong>Priority lead ({thresholds.PRIORITY_LEAD}+)</strong> — goes straight into the call queue
            at the top.
          </p>
          <p>
            <strong>Qualified lead ({thresholds.QUALIFIED_LEAD}+)</strong> — enters the call queue normally.
          </p>
          <p>
            <strong>Review required ({thresholds.REVIEW_REQUIRED}+)</strong> — waits for your decision before
            anyone calls it.
          </p>
          <p>
            <strong>Below {thresholds.REVIEW_REQUIRED}</strong> — low priority; also held for review rather
            than dialled.
          </p>
          <p className="text-ink-500">
            Changing weights affects leads scored from now on. Existing scores stay as they were until the
            lead is re-processed, so past decisions remain explainable against the rules in force at the
            time.
          </p>
        </div>
      </Card>
    </div>
  );
}
