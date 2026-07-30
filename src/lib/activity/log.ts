import type { ActivityKind, Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * Append-only meaningful-activity log.
 *
 * This is the accountability record. There is deliberately no update or delete
 * function in this module and no server action exposes one — a sales rep can
 * add to their history but never rewrite it.
 *
 * What is tracked is work inside this application (tickets opened, outcomes
 * recorded, notes written). No keystrokes, no screenshots, no monitoring of
 * anything outside the product.
 */
export async function logActivity(params: {
  userId: string;
  kind: ActivityKind;
  summary: string;
  ticketId?: string | null;
  shiftId?: string | null;
  sprintId?: string | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  // Resolve the rep's open shift so activity is always attributable to a shift
  // when one exists, even if the caller did not pass it.
  let shiftId = params.shiftId ?? null;
  let sprintId = params.sprintId ?? null;

  if (!shiftId) {
    const openShift = await prisma.shift.findFirst({
      where: { userId: params.userId, status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, sprintId: true },
    });
    if (openShift) {
      shiftId = openShift.id;
      sprintId = sprintId ?? openShift.sprintId;
    }
  }

  if (!sprintId) {
    const activeSprint = await prisma.weeklySprint.findFirst({
      where: { userId: params.userId, status: { in: ['ACTIVE', 'APPROVED'] } },
      orderBy: { weekStart: 'desc' },
      select: { id: true },
    });
    sprintId = activeSprint?.id ?? null;
  }

  await prisma.activityEvent.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      summary: params.summary.slice(0, 500),
      ticketId: params.ticketId ?? null,
      shiftId,
      sprintId,
      metadata: params.metadata,
    },
  });

  // Keeps "last meaningful activity" on the owner's Live Activity page honest
  // and drives inactivity detection.
  if (shiftId) {
    await prisma.shift
      .update({ where: { id: shiftId }, data: { lastActivityAt: new Date() } })
      .catch(() => undefined);
  }
}

export async function recentActivity(limit = 40, userId?: string) {
  return prisma.activityEvent.findMany({
    where: userId ? { userId } : {},
    orderBy: { occurredAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, name: true, avatarColor: true } },
      ticket: {
        select: {
          id: true,
          reference: true,
          company: { select: { name: true } },
        },
      },
    },
  });
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  SHIFT_STARTED: 'Started shift',
  SHIFT_PAUSED: 'Paused shift',
  SHIFT_RESUMED: 'Resumed shift',
  SHIFT_ENDED: 'Ended shift',
  LEAD_OPENED: 'Opened lead',
  LEAD_RESEARCHED: 'Researched lead',
  CONTACT_INFO_VIEWED: 'Viewed contact details',
  TICKET_MOVED: 'Moved ticket',
  CONTACT_ATTEMPT_LOGGED: 'Logged contact attempt',
  NOTE_ADDED: 'Added note',
  NOTE_EDITED: 'Edited note',
  FOLLOW_UP_CREATED: 'Created follow-up',
  FOLLOW_UP_COMPLETED: 'Completed follow-up',
  MEETING_INVITE_SENT: 'Sent meeting invite',
  MEETING_BOOKED: 'Booked meeting',
  STAGE_CHANGED: 'Changed pipeline stage',
  LEAD_ASSIGNED: 'Assigned lead',
  SETTINGS_CHANGED: 'Changed settings',
};
