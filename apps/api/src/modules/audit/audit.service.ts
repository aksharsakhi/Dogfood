import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string;
  eventId?: string;
  actorUserId?: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

export const webhookTypes: Record<string, string> = {
  EVENT_CREATED: 'event.created',
  EVENT_UPDATED: 'event.updated',
  EVENT_PUBLISHED: 'event.published',
  EVENT_EMBED_CONFIG_CHANGED: 'event.embed.config.changed',
  EVENT_IMPORTED: 'event.imported',
  TRACK_CREATED: 'track.created',
  TRACK_UPDATED: 'track.updated',
  TRACK_DELETED: 'track.deleted',
  PRIZE_CREATED: 'prize.created',
  PRIZE_UPDATED: 'prize.updated',
  PRIZE_DELETED: 'prize.deleted',
  REGISTRATION_CREATED: 'registration.created',
  REGISTRATION_WITHDRAWN: 'registration.withdrawn',
  TEAM_CREATED: 'team.created',
  TEAM_UPDATED: 'team.updated',
  TEAM_MEMBER_LEFT: 'team.member.left',
  TEAM_MEMBER_REMOVED: 'team.member.removed',
  TEAM_DISBANDED: 'team.disbanded',
  TEAM_INVITATION_CREATED: 'team.invitation.created',
  TEAM_INVITATION_REVOKED: 'team.invitation.revoked',
  TEAM_INVITATION_ACCEPTED: 'team.invitation.accepted',
  TEAM_INVITATION_REJECTED: 'team.invitation.rejected',
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  SUBMISSION_DRAFT_CREATED: 'submission.draft.created',
  SUBMISSION_DRAFT_UPDATED: 'submission.draft.updated',
  SUBMISSION_SUBMITTED: 'submission.submitted',
  JUDGE_INVITED: 'judge.invited',
  JUDGE_INVITE_REVOKED: 'judge.invite.revoked',
  JUDGE_ACCEPTED: 'judge.accepted',
  JUDGE_PROFILE_UPDATED: 'judge.profile.updated',
  CONFLICT_DECLARED: 'judge.conflict.declared',
  CONFLICT_REMOVED: 'judge.conflict.removed',
  RUBRIC_CREATED: 'rubric.created',
  RUBRIC_UPDATED: 'rubric.updated',
  RUBRIC_PUBLISHED: 'rubric.published',
  ASSIGNMENT_RUN_CREATED: 'assignment.run.created',
  ASSIGNMENT_PUBLISHED: 'assignment.run.published',
  JUDGE_ASSIGNED: 'judge.assignment.created',
  EVALUATION_DRAFT_SAVED: 'evaluation.draft.saved',
  EVALUATION_SUBMITTED: 'evaluation.submitted',
  SCORE_RUN_CREATED: 'scoring.run.created',
  RESULT_RUN_CREATED: 'results.run.created',
  RESULT_RUN_COVERAGE_OVERRIDE: 'results.coverage.override',
  VOTING_IDENTITY_CREATED: 'voting.identity.created',
  VOTING_CONFIG_CHANGED: 'voting.config.changed',
  COMMUNITY_VOTE_CAST: 'community.vote.cast',
  COMMUNITY_VOTE_FLAGGED: 'community.vote.flagged',
  PROJECT_COMMENT_POSTED: 'project.comment.posted',
  PROJECT_COMMENT_HIDDEN: 'project.comment.hidden',
  PAIRWISE_RANKING_CREATED: 'pairwise.ranking.created',
  PAIRWISE_RUN_PUBLISHED: 'pairwise.run.published',
  PAIRWISE_COMPARISON_SUBMITTED: 'pairwise.comparison.submitted',
  PAIRWISE_RUN_CLOSED: 'pairwise.run.closed',
  JUDGE_PARTICIPATION_RECORD_ISSUED: 'judge.participation.record.issued',
  JUDGE_PARTICIPATION_RECORD_REVOKED: 'judge.participation.record.revoked',
};

const safeMetadataKeys = new Set([
  'projectId',
  'assignmentId',
  'pairwiseRunId',
  'rankingRunId',
  'comparisonCount',
  'projectCount',
  'inputSetHash',
  'algorithm',
  'algorithmVersion',
  'winnerProjectId',
  'loserProjectId',
  'submissionId',
  'judgeProfileId',
  'recordId',
  'runId',
  'rubricId',
  'rubricVersionId',
  'version',
  'type',
  'status',
  'fields',
  'name',
  'slug',
  'trackId',
  'teamId',
  'mode',
  'opensAt',
  'closesAt',
  'active',
  'role',
  'submittedAt',
  'judgeProfileId',
  'type',
]);

function safeMetadata(value: Prisma.InputJsonValue | undefined) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => safeMetadataKeys.has(key)),
  );
}

@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, input: AuditInput): Promise<void> {
    const audit = await tx.auditEvent.create({
      data: input,
      select: { createdAt: true },
    });
    const eventType = webhookTypes[input.action];
    if (!eventType || !input.eventId) return;

    const tombstone =
      input.action.endsWith('_DELETED') || input.action === 'CONFLICT_REMOVED'
        ? safeMetadata(input.beforeState as Prisma.InputJsonValue | undefined)
        : undefined;
    const payload: Prisma.InputJsonObject = {
      schemaVersion: 1,
      eventType,
      occurredAt: audit.createdAt.toISOString(),
      eventId: input.eventId,
      entity: {
        type: input.entityType,
        ...(input.entityId && input.action !== 'VOTING_IDENTITY_CREATED'
          ? { id: input.entityId }
          : {}),
      },
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...safeMetadata(input.metadata),
      ...safeMetadata(input.afterState as Prisma.InputJsonValue | undefined),
      ...(tombstone ? { tombstone } : {}),
    };
    const outbox = await tx.webhookOutboxEvent.create({
      data: {
        eventId: input.eventId,
        eventType,
        schemaVersion: 1,
        payload,
        occurredAt: audit.createdAt,
      },
      select: { id: true },
    });
    const subscriptions = await tx.webhookSubscription.findMany({
      where: {
        eventId: input.eventId,
        active: true,
        OR: [{ eventTypes: { has: eventType } }, { eventTypes: { has: '*' } }],
      },
      select: { id: true },
    });
    if (subscriptions.length)
      await tx.webhookDelivery.createMany({
        data: subscriptions.map(({ id }) => ({
          subscriptionId: id,
          outboxEventId: outbox.id,
        })),
      });
  }
}
