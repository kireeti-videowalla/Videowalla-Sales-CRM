import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/auth/rbac';
import { prisma } from '@/lib/db';
import { KanbanBoard, type KanbanColumn } from '@/components/kanban-board';

export const dynamic = 'force-dynamic';

const CARDS_PER_COLUMN = 25;

export default async function PipelinePage() {
  const user = await requireUser();
  const canMove = can(user.role, 'leads.move_stage');

  // Reps only ever see their own board.
  const scope = user.role === 'SALES_REP' ? { assigneeId: user.id } : {};

  const stages = await prisma.pipelineStage.findMany({
    where: { isActive: true },
    orderBy: { position: 'asc' },
  });

  const columns: KanbanColumn[] = await Promise.all(
    stages.map(async (stage) => {
      const [cards, total] = await Promise.all([
        prisma.leadTicket.findMany({
          where: { stageId: stage.id, ...scope },
          orderBy: [{ priority: 'asc' }, { score: 'desc' }],
          take: CARDS_PER_COLUMN,
          include: {
            company: { select: { name: true, city: true } },
            opportunity: { select: { headline: true } },
            assignee: { select: { name: true } },
          },
        }),
        prisma.leadTicket.count({ where: { stageId: stage.id, ...scope } }),
      ]);

      return {
        key: stage.key,
        name: stage.name,
        color: stage.color,
        requiredFields: stage.requiredFields,
        total,
        cards: cards.map((t) => ({
          id: t.id,
          reference: t.reference,
          companyName: t.company.name,
          headline: t.opportunity.headline,
          score: t.score,
          priority: t.priority,
          assigneeName: t.assignee?.name ?? null,
          city: t.company.city,
          attemptCount: t.attemptCount,
          isCarryover: t.isCarryover,
          nextFollowUpAt: t.nextFollowUpAt?.toISOString() ?? null,
        })),
      };
    }),
  );

  const totalTickets = columns.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">
          {user.role === 'SALES_REP' ? 'Your Kanban board' : 'Pipeline'}
        </h1>
        <p className="mt-0.5 text-sm text-ink-500">
          {totalTickets} ticket{totalTickets === 1 ? '' : 's'}
          {canMove ? ' · drag a card to move it between stages' : ''}
        </p>
      </div>

      <KanbanBoard columns={columns} canMove={canMove} />
    </div>
  );
}
