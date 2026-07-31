import type { ContactChannel, LeadTicket, PipelineStage, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { createLogger } from '../logger';
import { logActivity } from '../activity/log';
import { createFollowUp, scheduleRuleFollowUp } from '../followups/service';
import { notify } from '../notifications/service';
import { getSetting } from '../settings/service';
import { addDaysInTz, DEFAULT_TIMEZONE } from '../time';
import { FIELD_LABELS } from './field-labels';

const log = createLogger('pipeline.stages');

/**
 * Fields each stage demands before a ticket may enter it. Sourced from the
 * PipelineStage.requiredFields column so the owner can tighten or relax them
 * per stage without a code change.
 */
export type StageFormData = Record<string, string | boolean | number | null | undefined>;

export { FIELD_LABELS };


export function validateStageFields(
  stage: PipelineStage,
  data: StageFormData,
): { ok: true } | { ok: false; missing: string[] } {
  const missing = stage.requiredFields.filter((field) => {
    const value = data[field];
    if (typeof value === 'boolean') return false;
    return value === undefined || value === null || String(value).trim() === '';
  });
  return missing.length === 0 ? { ok: true } : { ok: false, missing: missing.map((f) => FIELD_LABELS[f] ?? f) };
}

export type MoveResult =
  | { ok: true; ticket: LeadTicket; automationsRun: string[] }
  | { ok: false; error: string; missing?: string[] };

/**
 * Moves a ticket between stages.
 *
 * Every move writes an immutable StageHistory row (previous stage, new stage,
 * user, timestamp, sprint, required next action, any follow-up created) before
 * running stage automations.
 */
export async function moveTicketToStage(params: {
  ticketId: string;
  toStageKey: string;
  userId: string;
  data?: StageFormData;
  automated?: boolean;
  note?: string;
}): Promise<MoveResult> {
  const data = params.data ?? {};

  const ticket = await prisma.leadTicket.findUnique({
    where: { id: params.ticketId },
    include: { stage: true, company: true, assignee: { select: { timezone: true } } },
  });
  if (!ticket) return { ok: false, error: 'Ticket not found.' };

  const toStage = await prisma.pipelineStage.findUnique({ where: { key: params.toStageKey } });
  if (!toStage || !toStage.isActive) return { ok: false, error: 'Target stage not found or inactive.' };

  /**
   * A ticket can legitimately re-enter the stage it is already in — the second
   * unanswered call on a lead already sitting in "Contacted – No Answer" is the
   * common case. Returning early here would skip `schedule_retry_follow_up` and
   * the lead would drop out of the queue with nothing chasing it, which is
   * exactly the silent follow-up loss the product must never allow.
   *
   * So automations still run; only the stage-change history entry is skipped,
   * because nothing actually moved. The attempt itself is recorded separately
   * by ContactAttempt.
   */
  const isSameStage = ticket.stageId === toStage.id;

  // A do-not-contact company can only ever move further into suppression.
  if (ticket.company.doNotContact && toStage.category !== 'SUPPRESSED') {
    return { ok: false, error: 'This company is marked do-not-contact and cannot re-enter an active stage.' };
  }

  const validation = validateStageFields(toStage, data);
  if (!validation.ok) {
    return { ok: false, error: `Missing required information for ${toStage.name}.`, missing: validation.missing };
  }

  const fromStageId = ticket.stageId;
  const timezone = ticket.assignee?.timezone ?? DEFAULT_TIMEZONE;
  const automationsRun: string[] = [];
  let createdFollowUpId: string | null = null;

  const ticketUpdate: Prisma.LeadTicketUpdateInput = { stage: { connect: { id: toStage.id } } };

  // --- Stage-specific field capture ---------------------------------------
  if (data.interestLevel) ticketUpdate.interestLevel = String(data.interestLevel);
  if (data.nextAction) ticketUpdate.nextActionLabel = String(data.nextAction).slice(0, 200);
  if (data.notInterestedReason) ticketUpdate.notInterestedReason = String(data.notInterestedReason).slice(0, 500);
  if (data.disqualificationReason) ticketUpdate.disqualifiedReason = String(data.disqualificationReason).slice(0, 500);
  if (toStage.category === 'CLOSED_WON' || toStage.category === 'CLOSED_LOST' || toStage.category === 'SUPPRESSED') {
    ticketUpdate.closedAt = new Date();
  }

  await prisma.leadTicket.update({ where: { id: ticket.id }, data: ticketUpdate });

  // --- Automations ---------------------------------------------------------
  for (const automation of toStage.automations) {
    try {
      switch (automation) {
        case 'schedule_retry_follow_up': {
          const attemptNumber = Number(data.attemptNumber ?? ticket.attemptCount) || 1;
          const { scheduleRetryForAttempt } = await import('../followups/service');
          const followUp = await scheduleRetryForAttempt({
            ticketId: ticket.id,
            attemptNumber,
            channel: (data.contactMethod as ContactChannel) ?? 'PHONE',
            createdByUserId: params.userId,
          });
          createdFollowUpId = followUp?.id ?? null;
          automationsRun.push(automation);
          break;
        }

        case 'create_follow_up': {
          const dueAt = data.followUpDate ? new Date(String(data.followUpDate)) : null;
          const policy = await getSetting('followups.policy');
          const reasonKind = toStage.key === 'interested' ? 'INTERESTED_PROMISED' : 'MANUAL';
          const followUp = await createFollowUp({
            ticketId: ticket.id,
            reasonKind,
            reason:
              String(data.followUpReason ?? data.expectedNextStep ?? 'Follow up on the agreed next step'),
            channel: (data.contactMethod as ContactChannel) ?? 'PHONE',
            dueAt:
              dueAt && !Number.isNaN(dueAt.getTime())
                ? dueAt
                : addDaysInTz(new Date(), policy.interestedDefaultDelayDays, timezone),
            note: params.note,
            automated: false,
            createdByUserId: params.userId,
          });
          createdFollowUpId = followUp.id;
          automationsRun.push(automation);
          break;
        }

        case 'schedule_invite_follow_up': {
          const followUp = await scheduleRuleFollowUp({
            ticketId: ticket.id,
            ruleKey: 'invite_unconfirmed',
            channel: 'EMAIL',
            createdByUserId: params.userId,
          });
          createdFollowUpId = followUp?.id ?? null;
          automationsRun.push(automation);
          break;
        }

        case 'maybe_schedule_reactivation': {
          const appropriate =
            data.reactivationAppropriate === true ||
            String(data.reactivationAppropriate ?? '').toLowerCase() === 'true' ||
            String(data.reactivationAppropriate ?? '').toLowerCase() === 'yes';
          if (appropriate) {
            const explicitDate = data.reactivationDate ? new Date(String(data.reactivationDate)) : null;
            const followUp = await scheduleRuleFollowUp({
              ticketId: ticket.id,
              ruleKey: 'reactivation',
              reasonOverride: `Reactivation — previously not interested: ${data.notInterestedReason ?? 'no reason given'}`,
              dueAtOverride:
                explicitDate && !Number.isNaN(explicitDate.getTime()) ? explicitDate : undefined,
              createdByUserId: params.userId,
            });
            createdFollowUpId = followUp?.id ?? null;
            if (followUp) {
              await prisma.leadTicket.update({
                where: { id: ticket.id },
                data: { reactivationAt: followUp.dueAt },
              });
            }
          }
          automationsRun.push(automation);
          break;
        }

        case 'remove_from_call_queue': {
          // Cancel outstanding follow-ups explicitly, with a reason, so nothing
          // is ever silently dropped.
          await prisma.followUp.updateMany({
            where: { ticketId: ticket.id, status: { in: ['SCHEDULED', 'DUE', 'OVERDUE'] } },
            data: {
              status: 'CANCELLED',
              cancelledAt: new Date(),
              cancelReason: `Ticket moved to ${toStage.name}.`,
            },
          });
          await prisma.leadTicket.update({
            where: { id: ticket.id },
            data: { nextFollowUpAt: null, queuePosition: 0 },
          });
          automationsRun.push(automation);
          break;
        }

        case 'apply_do_not_contact': {
          await prisma.company.update({
            where: { id: ticket.companyId },
            data: {
              doNotContact: true,
              doNotContactReason: String(data.doNotContactReason ?? 'Requested by contact'),
              doNotContactAt: new Date(),
              doNotContactById: params.userId,
            },
          });
          automationsRun.push(automation);
          break;
        }

        case 'notify_owner_interested': {
          const policy = await getSetting('notifications.policy');
          if (policy.alertOnInterested) {
            await notify({
              key: 'lead.interested',
              roles: ['OWNER'],
              title: 'Interested lead',
              body: `${ticket.company.name} is interested — ${data.interestSummary ?? 'see the ticket for details'}.`,
              severity: 'SUCCESS',
              linkUrl: `/leads/${ticket.id}`,
              dedupeKey: `interested:${ticket.id}`,
            });
          }
          automationsRun.push(automation);
          break;
        }

        case 'notify_owner_meeting': {
          const policy = await getSetting('notifications.policy');
          if (policy.alertOnMeetingBooked) {
            await notify({
              key: 'meeting.booked',
              roles: ['OWNER'],
              title: 'Meeting booked',
              body: `A meeting with ${ticket.company.name} has been booked.`,
              severity: 'SUCCESS',
              linkUrl: `/leads/${ticket.id}`,
              dedupeKey: `meeting-booked:${ticket.id}:${Date.now()}`,
            });
          }
          automationsRun.push(automation);
          break;
        }

        case 'record_attempt':
          // Attempts are recorded by logContactAttempt, which is the caller
          // here. Nothing extra to do; listed for completeness in the UI.
          automationsRun.push(automation);
          break;

        default:
          log.warn('unknown stage automation', { automation, stage: toStage.key });
      }
    } catch (err) {
      log.error('stage automation failed', {
        automation,
        stage: toStage.key,
        ticketId: ticket.id,
        err: String(err),
      });
    }
  }

  // --- Immutable history ---------------------------------------------------
  if (!isSameStage) {
    await prisma.stageHistory.create({
      data: {
        ticketId: ticket.id,
        fromStageId,
        toStageId: toStage.id,
        userId: params.userId,
        sprintId: ticket.sprintId,
        shiftId: (
          await prisma.shift.findFirst({
            where: { userId: params.userId, status: { in: ['ACTIVE', 'PAUSED'] } },
            select: { id: true },
          })
        )?.id,
        requiredNextAction: String(data.nextAction ?? data.expectedNextStep ?? '') || null,
        followUpId: createdFollowUpId,
        automated: params.automated ?? false,
        metadata: { fields: data as Prisma.InputJsonValue, automationsRun },
      },
    });
  }

  if (params.note?.trim()) {
    await prisma.note.create({
      data: {
        ticketId: ticket.id,
        companyId: ticket.companyId,
        userId: params.userId,
        body: params.note.trim(),
        kind: toStage.key === 'contacted_connected' ? 'CONVERSATION_SUMMARY' : 'NOTE',
      },
    });
  }

  if (!isSameStage) {
    await logActivity({
      userId: params.userId,
      kind: 'STAGE_CHANGED',
      summary: `${ticket.company.name}: ${ticket.stage.name} → ${toStage.name}`,
      ticketId: ticket.id,
      metadata: { from: ticket.stage.key, to: toStage.key, automationsRun },
    });
  }

  const updated = await prisma.leadTicket.findUniqueOrThrow({ where: { id: ticket.id } });
  return { ok: true, ticket: updated, automationsRun };
}

export async function listStages(): Promise<PipelineStage[]> {
  return prisma.pipelineStage.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } });
}
