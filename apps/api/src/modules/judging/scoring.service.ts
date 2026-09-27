import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { Clock } from '../../common/time';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';

const D = Prisma.Decimal;
const SCALE = 8;
const CANONICAL_SCALE = 6;

/** Canonical 6-decimal rounding for deterministic ranking */
function canonical(v: Prisma.Decimal): Prisma.Decimal {
  return v.toDecimalPlaces(CANONICAL_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Compute population std dev (denominator N, not N-1) */
function populationStdDev(
  values: Prisma.Decimal[],
  mean: Prisma.Decimal,
): Prisma.Decimal {
  if (values.length === 0) return new D(0);
  const sumSqDiff = values.reduce(
    (acc, v) => acc.add(v.sub(mean).pow(2)),
    new D(0),
  );
  return sumSqDiff.div(values.length).sqrt().toDecimalPlaces(SCALE);
}

/** Compute input set hash for idempotency */
function inputSetHash(ids: string[]): string {
  const sorted = [...ids].sort();
  return createHash('sha256')
    .update(sorted.join(','))
    .digest('hex')
    .slice(0, 32);
}

type Tx = Prisma.TransactionClient;

/** Tie policy: replaceable function for competition ranking */
export function competitionRank(
  sorted: Array<{ id: string; score: Prisma.Decimal }>,
): Array<{ id: string; score: Prisma.Decimal; rank: number }> {
  const result: Array<{ id: string; score: Prisma.Decimal; rank: number }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const prev = result[i - 1];
    const rank =
      prev && canonical(sorted[i]!.score).eq(canonical(prev.score))
        ? prev.rank
        : i + 1;
    result.push({ id: sorted[i]!.id, score: sorted[i]!.score, rank });
  }
  return result;
}

/** Weight validation: replaceable function */
export function validateWeights(weights: Prisma.Decimal[]): {
  valid: boolean;
  sum: string;
} {
  const sum = weights.reduce((a, b) => a.add(b), new D(0));
  return { valid: sum.eq(new D(1)), sum: sum.toString() };
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async createScoreRun(
    p: SessionPrincipal,
    eventId: string,
    dto: { rubricVersionId?: string },
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;

        // Resolve rubric version
        let rubricVersionId = dto.rubricVersionId;
        if (!rubricVersionId) {
          const published = await tx.rubric.findMany({
            where: { eventId, status: 'PUBLISHED' },
          });
          if (published.length === 0)
            fail(409, 'NO_PUBLISHED_RUBRIC', 'No published rubric found.');
          if (published.length > 1)
            fail(
              409,
              'AMBIGUOUS_RUBRIC',
              'Multiple published rubrics in use. Specify rubricVersionId.',
            );
          rubricVersionId = published[0]!.id;
        }

        const rubric = await tx.rubric.findFirst({
          where: { id: rubricVersionId, eventId, status: 'PUBLISHED' },
          include: { criteria: { orderBy: { displayOrder: 'asc' } } },
        });
        if (!rubric)
          fail(
            409,
            'RUBRIC_NOT_PUBLISHED',
            'Rubric must be published and belong to this event.',
          );

        // Validate weights sum to 1
        const weights = rubric.criteria.map((c) => c.weight);
        const wv = validateWeights(weights);
        if (!wv.valid)
          fail(
            409,
            'INVALID_WEIGHTS',
            `Rubric criterion weights must sum to exactly 1.0, got ${wv.sum}.`,
          );

        // Gather SUBMITTED evaluations from PUBLISHED assignment runs for this event
        // with the specified rubric version
        const evaluations = await tx.evaluation.findMany({
          where: {
            status: 'SUBMITTED',
            rubricId: rubricVersionId,
            assignment: {
              eventId,
              run: { status: 'PUBLISHED' },
            },
          },
          include: {
            scores: true,
            assignment: {
              select: {
                judgeProfileId: true,
                submissionId: true,
                submission: { select: { projectId: true } },
                judgeProfile: {
                  select: {
                    eventMembership: { select: { status: true } },
                  },
                },
              },
            },
          },
        });

        if (evaluations.length === 0)
          fail(
            409,
            'NO_SUBMITTED_EVALUATIONS',
            'Zero submitted evaluations found for this rubric version.',
          );

        // Check for mixed rubric versions
        const rubricIds = new Set(evaluations.map((e) => e.rubricId));
        if (rubricIds.size > 1)
          fail(
            409,
            'MIXED_RUBRIC_VERSIONS',
            'Evaluations use multiple rubric versions.',
          );

        // Verify each evaluation has all criteria
        for (const ev of evaluations) {
          const scoredCriteria = new Set(ev.scores.map((s) => s.criterionId));
          for (const c of rubric.criteria) {
            if (!scoredCriteria.has(c.id))
              fail(
                409,
                'INCOMPLETE_EVALUATION',
                `Evaluation ${ev.id} is missing criterion ${c.id}.`,
              );
          }
        }

        const evalIds = evaluations.map((e) => e.id).sort();
        const hash = inputSetHash(evalIds);

        // Idempotency check
        const existing = await tx.scoreRun.findFirst({
          where: {
            eventId,
            method: 'Z_SCORE',
            methodVersion: 'V1',
            inputSetHash: hash,
            status: 'COMPLETED',
          },
        });
        if (existing) return this.getScoreRun(tx, existing.id);

        // Create the run in CREATING status
        const run = await tx.scoreRun.create({
          data: {
            eventId,
            status: 'CREATING',
            algorithm: 'Z_SCORE',
            algorithmVersion: 'V1',
            method: 'Z_SCORE',
            methodVersion: 'V1',
            parameters: {},
            rubricVersionId,
            inputEvaluationIds: evalIds,
            inputSetHash: hash,
            createdById: p.userId,
          },
        });

        try {
          // Determine if bounds differ across criteria
          const boundsSet = new Set(
            rubric.criteria.map(
              (c) => `${c.minScore.toString()}_${c.maxScore.toString()}`,
            ),
          );
          const uniformBounds = boundsSet.size === 1;

          // Step 1: Compute weighted raw score for each evaluation
          const evalRawScores: Array<{
            evaluationId: string;
            judgeProfileId: string;
            submissionId: string;
            projectId: string;
            rawScore: Prisma.Decimal;
            isSuspended: boolean;
          }> = [];

          for (const ev of evaluations) {
            let weightedSum = new D(0);
            for (const criterion of rubric.criteria) {
              const score = ev.scores.find(
                (s) => s.criterionId === criterion.id,
              );
              if (!score) continue; // should not happen - validated above

              let scoreValue: Prisma.Decimal;
              if (!uniformBounds) {
                // Convert to percent-of-max: (score - min) / (max - min) * 100
                const range = criterion.maxScore.sub(criterion.minScore);
                scoreValue = range.isZero()
                  ? new D(0)
                  : score.score.sub(criterion.minScore).div(range).mul(100);
              } else {
                scoreValue = score.score;
              }
              weightedSum = weightedSum.add(criterion.weight.mul(scoreValue));
            }

            const isSuspended =
              ev.assignment.judgeProfile.eventMembership.status === 'SUSPENDED';

            evalRawScores.push({
              evaluationId: ev.id,
              judgeProfileId: ev.assignment.judgeProfileId,
              submissionId: ev.assignment.submissionId,
              projectId: ev.assignment.submission.projectId,
              rawScore: weightedSum.toDecimalPlaces(SCALE),
              isSuspended,
            });
          }

          // Step 2: Z-score normalization per judge
          const judgeGroups = new Map<string, typeof evalRawScores>();
          for (const e of evalRawScores) {
            if (!judgeGroups.has(e.judgeProfileId))
              judgeGroups.set(e.judgeProfileId, []);
            judgeGroups.get(e.judgeProfileId)!.push(e);
          }

          const normDiagnostics: Array<{
            judgeProfileId: string;
            diagnostic: string | null;
          }> = [];
          const coverageDiagnostics: string[] = [];
          const normalizedRecords: Array<{
            evaluationId: string;
            judgeProfileId: string;
            submissionId: string;
            projectId: string;
            rawScore: Prisma.Decimal;
            normalizedScore: Prisma.Decimal;
            diagnostic: string | null;
          }> = [];

          for (const [judgeId, evals] of judgeGroups) {
            const rawValues = evals.map((e) => e.rawScore);
            const mean = rawValues
              .reduce((a, b) => a.add(b), new D(0))
              .div(rawValues.length)
              .toDecimalPlaces(SCALE);
            const sigma = populationStdDev(rawValues, mean);

            let judgeDiagnostic: string | null = null;
            if (sigma.isZero()) {
              judgeDiagnostic = 'INSUFFICIENT_VARIATION';
            }

            // Check if any evaluation is from a suspended judge
            const isSuspended = evals[0]?.isSuspended ?? false;
            if (isSuspended) {
              coverageDiagnostics.push(`SUSPENDED_JUDGE_INCLUDED:${judgeId}`);
            }

            await tx.judgeScoreStats.create({
              data: {
                scoreRunId: run.id,
                judgeProfileId: judgeId,
                evaluationCount: evals.length,
                mean,
                populationStdDev: sigma,
                diagnostic: judgeDiagnostic,
              },
            });

            normDiagnostics.push({
              judgeProfileId: judgeId,
              diagnostic: judgeDiagnostic,
            });

            for (const e of evals) {
              const normalized = sigma.isZero()
                ? new D(0)
                : e.rawScore.sub(mean).div(sigma).toDecimalPlaces(SCALE);

              normalizedRecords.push({
                evaluationId: e.evaluationId,
                judgeProfileId: e.judgeProfileId,
                submissionId: e.submissionId,
                projectId: e.projectId,
                rawScore: e.rawScore,
                normalizedScore: normalized,
                diagnostic: sigma.isZero() ? 'INSUFFICIENT_VARIATION' : null,
              });
            }
          }

          // Step 3: Create NormalizedScore records
          for (const nr of normalizedRecords) {
            await tx.normalizedScore.create({
              data: {
                scoreRunId: run.id,
                evaluationId: nr.evaluationId,
                judgeProfileId: nr.judgeProfileId,
                submissionId: nr.submissionId,
                projectId: nr.projectId,
                rawScore: nr.rawScore,
                normalizedScore: nr.normalizedScore,
                diagnostic: nr.diagnostic,
              },
            });
          }

          // Step 4: Compute ProjectScore per project
          // Need required reviews from PUBLISHED assignment runs
          const projectGroups = new Map<
            string,
            Array<{ normalizedScore: Prisma.Decimal; rawScore: Prisma.Decimal }>
          >();
          for (const nr of normalizedRecords) {
            if (!projectGroups.has(nr.projectId))
              projectGroups.set(nr.projectId, []);
            projectGroups.get(nr.projectId)!.push({
              normalizedScore: nr.normalizedScore,
              rawScore: nr.rawScore,
            });
          }

          // Determine required reviews per project
          const publishedRuns = await tx.assignmentRun.findMany({
            where: { eventId, status: 'PUBLISHED' },
            select: { id: true, reviewsPerSubmission: true },
          });

          // Get all project submissions with assignments
          const projectSubmissions = await tx.submission.findMany({
            where: {
              project: { eventId, status: 'ACTIVE' },
              status: { in: ['SUBMITTED', 'LOCKED'] },
            },
            include: {
              judgeAssignments: {
                where: { run: { status: 'PUBLISHED' } },
                select: { runId: true },
              },
            },
          });

          const requiredPerProject = new Map<string, number>();
          for (const sub of projectSubmissions) {
            const maxRequired = Math.max(
              0,
              ...sub.judgeAssignments.map((a) => {
                const pubRun = publishedRuns.find((r) => r.id === a.runId);
                return pubRun?.reviewsPerSubmission ?? 0;
              }),
            );
            const current = requiredPerProject.get(sub.projectId) ?? 0;
            requiredPerProject.set(
              sub.projectId,
              Math.max(current, maxRequired),
            );
          }

          const projectCoverageDiag: Array<{
            projectId: string;
            required: number;
            submitted: number;
            coverageComplete: boolean;
          }> = [];

          for (const [projectId, scores] of projectGroups) {
            const normalizedAgg = scores
              .reduce((a, b) => a.add(b.normalizedScore), new D(0))
              .div(scores.length)
              .toDecimalPlaces(SCALE);

            const rawAvg = scores
              .reduce((a, b) => a.add(b.rawScore), new D(0))
              .div(scores.length)
              .toDecimalPlaces(SCALE);

            const required = requiredPerProject.get(projectId) ?? 0;
            const coverageComplete = scores.length >= required;

            await tx.projectScore.create({
              data: {
                scoreRunId: run.id,
                projectId,
                aggregatedScore: normalizedAgg,
                rawAverage: rawAvg,
                evaluationCount: scores.length,
                requiredCount: required,
                coverageComplete,
              },
            });

            projectCoverageDiag.push({
              projectId,
              required,
              submitted: scores.length,
              coverageComplete,
            });
          }

          // Detect projects with zero evaluations that have assignments
          const allProjects = await tx.project.findMany({
            where: { eventId, status: 'ACTIVE' },
            select: { id: true },
          });
          for (const proj of allProjects) {
            if (!projectGroups.has(proj.id)) {
              const required = requiredPerProject.get(proj.id) ?? 0;
              projectCoverageDiag.push({
                projectId: proj.id,
                required,
                submitted: 0,
                coverageComplete: false,
              });
            }
          }

          // Step 5: Complete the run
          await tx.scoreRun.update({
            where: { id: run.id },
            data: {
              status: 'COMPLETED',
              completedAt: this.clock.now(),
              coverageDiagnostics: JSON.parse(
                JSON.stringify(projectCoverageDiag),
              ) as Prisma.InputJsonValue,
              normalizationDiagnostics: JSON.parse(
                JSON.stringify({
                  judges: normDiagnostics,
                  suspendedJudges: coverageDiagnostics,
                }),
              ) as Prisma.InputJsonValue,
            },
          });

          await this.audit.record(tx, {
            action: 'SCORE_RUN_CREATED',
            entityType: 'ScoreRun',
            entityId: run.id,
            eventId,
            actorUserId: p.userId,
            metadata: {
              method: 'Z_SCORE',
              methodVersion: 'V1',
              rubricVersionId,
              evaluationCount: evaluations.length,
            },
          });

          return this.getScoreRun(tx, run.id);
        } catch (err) {
          // Mark as failed
          try {
            await tx.scoreRun.update({
              where: { id: run.id },
              data: {
                status: 'FAILED',
                failedAt: this.clock.now(),
                failureReason: err instanceof Error ? err.message : String(err),
              },
            });
          } catch {
            // If the update itself fails (trigger prevents), just re-throw original
          }
          throw err;
        }
      },
      { timeout: 60000 },
    );
  }

  private async getScoreRun(tx: Tx, id: string) {
    const run = await tx.scoreRun.findUniqueOrThrow({
      where: { id },
      include: {
        normalizedScores: {
          select: {
            id: true,
            evaluationId: true,
            judgeProfileId: true,
            submissionId: true,
            projectId: true,
            rawScore: true,
            normalizedScore: true,
            diagnostic: true,
          },
        },
        projectScores: {
          select: {
            id: true,
            projectId: true,
            aggregatedScore: true,
            rawAverage: true,
            evaluationCount: true,
            requiredCount: true,
            coverageComplete: true,
          },
        },
        judgeStats: {
          select: {
            judgeProfileId: true,
            evaluationCount: true,
            mean: true,
            populationStdDev: true,
            diagnostic: true,
          },
        },
      },
    });
    return {
      id: run.id,
      eventId: run.eventId,
      status: run.status,
      method: run.method,
      methodVersion: run.methodVersion,
      rubricVersionId: run.rubricVersionId,
      inputEvaluationIds: run.inputEvaluationIds,
      evaluationCount: run.inputEvaluationIds.length,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      coverageDiagnostics: run.coverageDiagnostics,
      normalizationDiagnostics: run.normalizationDiagnostics,
      judgeStats: run.judgeStats.map((s) => ({
        ...s,
        mean: s.mean.toString(),
        populationStdDev: s.populationStdDev.toString(),
      })),
      normalizedScores: run.normalizedScores.map((s) => ({
        ...s,
        rawScore: s.rawScore.toString(),
        normalizedScore: s.normalizedScore.toString(),
      })),
      projectScores: run.projectScores.map((s) => ({
        ...s,
        aggregatedScore: s.aggregatedScore.toString(),
        rawAverage: s.rawAverage.toString(),
      })),
    };
  }

  /** Check if a COMPLETED run is STALE (current eligible eval IDs differ from stored input) */
  async isStale(
    tx: Tx,
    run: {
      id: string;
      eventId: string;
      rubricVersionId: string | null;
      inputEvaluationIds: string[];
    },
  ) {
    if (!run.rubricVersionId) return false;
    const current = await tx.evaluation.findMany({
      where: {
        status: 'SUBMITTED',
        rubricId: run.rubricVersionId,
        assignment: {
          eventId: run.eventId,
          run: { status: 'PUBLISHED' },
        },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const currentIds = current.map((e) => e.id).sort();
    const storedIds = [...run.inputEvaluationIds].sort();
    if (currentIds.length !== storedIds.length) return true;
    return currentIds.some((id, i) => id !== storedIds[i]);
  }

  async listScoreRuns(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    const runs = await this.db.scoreRun.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        method: true,
        methodVersion: true,
        rubricVersionId: true,
        inputEvaluationIds: true,
        createdAt: true,
        completedAt: true,
        eventId: true,
      },
    });
    const results = [];
    for (const run of runs) {
      const stale =
        run.status === 'COMPLETED' ? await this.isStale(this.db, run) : false;
      results.push({
        id: run.id,
        status: run.status,
        method: run.method,
        methodVersion: run.methodVersion,
        rubricVersionId: run.rubricVersionId,
        evaluationCount: run.inputEvaluationIds.length,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        freshness: stale ? 'STALE' : 'CURRENT',
      });
    }
    return results;
  }

  async getScoreRunDetail(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    const run = await this.db.scoreRun.findFirst({
      where: { id: runId, eventId },
    });
    if (!run) fail(404, 'SCORE_RUN_NOT_FOUND', 'Score run not found.');
    const detail = await this.getScoreRun(this.db, runId);
    const stale =
      run.status === 'COMPLETED' ? await this.isStale(this.db, run) : false;
    return { ...detail, freshness: stale ? 'STALE' : 'CURRENT' };
  }

  async createResultRun(
    p: SessionPrincipal,
    eventId: string,
    dto: {
      scoreRunId: string;
      confirmIncomplete?: boolean;
      overrideReason?: string;
    },
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;

      const scoreRun = await tx.scoreRun.findFirst({
        where: { id: dto.scoreRunId, eventId },
        include: {
          projectScores: true,
        },
      });
      if (!scoreRun) fail(404, 'SCORE_RUN_NOT_FOUND', 'Score run not found.');
      if (scoreRun.status !== 'COMPLETED')
        fail(
          409,
          'SCORE_RUN_NOT_COMPLETED',
          'Only COMPLETED score runs can produce results.',
        );

      // Check coverage
      const incompleteProjects = scoreRun.projectScores.filter(
        (ps) => !ps.coverageComplete,
      );
      const coverageIncomplete = incompleteProjects.length > 0;

      if (coverageIncomplete && !dto.confirmIncomplete)
        fail(
          409,
          'INCOMPLETE_COVERAGE',
          'Coverage is incomplete for some projects. Set confirmIncomplete=true and provide overrideReason to proceed.',
        );

      if (coverageIncomplete && !dto.overrideReason)
        fail(
          400,
          'OVERRIDE_REASON_REQUIRED',
          'An override reason is required when coverage is incomplete.',
        );

      // Idempotency
      const existing = await tx.resultRun.findFirst({
        where: {
          scoreRunId: dto.scoreRunId,
          coverageIncomplete,
        },
      });
      if (existing) return this.getResultRun(tx, existing.id);

      // Rank by canonical normalized aggregate DESC, competition ranking
      const sorted = scoreRun.projectScores
        .map((ps) => ({
          id: ps.projectId,
          score: canonical(ps.aggregatedScore),
        }))
        .sort((a, b) => {
          const cmp = b.score.cmp(a.score);
          return cmp !== 0 ? cmp : a.id.localeCompare(b.id); // stable ID for display
        });

      const ranked = competitionRank(sorted);

      const coverageSnapshot = incompleteProjects.map((ps) => ({
        projectId: ps.projectId,
        required: ps.requiredCount,
        submitted: ps.evaluationCount,
      }));

      const resultRun = await tx.resultRun.create({
        data: {
          eventId,
          scoreRunId: dto.scoreRunId,
          coverageIncomplete,
          overrideReason: coverageIncomplete ? dto.overrideReason : null,
          overrideActorId: coverageIncomplete ? p.userId : null,
          rankingPolicy: 'COMPETITION',
          rankingVersion: 'V1',
          coverageSnapshot: coverageIncomplete
            ? (JSON.parse(
                JSON.stringify(coverageSnapshot),
              ) as Prisma.InputJsonValue)
            : Prisma.DbNull,
          createdById: p.userId,
        },
      });

      for (const r of ranked) {
        await tx.projectResult.create({
          data: {
            resultRunId: resultRun.id,
            projectId: r.id,
            score: r.score,
            rank: r.rank,
          },
        });
      }

      await this.audit.record(tx, {
        action: 'RESULT_RUN_CREATED',
        entityType: 'ResultRun',
        entityId: resultRun.id,
        eventId,
        actorUserId: p.userId,
        metadata: {
          scoreRunId: dto.scoreRunId,
          coverageIncomplete,
          projectCount: ranked.length,
        },
      });

      if (coverageIncomplete) {
        await this.audit.record(tx, {
          action: 'RESULT_RUN_COVERAGE_OVERRIDE',
          entityType: 'ResultRun',
          entityId: resultRun.id,
          eventId,
          actorUserId: p.userId,
          metadata: {
            reason: dto.overrideReason,
            affectedProjects: coverageSnapshot,
          },
        });
      }

      return this.getResultRun(tx, resultRun.id);
    });
  }

  private async getResultRun(tx: Tx, id: string) {
    const run = await tx.resultRun.findUniqueOrThrow({
      where: { id },
      include: {
        projectResults: {
          orderBy: { rank: 'asc' },
          select: {
            id: true,
            projectId: true,
            score: true,
            rank: true,
            tieGroup: true,
          },
        },
      },
    });
    return {
      id: run.id,
      eventId: run.eventId,
      scoreRunId: run.scoreRunId,
      status: run.status,
      coverageIncomplete: run.coverageIncomplete,
      overrideReason: run.overrideReason,
      rankingPolicy: run.rankingPolicy,
      rankingVersion: run.rankingVersion,
      coverageSnapshot: run.coverageSnapshot,
      generatedAt: run.generatedAt,
      createdById: run.createdById,
      projectResults: run.projectResults.map((r) => ({
        ...r,
        score: r.score.toString(),
      })),
    };
  }

  async listResultRuns(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    return this.db.resultRun.findMany({
      where: { eventId },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        scoreRunId: true,
        status: true,
        coverageIncomplete: true,
        overrideReason: true,
        generatedAt: true,
      },
    });
  }

  async getResultRunDetail(
    p: SessionPrincipal,
    eventId: string,
    runId: string,
  ) {
    await this.access.organizer(p, eventId);
    const run = await this.db.resultRun.findFirst({
      where: { id: runId, eventId },
    });
    if (!run) fail(404, 'RESULT_RUN_NOT_FOUND', 'Result run not found.');
    return this.getResultRun(this.db, runId);
  }
}
