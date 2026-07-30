import { prisma } from '../db';
import { logActivity } from '../activity/log';
import { moveTicketToStage } from './stages';

/**
 * Manual Review queue actions.
 *
 * Tickets land in Review Required when the AI extraction was not confident
 * enough, when the score falls in the review band, or when key data is missing.
 * These are the owner's two exits from that queue.
 */

export type ReviewDecision = 'APPROVE' | 'DISQUALIFY';

export async function decideReview(params: {
  ticketId: string;
  decision: ReviewDecision;
  userId: string;
  reason?: string;
  /** Optional bump so an approved lead sorts high in the rep's queue. */
  priority?: 'PRIORITY' | 'HIGH' | 'NORMAL' | 'LOW';
}): Promise<{ ok: boolean; error?: string }> {
  const ticket = await prisma.leadTicket.findUnique({
    where: { id: params.ticketId },
    include: { company: true, stage: true },
  });
  if (!ticket) return { ok: false, error: 'Ticket not found.' };

  if (params.decision === 'DISQUALIFY') {
    const move = await moveTicketToStage({
      ticketId: ticket.id,
      toStageKey: 'disqualified',
      userId: params.userId,
      data: { disqualificationReason: params.reason ?? 'Did not meet the ideal customer profile on review.' },
      note: params.reason,
    });
    if (!move.ok) return { ok: false, error: move.error };
    await prisma.opportunity.update({
      where: { id: ticket.opportunityId },
      data: { status: 'DISQUALIFIED' },
    });
    return { ok: true };
  }

  const move = await moveTicketToStage({
    ticketId: ticket.id,
    toStageKey: 'ready_to_contact',
    userId: params.userId,
    note: params.reason,
  });
  if (!move.ok) return { ok: false, error: move.error };

  await prisma.leadTicket.update({
    where: { id: ticket.id },
    data: {
      priority: params.priority ?? ticket.priority,
      nextActionLabel: 'Call the company',
    },
  });
  await prisma.opportunity.update({
    where: { id: ticket.opportunityId },
    data: { status: 'QUALIFIED' },
  });

  await logActivity({
    userId: params.userId,
    kind: 'STAGE_CHANGED',
    summary: `Approved ${ticket.company.name} for calling after review`,
    ticketId: ticket.id,
  });

  return { ok: true };
}

/** Bulk approval from the Sunday Review "Review Exceptions" panel. */
export async function approveReviewBatch(
  ticketIds: string[],
  userId: string,
): Promise<{ approved: number; errors: string[] }> {
  const errors: string[] = [];
  let approved = 0;
  for (const id of ticketIds) {
    const result = await decideReview({ ticketId: id, decision: 'APPROVE', userId });
    if (result.ok) approved += 1;
    else errors.push(`${id}: ${result.error}`);
  }
  return { approved, errors };
}

export async function listReviewQueue(limit = 50) {
  return prisma.leadTicket.findMany({
    where: { stage: { key: 'review_required' }, closedAt: null, company: { doNotContact: false } },
    orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
    take: limit,
    include: {
      company: true,
      stage: true,
      opportunity: {
        include: { sourceRecord: { select: { kind: true, sourceUrl: true, subject: true } } },
      },
      scores: { where: { isCurrent: true }, take: 1 },
    },
  });
}
