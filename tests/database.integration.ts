import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rollback = new Error('ROLLBACK_TEST');
const expectedErrors: Record<
  string,
  | { message: string; sqlstate: string }
  | { code: string; meta: Record<string, unknown> }
> = {
  'one active team per event': {
    code: 'P2002',
    meta: { modelName: 'TeamMember', target: ['eventId', 'userId'] },
  },
  'membership event must match team': {
    code: 'P2003',
    meta: { modelName: 'TeamMember', constraint: 'TeamMember_eventId_fkey' },
  },
  'judge profile requires judge role': {
    message: 'JudgeProfile requires a JUDGE membership',
    sqlstate: '23514',
  },
  'submitted snapshot content is immutable': {
    message: 'Submitted snapshot is immutable',
    sqlstate: '23514',
  },
  'submitted snapshots cannot be deleted': {
    message: 'Submitted versions cannot be deleted',
    sqlstate: '23514',
  },
  'submission versions are unique': {
    code: 'P2002',
    meta: { modelName: 'Submission', target: ['projectId', 'version'] },
  },
  'project and track share event': {
    message: 'Project references must belong to the same event',
    sqlstate: '23514',
  },
  'assignments cannot cross events': {
    message: 'JudgeAssignment references must belong to the same event',
    sqlstate: '23514',
  },
  'published rubric criteria cannot change': {
    message: 'Published rubric criteria are immutable',
    sqlstate: '23514',
  },
  'assignments reject mutable drafts': {
    message: 'Assignment requires an immutable submitted version',
    sqlstate: '23514',
  },
  'assignment runs reject draft rubrics': {
    message: 'Assignment run requires a published same-event rubric',
    sqlstate: '23514',
  },
  'audit events cannot be rewritten': {
    message: 'AuditEvent is append-only',
    sqlstate: '23514',
  },
  'scores obey criterion bounds': {
    message: 'Score criterion/range does not match evaluation rubric',
    sqlstate: '23514',
  },
  'evaluation rubric must match assignment rubric at DB level': {
    code: 'P2003',
    meta: {
      modelName: 'Evaluation',
      constraint: 'Evaluation_assignmentId_rubricId_fkey',
    },
  },
  'published assignment run cannot be updated directly': {
    message: 'Published assignment run is immutable',
    sqlstate: '23514',
  },
  'published assignment cannot be updated directly': {
    message: 'Published assignment is immutable',
    sqlstate: '23514',
  },
  'second PREVIEW run for one event is rejected by partial unique index': {
    code: 'P2002',
    meta: { modelName: 'AssignmentRun', target: ['eventId'] },
  },
  'judge and submission uniqueness spans published runs': {
    code: 'P2002',
    meta: {
      modelName: 'JudgeAssignment',
      target: ['judgeProfileId', 'submissionId'],
    },
  },
  'submitted raw scores remain immutable': {
    message: 'Submitted raw scores are immutable',
    sqlstate: '23514',
  },
  'conflicting active event role rejected': {
    code: 'P2002',
    meta: { modelName: 'EventMembership', target: ['eventId', 'userId'] },
  },
  'completed score run is immutable': {
    message: 'Completed/failed ScoreRun is immutable',
    sqlstate: '23514',
  },
  'normalized score is immutable': {
    message: 'NormalizedScore is immutable after creation',
    sqlstate: '23514',
  },
  'project score is immutable': {
    message: 'ProjectScore is immutable after creation',
    sqlstate: '23514',
  },
  'result run is immutable': {
    message: 'ResultRun is immutable after creation',
    sqlstate: '23514',
  },
  'project result is immutable': {
    message: 'ProjectResult is immutable after creation',
    sqlstate: '23514',
  },
  'judge score stats is immutable': {
    message: 'JudgeScoreStats is immutable after creation',
    sqlstate: '23514',
  },
  'result run references must belong to the same event': {
    message: 'ResultRun references must belong to the same event',
    sqlstate: '23514',
  },
};
const checks: Array<{ name: string; passed: boolean; error?: string }> = [];
async function check(name: string, operation: () => Promise<void>) {
  try {
    await operation();
    checks.push({ name, passed: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(
      `FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function rejects(
  name: string,
  operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  await check(name, async () => {
    await assert.rejects(db.$transaction(operation), (error: unknown) => {
      assert(
        error instanceof Prisma.PrismaClientKnownRequestError ||
          error instanceof Prisma.PrismaClientUnknownRequestError,
      );
      const expected = expectedErrors[name];
      assert(expected, `Missing exact expected error for ${name}`);
      if ('message' in expected) {
        assert(
          error.message.includes(`message: "${expected.message}"`),
          `Expected exact PostgreSQL message: ${expected.message}`,
        );
        assert(
          error.message.includes(`code: "${expected.sqlstate}"`),
          `Expected PostgreSQL SQLSTATE ${expected.sqlstate}`,
        );
      } else {
        assert(error instanceof Prisma.PrismaClientKnownRequestError);
        assert.equal(error.code, expected.code);
        assert.deepEqual(error.meta, expected.meta);
      }
      return true;
    });
  });
}
async function run() {
  assert.equal(
    await db.user.count({ where: { email: { endsWith: '@dogfood.local' } } }),
    7,
    'Run development seed first',
  );
  await rejects('one active team per event', async (tx) => {
    const team = await tx.team.create({
      data: {
        eventId: id(10),
        createdById: id(3),
        name: 'Other',
        slug: randomUUID(),
      },
    });
    return tx.teamMember.create({
      data: { teamId: team.id, eventId: id(10), userId: id(3) },
    });
  });
  await rejects('membership event must match team', (tx) =>
    tx.teamMember.create({
      data: { teamId: id(60), eventId: randomUUID(), userId: id(6) },
    }),
  );
  await rejects('judge profile requires judge role', (tx) =>
    tx.judgeProfile.create({ data: { eventMembershipId: id(23) } }),
  );
  await rejects('submitted snapshot content is immutable', (tx) =>
    tx.submission.update({
      where: { id: id(80) },
      data: { title: 'tampered' },
    }),
  );
  await rejects('submitted snapshots cannot be deleted', (tx) =>
    tx.submission.delete({ where: { id: id(80) } }),
  );
  await rejects('submission versions are unique', (tx) =>
    tx.submission.create({
      data: {
        projectId: id(70),
        version: 1,
        title: 'duplicate',
        description: 'duplicate',
        createdById: id(3),
      },
    }),
  );
  await rejects('project and track share event', async (tx) => {
    const event = await tx.event.create({
      data: { slug: randomUUID(), name: 'Other', createdById: id(2) },
    });
    const track = await tx.track.create({
      data: { eventId: event.id, name: 'Other', slug: 'other' },
    });
    return tx.project.update({
      where: { id: id(70) },
      data: { trackId: track.id },
    });
  });
  await rejects('assignments cannot cross events', async (tx) => {
    const runId = await publishedRun(tx);
    const event = await tx.event.create({
      data: { slug: randomUUID(), name: 'Other', createdById: id(2) },
    });
    return tx.judgeAssignment.create({
      data: {
        eventId: event.id,
        runId,
        rubricId: id(100),
        judgeProfileId: id(96),
        submissionId: id(80),
        assignmentMethod: 'MANUAL',
      },
    });
  });
  await rejects('published rubric criteria cannot change', async (tx) => {
    await tx.rubric.update({
      where: { id: id(100) },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    return tx.rubricCriterion.update({
      where: { id: id(101) },
      data: { weight: '0.5' },
    });
  });
  await rejects('assignments reject mutable drafts', async (tx) => {
    const runId = await publishedRun(tx);
    const submission = await tx.submission.create({
      data: {
        projectId: id(70),
        version: 2,
        title: 'Draft',
        description: 'Draft',
        createdById: id(3),
      },
    });
    return tx.judgeAssignment.create({
      data: {
        eventId: id(10),
        runId,
        rubricId: id(100),
        judgeProfileId: id(96),
        submissionId: submission.id,
        assignmentMethod: 'MANUAL',
      },
    });
  });
  await rejects('assignment runs reject draft rubrics', async (tx) => {
    return tx.assignmentRun.create({
      data: {
        eventId: id(10),
        rubricVersionId: id(100),
        type: 'MANUAL',
        status: 'PUBLISHED',
        reviewsPerSubmission: 1,
        algorithm: 'manual',
        algorithmVersion: '1',
        allocationSource: 'manual',
        createdById: id(2),
        publishedAt: new Date(),
      },
    });
  });
  await rejects('audit events cannot be rewritten', async (tx) => {
    const audit = await tx.auditEvent.create({
      data: { action: 'TEST', entityType: 'Test' },
    });
    return tx.auditEvent.update({
      where: { id: audit.id },
      data: { action: 'ALTERED' },
    });
  });
  async function publishedRun(tx: Prisma.TransactionClient) {
    await tx.rubric.update({
      where: { id: id(100) },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    const run = await tx.assignmentRun.create({
      data: {
        eventId: id(10),
        rubricVersionId: id(100),
        type: 'MANUAL',
        status: 'PUBLISHED',
        reviewsPerSubmission: 1,
        algorithm: 'manual',
        algorithmVersion: '1',
        allocationSource: 'manual',
        createdById: id(2),
        publishedAt: new Date(),
      },
    });
    return run.id;
  }
  async function evaluation(tx: Prisma.TransactionClient) {
    const runId = await publishedRun(tx);
    const assignment = await tx.judgeAssignment.create({
      data: {
        eventId: id(10),
        runId,
        rubricId: id(100),
        judgeProfileId: id(96),
        submissionId: id(80),
        assignmentMethod: 'MANUAL',
      },
    });
    return tx.evaluation.create({
      data: {
        assignmentId: assignment.id,
        rubricId: id(100),
        status: 'IN_PROGRESS',
      },
    });
  }
  await rejects('scores obey criterion bounds', async (tx) => {
    const ev = await evaluation(tx);
    return tx.evaluationScore.create({
      data: { evaluationId: ev.id, criterionId: id(101), score: 11 },
    });
  });
  await rejects(
    'evaluation rubric must match assignment rubric at DB level',
    async (tx) => {
      const runId = await publishedRun(tx);
      const other = await tx.rubric.create({
        data: {
          eventId: id(10),
          name: 'Other published rubric',
          version: 99,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      const assignment = await tx.judgeAssignment.create({
        data: {
          eventId: id(10),
          runId,
          rubricId: id(100),
          judgeProfileId: id(96),
          submissionId: id(80),
          assignmentMethod: 'MANUAL',
        },
      });
      return tx.evaluation.create({
        data: { assignmentId: assignment.id, rubricId: other.id },
      });
    },
  );
  await rejects(
    'published assignment run cannot be updated directly',
    async (tx) => {
      const runId = await publishedRun(tx);
      return tx.assignmentRun.update({
        where: { id: runId },
        data: { algorithm: 'tampered' },
      });
    },
  );
  await rejects(
    'published assignment cannot be updated directly',
    async (tx) => {
      const runId = await publishedRun(tx);
      const assignment = await tx.judgeAssignment.create({
        data: {
          eventId: id(10),
          runId,
          rubricId: id(100),
          judgeProfileId: id(96),
          submissionId: id(80),
          assignmentMethod: 'MANUAL',
        },
      });
      return tx.judgeAssignment.update({
        where: { id: assignment.id },
        data: { status: 'COMPLETED' },
      });
    },
  );
  await rejects(
    'second PREVIEW run for one event is rejected by partial unique index',
    async (tx) => {
      await publishedRun(tx);
      const data = {
        eventId: id(10),
        rubricVersionId: id(100),
        type: 'BATCH' as const,
        status: 'PREVIEW' as const,
        reviewsPerSubmission: 1,
        algorithm: 'test',
        algorithmVersion: '1',
        allocationSource: 'greedy',
        createdById: id(2),
      };
      await tx.assignmentRun.create({ data });
      return tx.assignmentRun.create({ data });
    },
  );
  await rejects(
    'judge and submission uniqueness spans published runs',
    async (tx) => {
      const firstRunId = await publishedRun(tx);
      const secondRun = await tx.assignmentRun.create({
        data: {
          eventId: id(10),
          rubricVersionId: id(100),
          type: 'MANUAL',
          status: 'PUBLISHED',
          reviewsPerSubmission: 1,
          algorithm: 'manual',
          algorithmVersion: '1',
          allocationSource: 'manual',
          createdById: id(2),
          publishedAt: new Date(),
        },
      });
      const base = {
        eventId: id(10),
        rubricId: id(100),
        judgeProfileId: id(96),
        submissionId: id(80),
        assignmentMethod: 'MANUAL' as const,
      };
      await tx.judgeAssignment.create({ data: { ...base, runId: firstRunId } });
      return tx.judgeAssignment.create({
        data: { ...base, runId: secondRun.id },
      });
    },
  );
  await rejects('submitted raw scores remain immutable', async (tx) => {
    const ev = await evaluation(tx);
    const score = await tx.evaluationScore.create({
      data: { evaluationId: ev.id, criterionId: id(101), score: 8 },
    });
    await tx.evaluation.update({
      where: { id: ev.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    return tx.evaluationScore.update({
      where: { id: score.id },
      data: { score: 9 },
    });
  });
  await check('departed member may join another team', async () => {
    await assert.rejects(
      db.$transaction(async (tx) => {
        await tx.teamMember.update({
          where: { teamId_userId: { teamId: id(60), userId: id(3) } },
          data: { leftAt: new Date() },
        });
        const team = await tx.team.create({
          data: {
            eventId: id(10),
            createdById: id(3),
            name: 'New team',
            slug: randomUUID(),
          },
        });
        await tx.teamMember.create({
          data: { teamId: team.id, eventId: id(10), userId: id(3) },
        });
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );
  });
  await rejects('conflicting active event role rejected', (tx) =>
    tx.eventMembership.create({
      data: { eventId: id(10), userId: id(3), role: 'JUDGE' },
    }),
  );
  await rejects('completed score run is immutable', async (tx) => {
    const run = await tx.scoreRun.create({
      data: {
        eventId: id(10),
        status: 'COMPLETED',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        algorithm: 'Z_SCORE',
        algorithmVersion: 'V1',
        parameters: {},
        createdById: id(2),
      },
    });
    return tx.scoreRun.update({
      where: { id: run.id },
      data: { method: 'OTHER' },
    });
  });
  await rejects('normalized score is immutable', async (tx) => {
    const ev = await evaluation(tx);
    const run = await tx.scoreRun.create({
      data: {
        eventId: id(10),
        status: 'CREATING',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        algorithm: 'Z_SCORE',
        algorithmVersion: 'V1',
        parameters: {},
        createdById: id(2),
      },
    });
    const ns = await tx.normalizedScore.create({
      data: {
        scoreRunId: run.id,
        evaluationId: ev.id,
        rawScore: 5.0,
        normalizedScore: 0.0,
      },
    });
    return tx.normalizedScore.update({
      where: { id: ns.id },
      data: { normalizedScore: 1.0 },
    });
  });
  await rejects('project score is immutable', async (tx) => {
    const run = await tx.scoreRun.create({
      data: {
        eventId: id(10),
        status: 'CREATING',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        algorithm: 'Z_SCORE',
        algorithmVersion: 'V1',
        parameters: {},
        createdById: id(2),
      },
    });
    const ps = await tx.projectScore.create({
      data: {
        scoreRunId: run.id,
        projectId: id(70),
        aggregatedScore: 0.0,
        rawAverage: 5.0,
        evaluationCount: 1,
        requiredCount: 1,
        coverageComplete: true,
      },
    });
    return tx.projectScore.update({
      where: { id: ps.id },
      data: { aggregatedScore: 2.0 },
    });
  });
  await rejects('result run is immutable', async (tx) => {
    const run = await tx.scoreRun.create({
      data: {
        eventId: id(10),
        status: 'COMPLETED',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        algorithm: 'Z_SCORE',
        algorithmVersion: 'V1',
        parameters: {},
        createdById: id(2),
      },
    });
    const res = await tx.resultRun.create({
      data: {
        eventId: id(10),
        scoreRunId: run.id,
        createdById: id(2),
        rankingPolicy: 'COMPETITION',
        rankingVersion: 'V1',
      },
    });
    return tx.resultRun.update({
      where: { id: res.id },
      data: { rankingPolicy: 'OTHER' },
    });
  });
  await rejects('project result is immutable', async (tx) => {
    const run = await tx.scoreRun.create({
      data: {
        eventId: id(10),
        status: 'COMPLETED',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        algorithm: 'Z_SCORE',
        algorithmVersion: 'V1',
        parameters: {},
        createdById: id(2),
      },
    });
    const res = await tx.resultRun.create({
      data: {
        eventId: id(10),
        scoreRunId: run.id,
        createdById: id(2),
      },
    });
    const pr = await tx.projectResult.create({
      data: {
        resultRunId: res.id,
        projectId: id(70),
        score: 0.0,
        rank: 1,
      },
    });
    return tx.projectResult.update({
      where: { id: pr.id },
      data: { rank: 2 },
    });
  });
  await rejects('judge score stats is immutable', async (tx) => {
    const run = await tx.scoreRun.create({
      data: {
        eventId: id(10),
        status: 'CREATING',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        algorithm: 'Z_SCORE',
        algorithmVersion: 'V1',
        parameters: {},
        createdById: id(2),
      },
    });
    const jss = await tx.judgeScoreStats.create({
      data: {
        scoreRunId: run.id,
        judgeProfileId: id(96),
        evaluationCount: 1,
        mean: 5.0,
        populationStdDev: 0.0,
      },
    });
    return tx.judgeScoreStats.update({
      where: { id: jss.id },
      data: { mean: 6.0 },
    });
  });
  await rejects(
    'result run references must belong to the same event',
    async (tx) => {
      return tx.resultRun.create({
        data: {
          eventId: id(10),
          scoreRunId: randomUUID(),
          createdById: id(2),
        },
      });
    },
  );
  console.log(
    `DATABASE INVARIANTS: ${checks.filter((item) => item.passed).length} PASS, ${checks.filter((item) => !item.passed).length} FAIL`,
  );
  for (const item of checks)
    console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
  if (checks.some((item) => !item.passed)) process.exitCode = 1;
}
void run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
