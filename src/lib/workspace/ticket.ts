import { prisma } from '../db';

/** Full ticket view model — one query set, everything the detail page shows. */
export async function getTicketDetail(ticketId: string) {
  return prisma.leadTicket.findUnique({
    where: { id: ticketId },
    include: {
      company: {
        include: {
          industry: true,
          location: true,
          contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
          enrichments: { orderBy: { collectedAt: 'desc' }, take: 40 },
        },
      },
      opportunity: {
        include: {
          jobPosting: true,
          sourceRecord: true,
          scores: { where: { isCurrent: true }, take: 1 },
        },
      },
      primaryContact: true,
      stage: true,
      assignee: { select: { id: true, name: true, avatarColor: true } },
      sprint: { select: { id: true, label: true, weekStart: true, weekEnd: true } },
      territory: { select: { name: true } },
      attempts: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, avatarColor: true } },
          outcome: { select: { label: true, key: true } },
        },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, avatarColor: true } },
          revisions: { orderBy: { editedAt: 'desc' } },
        },
      },
      followUps: { orderBy: { dueAt: 'asc' } },
      meetings: { orderBy: { startsAt: 'desc' } },
      stageHistory: {
        orderBy: { occurredAt: 'desc' },
        include: {
          fromStage: { select: { name: true } },
          toStage: { select: { name: true, color: true } },
          user: { select: { name: true } },
        },
      },
      activity: { orderBy: { occurredAt: 'desc' }, take: 30, include: { user: { select: { name: true } } } },
    },
  });
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicketDetail>>>;
