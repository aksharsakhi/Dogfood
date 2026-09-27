import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { generateCsv } from './csv.util';
import {
  JUDGES_EXPORT_COLUMNS,
  ASSIGNMENTS_EXPORT_COLUMNS,
  PROGRESS_EXPORT_COLUMNS,
  RAW_EVALUATIONS_EXPORT_COLUMNS,
  NORMALIZED_SCORES_EXPORT_COLUMNS,
  PROJECT_SCORES_EXPORT_COLUMNS,
  RESULTS_EXPORT_COLUMNS,
  JudgeExportRow,
  AssignmentExportRow,
  ProgressExportRow,
  RawEvaluationExportRow,
  NormalizedScoreExportRow,
  ProjectScoreExportRow,
  ResultExportRow,
} from './csv-export.config';

@Injectable()
export class CsvExportService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async exportJudges(p: SessionPrincipal, eventId: string): Promise<string> {
    await this.access.organizer(p, eventId);
    const profiles = await this.db.judgeProfile.findMany({
      where: { eventMembership: { eventId } },
      include: {
        eventMembership: {
          include: { user: true },
        },
        judgeAssignments: {
          where: { run: { status: 'PUBLISHED' } },
          include: { evaluation: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    const rows: JudgeExportRow[] = profiles.map((pr) => {
      const completed = pr.judgeAssignments.filter(
        (a) => a.evaluation?.status === 'SUBMITTED',
      ).length;
      return {
        judgeProfileId: pr.id,
        userId: pr.eventMembership.userId,
        name: pr.eventMembership.user.displayName,
        email: pr.eventMembership.user.email,
        status: pr.eventMembership.status,
        available: pr.available,
        maxAssignments: pr.maxAssignments,
        assignedCount: pr.judgeAssignments.length,
        completedCount: completed,
      };
    });

    await this.recordAudit(p, eventId, 'judges');
    return generateCsv(rows, JUDGES_EXPORT_COLUMNS);
  }

  async exportAssignments(
    p: SessionPrincipal,
    eventId: string,
  ): Promise<string> {
    await this.access.organizer(p, eventId);
    const assignments = await this.db.judgeAssignment.findMany({
      where: { eventId, run: { status: 'PUBLISHED' } },
      include: {
        submission: {
          include: { project: true },
        },
        judgeProfile: {
          include: {
            eventMembership: {
              include: { user: true },
            },
          },
        },
        evaluation: true,
      },
      orderBy: { id: 'asc' },
    });

    const rows: AssignmentExportRow[] = assignments.map((a) => ({
      assignmentId: a.id,
      runId: a.runId,
      submissionId: a.submissionId,
      projectId: a.submission.projectId,
      projectTitle: a.submission.project.name,
      judgeProfileId: a.judgeProfileId,
      judgeName: a.judgeProfile.eventMembership.user.displayName,
      status: a.evaluation?.status ?? 'ASSIGNED',
      createdAt: a.assignedAt.toISOString(),
    }));

    await this.recordAudit(p, eventId, 'assignments');
    return generateCsv(rows, ASSIGNMENTS_EXPORT_COLUMNS);
  }

  async exportProgress(
    p: SessionPrincipal,
    eventId: string,
    reviewsPerSubmission = 2,
  ): Promise<string> {
    await this.access.organizer(p, eventId);
    const submissions = await this.db.submission.findMany({
      where: {
        project: { eventId, status: 'ACTIVE' },
        status: { in: ['SUBMITTED', 'LOCKED'] },
      },
      include: {
        project: true,
        judgeAssignments: {
          where: { run: { status: 'PUBLISHED' } },
          include: {
            evaluation: true,
            judgeProfile: {
              include: { eventMembership: { include: { user: true } } },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    const rows: ProgressExportRow[] = submissions.map((s) => {
      const activeAssignments = s.judgeAssignments.filter(
        (a) =>
          a.judgeProfile.available &&
          a.judgeProfile.eventMembership.status === 'ACTIVE' &&
          a.judgeProfile.eventMembership.user.status === 'ACTIVE',
      );
      const completed = activeAssignments.filter(
        (a) => a.evaluation?.status === 'SUBMITTED',
      ).length;
      return {
        submissionId: s.id,
        projectId: s.projectId,
        projectTitle: s.project.name,
        requiredEvaluations: reviewsPerSubmission,
        assignedEvaluations: activeAssignments.length,
        completedEvaluations: completed,
        shortfall: Math.max(0, reviewsPerSubmission - activeAssignments.length),
      };
    });

    await this.recordAudit(p, eventId, 'progress');
    return generateCsv(rows, PROGRESS_EXPORT_COLUMNS);
  }

  async exportRawEvaluations(
    p: SessionPrincipal,
    eventId: string,
  ): Promise<string> {
    // Check role: Organizer can export all, Judge can export only their own
    const membership = await this.db.eventMembership.findFirst({
      where: { eventId, userId: p.userId },
      include: { judgeProfile: true },
    });

    const isOrg =
      p.platformRoles.includes('ADMIN') ||
      (membership?.role === 'ORGANIZER' && membership.status === 'ACTIVE');
    const isJudge =
      membership?.role === 'JUDGE' &&
      membership.status === 'ACTIVE' &&
      membership.judgeProfile != null;

    if (!isOrg && !isJudge) {
      fail(403, 'FORBIDDEN', 'Access denied to evaluations export.');
    }

    const assignmentWhere: Prisma.JudgeAssignmentWhereInput = {
      eventId,
      run: { status: 'PUBLISHED' },
    };

    if (!isOrg && isJudge) {
      // Judge gets ONLY their own evaluations
      assignmentWhere.judgeProfileId = membership.judgeProfile!.id;
    }

    const whereClause: Prisma.EvaluationWhereInput = {
      status: 'SUBMITTED',
      assignment: assignmentWhere,
    };

    const evaluations = await this.db.evaluation.findMany({
      where: whereClause,
      include: {
        rubric: true,
        scores: {
          include: { criterion: true },
          orderBy: { criterion: { displayOrder: 'asc' } },
        },
        assignment: {
          include: {
            submission: { include: { project: true } },
            judgeProfile: {
              include: { eventMembership: { include: { user: true } } },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // Compute raw weighted score per evaluation
    const rows: RawEvaluationExportRow[] = [];
    for (const ev of evaluations) {
      let rawWeighted = 0;
      for (const sc of ev.scores) {
        rawWeighted += Number(sc.score) * Number(sc.criterion.weight);
      }

      for (const sc of ev.scores) {
        rows.push({
          evaluationId: ev.id,
          submissionId: ev.assignment.submissionId,
          projectId: ev.assignment.submission.projectId,
          projectTitle: ev.assignment.submission.project.name,
          judgeProfileId: ev.assignment.judgeProfileId,
          judgeName:
            ev.assignment.judgeProfile.eventMembership.user.displayName,
          status: ev.status,
          rubricId: ev.rubricId,
          criterionId: sc.criterionId,
          criterionName: sc.criterion.name,
          score: sc.score.toString(),
          rawWeightedScore: rawWeighted.toFixed(6),
          submittedAt: ev.submittedAt ? ev.submittedAt.toISOString() : '',
        });
      }
    }

    await this.recordAudit(p, eventId, 'raw-evaluations');
    return generateCsv(rows, RAW_EVALUATIONS_EXPORT_COLUMNS);
  }

  async exportNormalizedScores(
    p: SessionPrincipal,
    eventId: string,
    scoreRunId?: string,
  ): Promise<string> {
    await this.access.organizer(p, eventId);

    const run = scoreRunId
      ? await this.db.scoreRun.findFirst({
          where: { id: scoreRunId, eventId },
        })
      : await this.db.scoreRun.findFirst({
          where: { eventId, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
        });

    if (!run) fail(404, 'SCORE_RUN_NOT_FOUND', 'Score run not found.');

    const scores = await this.db.normalizedScore.findMany({
      where: { scoreRunId: run.id },
      include: {
        submission: { include: { project: true } },
        project: true,
      },
      orderBy: { id: 'asc' },
    });

    const rows: NormalizedScoreExportRow[] = scores.map((s) => ({
      scoreRunId: run.id,
      method: run.method,
      methodVersion: run.methodVersion,
      rubricVersionId: run.rubricVersionId ?? '',
      evaluationId: s.evaluationId,
      submissionId: s.submissionId ?? '',
      projectId: s.projectId ?? s.submission?.projectId ?? '',
      projectTitle: s.submission?.project?.name ?? s.project?.name ?? '',
      judgeProfileId: s.judgeProfileId ?? '',
      rawWeightedScore: s.rawScore.toString(),
      normalizedScore: s.normalizedScore.toString(),
      diagnostic: s.diagnostic,
    }));

    await this.recordAudit(p, eventId, 'normalized-scores', run.id);
    return generateCsv(rows, NORMALIZED_SCORES_EXPORT_COLUMNS);
  }

  async exportProjectScores(
    p: SessionPrincipal,
    eventId: string,
    scoreRunId?: string,
  ): Promise<string> {
    await this.access.organizer(p, eventId);

    const run = scoreRunId
      ? await this.db.scoreRun.findFirst({
          where: { id: scoreRunId, eventId },
        })
      : await this.db.scoreRun.findFirst({
          where: { eventId, status: 'COMPLETED' },
          orderBy: { createdAt: 'desc' },
        });

    if (!run) fail(404, 'SCORE_RUN_NOT_FOUND', 'Score run not found.');

    const projectScores = await this.db.projectScore.findMany({
      where: { scoreRunId: run.id },
      include: { project: true },
      orderBy: { aggregatedScore: 'desc' },
    });

    const rows: ProjectScoreExportRow[] = projectScores.map((ps) => ({
      scoreRunId: run.id,
      method: run.method,
      methodVersion: run.methodVersion,
      rubricVersionId: run.rubricVersionId ?? '',
      projectId: ps.projectId,
      projectTitle: ps.project.name,
      rawAverage: ps.rawAverage.toString(),
      normalizedAggregate: ps.aggregatedScore.toString(),
      evaluationCount: ps.evaluationCount,
      requiredCount: ps.requiredCount,
      coverageComplete: ps.coverageComplete,
    }));

    await this.recordAudit(p, eventId, 'project-scores', run.id);
    return generateCsv(rows, PROJECT_SCORES_EXPORT_COLUMNS);
  }

  async exportResults(
    p: SessionPrincipal,
    eventId: string,
    resultRunId?: string,
  ): Promise<string> {
    await this.access.organizer(p, eventId);

    const run = resultRunId
      ? await this.db.resultRun.findFirst({
          where: { id: resultRunId, eventId },
          include: {
            projectResults: {
              include: { project: true },
              orderBy: { rank: 'asc' },
            },
          },
        })
      : await this.db.resultRun.findFirst({
          where: { eventId },
          orderBy: { generatedAt: 'desc' },
          include: {
            projectResults: {
              include: { project: true },
              orderBy: { rank: 'asc' },
            },
          },
        });

    if (!run) fail(404, 'RESULT_RUN_NOT_FOUND', 'Result run not found.');

    const rows: ResultExportRow[] = run.projectResults.map((pr) => ({
      resultRunId: run.id,
      scoreRunId: run.scoreRunId,
      rankingPolicy: run.rankingPolicy,
      rankingVersion: run.rankingVersion,
      coverageIncomplete: run.coverageIncomplete,
      overrideReason: run.overrideReason,
      rank: pr.rank,
      projectId: pr.projectId,
      projectTitle: pr.project.name,
      score: pr.score.toString(),
    }));

    await this.recordAudit(p, eventId, 'results', undefined, run.id);
    return generateCsv(rows, RESULTS_EXPORT_COLUMNS);
  }

  private async recordAudit(
    p: SessionPrincipal,
    eventId: string,
    exportType: string,
    scoreRunId?: string,
    resultRunId?: string,
  ) {
    await this.audit.record(this.db, {
      action: 'CSV_EXPORTED',
      entityType: 'Event',
      entityId: eventId,
      eventId,
      actorUserId: p.userId,
      metadata: {
        exportType,
        scoreRunId: scoreRunId ?? null,
        resultRunId: resultRunId ?? null,
      },
    });
  }
}
