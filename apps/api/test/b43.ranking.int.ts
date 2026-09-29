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
import { WebhookTransport } from '../src/modules/webhooks/webhook-transport';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import * as solver from '../src/modules/pairwise/bradley-terry';
import { AuditService } from '../src/modules/audit/audit.service';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('B4.3 requires an isolated test database');

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
  const email = `b43-${label}-${unique()}@example.test`;
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
      name: 'B4.3 Pairwise Event',
      slug: `b43-${unique()}`,
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

type Assignment = {
  assignmentId: string;
  projectA: { projectId: string };
  projectB: { projectId: string };
};
type Result = {
  projectId: string;
  projectName: string;
  rank: number;
  canonicalStrength: string;
  strength: string;
  wins: number;
  losses: number;
};
describe('B4.3 immutable ranking orchestration', () => {
  const send = jest.fn().mockResolvedValue(204);
  let organizer: Actor;
  let judgeA: Actor;
  let participant: Actor;
  let outsider: Actor;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WebhookTransport)
      .useValue({ send })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app, origin);
    await app.listen(0, '127.0.0.1');
    [organizer, judgeA, participant, outsider] = await Promise.all([
      actor('organizer'),
      actor('judge'),
      actor('participant'),
      actor('outsider'),
    ]);
  });
  afterAll(async () => {
    if (app) await app.close();
    await db.$disconnect();
  });
  afterEach(() => jest.restoreAllMocks());

  async function fixture(count = 3) {
    const eventId = await event(organizer);
    await judge(eventId, organizer, judgeA);
    await db.eventMembership.create({
      data: { eventId, userId: participant.id, role: 'PARTICIPANT' },
    });
    const projects: Awaited<ReturnType<typeof project>>[] = [];
    for (let i = 0; i < count; i++)
      projects.push(await project(eventId, organizer, `Frozen ${i}`));
    projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
    const base = `/events/${eventId}/judging/pairwise`;
    const run = await post(`${base}/runs`, {}, organizer.cookie).expect(201);
    const runId = run.body.id as string;
    const path = `${base}/runs/${runId}`;
    const preview = await post(
      `${path}/assignments/preview`,
      {},
      organizer.cookie,
    ).expect(201);
    await post(
      `${path}/publish`,
      { proposalHash: preview.body.proposalHash },
      organizer.cookie,
    ).expect(201);
    const workspace = await get(`${base}/workspace`, judgeA.cookie).expect(200);
    const assignments = workspace.body.assignments as Assignment[];
    async function submit(w: number, l: number) {
      const winner = projects[w]!.projectId;
      const loser = projects[l]!.projectId;
      const a = assignments.find(
        (a) =>
          [a.projectA.projectId, a.projectB.projectId].includes(winner) &&
          [a.projectA.projectId, a.projectB.projectId].includes(loser),
      )!;
      expect(a).toBeDefined();
      return post(
        `${base}/assignments/${a.assignmentId}/submit`,
        { winnerProjectId: winner },
        judgeA.cookie,
      ).expect(201);
    }
    return { eventId, runId, path, base, projects, assignments, submit };
  }

  it('persists ordered finite strengths, exact hash and frozen project names with diagnostics', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    await f.submit(0, 2);
    const old = await db.submission.findUniqueOrThrow({
      where: { id: f.projects[0]!.submissionId },
    });
    await db.project.update({
      where: { id: f.projects[0]!.projectId },
      data: { name: 'MUTABLE LIVE NAME' },
    });
    await db.submission.create({
      data: {
        projectId: old.projectId,
        version: 2,
        title: 'NEW VERSION',
        description: 'not ranking evidence',
        projectName: 'NEW NAME',
        status: 'SUBMITTED',
        submittedAt: new Date(),
        createdById: organizer.id,
      },
    });
    const response = await post(
      `${f.path}/rankings`,
      {},
      organizer.cookie,
    ).expect(201);
    const r = response.body;
    expect(r).toMatchObject({
      comparisonCount: 3,
      projectCount: 3,
      componentCount: 1,
      converged: true,
      stale: false,
      algorithm: 'BRADLEY_TERRY_RIDGE',
      algorithmVersion: 'V1',
      lambda: '0.01',
    });
    expect(r.results.map((x: Result) => x.projectId)).toEqual(
      f.projects.map((p) => p.projectId),
    );
    expect(r.results.map((x: Result) => x.rank)).toEqual([1, 2, 3]);
    expect(r.results[0].projectName).toBe(old.projectName);
    for (const x of r.results as Result[]) {
      expect(Number.isFinite(Number(x.strength))).toBe(true);
      expect(x.canonicalStrength).toMatch(/^-?\d+\.\d{6}$/);
    }
    const comparisons = await db.pairwiseComparison.findMany({
      where: { assignment: { runId: f.runId } },
    });
    expect(r.inputSetHash).toBe(
      solver.computePairwiseInputSetHash({
        pairwiseRunId: f.runId,
        comparisons,
      }),
    );
    expect(
      await db.pairwiseProjectResult.count({ where: { rankingRunId: r.id } }),
    ).toBe(3);
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { entityId: r.id, action: 'PAIRWISE_RANKING_CREATED' },
    });
    expect(audit.metadata).toMatchObject({
      comparisonIds: comparisons.map((c) => c.id).sort(),
      projectIds: f.projects.map((p) => p.projectId),
    });
    await get(`${f.base}/rankings/${r.id}`, organizer.cookie).expect(200);
  });

  it('allows a separated connected chain with finite A > B > C > D', async () => {
    const f = await fixture(4);
    await f.submit(0, 1);
    await f.submit(1, 2);
    await f.submit(2, 3);
    const { body } = await post(
      `${f.path}/rankings`,
      {},
      organizer.cookie,
    ).expect(201);
    expect(body).toMatchObject({
      separationRisk: true,
      regularizationSensitive: true,
      stronglyConnectedWinGraph: false,
      converged: true,
    });
    expect(body.results.map((r: Result) => r.projectId)).toEqual(
      f.projects.map((p) => p.projectId),
    );
    expect(
      body.results.every((r: Result) => Number.isFinite(Number(r.strength))),
    ).toBe(true);
  });

  it('rejects disconnected evidence with diagnostics and no ranking state', async () => {
    const f = await fixture(4);
    await f.submit(0, 1);
    await f.submit(2, 3);
    const { body } = await post(
      `${f.path}/rankings`,
      {},
      organizer.cookie,
    ).expect(409);
    expect(body.code).toBe('PAIRWISE_GRAPH_DISCONNECTED');
    expect(body.details).toMatchObject({
      componentCount: 2,
      comparisonCount: 2,
      projectCount: 4,
      isolatedProjects: [],
    });
    expect(body.details.components).toEqual([
      f.projects.slice(0, 2).map((p) => p.projectId),
      f.projects.slice(2).map((p) => p.projectId),
    ]);
    expect(
      await db.pairwiseRankingRun.count({ where: { pairwiseRunId: f.runId } }),
    ).toBe(0);
    expect(
      await db.pairwiseProjectResult.count({
        where: { rankingRun: { pairwiseRunId: f.runId } },
      }),
    ).toBe(0);
    const progress = await get(`${f.path}/progress`, organizer.cookie).expect(
      200,
    );
    expect(progress.body.evidenceGraph).toMatchObject({
      graphConnected: false,
      componentCount: 2,
    });
  });

  it('reports isolated projects and refuses unpublished runs', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    const { body } = await post(
      `${f.path}/rankings`,
      {},
      organizer.cookie,
    ).expect(409);
    expect(body.details.isolatedProjects).toEqual([f.projects[2]!.projectId]);
    const draft = await post(`${f.base}/runs`, {}, organizer.cookie).expect(
      201,
    );
    const rejected = await post(
      `${f.base}/runs/${draft.body.id}/rankings`,
      {},
      organizer.cookie,
    ).expect(409);
    expect(rejected.body.code).toBe('PAIRWISE_RUN_NOT_PUBLISHED');
  });

  it('rolls back ranking, results, audit, outbox and deliveries after the outbox write', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    const subscription = await post(
      `/events/${f.eventId}/webhooks`,
      {
        url: 'https://8.8.8.8/hooks',
        eventTypes: ['pairwise.ranking.created'],
      },
      organizer.cookie,
    ).expect(201);
    const audit = app.get(AuditService);
    const original = audit.record.bind(audit);
    const spy = jest
      .spyOn(audit, 'record')
      .mockImplementation(async (tx, input) => {
        await original(tx, input);
        if (input.action === 'PAIRWISE_RANKING_CREATED') {
          expect(
            await tx.pairwiseRankingRun.count({
              where: { pairwiseRunId: f.runId },
            }),
          ).toBe(1);
          expect(
            await tx.pairwiseProjectResult.count({
              where: { rankingRunId: input.entityId },
            }),
          ).toBe(3);
          expect(
            await tx.webhookOutboxEvent.count({
              where: {
                eventId: f.eventId,
                eventType: 'pairwise.ranking.created',
              },
            }),
          ).toBe(1);
          expect(
            await tx.webhookDelivery.count({
              where: { subscriptionId: subscription.body.id },
            }),
          ).toBe(1);
          throw new Error('B4.3 injected late transactional failure');
        }
      });
    await post(`${f.path}/rankings`, {}, organizer.cookie).expect(500);
    spy.mockRestore();
    expect(
      await db.pairwiseRankingRun.count({ where: { pairwiseRunId: f.runId } }),
    ).toBe(0);
    expect(
      await db.pairwiseProjectResult.count({
        where: { rankingRun: { pairwiseRunId: f.runId } },
      }),
    ).toBe(0);
    expect(
      await db.auditEvent.count({
        where: { eventId: f.eventId, action: 'PAIRWISE_RANKING_CREATED' },
      }),
    ).toBe(0);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId: f.eventId, eventType: 'pairwise.ranking.created' },
      }),
    ).toBe(0);
    expect(
      await db.webhookDelivery.count({
        where: {
          outboxEvent: {
            eventId: f.eventId,
            eventType: 'pairwise.ranking.created',
          },
        },
      }),
    ).toBe(0);
  });

  it('marks historical evidence stale without mutating R1 and creates R2 for new evidence', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    const r1 = (
      await post(`${f.path}/rankings`, {}, organizer.cookie).expect(201)
    ).body;
    const before = await db.pairwiseRankingRun.findUniqueOrThrow({
      where: { id: r1.id },
      include: { projectResults: true },
    });
    await f.submit(0, 2);
    const historical = (
      await get(`${f.base}/rankings/${r1.id}`, organizer.cookie).expect(200)
    ).body;
    expect(historical).toMatchObject({
      stale: true,
      comparisonCount: 2,
      currentComparisonCount: 3,
      inputSetHash: r1.inputSetHash,
      results: r1.results,
    });
    const r2 = (
      await post(`${f.path}/rankings`, {}, organizer.cookie).expect(201)
    ).body;
    expect(r2.id).not.toBe(r1.id);
    expect(r2.inputSetHash).not.toBe(r1.inputSetHash);
    expect(r2.stale).toBe(false);
    expect(
      await db.pairwiseRankingRun.findUniqueOrThrow({
        where: { id: r1.id },
        include: { projectResults: true },
      }),
    ).toEqual(before);
    const list = await get(`${f.path}/rankings`, organizer.cookie).expect(200);
    expect(list.body).toHaveLength(2);
  });

  it('reuses identical evidence concurrently and emits exactly one versioned logical webhook', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    const responses = await Promise.all([
      post(`${f.path}/rankings`, {}, organizer.cookie).expect(201),
      post(`${f.path}/rankings`, {}, organizer.cookie).expect(201),
    ]);
    expect(responses[0]!.body).toEqual(responses[1]!.body);
    const r = responses[0]!.body;
    const events = await db.webhookOutboxEvent.findMany({
      where: { eventId: f.eventId, eventType: 'pairwise.ranking.created' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      payload: {
        schemaVersion: 1,
        eventType: 'pairwise.ranking.created',
        eventId: f.eventId,
        rankingRunId: r.id,
        pairwiseRunId: f.runId,
        inputSetHash: r.inputSetHash,
        comparisonCount: 2,
        projectCount: 3,
        algorithm: 'BRADLEY_TERRY_RIDGE',
        algorithmVersion: 'V1',
      },
    });
    expect(events[0]!.payload).not.toHaveProperty('comparisonIds');
    expect(
      await db.auditEvent.count({
        where: { eventId: f.eventId, action: 'PAIRWISE_RANKING_CREATED' },
      }),
    ).toBe(1);
    expect(
      await db.pairwiseRankingRun.count({ where: { pairwiseRunId: f.runId } }),
    ).toBe(1);
    await post(`${f.path}/close`, {}, organizer.cookie).expect(201);
    expect(
      (await post(`${f.path}/rankings`, {}, organizer.cookie).expect(201)).body
        .id,
    ).toBe(r.id);
  });

  it('enforces organizer authorization and event isolation for every ranking route', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    const r = (
      await post(`${f.path}/rankings`, {}, organizer.cookie).expect(201)
    ).body;
    for (const actor of [judgeA, participant, outsider]) {
      await post(`${f.path}/rankings`, {}, actor.cookie).expect(403);
      await get(`${f.path}/rankings`, actor.cookie).expect(403);
      await get(`${f.base}/rankings/${r.id}`, actor.cookie).expect(403);
    }
    await post(`${f.path}/rankings`).expect(401);
    await get(`${f.path}/rankings`).expect(401);
    await get(`${f.base}/rankings/${r.id}`).expect(401);
    const other = await event(organizer);
    await get(
      `/events/${other}/judging/pairwise/rankings/${r.id}`,
      organizer.cookie,
    ).expect(404);
    await get(
      `/events/${other}/judging/pairwise/runs/${f.runId}/rankings`,
      organizer.cookie,
    ).expect(404);
    await post(
      `/events/${other}/judging/pairwise/runs/${f.runId}/rankings`,
      {},
      organizer.cookie,
    ).expect(404);
    expect(r.results.map((x: Result) => x.projectId).sort()).toEqual(
      f.projects.map((p) => p.projectId),
    );
  });

  it('persists six-decimal ties as competition ranks 1, 1, 3', async () => {
    const f = await fixture();
    await f.submit(0, 2);
    await f.submit(1, 2);
    const { body } = await post(
      `${f.path}/rankings`,
      {},
      organizer.cookie,
    ).expect(201);
    expect(body.results.map((r: Result) => r.rank)).toEqual([1, 1, 3]);
    expect(body.results[0].canonicalStrength).toBe(
      body.results[1].canonicalStrength,
    );
  });

  it('refuses nonconverged or nonfinite solver output without partial persistence', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    const original = solver.fitBradleyTerryRidgeV1;
    const spy = jest
      .spyOn(solver, 'fitBradleyTerryRidgeV1')
      .mockImplementation((input) => ({
        ...original(input),
        converged: false,
      }));
    const rejected = await post(
      `${f.path}/rankings`,
      {},
      organizer.cookie,
    ).expect(409);
    expect(rejected.body.code).toBe('PAIRWISE_SOLVER_FAILED');
    spy.mockImplementation((input) => ({
      ...original(input),
      finalDelta: NaN,
    }));
    await post(`${f.path}/rankings`, {}, organizer.cookie).expect(409);
    expect(
      await db.pairwiseRankingRun.count({ where: { pairwiseRunId: f.runId } }),
    ).toBe(0);
  });
  it('retries and replays ranking webhooks with stable delivery identity and immutable payload', async () => {
    const f = await fixture();
    await f.submit(0, 1);
    await f.submit(1, 2);
    const subscription = await post(
      `/events/${f.eventId}/webhooks`,
      {
        url: 'https://8.8.8.8/hooks',
        eventTypes: ['pairwise.ranking.created'],
      },
      organizer.cookie,
    ).expect(201);
    await post(`${f.path}/rankings`, {}, organizer.cookie).expect(201);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: subscription.body.id },
      include: { outboxEvent: true },
    });
    send.mockReset().mockResolvedValueOnce(503).mockResolvedValueOnce(204);
    const worker = app.get(WebhooksService);
    // Put this fixture first in the shared test database's durable queue.
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await worker.processOne();
    expect(
      await db.webhookDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ status: 'RETRYING', attempts: 1 });
    await post(
      `/events/${f.eventId}/webhook-deliveries/${delivery.id}/replay`,
      {},
      organizer.cookie,
    ).expect(201);
    // Put this fixture first in the shared test database's durable queue.
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await worker.processOne();
    expect(
      await db.webhookDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ status: 'DELIVERED', attempts: 2, manualReplays: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    const payloads = send.mock.calls.map((call) =>
      JSON.parse(call[4] as string),
    );
    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[0]).toMatchObject({
      deliveryId: delivery.id,
      eventType: 'pairwise.ranking.created',
      schemaVersion: 1,
    });
    expect(
      await db.webhookOutboxEvent.findUniqueOrThrow({
        where: { id: delivery.outboxEventId },
      }),
    ).toEqual(delivery.outboxEvent);
    await db.webhookSubscription.update({
      where: { id: subscription.body.id },
      data: { active: false },
    });
  });
});
