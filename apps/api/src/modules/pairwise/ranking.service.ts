import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PairwiseRankingRun } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { DomainError, fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import {
  computePairwiseInputSetHash,
  fitBradleyTerryRidgeV1,
  FROZEN_PAIRWISE_CONFIG,
} from './bradley-terry';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PairwiseRankingService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async evidence(tx: Tx, eventId: string, runId: string) {
    const run = await tx.pairwiseRun.findFirst({
      where: { id: runId, eventId },
    });
    if (!run) fail(404, 'PAIRWISE_RUN_NOT_FOUND', 'Pairwise run not found.');
    const snapshots = await tx.pairwiseRunProjectSnapshot.findMany({
      where: { pairwiseRunId: runId },
      select: {
        projectId: true,
        submissionId: true,
        submission: { select: { projectName: true, title: true } },
      },
      orderBy: { projectId: 'asc' },
    });
    const comparisons = await tx.pairwiseComparison.findMany({
      where: { assignment: { runId } },
      select: { id: true, winnerProjectId: true, loserProjectId: true },
      orderBy: { id: 'asc' },
    });
    // The run identity commits to its permanently frozen project/snapshot set.
    const inputSetHash = computePairwiseInputSetHash({
      pairwiseRunId: runId,
      comparisons,
    });
    return { run, snapshots, comparisons, inputSetHash };
  }

  private async view(
    tx: Tx,
    row: PairwiseRankingRun,
    evidence: Awaited<ReturnType<PairwiseRankingService['evidence']>>,
  ) {
    const results = await tx.pairwiseProjectResult.findMany({
      where: { rankingRunId: row.id },
      orderBy: [{ rank: 'asc' }, { projectId: 'asc' }],
    });
    const names = new Map(evidence.snapshots.map((s) => [s.projectId, s]));
    return {
      ...row,
      rankingRunId: row.id,
      lambda: row.lambda.toString(),
      finalDelta: row.finalDelta.toString(),
      currentComparisonCount: evidence.comparisons.length,
      stale: row.inputSetHash !== evidence.inputSetHash,
      regularizationSensitive: row.separationRisk,
      results: results.map((result) => ({
        projectId: result.projectId,
        projectName:
          names.get(result.projectId)?.submission.projectName ??
          names.get(result.projectId)?.submission.title ??
          result.projectId,
        submissionId: names.get(result.projectId)?.submissionId,
        rank: result.rank,
        strength: result.strength.toString(),
        canonicalStrength: result.canonicalStrength.toFixed(6),
        wins: result.wins,
        losses: result.losses,
      })),
    };
  }

  async create(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(
      async (tx) => {
        // Same lock as B4.2 submission and closure: evidence cannot change mid-run.
        await tx.$queryRaw`SELECT id FROM "PairwiseRun" WHERE id = ${runId}::uuid FOR UPDATE`;
        const evidence = await this.evidence(tx, eventId, runId);
        if (!['PUBLISHED', 'CLOSED'].includes(evidence.run.status))
          fail(
            409,
            'PAIRWISE_RUN_NOT_PUBLISHED',
            'Publish the pairwise run before ranking.',
          );
        const existing = await tx.pairwiseRankingRun.findFirst({
          where: {
            pairwiseRunId: runId,
            inputSetHash: evidence.inputSetHash,
            algorithm: FROZEN_PAIRWISE_CONFIG.algorithm,
            algorithmVersion: FROZEN_PAIRWISE_CONFIG.algorithmVersion,
            lambda: FROZEN_PAIRWISE_CONFIG.lambda,
          },
        });
        if (existing) return this.view(tx, existing, evidence);
        const fit = fitBradleyTerryRidgeV1({
          projectIds: evidence.snapshots.map((s) => s.projectId),
          comparisons: evidence.comparisons,
        });
        if (!fit.connected || fit.projectCount < 2) {
          throw new DomainError(
            409,
            'PAIRWISE_GRAPH_DISCONNECTED',
            'Global ranking unavailable because the comparison graph is disconnected.',
            {
              componentCount: fit.componentCount,
              components: fit.components,
              isolatedProjects: fit.components
                .filter((c) => c.length === 1)
                .flat(),
              comparisonCount: fit.comparisonCount,
              projectCount: fit.projectCount,
            },
          );
        }
        if (
          !fit.converged ||
          !Number.isFinite(fit.finalDelta) ||
          !Number.isFinite(fit.finalObjective) ||
          fit.ranks.length !== fit.projectCount ||
          fit.ranks.some(
            (r) =>
              !Number.isFinite(r.beta) || !Number.isFinite(r.canonicalStrength),
          )
        )
          fail(
            409,
            'PAIRWISE_SOLVER_FAILED',
            'Ranking did not converge to finite strengths; no ranking was saved.',
          );
        const row = await tx.pairwiseRankingRun.create({
          data: {
            pairwiseRunId: runId,
            algorithm: fit.algorithm,
            algorithmVersion: fit.algorithmVersion,
            lambda: fit.lambda,
            inputSetHash: evidence.inputSetHash,
            comparisonCount: fit.comparisonCount,
            projectCount: fit.projectCount,
            componentCount: fit.componentCount,
            converged: fit.converged,
            iterations: fit.iterations,
            finalDelta: fit.finalDelta,
            stronglyConnectedWinGraph: fit.stronglyConnectedWinGraph,
            separationRisk: fit.separationRisk,
          },
        });
        await tx.pairwiseProjectResult.createMany({
          data: fit.ranks.map((r) => ({
            rankingRunId: row.id,
            projectId: r.projectId,
            strength: r.beta,
            canonicalStrength: r.canonicalStrengthStr,
            rank: r.rank,
            wins: r.wins,
            losses: r.losses,
          })),
        });
        await this.audit.record(tx, {
          action: 'PAIRWISE_RANKING_CREATED',
          entityType: 'PairwiseRankingRun',
          entityId: row.id,
          eventId,
          actorUserId: p.userId,
          metadata: {
            eventId,
            pairwiseRunId: runId,
            rankingRunId: row.id,
            comparisonCount: fit.comparisonCount,
            projectCount: fit.projectCount,
            inputSetHash: evidence.inputSetHash,
            algorithm: fit.algorithm,
            algorithmVersion: fit.algorithmVersion,
            // Immutable exact evidence index for historical replay, excluded from webhook metadata.
            comparisonIds: evidence.comparisons.map((c) => c.id),
            projectIds: evidence.snapshots.map((s) => s.projectId),
          },
        });
        return this.view(tx, row, evidence);
      },
      { timeout: 30000 },
    );
  }

  async list(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(
      async (tx) => {
        const evidence = await this.evidence(tx, eventId, runId);
        const rows = await tx.pairwiseRankingRun.findMany({
          where: { pairwiseRunId: runId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return Promise.all(rows.map((row) => this.view(tx, row, evidence)));
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detail(p: SessionPrincipal, eventId: string, rankingRunId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(
      async (tx) => {
        const row = await tx.pairwiseRankingRun.findFirst({
          where: { id: rankingRunId, pairwiseRun: { eventId } },
        });
        if (!row)
          fail(
            404,
            'PAIRWISE_RANKING_NOT_FOUND',
            'Pairwise ranking not found.',
          );
        return this.view(
          tx,
          row,
          await this.evidence(tx, eventId, row.pairwiseRunId),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
