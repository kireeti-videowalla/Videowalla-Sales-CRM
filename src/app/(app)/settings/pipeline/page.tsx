import { prisma } from '@/lib/db';
import { Card } from '@/components/ui';
import { OutcomeEditor, StageEditor } from '@/components/pipeline-config-panels';

export const dynamic = 'force-dynamic';

export default async function PipelineSettingsPage() {
  const [stages, outcomes] = await Promise.all([
    prisma.pipelineStage.findMany({
      orderBy: { position: 'asc' },
      include: { _count: { select: { tickets: true } } },
    }),
    prisma.contactOutcomeType.findMany({ orderBy: { position: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <Card
        title="Kanban columns"
        subtitle="Rename, recolour, reorder, add or remove the columns on the board, and decide what each one requires."
      >
        <StageEditor
          stages={stages.map((s) => ({
            id: s.id,
            key: s.key,
            name: s.name,
            category: s.category,
            position: s.position,
            color: s.color,
            isActive: s.isActive,
            isSystem: s.isSystem,
            requiredFields: s.requiredFields,
            automations: s.automations,
            ticketCount: s._count.tickets,
          }))}
        />
      </Card>

      <Card
        title="Contact outcomes"
        subtitle="The buttons she picks from after a call, and what each one does to the card and to her score."
      >
        <OutcomeEditor
          outcomes={outcomes.map((o) => ({
            id: o.id,
            key: o.key,
            label: o.label,
            position: o.position,
            isActive: o.isActive,
            targetStageKey: o.targetStageKey,
            countsAsContact: o.countsAsContact,
            countsAsConversation: o.countsAsConversation,
            requiresNote: o.requiresNote,
            requiresFollowUp: o.requiresFollowUp,
          }))}
          stages={stages.filter((s) => s.isActive).map((s) => ({ key: s.key, name: s.name }))}
        />
      </Card>
    </div>
  );
}
