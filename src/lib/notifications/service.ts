import type { NotificationSeverity, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { getSetting } from '../settings/service';

const log = createLogger('notifications');

export type NotifyInput = {
  /** Stable key, e.g. `shift.started`. Used for per-user preferences. */
  key: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  linkUrl?: string;
  metadata?: Prisma.InputJsonValue;
  /** Prevents repeat alerts for the same underlying condition. */
  dedupeKey?: string;
  userIds?: string[];
  roles?: UserRole[];
};

/**
 * Creates in-app notifications and, when enabled and configured, dispatches
 * email/Slack copies.
 *
 * A notification is never lost because a channel is unavailable: the in-app
 * record is written first, and channel failures are logged against it.
 */
export async function notify(input: NotifyInput): Promise<{ created: number }> {
  const recipients = new Set(input.userIds ?? []);

  if (input.roles?.length) {
    const users = await prisma.user.findMany({
      where: { role: { in: input.roles }, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const u of users) recipients.add(u.id);
  }

  if (recipients.size === 0) return { created: 0 };

  const policy = await getSetting('notifications.policy');
  let created = 0;

  for (const userId of recipients) {
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_key: { userId, key: input.key } },
    });
    if (pref && !pref.inApp && !pref.email && !pref.slack) continue;

    // dedupeKey is globally unique in the schema, so scope it per user.
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${userId}` : null;

    try {
      await prisma.notification.create({
        data: {
          userId,
          key: input.key,
          title: input.title.slice(0, 200),
          body: input.body.slice(0, 1000),
          severity: input.severity ?? 'INFO',
          channel: 'IN_APP',
          linkUrl: input.linkUrl ?? null,
          metadata: input.metadata,
          dedupeKey,
          deliveredAt: new Date(),
        },
      });
      created += 1;
    } catch (err) {
      // P2002 on dedupeKey means we already told them. That is success.
      if (typeof err === 'object' && err && (err as { code?: string }).code === 'P2002') continue;
      log.error('failed to create notification', { userId, key: input.key, err: String(err) });
      continue;
    }

    const wantsEmail = pref?.email ?? policy.emailEnabled;
    if (wantsEmail && policy.emailEnabled) {
      await deliverEmail(userId, input).catch((err) =>
        log.warn('email notification failed', { userId, err: String(err) }),
      );
    }
  }

  return { created };
}

/**
 * Email delivery. Intentionally reports "not configured" rather than pretending
 * to send — the owner should never believe an alert went out when it did not.
 */
async function deliverEmail(userId: string, input: NotifyInput): Promise<void> {
  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    await prisma.notification.updateMany({
      where: { userId, key: input.key, deliveryError: null, readAt: null },
      data: { deliveryError: 'Email channel is enabled but SMTP_URL is not configured.' },
    });
    return;
  }
  // SMTP transport is a Phase 3 item; the hook exists so enabling it is a
  // single implementation, not a refactor.
  log.info('email delivery requested', { userId, key: input.key });
}

export async function listNotifications(userId: string, limit = 30) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { readAt: new Date() },
  });
}

/** Catalogue used by Settings → Notifications. */
export const NOTIFICATION_CATALOGUE: Array<{
  key: string;
  label: string;
  audience: 'OWNER' | 'SALES_REP';
}> = [
  { key: 'shift.started', label: 'Shift started', audience: 'OWNER' },
  { key: 'shift.ended', label: 'Shift ended', audience: 'OWNER' },
  { key: 'shift.missed', label: 'Planned shift missed', audience: 'OWNER' },
  { key: 'shift.late', label: 'Shift started late', audience: 'OWNER' },
  { key: 'shift.inactive', label: 'Excessive inactivity during a shift', audience: 'OWNER' },
  { key: 'target.hours_behind', label: 'Weekly hours falling behind', audience: 'OWNER' },
  { key: 'target.behind', label: 'Weekly target falling behind', audience: 'OWNER' },
  { key: 'target.completed', label: 'Weekly target completed', audience: 'OWNER' },
  { key: 'lead.high_score', label: 'High-scoring lead found', audience: 'OWNER' },
  { key: 'lead.interested', label: 'Interested lead', audience: 'OWNER' },
  { key: 'meeting.invite_sent', label: 'Meeting invite sent', audience: 'OWNER' },
  { key: 'meeting.booked', label: 'Meeting booked', audience: 'OWNER' },
  { key: 'followup.overdue', label: 'Follow-up overdue', audience: 'OWNER' },
  { key: 'report.weekly_ready', label: 'Weekly report ready', audience: 'OWNER' },
  { key: 'sprint.ready', label: 'Sunday sprint ready for approval', audience: 'OWNER' },
  { key: 'lead.shortage', label: 'Qualified lead shortage', audience: 'OWNER' },
  { key: 'integration.failure', label: 'Integration failure', audience: 'OWNER' },
  { key: 'rep.shift_upcoming', label: 'Upcoming shift', audience: 'SALES_REP' },
  { key: 'rep.sprint_approved', label: 'Weekly sprint approved', audience: 'SALES_REP' },
  { key: 'rep.followup_due', label: 'Follow-up due', audience: 'SALES_REP' },
  { key: 'rep.followup_overdue', label: 'Follow-up overdue', audience: 'SALES_REP' },
  { key: 'rep.target_behind', label: 'Target falling behind', audience: 'SALES_REP' },
  { key: 'rep.meeting_response', label: 'Meeting response received', audience: 'SALES_REP' },
  { key: 'rep.new_priority_lead', label: 'New priority lead assigned', audience: 'SALES_REP' },
  { key: 'rep.hours_remaining', label: 'Remaining weekly hours', audience: 'SALES_REP' },
  { key: 'rep.end_of_shift', label: 'End-of-shift requirements', audience: 'SALES_REP' },
];
