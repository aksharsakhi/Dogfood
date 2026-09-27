import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { allocate, AllocationInput } from './allocator';
import { BatchPreviewDto, PublishPreviewDto } from './judging.dto';

type Tx = Prisma.TransactionClient;
@Injectable()
export class BatchService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async snapshot(
    tx: Tx,
    eventId: string,
    reviewsPerSubmission: number,
  ) {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || ['DRAFT', 'ARCHIVED'].includes(event.status))
      fail(409, 'EVENT_NOT_JUDGEABLE', 'Event is not ready for judging.');
    const [profiles, submissions, assignments, conflicts] = await Promise.all([
      tx.judgeProfile.findMany({
        where: {
          available: true,
          eventMembership: {
            eventId,
            role: 'JUDGE',
            status: 'ACTIVE',
            user: { status: 'ACTIVE' },
          },
        },
        include: { expertise: true },
      }),
      tx.submission.findMany({
        where: { project: { eventId, status: 'ACTIVE' } },
        include: { project: { select: { teamId: true } } },
        orderBy: [{ projectId: 'asc' }, { version: 'desc' }],
      }),
      tx.judgeAssignment.findMany({
        where: { eventId, run: { status: 'PUBLISHED' } },
        select: {
          submissionId: true,
          judgeProfileId: true,
          judgeProfile: {
            select: {
              available: true,
              eventMembership: {
                select: {
                  status: true,
                  user: { select: { status: true } },
                },
              },
            },
          },
        },
      }),
      tx.judgeConflict.findMany({
        where: { judgeProfile: { eventMembership: { eventId } } },
      }),
    ]);
    const isActiveJudge = (
      j:
        | {
            available?: boolean;
            eventMembership?: {
              status?: string;
              user?: { status?: string };
            } | null;
          }
        | null
        | undefined,
    ) =>
      Boolean(
        j?.available &&
        j.eventMembership?.status === 'ACTIVE' &&
        j.eventMembership.user?.status === 'ACTIVE',
      );

    const latest = new Map<string, (typeof submissions)[number]>();
    for (const s of submissions)
      if (
        !latest.has(s.projectId) &&
        ['SUBMITTED', 'LOCKED', 'WITHDRAWN'].includes(s.status)
      )
        latest.set(s.projectId, s);
    const eligible = [...latest.values()].filter((s) =>
      ['SUBMITTED', 'LOCKED'].includes(s.status),
    );
    const load = new Map<string, number>();
    const coverage = new Map<string, number>();
    const activeAssignments = assignments.filter((a) =>
      isActiveJudge(a.judgeProfile),
    );
    const atRiskAssignments = assignments.filter(
      (a) => !isActiveJudge(a.judgeProfile),
    );
    for (const a of activeAssignments) {
      load.set(a.judgeProfileId, (load.get(a.judgeProfileId) ?? 0) + 1);
      coverage.set(a.submissionId, (coverage.get(a.submissionId) ?? 0) + 1);
    }
    const input: AllocationInput = {
      reviewsPerSubmission,
      judges: profiles.map((j) => ({
        id: j.id,
        capacity: j.maxAssignments ?? assignments.length + eligible.length,
        load: load.get(j.id) ?? 0,
        trackIds: j.expertise.map((x) => x.trackId),
      })),
      submissions: eligible.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        trackId: s.trackId,
        covered: coverage.get(s.id) ?? 0,
        excludedJudgeIds: profiles
          .filter(
            (j) =>
              conflicts.some(
                (c) =>
                  c.judgeProfileId === j.id &&
                  (c.teamId === s.project.teamId ||
                    c.projectId === s.projectId ||
                    ['ORGANIZATION', 'OTHER'].includes(c.type)),
              ) ||
              activeAssignments.some(
                (a) => a.judgeProfileId === j.id && a.submissionId === s.id,
              ),
          )
          .map((j) => j.id),
      })),
    };
    const result = allocate(input);
    return {
      event,
      result,
      input,
      atRiskAssignments: atRiskAssignments.length,
      submissionDeadlineOpen:
        !event.submissionClosesAt ||
        this.clock.now() < event.submissionClosesAt,
    };
  }

  async preflight(p: SessionPrincipal, eventId: string, dto: BatchPreviewDto) {
    await this.access.organizer(p, eventId);
    const rubric = await this.db.rubric.findFirst({
      where: { id: dto.rubricId, eventId, status: 'PUBLISHED' },
    });
    if (!rubric)
      fail(
        409,
        'RUBRIC_NOT_PUBLISHED',
        'A published event rubric is required.',
      );
    const state = await this.snapshot(
      this.db,
      eventId,
      dto.reviewsPerSubmission,
    );
    return {
      ...state.result,
      eligibleSubmissions: state.input.submissions.length,
      activeJudges: state.input.judges.length,
      atRiskCoverage: state.atRiskAssignments,
      submissionDeadlineOpen: state.submissionDeadlineOpen,
      warnings: state.submissionDeadlineOpen
        ? [
            'Submission deadline has not passed; publishing requires acknowledgment.',
          ]
        : [],
    };
  }

  async preview(p: SessionPrincipal, eventId: string, dto: BatchPreviewDto) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const rubric = await tx.rubric.findFirst({
        where: { id: dto.rubricId, eventId, status: 'PUBLISHED' },
      });
      if (!rubric)
        fail(
          409,
          'RUBRIC_NOT_PUBLISHED',
          'A published event rubric is required.',
        );
      const state = await this.snapshot(tx, eventId, dto.reviewsPerSubmission);
      await tx.assignmentRun.updateMany({
        where: { eventId, status: 'PREVIEW' },
        data: { status: 'SUPERSEDED' },
      });
      const run = await tx.assignmentRun.create({
        data: {
          eventId,
          rubricVersionId: rubric.id,
          type: 'BATCH',
          status: 'PREVIEW',
          reviewsPerSubmission: dto.reviewsPerSubmission,
          algorithm: 'constrained-greedy-maxflow',
          algorithmVersion: '1',
          allocationSource: state.result.allocationSource,
          previewStats: JSON.parse(
            JSON.stringify({
              required: state.result.required,
              achievable: state.result.achievable,
              shortfall: state.result.shortfall,
              perSubmission: state.result.perSubmission,
              connectivity: state.result.connectivity,
              greedyCount: state.result.greedyCount,
              proposedCount: state.result.pairs.length,
              perJudgeWorkload: state.input.judges.map((judge) => ({
                judgeProfileId: judge.id,
                existing: judge.load,
                proposed: state.result.pairs.filter(
                  (pair) => pair.judgeProfileId === judge.id,
                ).length,
              })),
              submissionDeadlineOpen: state.submissionDeadlineOpen,
            }),
          ) as Prisma.InputJsonValue,
          createdById: p.userId,
        },
      });
      if (state.result.pairs.length)
        await tx.assignmentRunProposal.createMany({
          data: state.result.pairs.map((pair) => ({ runId: run.id, ...pair })),
        });
      await this.audit.record(tx, {
        action: 'ASSIGNMENT_RUN_CREATED',
        entityType: 'AssignmentRun',
        entityId: run.id,
        eventId,
        actorUserId: p.userId,
        metadata: { type: 'BATCH', rubricVersionId: rubric.id },
      });
      return {
        runId: run.id,
        status: run.status,
        rubricVersionId: rubric.id,
        reviewsPerSubmission: run.reviewsPerSubmission,
        allocationSource: run.allocationSource,
        proposals: state.result.pairs,
        stats: run.previewStats,
      };
    });
  }

  async run(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    const row = await this.db.assignmentRun.findFirst({
      where: { id: runId, eventId },
      include: {
        proposals: { select: { judgeProfileId: true, submissionId: true } },
      },
    });
    if (!row) fail(404, 'RUN_NOT_FOUND', 'Assignment run not found.');
    return {
      id: row.id,
      status: row.status,
      type: row.type,
      rubricVersionId: row.rubricVersionId,
      reviewsPerSubmission: row.reviewsPerSubmission,
      allocationSource: row.allocationSource,
      stats: row.previewStats,
      proposals: row.proposals,
    };
  }

  async publish(
    p: SessionPrincipal,
    eventId: string,
    runId: string,
    dto: PublishPreviewDto,
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const run = await tx.assignmentRun.findFirst({
        where: { id: runId, eventId, type: 'BATCH' },
        include: { proposals: true },
      });
      if (!run) fail(404, 'RUN_NOT_FOUND', 'Assignment run not found.');
      if (run.status === 'PUBLISHED')
        return {
          runId,
          status: 'PUBLISHED',
          alreadyPublished: true,
          assignmentCount: await tx.judgeAssignment.count({ where: { runId } }),
        };
      if (run.status !== 'PREVIEW')
        fail(
          409,
          'STALE_PREVIEW',
          'Preview was superseded; generate a fresh preview.',
        );
      const state = await this.snapshot(tx, eventId, run.reviewsPerSubmission);
      if (state.submissionDeadlineOpen && !dto.acknowledgeOpenSubmissions)
        fail(
          409,
          'SUBMISSIONS_OPEN',
          'Submission deadline has not passed; explicit acknowledgment is required.',
        );
      const oldStats = run.previewStats as Record<string, unknown> | null;
      if (
        oldStats?.shortfall !== 0 ||
        state.result.shortfall !== 0 ||
        oldStats?.required !== state.result.required ||
        run.proposals.length !== state.result.required
      )
        fail(
          409,
          'STALE_PREVIEW',
          'Coverage changed or preview is incomplete; generate a fresh preview.',
        );
      const current = new Set(state.input.submissions.map((s) => s.id));
      const judgeMap = new Map(state.input.judges.map((j) => [j.id, j]));
      const submissionMap = new Map(
        state.input.submissions.map((s) => [s.id, s]),
      );
      const pendingLoad = new Map<string, number>();
      const pendingCoverage = new Map<string, number>();
      for (const proposal of run.proposals) {
        const judge = judgeMap.get(proposal.judgeProfileId);
        const submission = submissionMap.get(proposal.submissionId);
        if (!current.has(proposal.submissionId) || !submission)
          fail(
            409,
            'STALE_PREVIEW',
            'Submission is no longer eligible; generate a fresh preview.',
          );
        if (!judge)
          fail(
            409,
            'STALE_PREVIEW',
            'Judge is no longer active or available; generate a fresh preview.',
          );
        if (submission.excludedJudgeIds.includes(judge.id))
          fail(
            409,
            'STALE_PREVIEW',
            'Conflict or duplicate assignment changed; generate a fresh preview.',
          );
        pendingLoad.set(judge.id, (pendingLoad.get(judge.id) ?? 0) + 1);
        pendingCoverage.set(
          submission.id,
          (pendingCoverage.get(submission.id) ?? 0) + 1,
        );
        if (judge.load + pendingLoad.get(judge.id)! > judge.capacity)
          fail(
            409,
            'STALE_PREVIEW',
            'Judge capacity changed; generate a fresh preview.',
          );
        if (
          submission.covered + pendingCoverage.get(submission.id)! >
          run.reviewsPerSubmission
        )
          fail(
            409,
            'STALE_PREVIEW',
            'Submission coverage changed; generate a fresh preview.',
          );
      }
      await tx.assignmentRun.update({
        where: { id: runId },
        data: { status: 'PUBLISHED', publishedAt: this.clock.now() },
      });
      for (const proposal of run.proposals) {
        const assignment = await tx.judgeAssignment.create({
          data: {
            eventId,
            runId,
            rubricId: run.rubricVersionId,
            judgeProfileId: proposal.judgeProfileId,
            submissionId: proposal.submissionId,
            assignmentMethod: 'ALGORITHMIC',
            assignedById: p.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'JUDGE_ASSIGNED',
          entityType: 'JudgeAssignment',
          entityId: assignment.id,
          eventId,
          actorUserId: p.userId,
          metadata: {
            runId,
            judgeProfileId: proposal.judgeProfileId,
            submissionId: proposal.submissionId,
          },
        });
      }
      await this.audit.record(tx, {
        action: 'ASSIGNMENT_PUBLISHED',
        entityType: 'AssignmentRun',
        entityId: runId,
        eventId,
        actorUserId: p.userId,
        metadata: {
          acknowledgedOpenSubmissions: !!dto.acknowledgeOpenSubmissions,
          assignmentCount: run.proposals.length,
        },
      });
      return {
        runId,
        status: 'PUBLISHED',
        alreadyPublished: false,
        assignmentCount: run.proposals.length,
      };
    });
  }

  async progress(
    p: SessionPrincipal,
    eventId: string,
    reviewsPerSubmission: number,
  ) {
    await this.access.organizer(p, eventId);
    const state = await this.snapshot(this.db, eventId, reviewsPerSubmission);
    const assignments = await this.db.judgeAssignment.findMany({
      where: { eventId, run: { status: 'PUBLISHED' } },
      select: {
        judgeProfileId: true,
        submissionId: true,
        judgeProfile: {
          select: {
            available: true,
            eventMembership: {
              select: {
                status: true,
                user: { select: { status: true } },
              },
            },
          },
        },
        evaluation: { select: { status: true } },
      },
    });
    const isActiveJudge = (
      j:
        | {
            available?: boolean;
            eventMembership?: {
              status?: string;
              user?: { status?: string };
            } | null;
          }
        | null
        | undefined,
    ) =>
      Boolean(
        j?.available &&
        j.eventMembership?.status === 'ACTIVE' &&
        j.eventMembership.user?.status === 'ACTIVE',
      );
    const activeAssignments = assignments.filter((a) =>
      isActiveJudge(a.judgeProfile),
    );
    const atRiskAssignments = assignments.filter(
      (a) => !isActiveJudge(a.judgeProfile),
    );

    return {
      activeJudges: state.input.judges.length,
      eligibleSubmissions: state.input.submissions.length,
      reviewsPerSubmission,
      requiredEvaluations:
        state.input.submissions.length * reviewsPerSubmission,
      publishedCoverage: activeAssignments.length,
      atRiskCoverage: atRiskAssignments.length,
      atRiskAssignments: atRiskAssignments.length,
      completedEvaluations: activeAssignments.filter(
        (a) => a.evaluation?.status === 'SUBMITTED',
      ).length,
      remainingEvaluations: activeAssignments.filter(
        (a) => a.evaluation?.status !== 'SUBMITTED',
      ).length,
      judges: state.input.judges.map((j) => {
        const mine = activeAssignments.filter((a) => a.judgeProfileId === j.id);
        const completed = mine.filter(
          (a) => a.evaluation?.status === 'SUBMITTED',
        ).length;
        return {
          judgeProfileId: j.id,
          assigned: mine.length,
          completed,
          remaining: mine.length - completed,
        };
      }),
      submissions: state.input.submissions.map((s) => {
        const mine = activeAssignments.filter((a) => a.submissionId === s.id);
        const atRisk = atRiskAssignments.filter((a) => a.submissionId === s.id);
        return {
          submissionId: s.id,
          projectId: s.projectId,
          assigned: mine.length,
          atRisk: atRisk.length,
          completed: mine.filter((a) => a.evaluation?.status === 'SUBMITTED')
            .length,
          shortfall: Math.max(0, reviewsPerSubmission - mine.length),
        };
      }),
    };
  }
}
