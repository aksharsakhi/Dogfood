import 'reflect-metadata';
import 'dotenv/config';
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
import { AuditService } from '../src/modules/audit/audit.service';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('B4.2 requires an isolated test database');

const db = new PrismaClient();
let app: NestFastifyApplication;
type Actor = { id: string; cookie: string };
const unique = () => randomUUID().slice(0, 12);
const origin = 'http://localhost:3000';
const api = () => app.getHttpServer();
const post = (path: string, body: object = {}, cookie?: string) => {
  const req = request(api()).post(path).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const get = (path: string, cookie?: string) => {
  const req = request(api()).get(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
};
async function actor(label: string): Promise<Actor> {
  const email = `b42-${label}-${unique()}@example.test`;
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
    cookie: (Array.isArray(header) ? header[0] : header).split(';')[0],
  };
}
async function event(organizer: Actor) {
  const created = await post(
    '/events',
    {
      name: 'B4.2 Pairwise Event',
      slug: `b42-${unique()}`,
      visibility: 'PUBLIC',
      registrationOpensAt: '2029-01-01T00:00:00Z',
      registrationClosesAt: '2031-01-01T00:00:00Z',
      submissionClosesAt: '2030-01-03T00:00:00Z',
      judgingOpensAt: '2030-01-04T00:00:00Z',
      judgingClosesAt: '2030-01-06T00:00:00Z',
    },
    organizer.cookie,
  ).expect(201);
  await post(`/events/${created.body.id}/publish`, {}, organizer.cookie).expect(
    201,
  );
  return created.body.id as string;
}
async function judge(eventId: string, organizer: Actor, user: Actor) {
  const invitation = await post(
    `/events/${eventId}/judging/invitations`,
    { invitedUserId: user.id },
    organizer.cookie,
  ).expect(201);
  const accepted = await post(
    '/judge-invitations/accept',
    { token: invitation.body.token },
    user.cookie,
  ).expect(200);
  return accepted.body.judgeProfileId as string;
}
async function project(eventId: string, organizer: Actor, name: string) {
  const team = await db.team.create({
    data: {
      eventId,
      createdById: organizer.id,
      name: `Team ${name}`,
      slug: `team-${unique()}`,
    },
  });
  const row = await db.project.create({
    data: {
      eventId,
      teamId: team.id,
      name,
      slug: `proj-${unique()}`,
      status: 'ACTIVE',
    },
  });
  const submission = await db.submission.create({
    data: {
      projectId: row.id,
      version: 1,
      title: `${name} S1`,
      description: `${name} frozen description`,
      projectName: name,
      status: 'SUBMITTED',
      createdById: organizer.id,
      submittedAt: new Date(),
    },
  });
  return { projectId: row.id, submissionId: submission.id, teamId: team.id };
}

describe('B4.2 pairwise backend lifecycle', () => {
  let organizer: Actor;
  let participant: Actor;
  let judgeA: Actor;
  let judgeB: Actor;
  let outsider: Actor;
  let eventId: string;
  let otherEventId: string;
  let judgeAId: string;
  let judgeBId: string;
  let projects: Awaited<ReturnType<typeof project>>[];
  const base = () => `/events/${eventId}/judging/pairwise`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app, origin);
    await app.listen(0, '127.0.0.1');
    [organizer, participant, judgeA, judgeB, outsider] = await Promise.all([
      actor('organizer'),
      actor('participant'),
      actor('judge-a'),
      actor('judge-b'),
      actor('outsider'),
    ]);
    eventId = await event(organizer);
    otherEventId = await event(outsider);
    const membership = await db.eventMembership.create({
      data: { eventId, userId: participant.id, role: 'PARTICIPANT' },
    });
    expect(membership.id).toBeDefined();
    judgeAId = await judge(eventId, organizer, judgeA);
    judgeBId = await judge(eventId, organizer, judgeB);
    projects = [];
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta'])
      projects.push(await project(eventId, organizer, name));
  }, 60000);

  afterAll(async () => {
    if (app) await app.close();
    await db.$disconnect();
  });

  it('enforces organizer creation and cross-event authorization', async () => {
    await post(`${base()}/runs`, {}, participant.cookie).expect(403);
    await post(`${base()}/runs`, {}, judgeA.cookie).expect(403);
    await post(`${base()}/runs`, {}).expect(401);
    await post(
      `/events/${otherEventId}/judging/pairwise/runs`,
      {},
      organizer.cookie,
    ).expect(403);
    const created = await post(
      `${base()}/runs`,
      { algorithm: 'ELO', lambda: 99 },
      organizer.cookie,
    ).expect(201);
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      algorithm: 'BRADLEY_TERRY_RIDGE',
      algorithmVersion: 'V1',
    });
    expect(Number(created.body.lambda)).toBe(0.01);
    await get(`${base()}/runs`, participant.cookie).expect(403);
    await get(`${base()}/runs/${created.body.id}`, organizer.cookie).expect(
      200,
    );
    const runPath = `${base()}/runs/${created.body.id}`;
    await post(`${runPath}/assignments/preview`, {}, judgeA.cookie).expect(403);
    await post(
      `${runPath}/publish`,
      { proposalHash: '0'.repeat(64) },
      participant.cookie,
    ).expect(403);
    await post(`${runPath}/close`, {}, judgeA.cookie).expect(403);
    await get(`${runPath}/progress`, judgeA.cookie).expect(403);
    await get(`${base()}/workspace`).expect(401);
  });

  it('previews deterministically, detects submission and conflict staleness, and publishes atomically', async () => {
    const created = await post(`${base()}/runs`, {}, organizer.cookie).expect(
      201,
    );
    const runId = created.body.id as string;
    const path = `${base()}/runs/${runId}`;
    const first = await post(
      `${path}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    const second = await post(
      `${path}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    expect(second.body).toEqual(first.body);
    expect(first.body.diagnostics).toMatchObject({
      projectCount: 4,
      componentCount: 1,
      graphConnected: true,
    });
    expect(first.body.pairs.length).toBeGreaterThanOrEqual(4);
    expect(
      Math.max(
        ...first.body.diagnostics.perJudgeWorkload.map(
          (x: { proposed: number }) => x.proposed,
        ),
      ) -
        Math.min(
          ...first.body.diagnostics.perJudgeWorkload.map(
            (x: { proposed: number }) => x.proposed,
          ),
        ),
    ).toBeLessThanOrEqual(1);

    const s2 = await db.submission.create({
      data: {
        projectId: projects[0]!.projectId,
        version: 2,
        title: 'Alpha S2',
        description: 'new version',
        projectName: 'Alpha',
        status: 'SUBMITTED',
        createdById: organizer.id,
        submittedAt: new Date(),
      },
    });
    await post(
      `${path}/publish`,
      { proposalHash: first.body.proposalHash },
      organizer.cookie,
    ).expect(409);
    expect(
      await db.auditEvent.count({
        where: { entityId: runId, action: 'PAIRWISE_RUN_PUBLISHED' },
      }),
    ).toBe(0);
    expect(
      await db.webhookOutboxEvent.count({
        where: {
          eventId,
          eventType: 'pairwise.run.published',
          payload: { path: ['entity', 'id'], equals: runId },
        },
      }),
    ).toBe(0);
    expect(
      await db.pairwiseRunProjectSnapshot.count({
        where: { pairwiseRunId: runId },
      }),
    ).toBe(0);
    expect(await db.pairwiseAssignment.count({ where: { runId } })).toBe(0);
    const refreshed = await post(
      `${path}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    expect(refreshed.body.snapshots).toContainEqual({
      projectId: projects[0]!.projectId,
      submissionId: s2.id,
    });
    await db.judgeConflict.create({
      data: {
        judgeProfileId: judgeAId,
        type: 'PROJECT',
        projectId: projects[0]!.projectId,
        reason: 'fixture',
      },
    });
    await post(
      `${path}/publish`,
      { proposalHash: refreshed.body.proposalHash },
      organizer.cookie,
    ).expect(409);
    const finalPreview = await post(
      `${path}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    expect(
      finalPreview.body.pairs.every(
        (pair: {
          judgeProfileId: string;
          projectAId: string;
          projectBId: string;
        }) =>
          pair.judgeProfileId !== judgeAId ||
          ![pair.projectAId, pair.projectBId].includes(projects[0]!.projectId),
      ),
    ).toBe(true);
    const published = await post(
      `${path}/publish`,
      { proposalHash: finalPreview.body.proposalHash },
      organizer.cookie,
    ).expect(201);
    expect(published.body.assignmentCount).toBe(finalPreview.body.pairs.length);
    expect(
      await db.pairwiseRunProjectSnapshot.count({
        where: { pairwiseRunId: runId },
      }),
    ).toBe(4);
    expect(await db.pairwiseAssignment.count({ where: { runId } })).toBe(
      finalPreview.body.pairs.length,
    );
    await post(
      `${path}/publish`,
      { proposalHash: finalPreview.body.proposalHash },
      organizer.cookie,
    ).expect(409);
    expect(
      await db.webhookOutboxEvent.count({
        where: {
          eventId,
          eventType: 'pairwise.run.published',
          payload: { path: ['entity', 'id'], equals: runId },
        },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { entityId: runId, action: 'PAIRWISE_RUN_PUBLISHED' },
      }),
    ).toBe(1);
    const progress = await get(`${path}/progress`, organizer.cookie).expect(
      200,
    );
    expect(progress.body).toMatchObject({
      status: 'PUBLISHED',
      pinnedProjectCount: 4,
      totalAssignments: finalPreview.body.pairs.length,
    });

    const s3 = await db.submission.create({
      data: {
        projectId: projects[0]!.projectId,
        version: 3,
        title: 'Alpha S3',
        description: 'later version',
        projectName: 'Alpha',
        status: 'SUBMITTED',
        createdById: organizer.id,
        submittedAt: new Date(),
      },
    });
    const ws = await get(`${base()}/workspace`, judgeB.cookie).expect(200);
    const alpha = ws.body.assignments
      .flatMap(
        (a: {
          projectA: { projectId: string; submission: { id: string } };
          projectB: { projectId: string; submission: { id: string } };
        }) => [a.projectA, a.projectB],
      )
      .find(
        (p: { projectId: string }) => p.projectId === projects[0]!.projectId,
      );
    expect(alpha.submission.id).toBe(s2.id);
    expect(alpha.submission.id).not.toBe(s3.id);
    await get(`${base()}/workspace`, participant.cookie).expect(403);
    await get(`${base()}/workspace`, organizer.cookie).expect(403);
  }, 60000);

  it('isolates judges, rejects conflicts, and closes submitted evidence', async () => {
    const created = await post(`${base()}/runs`, {}, organizer.cookie).expect(
      201,
    );
    const runId = created.body.id as string;
    const preview = await post(
      `${base()}/runs/${runId}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    await post(
      `${base()}/runs/${runId}/publish`,
      { proposalHash: preview.body.proposalHash },
      organizer.cookie,
    ).expect(201);
    const workspace = await get(`${base()}/workspace`, judgeB.cookie).expect(
      200,
    );
    const ownIds = new Set(
      (
        await db.pairwiseAssignment.findMany({
          where: { judgeProfileId: judgeBId, run: { eventId } },
          select: { id: true },
        })
      ).map((assignment) => assignment.id),
    );
    expect(
      workspace.body.assignments.every((assignment: { assignmentId: string }) =>
        ownIds.has(assignment.assignmentId),
      ),
    ).toBe(true);
    const own = workspace.body.assignments.find(
      (a: { runId: string }) => a.runId === runId,
    );
    expect(own).toBeDefined();
    const target = `${base()}/assignments/${own.assignmentId}/submit`;
    await post(
      target,
      { winnerProjectId: own.projectA.projectId },
      judgeA.cookie,
    ).expect(404);
    await post(
      target,
      { winnerProjectId: own.projectA.projectId },
      organizer.cookie,
    ).expect(403);
    await post(target, { winnerProjectId: randomUUID() }, judgeB.cookie).expect(
      400,
    );
    const submitted = await post(
      target,
      { winnerProjectId: own.projectA.projectId },
      judgeB.cookie,
    ).expect(201);
    expect(submitted.body.loserProjectId).toBe(own.projectB.projectId);
    expect(
      (
        await db.pairwiseAssignment.findUniqueOrThrow({
          where: { id: own.assignmentId },
        })
      ).status,
    ).toBe('SUBMITTED');
    await post(
      target,
      { winnerProjectId: own.projectB.projectId },
      judgeB.cookie,
    ).expect(409);
    expect(
      await db.pairwiseComparison.count({
        where: { assignmentId: own.assignmentId },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: {
          entityId: submitted.body.id,
          action: 'PAIRWISE_COMPARISON_SUBMITTED',
        },
      }),
    ).toBe(1);
    const comparisonAudit = await db.auditEvent.findFirstOrThrow({
      where: {
        entityId: submitted.body.id,
        action: 'PAIRWISE_COMPARISON_SUBMITTED',
      },
    });
    expect(comparisonAudit.metadata).toMatchObject({
      pairwiseRunId: runId,
      assignmentId: own.assignmentId,
      judgeProfileId: judgeBId,
      winnerProjectId: own.projectA.projectId,
      loserProjectId: own.projectB.projectId,
    });
    const pending = await db.pairwiseAssignment.findFirstOrThrow({
      where: { runId, judgeProfileId: judgeBId, status: 'PENDING' },
    });
    await db.judgeConflict.create({
      data: {
        judgeProfileId: judgeBId,
        type: 'PROJECT',
        projectId: pending.projectBId,
        reason: 'Conflict declared after publication',
      },
    });
    await post(
      `${base()}/assignments/${pending.id}/submit`,
      { winnerProjectId: pending.projectAId },
      judgeB.cookie,
    ).expect(409);
    expect(
      await db.pairwiseComparison.count({
        where: { assignmentId: pending.id },
      }),
    ).toBe(0);
    await get(`${base()}/runs/${runId}/progress`, participant.cookie).expect(
      403,
    );
    await get(
      `/events/${otherEventId}/judging/pairwise/runs/${runId}`,
      organizer.cookie,
    ).expect(403);
    await get(
      `/events/${otherEventId}/judging/pairwise/workspace`,
      judgeB.cookie,
    ).expect(403);
    await post(
      `/events/${otherEventId}/judging/pairwise/assignments/${own.assignmentId}/submit`,
      { winnerProjectId: own.projectA.projectId },
      judgeB.cookie,
    ).expect(403);
    await post(`${base()}/runs/${runId}/close`, {}, judgeB.cookie).expect(403);
    await post(`${base()}/runs/${runId}/close`, {}, organizer.cookie).expect(
      201,
    );
    await post(`${base()}/runs/${runId}/close`, {}, organizer.cookie).expect(
      409,
    );
    await post(
      `${base()}/assignments/${pending.id}/submit`,
      { winnerProjectId: own.projectA.projectId },
      judgeB.cookie,
    ).expect(409);
    expect(
      await db.webhookOutboxEvent.count({
        where: {
          eventId,
          eventType: 'pairwise.run.closed',
          payload: { path: ['entity', 'id'], equals: runId },
        },
      }),
    ).toBe(1);
    expect(
      await db.webhookOutboxEvent.count({
        where: {
          eventId,
          eventType: 'pairwise.comparison.submitted',
          payload: { path: ['entity', 'id'], equals: submitted.body.id },
        },
      }),
    ).toBe(1);
  }, 60000);

  it('rolls back snapshots, assignments, status, audit, and outbox after a late publish failure', async () => {
    const created = await post(`${base()}/runs`, {}, organizer.cookie).expect(
      201,
    );
    const runId = created.body.id as string;
    const preview = await post(
      `${base()}/runs/${runId}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    const audit = app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = jest
      .spyOn(audit, 'record')
      .mockImplementation(async (tx, input) => {
        await original(tx, input);
        if (input.action === 'PAIRWISE_RUN_PUBLISHED')
          throw new Error('Injected failure after transactional outbox write');
      });
    try {
      await post(
        `${base()}/runs/${runId}/publish`,
        { proposalHash: preview.body.proposalHash },
        organizer.cookie,
      ).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(
      (await db.pairwiseRun.findUniqueOrThrow({ where: { id: runId } })).status,
    ).toBe('DRAFT');
    expect(
      await db.pairwiseRunProjectSnapshot.count({
        where: { pairwiseRunId: runId },
      }),
    ).toBe(0);
    expect(await db.pairwiseAssignment.count({ where: { runId } })).toBe(0);
    expect(
      await db.auditEvent.count({
        where: { entityId: runId, action: 'PAIRWISE_RUN_PUBLISHED' },
      }),
    ).toBe(0);
    expect(
      await db.webhookOutboxEvent.count({
        where: {
          eventId,
          eventType: 'pairwise.run.published',
          payload: { path: ['entity', 'id'], equals: runId },
        },
      }),
    ).toBe(0);
  });

  it('documents every pairwise operation in OpenAPI', async () => {
    const response = await get('/openapi.json').expect(200);
    const paths = response.body.paths as Record<
      string,
      Record<string, unknown>
    >;
    expect(
      paths[`${base().replace(eventId, '{eventId}')}/runs`],
    ).toHaveProperty('post');
    expect(
      paths[`${base().replace(eventId, '{eventId}')}/workspace`],
    ).toHaveProperty('get');
    expect(
      paths[
        `${base().replace(eventId, '{eventId}')}/assignments/{assignmentId}/submit`
      ],
    ).toHaveProperty('post');
  });
});
