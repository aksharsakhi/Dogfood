import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Clock } from '../src/common/time';
import { allocate, AllocationInput } from '../src/modules/judging/allocator';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('Isolated test database required');
const db = new PrismaClient();
const unique = () => randomUUID().slice(0, 12);
const origin = 'http://localhost:3000';
let now = new Date('2030-01-04T12:00:00Z');
let app: NestFastifyApplication;
type Actor = { id: string; cookie: string };
const post = (path: string, body: object, cookie?: string) => {
  const req = request(app.getHttpServer()).post(path).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const get = (path: string, cookie: string) =>
  request(app.getHttpServer()).get(path).set('Cookie', cookie);
async function actor(label: string): Promise<Actor> {
  const email = `${label}-${unique()}@example.test`;
  const created = await post('/auth/register', {
    email,
    displayName: label,
    password: 'A secure test password 123!',
  }).expect(201);
  const login = await post('/auth/login', {
    email,
    password: 'A secure test password 123!',
  }).expect(200);
  const header = login.headers['set-cookie'];
  return {
    id: created.body.id as string,
    cookie: ((Array.isArray(header) ? header[0] : header) as string).split(
      ';',
    )[0]!,
  };
}
async function fixture(judgeCount = 2, submissionCount = 1) {
  const organizer = await actor('organizer-stage3');
  const event = await post(
    '/events',
    {
      name: 'Stage 3 judging',
      slug: `stage3-${unique()}`,
      visibility: 'PUBLIC',
      registrationOpensAt: '2029-01-01T00:00:00Z',
      registrationClosesAt: '2031-01-01T00:00:00Z',
      submissionClosesAt: '2030-01-03T00:00:00Z',
      judgingOpensAt: '2030-01-04T00:00:00Z',
      judgingClosesAt: '2030-01-06T00:00:00Z',
    },
    organizer.cookie,
  ).expect(201);
  const eventId = event.body.id as string;
  await post(`/events/${eventId}/publish`, {}, organizer.cookie).expect(201);
  const base = `/events/${eventId}/judging`;
  const draft = await post(
    `${base}/rubrics`,
    {
      name: 'Stage 3 rubric',
      criteria: [
        { name: 'Impact', weight: '0.4', minScore: '0', maxScore: '10' },
        { name: 'Execution', weight: '0.6', minScore: '0', maxScore: '10' },
      ],
    },
    organizer.cookie,
  ).expect(201);
  const rubric = await post(
    `${base}/rubrics/${draft.body.id}/publish`,
    {},
    organizer.cookie,
  ).expect(201);
  const judges: Array<{ actor: Actor; profileId: string }> = [];
  for (let i = 0; i < judgeCount; i++) {
    const user = await actor(`judge-stage3-${i}`);
    const invite = await post(
      `${base}/invitations`,
      { invitedUserId: user.id },
      organizer.cookie,
    ).expect(201);
    const accepted = await post(
      '/judge-invitations/accept',
      { token: invite.body.token },
      user.cookie,
    ).expect(200);
    judges.push({
      actor: user,
      profileId: accepted.body.judgeProfileId as string,
    });
  }
  const submissions: Array<{ id: string; projectId: string; teamId: string }> =
    [];
  for (let i = 0; i < submissionCount; i++) {
    const team = await db.team.create({
      data: {
        eventId,
        createdById: organizer.id,
        name: `Team ${i}`,
        slug: `stage3-team-${unique()}`,
      },
    });
    const project = await db.project.create({
      data: {
        eventId,
        teamId: team.id,
        name: `Project ${i}`,
        slug: `stage3-project-${unique()}`,
        status: 'ACTIVE',
      },
    });
    const submission = await db.submission.create({
      data: {
        projectId: project.id,
        version: 1,
        title: `Submitted ${i}`,
        description: 'Snapshot',
        projectName: `Project ${i}`,
        status: 'SUBMITTED',
        createdById: organizer.id,
        submittedAt: new Date('2030-01-02T00:00:00Z'),
      },
    });
    submissions.push({
      id: submission.id,
      projectId: project.id,
      teamId: team.id,
    });
  }
  const requestBody = (reviewsPerSubmission = 1) => ({
    rubricId: rubric.body.id as string,
    reviewsPerSubmission,
  });
  return {
    organizer,
    eventId,
    base,
    rubric: rubric.body as { id: string; criteria: Array<{ id: string }> },
    judges,
    submissions,
    requestBody,
  };
}
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue({ now: () => now })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

const judge = (id: string, capacity = 1, load = 0) => ({
  id,
  capacity,
  load,
  trackIds: [],
});
const submission = (id: string, eligible: string[], covered = 0) => ({
  id,
  projectId: id,
  trackId: null,
  covered,
  excludedJudgeIds: ['a', 'b', 'c'].filter((j) => !eligible.includes(j)),
});
describe('Stage 3 deterministic allocator', () => {
  it('reports genuine max-flow infeasibility and affected submissions', () => {
    const result = allocate({
      judges: [judge('a')],
      submissions: [submission('s1', ['a']), submission('s2', ['a'])],
      reviewsPerSubmission: 1,
    });
    expect(result).toMatchObject({ required: 2, achievable: 1, shortfall: 1 });
    expect(result.affectedSubmissions).toHaveLength(1);
    expect(result.affectedSubmissions[0]!.reasons).toContain(
      'shared judge capacity',
    );
  });
  it('uses deterministic flow fallback when constrained greedy fails on a feasible graph', () => {
    // s1 only a; s2 b/c; s3 a/b. Greedy assigns a,b, then strands s3; flow reroutes s2 to c.
    const input: AllocationInput = {
      judges: [judge('a'), judge('b'), judge('c')],
      submissions: [
        submission('s1', ['a']),
        submission('s2', ['b', 'c']),
        submission('s3', ['a', 'b']),
      ],
      reviewsPerSubmission: 1,
    };
    const result = allocate(input);
    expect(result.greedyCount).toBe(2);
    expect(result).toMatchObject({
      required: 3,
      achievable: 3,
      shortfall: 0,
      allocationSource: 'flow-fallback',
    });
    expect(result.pairs).toEqual([
      { submissionId: 's1', judgeProfileId: 'a' },
      { submissionId: 's2', judgeProfileId: 'c' },
      { submissionId: 's3', judgeProfileId: 'b' },
    ]);
    for (let i = 0; i < 4; i++)
      expect(
        allocate({
          ...input,
          judges: [...input.judges].reverse(),
          submissions: [...input.submissions].reverse(),
        }).pairs,
      ).toEqual(result.pairs);
  });
  it('processes fewest eligible judges first and counts existing load and coverage', () => {
    const result = allocate({
      judges: [judge('a', 2, 1), judge('b')],
      submissions: [submission('s1', ['a', 'b'], 1), submission('s2', ['b'])],
      reviewsPerSubmission: 1,
    });
    expect(result).toMatchObject({
      required: 1,
      achievable: 1,
      shortfall: 0,
      allocationSource: 'greedy',
    });
    expect(result.pairs).toEqual([{ submissionId: 's2', judgeProfileId: 'b' }]);
  });
  it('assigns the most constrained submission first', () => {
    const result = allocate({
      judges: [judge('a'), judge('b')],
      submissions: [submission('s1', ['a', 'b']), submission('s2', ['a'])],
      reviewsPerSubmission: 1,
    });
    expect(result.allocationSource).toBe('greedy');
    expect(result.pairs).toEqual([
      { submissionId: 's2', judgeProfileId: 'a' },
      { submissionId: 's1', judgeProfileId: 'b' },
    ]);
  });
});

describe('Stage 3 preview and publish', () => {
  it('preflights exact coverage, stores proposals only, publishes with audit, and repeats idempotently', async () => {
    const f = await fixture(2, 2);
    const pre = await post(
      `${f.base}/assignments/preflight`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    expect(pre.body).toMatchObject({
      required: 4,
      achievable: 4,
      shortfall: 0,
      eligibleSubmissions: 2,
      activeJudges: 2,
      submissionDeadlineOpen: false,
    });
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    const runId = preview.body.runId as string;
    expect(preview.body.proposals).toHaveLength(4);
    expect(preview.body.stats).toMatchObject({
      required: 4,
      achievable: 4,
      shortfall: 0,
      proposedCount: 4,
      perJudgeWorkload: expect.arrayContaining([
        { judgeProfileId: f.judges[0]!.profileId, existing: 0, proposed: 2 },
        { judgeProfileId: f.judges[1]!.profileId, existing: 0, proposed: 2 },
      ]),
    });
    expect(await db.judgeAssignment.count({ where: { runId } })).toBe(0);
    expect(await db.assignmentRunProposal.count({ where: { runId } })).toBe(4);
    await get(`${f.base}/workspace`, f.judges[0]!.actor.cookie)
      .expect(200)
      .then((r) => expect(r.body.assigned).toBe(0));
    const published = await post(
      `${f.base}/assignments/runs/${runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(201);
    expect(published.body).toMatchObject({
      assignmentCount: 4,
      alreadyPublished: false,
    });
    await post(
      `${f.base}/assignments/runs/${runId}/publish`,
      {},
      f.organizer.cookie,
    )
      .expect(201)
      .then((r) =>
        expect(r.body).toMatchObject({
          assignmentCount: 4,
          alreadyPublished: true,
        }),
      );
    expect(await db.judgeAssignment.count({ where: { runId } })).toBe(4);
    for (const [action, count] of [
      ['ASSIGNMENT_RUN_CREATED', 1],
      ['ASSIGNMENT_PUBLISHED', 1],
      ['JUDGE_ASSIGNED', 4],
    ] as const)
      expect(
        await db.auditEvent.count({ where: { eventId: f.eventId, action } }),
      ).toBe(count);
    const progress = await get(
      `${f.base}/progress?reviewsPerSubmission=2`,
      f.organizer.cookie,
    ).expect(200);
    expect(progress.body).toMatchObject({
      requiredEvaluations: 4,
      publishedCoverage: 4,
      completedEvaluations: 0,
      remainingEvaluations: 4,
    });
    expect(
      progress.body.submissions.every(
        (s: { shortfall: number }) => s.shortfall === 0,
      ),
    ).toBe(true);
    const topUp = await post(
      `${f.base}/assignments/preflight`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    expect(topUp.body).toMatchObject({
      required: 0,
      achievable: 0,
      shortfall: 0,
    });
    await post(
      `${f.base}/assignments/preview`,
      f.requestBody(2),
      f.judges[0]!.actor.cookie,
    ).expect(403);
  });
  it('supersedes one preview per event and rejects publishing the stale run', async () => {
    const f = await fixture();
    const first = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    const second = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    expect(first.body.runId).not.toBe(second.body.runId);
    expect(
      (
        await db.assignmentRun.findUniqueOrThrow({
          where: { id: first.body.runId },
        })
      ).status,
    ).toBe('SUPERSEDED');
    expect(
      await db.assignmentRun.count({
        where: { eventId: f.eventId, status: 'PREVIEW' },
      }),
    ).toBe(1);
    await post(
      `${f.base}/assignments/runs/${first.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(409);
    await get(
      `${f.base}/assignments/runs/${second.body.runId}`,
      f.organizer.cookie,
    ).expect(200);
    await get(
      `${f.base}/assignments/runs/${second.body.runId}`,
      f.judges[0]!.actor.cookie,
    ).expect(403);
  });
  it('does not silently publish an infeasible preview', async () => {
    const f = await fixture(1, 2);
    const pre = await post(
      `${f.base}/assignments/preflight`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    expect(pre.body).toMatchObject({
      required: 2,
      achievable: 2,
      shortfall: 0,
    });
    await request(app.getHttpServer())
      .patch(`${f.base}/judges/${f.judges[0]!.profileId}`)
      .set('Origin', origin)
      .set('Cookie', f.organizer.cookie)
      .send({ maxAssignments: 1 })
      .expect(200);
    const impossible = await post(
      `${f.base}/assignments/preflight`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    expect(impossible.body).toMatchObject({
      required: 2,
      achievable: 1,
      shortfall: 1,
    });
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    await post(
      `${f.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(409);
  });
  it('revalidates publish when judge is suspended', async () => {
    const f = await fixture(1, 1);
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    await db.eventMembership.update({
      where: {
        eventId_userId_role: {
          eventId: f.eventId,
          userId: f.judges[0]!.actor.id,
          role: 'JUDGE',
        },
      },
      data: { status: 'SUSPENDED' },
    });
    const rejected = await post(
      `${f.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(409);
    expect(rejected.body.code).toBe('STALE_PREVIEW');
    expect(
      await db.judgeAssignment.count({
        where: { runId: preview.body.runId },
      }),
    ).toBe(0);
  });
  it('revalidates publish when conflict is added', async () => {
    const f = await fixture(1, 1);
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    await post(
      `${f.base}/conflicts`,
      {
        judgeProfileId: f.judges[0]!.profileId,
        type: 'TEAM',
        targetId: f.submissions[0]!.teamId,
      },
      f.organizer.cookie,
    ).expect(201);
    const rejected = await post(
      `${f.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(409);
    expect(rejected.body.code).toBe('STALE_PREVIEW');
    expect(
      await db.judgeAssignment.count({
        where: { runId: preview.body.runId },
      }),
    ).toBe(0);
  });
  it('revalidates publish when submission is withdrawn', async () => {
    const f = await fixture(1, 1);
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(),
      f.organizer.cookie,
    ).expect(201);
    await db.submission.update({
      where: { id: f.submissions[0]!.id },
      data: { status: 'WITHDRAWN' },
    });
    const rejected = await post(
      `${f.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(409);
    expect(rejected.body.code).toBe('STALE_PREVIEW');
    expect(
      await db.judgeAssignment.count({
        where: { runId: preview.body.runId },
      }),
    ).toBe(0);
  });
  it('revalidates changed capacity and a new cross-run assignment', async () => {
    const capacity = await fixture(1, 1);
    const preview = await post(
      `${capacity.base}/assignments/preview`,
      capacity.requestBody(),
      capacity.organizer.cookie,
    ).expect(201);
    await request(app.getHttpServer())
      .patch(`${capacity.base}/judges/${capacity.judges[0]!.profileId}`)
      .set('Origin', origin)
      .set('Cookie', capacity.organizer.cookie)
      .send({ maxAssignments: 0 })
      .expect(200);
    const capacityFailure = await post(
      `${capacity.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      capacity.organizer.cookie,
    ).expect(409);
    expect(capacityFailure.body.code).toBe('STALE_PREVIEW');
    const duplicate = await fixture(1, 1);
    const stale = await post(
      `${duplicate.base}/assignments/preview`,
      duplicate.requestBody(),
      duplicate.organizer.cookie,
    ).expect(201);
    await post(
      `${duplicate.base}/assignments/manual`,
      {
        judgeProfileId: duplicate.judges[0]!.profileId,
        submissionId: duplicate.submissions[0]!.id,
        rubricId: duplicate.rubric.id,
      },
      duplicate.organizer.cookie,
    ).expect(201);
    const duplicateFailure = await post(
      `${duplicate.base}/assignments/runs/${stale.body.runId}/publish`,
      {},
      duplicate.organizer.cookie,
    ).expect(409);
    expect(duplicateFailure.body.code).toBe('STALE_PREVIEW');
    expect(
      await db.judgeAssignment.count({ where: { runId: stale.body.runId } }),
    ).toBe(0);
  });
  it('warns while submissions are open, blocks unacknowledged publish, and audits acknowledgment', async () => {
    const f = await fixture(1, 1);
    now = new Date('2030-01-02T12:00:00Z');
    try {
      const pre = await post(
        `${f.base}/assignments/preflight`,
        f.requestBody(),
        f.organizer.cookie,
      ).expect(201);
      expect(pre.body.submissionDeadlineOpen).toBe(true);
      expect(pre.body.warnings).toHaveLength(1);
      const preview = await post(
        `${f.base}/assignments/preview`,
        f.requestBody(),
        f.organizer.cookie,
      ).expect(201);
      const blocked = await post(
        `${f.base}/assignments/runs/${preview.body.runId}/publish`,
        {},
        f.organizer.cookie,
      ).expect(409);
      expect(blocked.body.code).toBe('SUBMISSIONS_OPEN');
      await post(
        `${f.base}/assignments/runs/${preview.body.runId}/publish`,
        { acknowledgeOpenSubmissions: true },
        f.organizer.cookie,
      ).expect(201);
      expect(
        await db.auditEvent.count({
          where: {
            eventId: f.eventId,
            action: 'ASSIGNMENT_PUBLISHED',
            metadata: { path: ['acknowledgedOpenSubmissions'], equals: true },
          },
        }),
      ).toBe(1);
    } finally {
      now = new Date('2030-01-04T12:00:00Z');
    }
  });
  it('counts prior published coverage/capacity and prevents cross-run duplicates', async () => {
    const f = await fixture(2, 1);
    const first = await post(
      `${f.base}/assignments/manual`,
      {
        judgeProfileId: f.judges[0]!.profileId,
        submissionId: f.submissions[0]!.id,
        rubricId: f.rubric.id,
      },
      f.organizer.cookie,
    ).expect(201);
    const pre = await post(
      `${f.base}/assignments/preflight`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    expect(pre.body).toMatchObject({
      required: 1,
      achievable: 1,
      shortfall: 0,
    });
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    expect(preview.body.proposals).toEqual([
      {
        submissionId: f.submissions[0]!.id,
        judgeProfileId: f.judges[1]!.profileId,
      },
    ]);
    await post(
      `${f.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(201);
    expect(
      await db.judgeAssignment.count({
        where: { submissionId: f.submissions[0]!.id },
      }),
    ).toBe(2);
    expect(
      await db.judgeAssignment.count({
        where: { id: first.body.assignmentId },
      }),
    ).toBe(1);
    await post(
      `${f.base}/assignments/manual`,
      {
        judgeProfileId: f.judges[1]!.profileId,
        submissionId: f.submissions[0]!.id,
        rubricId: f.rubric.id,
      },
      f.organizer.cookie,
    ).expect(409);
  });
  it('counts only ACTIVE judges as effective coverage in preflight and progress, showing suspended judges as at-risk shortfall', async () => {
    const f = await fixture(2, 1);
    const preview = await post(
      `${f.base}/assignments/preview`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    await post(
      `${f.base}/assignments/runs/${preview.body.runId}/publish`,
      {},
      f.organizer.cookie,
    ).expect(201);

    const initialProgress = await get(
      `${f.base}/progress?reviewsPerSubmission=2`,
      f.organizer.cookie,
    ).expect(200);
    expect(initialProgress.body).toMatchObject({
      publishedCoverage: 2,
      atRiskCoverage: 0,
      atRiskAssignments: 0,
    });
    expect(initialProgress.body.submissions[0].shortfall).toBe(0);

    const suspendedJudgeProfile = await db.judgeProfile.findUniqueOrThrow({
      where: { id: f.judges[1]!.profileId },
      select: { eventMembershipId: true },
    });
    await db.eventMembership.update({
      where: { id: suspendedJudgeProfile.eventMembershipId },
      data: { status: 'SUSPENDED' },
    });

    const progressAfterSuspension = await get(
      `${f.base}/progress?reviewsPerSubmission=2`,
      f.organizer.cookie,
    ).expect(200);
    expect(progressAfterSuspension.body).toMatchObject({
      publishedCoverage: 1,
      atRiskCoverage: 1,
      atRiskAssignments: 1,
    });
    expect(progressAfterSuspension.body.submissions[0]).toMatchObject({
      assigned: 1,
      atRisk: 1,
      shortfall: 1,
    });

    const preflight = await post(
      `${f.base}/assignments/preflight`,
      f.requestBody(2),
      f.organizer.cookie,
    ).expect(201);
    expect(preflight.body).toMatchObject({
      required: 1,
      atRiskCoverage: 1,
    });
  });
});
