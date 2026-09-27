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

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('Isolated test database required');
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID().slice(0, 12);
let now = new Date('2030-01-02T12:00:00Z');
let app: NestFastifyApplication;
type Actor = { id: string; email: string; cookie: string };
const api = () => app.getHttpServer();
const post = (path: string, body: object = {}, cookie?: string) => {
  const req = request(api()).post(path).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const patch = (path: string, body: object, cookie: string) =>
  request(api())
    .patch(path)
    .set('Origin', origin)
    .set('Cookie', cookie)
    .send(body);
const get = (path: string, cookie: string) =>
  request(api()).get(path).set('Cookie', cookie);
const del = (path: string, cookie: string) =>
  request(api()).delete(path).set('Origin', origin).set('Cookie', cookie);
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
  const cookie = (Array.isArray(header) ? header[0] : header) as string;
  return {
    id: created.body.id as string,
    email,
    cookie: cookie.split(';')[0]!,
  };
}
async function event(organizer: Actor) {
  const created = await post(
    '/events',
    {
      name: 'Judging test',
      slug: `judge-${unique()}`,
      visibility: 'PUBLIC',
      registrationOpensAt: '2029-01-01T00:00:00Z',
      registrationClosesAt: '2031-01-01T00:00:00Z',
      submissionClosesAt: '2031-01-02T00:00:00Z',
      judgingOpensAt: '2031-01-03T00:00:00Z',
      judgingClosesAt: '2032-01-01T00:00:00Z',
    },
    organizer.cookie,
  ).expect(201);
  await post(`/events/${created.body.id}/publish`, {}, organizer.cookie).expect(
    201,
  );
  return created.body.id as string;
}
const rubric = (weights = ['0.4', '0.6']) => ({
  name: 'Quality',
  criteria: weights.map((weight, i) => ({
    name: `Criterion ${i}`,
    weight,
    minScore: '0',
    maxScore: '10',
  })),
});
let organizer: Actor, participant: Actor, eventId: string;
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
  organizer = await actor('organizer');
  participant = await actor('participant');
  eventId = await event(organizer);
  await post(`/events/${eventId}/registrations`, {}, participant.cookie).expect(
    201,
  );
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('Phase 4A stage 1', () => {
  it('accepts a recipient-bound invite once, stores only its hash, and audits onboarding', async () => {
    const judge = await actor('judge');
    const path = `/events/${eventId}/judging/invitations`;
    const invite = await post(
      path,
      { email: judge.email, invitedUserId: judge.id },
      organizer.cookie,
    ).expect(201);
    expect(invite.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await db.judgeInvitation.findUniqueOrThrow({
      where: { id: invite.body.id as string },
    });
    expect(stored.tokenHash).not.toBe(invite.body.token);
    const accepted = await post(
      '/judge-invitations/accept',
      { token: invite.body.token },
      judge.cookie,
    ).expect(200);
    expect(accepted.body.eventId).toBe(eventId);
    await post(
      '/judge-invitations/accept',
      { token: invite.body.token },
      judge.cookie,
    ).expect(409);
    expect(
      await db.auditEvent.count({
        where: {
          eventId,
          action: 'JUDGE_ACCEPTED',
          entityId: accepted.body.judgeProfileId,
        },
      }),
    ).toBe(1);
  });
  it('rejects recipient mismatch, revocation, expiry, and concurrent replay', async () => {
    const a = await actor('recipient');
    const b = await actor('other');
    const path = `/events/${eventId}/judging/invitations`;
    const mismatch = await post(
      path,
      { invitedUserId: a.id },
      organizer.cookie,
    ).expect(201);
    await post(
      '/judge-invitations/accept',
      { token: mismatch.body.token },
      b.cookie,
    ).expect(403);
    const revoked = await post(path, {}, organizer.cookie).expect(201);
    await post(
      `${path}/${revoked.body.id}/revoke`,
      {},
      organizer.cookie,
    ).expect(204);
    await post(
      '/judge-invitations/accept',
      { token: revoked.body.token },
      b.cookie,
    ).expect(409);
    const expired = await post(
      path,
      { expiresInHours: 1 },
      organizer.cookie,
    ).expect(201);
    now = new Date(now.getTime() + 3600000);
    await post(
      '/judge-invitations/accept',
      { token: expired.body.token },
      b.cookie,
    ).expect(409);
    now = new Date('2030-01-02T12:00:00Z');
    const race = await post(path, {}, organizer.cookie).expect(201);
    const results = await Promise.all([
      post('/judge-invitations/accept', { token: race.body.token }, b.cookie),
      post('/judge-invitations/accept', { token: race.body.token }, b.cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('rejects same-event participant and organizer role conflicts, permits roles in separate events', async () => {
    const path = `/events/${eventId}/judging/invitations`;
    for (const user of [participant, organizer]) {
      const invite = await post(
        path,
        { invitedUserId: user.id },
        organizer.cookie,
      ).expect(201);
      const result = await post(
        '/judge-invitations/accept',
        { token: invite.body.token },
        user.cookie,
      ).expect(409);
      expect(result.body.code).toBe('ROLE_CONFLICT');
    }
    const otherEvent = await event(organizer);
    const invite = await post(
      `/events/${otherEvent}/judging/invitations`,
      { invitedUserId: participant.id },
      organizer.cookie,
    ).expect(201);
    await post(
      '/judge-invitations/accept',
      { token: invite.body.token },
      participant.cookie,
    ).expect(200);
  });
  it('publishes exact decimal weights, keeps published versions immutable, and creates a fresh version', async () => {
    const base = `/events/${eventId}/judging/rubrics`;
    const invalid = await post(
      base,
      rubric(['0.4', '0.5']),
      organizer.cookie,
    ).expect(201);
    await post(
      `${base}/${invalid.body.id}/publish`,
      {},
      organizer.cookie,
    ).expect(400);
    const first = await post(base, rubric(), organizer.cookie).expect(201);
    await patch(
      `${base}/${first.body.id}`,
      rubric(['0.25', '0.75']),
      organizer.cookie,
    ).expect(200);
    await post(`${base}/${first.body.id}/publish`, {}, organizer.cookie).expect(
      201,
    );
    await patch(`${base}/${first.body.id}`, rubric(), organizer.cookie).expect(
      409,
    );
    const second = await post(base, rubric(), organizer.cookie).expect(201);
    expect(second.body.version).toBe(first.body.version + 1);
    const list = await get(base, organizer.cookie).expect(200);
    expect(
      list.body.find((r: { id: string }) => r.id === first.body.id).criteria[0]
        .weight,
    ).toBe('0.25');
  });
  it('keeps conflict controls organizer-only and event-scoped', async () => {
    await get(
      `/events/${eventId}/judging/conflicts`,
      participant.cookie,
    ).expect(403);
    await post(
      `/events/${eventId}/judging/invitations`,
      { email: 'bad-address' },
      organizer.cookie,
    ).expect(400);
    const judges = await get(
      `/events/${eventId}/judging/judges`,
      organizer.cookie,
    ).expect(200);
    expect(judges.body.length).toBeGreaterThan(0);
  });
  it('creates, lists, and removes team and project conflicts with audit records', async () => {
    const judge = await actor('conflict-judge');
    const invite = await post(
      `/events/${eventId}/judging/invitations`,
      { invitedUserId: judge.id },
      organizer.cookie,
    ).expect(201);
    const accepted = await post(
      '/judge-invitations/accept',
      { token: invite.body.token },
      judge.cookie,
    ).expect(200);
    const team = await db.team.create({
      data: {
        eventId,
        createdById: participant.id,
        name: 'Conflict team',
        slug: `conflict-${unique()}`,
      },
    });
    const project = await db.project.create({
      data: {
        eventId,
        teamId: team.id,
        name: 'Conflict project',
        slug: `conflict-project-${unique()}`,
      },
    });
    const base = `/events/${eventId}/judging/conflicts`;
    for (const [type, targetId] of [
      ['TEAM', team.id],
      ['PROJECT', project.id],
    ] as const) {
      const created = await post(
        base,
        {
          judgeProfileId: accepted.body.judgeProfileId,
          type,
          targetId,
          reason: 'Declared relationship',
        },
        organizer.cookie,
      ).expect(201);
      const listed = await get(base, organizer.cookie).expect(200);
      expect(
        listed.body.some((c: { id: string }) => c.id === created.body.id),
      ).toBe(true);
      expect(
        await db.auditEvent.count({
          where: {
            action: 'CONFLICT_DECLARED',
            eventId,
            entityId: created.body.id,
          },
        }),
      ).toBe(1);
      await del(`${base}/${created.body.id}`, organizer.cookie).expect(204);
      expect(
        await db.auditEvent.count({
          where: {
            action: 'CONFLICT_REMOVED',
            eventId,
            entityId: created.body.id,
          },
        }),
      ).toBe(1);
    }
    await post(
      base,
      {
        judgeProfileId: accepted.body.judgeProfileId,
        type: 'TEAM',
        targetId: randomUUID(),
      },
      organizer.cookie,
    ).expect(404);
  });
  it('keeps an assigned evaluation bound to its original rubric after a new version is published', async () => {
    const judge = await actor('version-judge');
    const invite = await post(
      `/events/${eventId}/judging/invitations`,
      { invitedUserId: judge.id },
      organizer.cookie,
    ).expect(201);
    const accepted = await post(
      '/judge-invitations/accept',
      { token: invite.body.token },
      judge.cookie,
    ).expect(200);
    const base = `/events/${eventId}/judging/rubrics`;
    const first = await post(base, rubric(), organizer.cookie).expect(201);
    await post(`${base}/${first.body.id}/publish`, {}, organizer.cookie).expect(
      201,
    );
    const team = await db.team.create({
      data: {
        eventId,
        createdById: participant.id,
        name: 'Version team',
        slug: `version-${unique()}`,
      },
    });
    const project = await db.project.create({
      data: {
        eventId,
        teamId: team.id,
        name: 'Version project',
        slug: `version-project-${unique()}`,
      },
    });
    const submission = await db.submission.create({
      data: {
        projectId: project.id,
        version: 1,
        title: 'Frozen project',
        description: 'Snapshot',
        projectName: 'Version project',
        status: 'SUBMITTED',
        submittedAt: now,
        createdById: participant.id,
      },
    });
    const run = await db.assignmentRun.create({
      data: {
        eventId,
        rubricVersionId: first.body.id,
        type: 'MANUAL',
        status: 'PUBLISHED',
        reviewsPerSubmission: 1,
        algorithm: 'manual',
        algorithmVersion: '1',
        allocationSource: 'manual',
        createdById: organizer.id,
        publishedAt: now,
      },
    });
    const assignment = await db.judgeAssignment.create({
      data: {
        eventId,
        runId: run.id,
        rubricId: first.body.id,
        judgeProfileId: accepted.body.judgeProfileId,
        submissionId: submission.id,
        assignmentMethod: 'MANUAL',
      },
    });
    const evaluation = await db.evaluation.create({
      data: {
        assignmentId: assignment.id,
        rubricId: first.body.id,
        status: 'IN_PROGRESS',
      },
    });
    const second = await post(
      base,
      rubric(['0.25', '0.75']),
      organizer.cookie,
    ).expect(201);
    await post(
      `${base}/${second.body.id}/publish`,
      {},
      organizer.cookie,
    ).expect(201);
    const oldRun = await db.assignmentRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    const oldEvaluation = await db.evaluation.findUniqueOrThrow({
      where: { id: evaluation.id },
    });
    expect(oldRun.rubricVersionId).toBe(first.body.id);
    expect(oldEvaluation.rubricId).toBe(first.body.id);
    expect(second.body.id).not.toBe(first.body.id);
  });
  it('validates judging window order at the exact equality boundary', async () => {
    const base = {
      name: 'Invalid judging window',
      slug: `invalid-window-${unique()}`,
      submissionClosesAt: '2030-02-01T00:00:00Z',
    };
    const equal = await post(
      '/events',
      {
        ...base,
        judgingOpensAt: '2030-02-02T00:00:00Z',
        judgingClosesAt: '2030-02-02T00:00:00Z',
      },
      organizer.cookie,
    ).expect(400);
    expect(equal.body.code).toBe('INVALID_EVENT_WINDOW');
    const reversed = await post(
      '/events',
      {
        ...base,
        judgingOpensAt: '2030-02-03T00:00:00Z',
        judgingClosesAt: '2030-02-02T00:00:00Z',
      },
      organizer.cookie,
    ).expect(400);
    expect(reversed.body.code).toBe('INVALID_EVENT_WINDOW');
    await post(
      '/events',
      {
        ...base,
        judgingOpensAt: '2030-02-02T00:00:00Z',
        judgingClosesAt: '2030-02-02T00:00:00.001Z',
      },
      organizer.cookie,
    ).expect(201);
  });
});
