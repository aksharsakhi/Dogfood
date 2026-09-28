import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { EvaluationDto, ManualAssignmentDto } from './judging.dto';

type Tx = Prisma.TransactionClient;
const viewInclude = {
  submission: {
    select: {
      id: true,
      version: true,
      title: true,
      description: true,
      projectName: true,
      projectTagline: true,
      trackId: true,
      trackName: true,
      repositoryUrl: true,
      demoUrl: true,
      submittedAt: true,
    },
  },
  run: {
    include: {
      rubric: {
        include: { criteria: { orderBy: { displayOrder: 'asc' as const } } },
      },
    },
  },
  evaluation: { include: { scores: true } },
} satisfies Prisma.JudgeAssignmentInclude;
type AssignmentView = Prisma.JudgeAssignmentGetPayload<{
  include: typeof viewInclude;
}>;

@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger(EvaluationsService.name);
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async eligibleSubmission(
    tx: Tx,
    eventId: string,
    submissionId: string,
  ) {
    const submission = await tx.submission.findFirst({
      where: {
        id: submissionId,
        project: { eventId, status: 'ACTIVE' },
      },
      include: { project: true },
    });
    if (!submission || !['SUBMITTED', 'LOCKED'].includes(submission.status))
      fail(
        409,
        'SUBMISSION_INELIGIBLE',
        'Only a current final submission can be assigned.',
      );
    const latestFinal = await tx.submission.findFirst({
      where: {
        projectId: submission.projectId,
        status: { in: ['SUBMITTED', 'LOCKED', 'WITHDRAWN'] },
      },
      orderBy: { version: 'desc' },
    });
    if (latestFinal?.id !== submissionId)
      fail(
        409,
        'SUBMISSION_INELIGIBLE',
        'Only the latest final submission can be assigned.',
      );
    return submission;
  }

  async manual(p: SessionPrincipal, eventId: string, dto: ManualAssignmentDto) {
    await this.access.organizer(p, eventId);
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
        const event = await tx.event.findUnique({ where: { id: eventId } });
        if (!event || ['DRAFT', 'ARCHIVED'].includes(event.status))
          fail(409, 'EVENT_NOT_JUDGEABLE', 'Event is not ready for judging.');
        const rubric = await tx.rubric.findFirst({
          where: { id: dto.rubricId, eventId, status: 'PUBLISHED' },
        });
        if (!rubric)
          fail(
            409,
            'RUBRIC_NOT_PUBLISHED',
            'A published event rubric is required.',
          );
        const judge = await tx.judgeProfile.findFirst({
          where: {
            id: dto.judgeProfileId,
            available: true,
            eventMembership: {
              eventId,
              role: 'JUDGE',
              status: 'ACTIVE',
              user: { status: 'ACTIVE' },
            },
          },
        });
        if (!judge)
          fail(409, 'JUDGE_INELIGIBLE', 'Judge is not active or available.');
        const submission = await this.eligibleSubmission(
          tx,
          eventId,
          dto.submissionId,
        );
        const conflict = await tx.judgeConflict.findFirst({
          where: {
            judgeProfileId: judge.id,
            OR: [
              { teamId: submission.project.teamId },
              { projectId: submission.projectId },
              { type: { in: ['ORGANIZATION', 'OTHER'] } },
            ],
          },
        });
        if (conflict)
          fail(
            409,
            'JUDGE_CONFLICT',
            'Declared conflict excludes this assignment.',
          );
        if (
          await tx.judgeAssignment.findUnique({
            where: {
              judgeProfileId_submissionId: {
                judgeProfileId: judge.id,
                submissionId: submission.id,
              },
            },
          })
        )
          fail(409, 'ASSIGNMENT_EXISTS', 'Judge already has this submission.');
        const load = await tx.judgeAssignment.count({
          where: { judgeProfileId: judge.id, run: { status: 'PUBLISHED' } },
        });
        if (judge.maxAssignments !== null && load >= judge.maxAssignments)
          fail(
            409,
            'JUDGE_AT_CAPACITY',
            'Judge has reached the assignment capacity.',
          );
        const run = await tx.assignmentRun.create({
          data: {
            eventId,
            rubricVersionId: rubric.id,
            type: 'MANUAL',
            status: 'PUBLISHED',
            reviewsPerSubmission: 1,
            algorithm: 'manual',
            algorithmVersion: '1',
            allocationSource: 'manual',
            createdById: p.userId,
            publishedAt: this.clock.now(),
          },
        });
        const assignment = await tx.judgeAssignment.create({
          data: {
            eventId,
            runId: run.id,
            rubricId: rubric.id,
            judgeProfileId: judge.id,
            submissionId: submission.id,
            assignmentMethod: 'MANUAL',
            assignedById: p.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'ASSIGNMENT_RUN_CREATED',
          entityType: 'AssignmentRun',
          entityId: run.id,
          eventId,
          actorUserId: p.userId,
          metadata: { type: 'MANUAL', rubricVersionId: rubric.id },
        });
        await this.audit.record(tx, {
          action: 'ASSIGNMENT_PUBLISHED',
          entityType: 'AssignmentRun',
          entityId: run.id,
          eventId,
          actorUserId: p.userId,
        });
        await this.audit.record(tx, {
          action: 'JUDGE_ASSIGNED',
          entityType: 'JudgeAssignment',
          entityId: assignment.id,
          eventId,
          actorUserId: p.userId,
          metadata: {
            judgeProfileId: judge.id,
            submissionId: submission.id,
            runId: run.id,
          },
        });
        return {
          runId: run.id,
          assignmentId: assignment.id,
          judgeProfileId: judge.id,
          submissionId: submission.id,
          rubricId: rubric.id,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        fail(409, 'ASSIGNMENT_EXISTS', 'Judge already has this submission.');
      throw error;
    }
  }

  private permittedWhere(
    p: SessionPrincipal,
    eventId: string,
  ): Prisma.JudgeAssignmentWhereInput {
    return {
      eventId,
      run: { status: 'PUBLISHED' },
      judgeProfile: {
        eventMembership: {
          eventId,
          userId: p.userId,
          role: 'JUDGE',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      },
    };
  }

  private async assigned(
    tx: Tx,
    p: SessionPrincipal,
    eventId: string,
    id: string,
    bySubmission = false,
  ) {
    const row = await tx.judgeAssignment.findFirst({
      where: {
        ...this.permittedWhere(p, eventId),
        ...(bySubmission ? { submissionId: id } : { id }),
      },
      include: viewInclude,
    });
    if (!row) {
      this.logger.warn(
        `Denied judge submission access event=${eventId} resource=${id} user=${p.userId}`,
      );
      fail(404, 'ASSIGNMENT_NOT_FOUND', 'Assigned submission not found.');
    }
    return row;
  }

  private dto(row: AssignmentView) {
    const s = row.submission;
    const rubric = row.run.rubric;
    const evaluation = row.evaluation;
    return {
      assignmentId: row.id,
      eventId: row.eventId,
      submission: {
        id: s.id,
        version: s.version,
        title: s.title,
        description: s.description,
        projectName: s.projectName,
        projectTagline: s.projectTagline,
        trackId: s.trackId,
        trackName: s.trackName,
        repositoryUrl: s.repositoryUrl,
        demoUrl: s.demoUrl,
        submittedAt: s.submittedAt,
      },
      rubric: {
        id: rubric.id,
        version: rubric.version,
        name: rubric.name,
        criteria: rubric.criteria.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          weight: c.weight.toString(),
          minScore: c.minScore.toString(),
          maxScore: c.maxScore.toString(),
          displayOrder: c.displayOrder,
        })),
      },
      evaluation: evaluation
        ? {
            id: evaluation.id,
            status: evaluation.status,
            comments: evaluation.comments,
            startedAt: evaluation.startedAt,
            submittedAt: evaluation.submittedAt,
            scores: evaluation.scores.map((x) => ({
              criterionId: x.criterionId,
              score: x.score.toString(),
              comment: x.comment,
            })),
          }
        : null,
    };
  }

  async workspace(p: SessionPrincipal, eventId: string) {
    const membership = await this.db.eventMembership.findFirst({
      where: {
        eventId,
        userId: p.userId,
        role: 'JUDGE',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
    });
    if (!membership)
      fail(
        403,
        'JUDGE_ACCESS_REQUIRED',
        'Active judge membership is required.',
      );
    const rows = await this.db.judgeAssignment.findMany({
      where: this.permittedWhere(p, eventId),
      include: viewInclude,
      orderBy: { assignedAt: 'asc' },
    });
    const completed = rows.filter(
      (a) => a.evaluation?.status === 'SUBMITTED',
    ).length;
    const draft = rows.filter(
      (a) => a.evaluation?.status === 'IN_PROGRESS',
    ).length;
    return {
      assigned: rows.length,
      completed,
      draft,
      remaining: rows.length - completed,
      assignments: rows.map((a) => ({
        assignmentId: a.id,
        submissionId: a.submissionId,
        title: a.submission.title,
        projectName: a.submission.projectName,
        status: a.evaluation?.status ?? 'NOT_STARTED',
        rubricVersionId: a.rubricId,
      })),
    };
  }

  async scoresForJudge(p: SessionPrincipal, eventId: string, judgeId: string) {
    const ownProfile = await this.db.judgeProfile.findFirst({
      where: {
        eventMembership: {
          eventId,
          userId: p.userId,
          role: 'JUDGE',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      },
      select: { id: true },
    });
    if (!ownProfile)
      fail(
        403,
        'JUDGE_ACCESS_REQUIRED',
        'Active judge membership is required.',
      );
    if (ownProfile.id !== judgeId)
      fail(
        403,
        'PEER_SCORES_FORBIDDEN',
        'Judges may only read their own scores.',
      );
    const evaluations = await this.db.evaluation.findMany({
      where: {
        status: 'SUBMITTED',
        assignment: {
          eventId,
          judgeProfileId: ownProfile.id,
          run: { status: 'PUBLISHED' },
        },
      },
      select: {
        id: true,
        assignmentId: true,
        submittedAt: true,
        comments: true,
        assignment: { select: { submissionId: true } },
        scores: {
          select: { criterionId: true, score: true, comment: true },
          orderBy: { criterionId: 'asc' },
        },
      },
      orderBy: { assignmentId: 'asc' },
    });
    return {
      judgeProfileId: ownProfile.id,
      evaluations: evaluations.map((evaluation) => ({
        evaluationId: evaluation.id,
        assignmentId: evaluation.assignmentId,
        submissionId: evaluation.assignment.submissionId,
        submittedAt: evaluation.submittedAt,
        comments: evaluation.comments,
        scores: evaluation.scores.map((score) => ({
          criterionId: score.criterionId,
          score: score.score.toString(),
          comment: score.comment,
        })),
      })),
    };
  }

  async detail(p: SessionPrincipal, eventId: string, assignmentId: string) {
    return this.dto(await this.assigned(this.db, p, eventId, assignmentId));
  }
  async submission(p: SessionPrincipal, eventId: string, submissionId: string) {
    return this.dto(
      await this.assigned(this.db, p, eventId, submissionId, true),
    );
  }

  private window(event: {
    judgingOpensAt: Date | null;
    judgingClosesAt: Date | null;
  }) {
    const now = this.clock.now();
    if (!event.judgingOpensAt || !event.judgingClosesAt)
      fail(
        409,
        'JUDGING_WINDOW_NOT_CONFIGURED',
        'Judging window is not configured.',
      );
    if (now < event.judgingOpensAt)
      fail(409, 'JUDGING_NOT_OPEN', 'Judging has not opened.');
    if (now >= event.judgingClosesAt)
      fail(409, 'JUDGING_CLOSED', 'Judging has closed.');
    return now;
  }

  async save(
    p: SessionPrincipal,
    eventId: string,
    assignmentId: string,
    dto: EvaluationDto,
    submit: boolean,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "JudgeAssignment" WHERE id = ${assignmentId}::uuid FOR UPDATE`;
      const assignment = await this.assigned(tx, p, eventId, assignmentId);
      const event = await tx.event.findUniqueOrThrow({
        where: { id: eventId },
      });
      const now = this.window(event);
      if (
        assignment.evaluation?.status === 'SUBMITTED' ||
        assignment.evaluation?.status === 'LOCKED'
      )
        fail(
          409,
          'EVALUATION_IMMUTABLE',
          'Submitted evaluations cannot be changed.',
        );
      const criteria = assignment.run.rubric.criteria;
      const provided = dto.scores ?? [];
      if (new Set(provided.map((x) => x.criterionId)).size !== provided.length)
        fail(
          400,
          'DUPLICATE_CRITERION',
          'Each criterion may be scored once per request.',
        );
      for (const score of provided) {
        const criterion = criteria.find((x) => x.id === score.criterionId);
        if (!criterion)
          fail(
            400,
            'WRONG_RUBRIC_CRITERION',
            'Criterion is not in the assigned rubric.',
          );
        const value = new Prisma.Decimal(score.score);
        if (value.lt(criterion.minScore) || value.gt(criterion.maxScore))
          fail(
            400,
            'SCORE_OUT_OF_RANGE',
            'Score is outside the criterion bounds.',
          );
      }
      const evaluation =
        assignment.evaluation ??
        (await tx.evaluation.create({
          data: {
            assignmentId,
            rubricId: assignment.rubricId,
            status: 'IN_PROGRESS',
            startedAt: now,
          },
        }));
      if (dto.comments !== undefined)
        await tx.evaluation.update({
          where: { id: evaluation.id },
          data: { comments: dto.comments },
        });
      for (const score of provided) {
        await tx.evaluationScore.upsert({
          where: {
            evaluationId_criterionId: {
              evaluationId: evaluation.id,
              criterionId: score.criterionId,
            },
          },
          create: {
            evaluationId: evaluation.id,
            criterionId: score.criterionId,
            score: score.score,
            comment: score.comment,
          },
          update: {
            score: score.score,
            ...(score.comment !== undefined ? { comment: score.comment } : {}),
          },
        });
      }
      if (submit) {
        const scored = await tx.evaluationScore.count({
          where: { evaluationId: evaluation.id },
        });
        if (scored !== criteria.length)
          fail(
            400,
            'EVALUATION_INCOMPLETE',
            'Every rubric criterion must be scored before submission.',
          );
        await tx.evaluation.update({
          where: { id: evaluation.id },
          data: { status: 'SUBMITTED', submittedAt: now },
        });
        await this.audit.record(tx, {
          action: 'EVALUATION_SUBMITTED',
          entityType: 'Evaluation',
          entityId: evaluation.id,
          eventId,
          actorUserId: p.userId,
          metadata: { assignmentId, rubricId: assignment.rubricId },
        });
      } else {
        await this.audit.record(tx, {
          action: 'EVALUATION_DRAFT_SAVED',
          entityType: 'Evaluation',
          entityId: evaluation.id,
          eventId,
          actorUserId: p.userId,
          metadata: { assignmentId, rubricId: assignment.rubricId },
        });
      }
      return this.dto(await this.assigned(tx, p, eventId, assignmentId));
    });
  }
}
