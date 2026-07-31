import { prisma } from '../db';
import { getTzParts, startOfMonthInTz, endOfMonthInTz, DEFAULT_TIMEZONE } from '../time';
import { TARGET_DEFINITIONS } from './targets';

/**
 * Monthly targets.
 *
 * Derived from the weekly plan rather than invented separately: a month's
 * target is the sum of the weekly targets that fall inside it. That keeps the
 * two consistent — the owner cannot end up with a monthly number the weekly
 * capacity maths says is impossible.
 *
 * The owner can still override any monthly figure, and an override survives
 * recalculation.
 */

export type MonthlyProgress = {
  year: number;
  month: number;
  label: string;
  targets: Array<{
    key: string;
    label: string;
    target: number;
    achieved: number;
    isOverridden: boolean;
  }>;
};

/** Recomputes monthly targets for a user from the sprints in that month. */
export async function refreshMonthlyTargets(
  userId: string,
  when = new Date(),
  timezone = DEFAULT_TIMEZONE,
): Promise<void> {
  const parts = getTzParts(when, timezone);
  const periodStart = startOfMonthInTz(when, timezone);
  const periodEnd = endOfMonthInTz(when, timezone);

  const sprints = await prisma.weeklySprint.findMany({
    where: { userId, weekStart: { gte: periodStart, lte: periodEnd } },
    include: { targets: true },
  });

  for (const def of TARGET_DEFINITIONS) {
    const summed = sprints.reduce(
      (total, sprint) => total + (sprint.targets.find((t) => t.key === def.key)?.target ?? 0),
      0,
    );

    const existing = await prisma.monthlyTarget.findUnique({
      where: {
        userId_year_month_key: { userId, year: parts.year, month: parts.month, key: def.key },
      },
    });

    // Never overwrite a number the owner set by hand.
    if (existing && existing.target !== summed && existing.updatedAt > existing.createdAt) continue;

    await prisma.monthlyTarget.upsert({
      where: {
        userId_year_month_key: { userId, year: parts.year, month: parts.month, key: def.key },
      },
      create: { userId, year: parts.year, month: parts.month, key: def.key, label: def.label, target: summed },
      update: { target: summed, label: def.label },
    });
  }
}

/** Monthly targets alongside what has actually been achieved so far. */
export async function getMonthlyProgress(
  userId: string,
  when = new Date(),
  timezone = DEFAULT_TIMEZONE,
): Promise<MonthlyProgress> {
  const parts = getTzParts(when, timezone);
  const periodStart = startOfMonthInTz(when, timezone);
  const periodEnd = endOfMonthInTz(when, timezone);

  const targets = await prisma.monthlyTarget.findMany({
    where: { userId, year: parts.year, month: parts.month },
  });

  const scorecards = await prisma.weeklyScorecard.findMany({
    where: { userId, sprint: { weekStart: { gte: periodStart, lte: periodEnd } } },
  });

  const achieved: Record<string, number> = {
    TOTAL_CONTACTS: 0,
    NEW_CONTACTS: 0,
    FOLLOW_UPS: 0,
    CONVERSATIONS: 0,
    INTERESTED: 0,
    MEETINGS: 0,
  };
  for (const card of scorecards) {
    achieved.TOTAL_CONTACTS! += card.contactsCompleted;
    achieved.NEW_CONTACTS! += card.newContacts;
    achieved.FOLLOW_UPS! += card.followUpsCompleted;
    achieved.CONVERSATIONS! += card.conversations;
    achieved.INTERESTED! += card.interestedLeads;
    achieved.MEETINGS! += card.meetingsBooked;
  }

  return {
    year: parts.year,
    month: parts.month,
    label: new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone: timezone }).format(
      periodStart,
    ),
    targets: TARGET_DEFINITIONS.map((def) => {
      const row = targets.find((t) => t.key === def.key);
      return {
        key: def.key,
        label: def.label,
        target: row?.target ?? 0,
        achieved: achieved[def.key] ?? 0,
        isOverridden: row ? row.updatedAt > row.createdAt : false,
      };
    }),
  };
}

export async function overrideMonthlyTarget(params: {
  userId: string;
  year: number;
  month: number;
  key: string;
  target: number;
}): Promise<void> {
  const def = TARGET_DEFINITIONS.find((d) => d.key === params.key);
  await prisma.monthlyTarget.upsert({
    where: {
      userId_year_month_key: {
        userId: params.userId,
        year: params.year,
        month: params.month,
        key: params.key,
      },
    },
    create: {
      userId: params.userId,
      year: params.year,
      month: params.month,
      key: params.key,
      label: def?.label ?? params.key,
      target: Math.max(0, Math.round(params.target)),
    },
    update: { target: Math.max(0, Math.round(params.target)) },
  });
}
