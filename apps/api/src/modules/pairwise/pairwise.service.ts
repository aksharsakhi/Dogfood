import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionPrincipal } from '@dogfood/shared';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccessService } from '../../common/auth/access.service';
import { fail } from '../../common/errors/domain-error';
import { AuditService } from '../audit/audit.service';
import { planPairwise } from './assignment-plan';

type Tx = Prisma.TransactionClient;

@Injectable()
export class PairwiseService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async run(tx: Tx, eventId: string, runId: string) {
    const row = await tx.pairwiseRun.findFirst({
      where: { id: runId, eventId },
    });
    if (!row) fail(404, 'PAIRWISE_RUN_NOT_FOUND', 'Pairwise run not found.');
    return row;
  }

  private async judge(p: SessionPrincipal, eventId: string) {
    const profile = await this.db.judgeProfile.findFirst({
      where: {
        eventMembership: {
          eventId,
          userId: p.userId,
          role: 'JUDGE',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      },
    });
    if (!profile)
      fail(
        403,
        'JUDGE_ACCESS_REQUIRED',
        'Active judge membership is required.',
      );
    return profile;
  }

  private async input(tx: Tx, eventId: string) {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || ['DRAFT', 'ARCHIVED'].includes(event.status))
      fail(409, 'EVENT_NOT_JUDGEABLE', 'Event is not ready for judging.');
    const [submissions, profiles, conflicts, assignments] = await Promise.all([
      tx.submission.findMany({
        where: { project: { eventId, status: 'ACTIVE' } },
        include: { project: { select: { teamId: true } } },
        orderBy: [{ projectId: 'asc' }, { version: 'desc' }],
      }),
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
        orderBy: { id: 'asc' },
      }),
      tx.judgeConflict.findMany({
        where: { judgeProfile: { eventMembership: { eventId } } },
        orderBy: { id: 'asc' },
      }),
      tx.judgeAssignment.findMany({
        where: { eventId, run: { status: 'PUBLISHED' } },
        select: { judgeProfileId: true },
      }),
    ]);
    const latest = new Map<string, (typeof submissions)[number]>();
    for (const submission of submissions)
      if (
        !latest.has(submission.projectId) &&
        ['SUBMITTED', 'LOCKED', 'WITHDRAWN'].includes(submission.status)
      )
        latest.set(submission.projectId, submission);
    const projects = [...latest.values()]
      .filter((submission) =>
        ['SUBMITTED', 'LOCKED'].includes(submission.status),
      )
      .map((submission) => ({
        projectId: submission.projectId,
        submissionId: submission.id,
        teamId: submission.project.teamId,
      }));
    const judgeInputs = await Promise.all(
      profiles.map(async (profile) => ({
        id: profile.id,
        capacity: profile.maxAssignments,
        existingLoad:
          assignments.filter(
            (assignment) => assignment.judgeProfileId === profile.id,
          ).length +
          (await tx.pairwiseAssignment.count({
            where: { judgeProfileId: profile.id, run: { status: 'PUBLISHED' } },
          })),
      })),
    );
    return planPairwise({
      projects,
      judges: judgeInputs,
      conflicts: conflicts.map(
        ({ judgeProfileId, projectId, teamId, type }) => ({
          judgeProfileId,
          projectId,
          teamId,
          type,
        }),
      ),
    });
  }

  async create(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId } });
      if (!event) fail(404, 'EVENT_NOT_FOUND', 'Event not found.');
      const run = await tx.pairwiseRun.create({
        data: { eventId, createdById: p.userId },
      });
      await this.audit.record(tx, {
        action: 'PAIRWISE_RUN_CREATED',
        entityType: 'PairwiseRun',
        entityId: run.id,
        eventId,
        actorUserId: p.userId,
      });
      return run;
    });
  }

  async list(p: SessionPrincipal, eventId: string) {
    await this.access.organizer(p, eventId);
    return this.db.pairwiseRun.findMany({
      where: { eventId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async detail(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    return this.run(this.db, eventId, runId);
  }

  async preview(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const run = await this.run(tx, eventId, runId);
      if (run.status !== 'DRAFT' || run.snapshotsFrozenAt)
        fail(
          409,
          'PAIRWISE_RUN_NOT_DRAFT',
          'Only an unfrozen draft run can be previewed.',
        );
      if (
        await tx.pairwiseRunProjectSnapshot.count({
          where: { pairwiseRunId: runId },
        })
      )
        fail(
          409,
          'PAIRWISE_SNAPSHOTS_EXIST',
          'Draft run already has pinned snapshots.',
        );
      const proposal = await this.input(tx, eventId);
      await this.audit.record(tx, {
        action: 'PAIRWISE_ASSIGNMENTS_PREVIEWED',
        entityType: 'PairwiseRun',
        entityId: runId,
        eventId,
        actorUserId: p.userId,
        metadata: { runId, proposalHash: proposal.proposalHash },
      });
      return proposal;
    });
  }

  async publish(
    p: SessionPrincipal,
    eventId: string,
    runId: string,
    proposalHash: string,
  ) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;
      const run = await this.run(tx, eventId, runId);
      if (run.status !== 'DRAFT' || run.snapshotsFrozenAt)
        fail(
          409,
          'PAIRWISE_RUN_NOT_DRAFT',
          'Only an unfrozen draft run can be published.',
        );
      if (
        await tx.pairwiseRunProjectSnapshot.count({
          where: { pairwiseRunId: runId },
        })
      )
        fail(
          409,
          'PAIRWISE_SNAPSHOTS_EXIST',
          'Draft run already has pinned snapshots.',
        );
      // Normal submission writes lock their Project row. Hold those locks while
      // checking the preview and pinning submissions to prevent a late version.
      await tx.$queryRaw`SELECT id FROM "Project" WHERE "eventId" = ${eventId}::uuid ORDER BY id FOR UPDATE`;
      // Conflict inserts acquire an FK lock on JudgeProfile. This stronger
      // lock orders conflict changes against the eligibility check and commit.
      await tx.$queryRaw`SELECT j.id FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id = j."eventMembershipId" WHERE m."eventId" = ${eventId}::uuid ORDER BY j.id FOR UPDATE OF j`;
      const proposal = await this.input(tx, eventId);
      if (proposal.proposalHash !== proposalHash)
        fail(
          409,
          'STALE_PREVIEW',
          'Inputs changed; generate a fresh pairwise preview.',
        );
      if (!proposal.diagnostics.graphConnected || proposal.snapshots.length < 2)
        fail(
          409,
          'PAIRWISE_INFEASIBLE',
          'A connected comparison graph is not feasible.',
        );
      for (const snapshot of proposal.snapshots)
        await tx.pairwiseRunProjectSnapshot.create({
          data: { pairwiseRunId: runId, ...snapshot },
        });
      for (const pair of proposal.pairs)
        await tx.pairwiseAssignment.create({ data: { runId, ...pair } });
      await tx.pairwiseRun.update({
        where: { id: runId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'PAIRWISE_RUN_PUBLISHED',
        entityType: 'PairwiseRun',
        entityId: runId,
        eventId,
        actorUserId: p.userId,
        metadata: { runId },
      });
      return {
        runId,
        status: 'PUBLISHED',
        assignmentCount: proposal.pairs.length,
        proposalHash,
      };
    });
  }

  async close(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PairwiseRun" WHERE id = ${runId}::uuid FOR UPDATE`;
      const run = await this.run(tx, eventId, runId);
      if (run.status !== 'PUBLISHED')
        fail(
          409,
          'PAIRWISE_RUN_NOT_PUBLISHED',
          'Only a published run can be closed.',
        );
      const closed = await tx.pairwiseRun.update({
        where: { id: runId },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'PAIRWISE_RUN_CLOSED',
        entityType: 'PairwiseRun',
        entityId: runId,
        eventId,
        actorUserId: p.userId,
        metadata: { runId },
      });
      return closed;
    });
  }

  async progress(p: SessionPrincipal, eventId: string, runId: string) {
    await this.access.organizer(p, eventId);
    const run = await this.run(this.db, eventId, runId);
    const [assignments, snapshots] = await Promise.all([
      this.db.pairwiseAssignment.findMany({
        where: { runId },
        select: {
          status: true,
          judgeProfileId: true,
          projectAId: true,
          projectBId: true,
        },
      }),
      this.db.pairwiseRunProjectSnapshot.findMany({
        where: { pairwiseRunId: runId },
        select: { projectId: true },
      }),
    ]);
    const submitted = assignments.filter(
      (assignment) => assignment.status === 'SUBMITTED',
    ).length;
    const perJudge = new Map<string, { total: number; submitted: number }>();
    const degree = new Map(
      snapshots.map((snapshot) => [snapshot.projectId, 0]),
    );
    const parent = new Map(
      snapshots.map((snapshot) => [snapshot.projectId, snapshot.projectId]),
    );
    for (const assignment of assignments) {
      const counts = perJudge.get(assignment.judgeProfileId) ?? {
        total: 0,
        submitted: 0,
      };
      counts.total++;
      if (assignment.status === 'SUBMITTED') counts.submitted++;
      perJudge.set(assignment.judgeProfileId, counts);
      for (const id of [assignment.projectAId, assignment.projectBId]) {
        degree.set(id, (degree.get(id) ?? 0) + 1);
        if (!parent.has(id)) parent.set(id, id);
      }
    }
    const root = (id: string): string => {
      let current = id;
      while (parent.get(current) !== current) current = parent.get(current)!;
      return current;
    };
    for (const assignment of assignments)
      parent.set(root(assignment.projectBId), root(assignment.projectAId));
    const degrees = [...degree.values()];
    return {
      runId,
      status: run.status,
      totalAssignments: assignments.length,
      pending: assignments.length - submitted,
      submitted,
      completionPercent: assignments.length
        ? (submitted / assignments.length) * 100
        : 0,
      pinnedProjectCount: snapshots.length,
      perJudge: [...perJudge]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([judgeProfileId, counts]) => ({ judgeProfileId, ...counts })),
      graph: {
        componentCount: new Set([...parent.keys()].map(root)).size,
        graphConnected:
          snapshots.length >= 2 &&
          new Set([...parent.keys()].map(root)).size === 1,
        perProjectDegree: [...degree]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([projectId, value]) => ({ projectId, degree: value })),
        minDegree: degrees.length ? Math.min(...degrees) : 0,
        maxDegree: degrees.length ? Math.max(...degrees) : 0,
      },
    };
  }

  private async material(tx: Tx, runId: string, projectId: string) {
    const snapshot = await tx.pairwiseRunProjectSnapshot.findUnique({
      where: { pairwiseRunId_projectId: { pairwiseRunId: runId, projectId } },
      include: {
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
      },
    });
    if (!snapshot)
      fail(409, 'PAIRWISE_SNAPSHOT_MISSING', 'Pinned submission is missing.');
    return { projectId, submission: snapshot.submission };
  }

  async workspace(p: SessionPrincipal, eventId: string) {
    const judge = await this.judge(p, eventId);
    const assignments = await this.db.pairwiseAssignment.findMany({
      where: {
        judgeProfileId: judge.id,
        run: { eventId, status: { in: ['PUBLISHED', 'CLOSED'] } },
      },
      include: { comparison: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const rows = await Promise.all(
      assignments.map(async (assignment) => ({
        assignmentId: assignment.id,
        runId: assignment.runId,
        status: assignment.status,
        projectA: await this.material(
          this.db,
          assignment.runId,
          assignment.projectAId,
        ),
        projectB: await this.material(
          this.db,
          assignment.runId,
          assignment.projectBId,
        ),
        comparison: assignment.comparison
          ? {
              id: assignment.comparison.id,
              winnerProjectId: assignment.comparison.winnerProjectId,
              submittedAt: assignment.comparison.submittedAt,
            }
          : null,
      })),
    );
    return { judgeProfileId: judge.id, assignments: rows };
  }

  async submit(
    p: SessionPrincipal,
    eventId: string,
    assignmentId: string,
    winnerProjectId: string,
  ) {
    const judge = await this.judge(p, eventId);
    return this.db.$transaction(async (tx) => {
      const reference = await tx.pairwiseAssignment.findFirst({
        where: { id: assignmentId, judgeProfileId: judge.id, run: { eventId } },
        select: { runId: true },
      });
      if (!reference)
        fail(
          404,
          'PAIRWISE_ASSIGNMENT_NOT_FOUND',
          'Assigned comparison not found.',
        );
      await tx.$queryRaw`SELECT id FROM "PairwiseRun" WHERE id = ${reference.runId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "JudgeProfile" WHERE id = ${judge.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "PairwiseAssignment" WHERE id = ${assignmentId}::uuid FOR UPDATE`;
      const assignment = await tx.pairwiseAssignment.findFirst({
        where: { id: assignmentId, judgeProfileId: judge.id, run: { eventId } },
        include: { run: true, comparison: true },
      });
      if (!assignment)
        fail(
          404,
          'PAIRWISE_ASSIGNMENT_NOT_FOUND',
          'Assigned comparison not found.',
        );
      if (assignment.run.status !== 'PUBLISHED')
        fail(409, 'PAIRWISE_RUN_CLOSED', 'Run is not open for comparison.');
      if (assignment.status !== 'PENDING' || assignment.comparison)
        fail(
          409,
          'PAIRWISE_COMPARISON_IMMUTABLE',
          'Comparison has already been submitted.',
        );
      if (
        winnerProjectId !== assignment.projectAId &&
        winnerProjectId !== assignment.projectBId
      )
        fail(
          400,
          'INVALID_WINNER',
          'Winner must be one of the assigned projects.',
        );
      const loserProjectId =
        winnerProjectId === assignment.projectAId
          ? assignment.projectBId
          : assignment.projectAId;
      const [a, b] = await Promise.all([
        this.material(tx, assignment.runId, assignment.projectAId),
        this.material(tx, assignment.runId, assignment.projectBId),
      ]);
      const projects = await tx.project.findMany({
        where: { id: { in: [a.projectId, b.projectId] } },
        select: { id: true, teamId: true },
      });
      const conflicts = await tx.judgeConflict.findMany({
        where: { judgeProfileId: judge.id },
      });
      if (
        projects.some((project) =>
          conflicts.some(
            (conflict) =>
              conflict.projectId === project.id ||
              conflict.teamId === project.teamId ||
              ['ORGANIZATION', 'OTHER'].includes(conflict.type),
          ),
        )
      )
        fail(
          409,
          'JUDGE_CONFLICT',
          'Declared conflict excludes this comparison.',
        );
      const comparison = await tx.pairwiseComparison.create({
        data: { assignmentId, winnerProjectId, loserProjectId },
      });
      await this.audit.record(tx, {
        action: 'PAIRWISE_COMPARISON_SUBMITTED',
        entityType: 'PairwiseComparison',
        entityId: comparison.id,
        eventId,
        actorUserId: p.userId,
        metadata: {
          pairwiseRunId: assignment.runId,
          assignmentId,
          judgeProfileId: judge.id,
          winnerProjectId,
          loserProjectId,
        },
      });
      return comparison;
    });
  }
}
