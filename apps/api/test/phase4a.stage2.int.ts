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
const opening = new Date('2030-01-04T00:00:00Z');
const closing = new Date('2030-01-05T00:00:00Z');
let now = new Date('2030-01-04T12:00:00Z');
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
      name: 'Stage 2 judging',
      slug: `stage2-${unique()}`,
      visibility: 'PUBLIC',
      registrationOpensAt: '2029-01-01T00:00:00Z',
      registrationClosesAt: '2031-01-01T00:00:00Z',
      submissionClosesAt: '2030-01-03T00:00:00Z',
      judgingOpensAt: opening.toISOString(),
      judgingClosesAt: closing.toISOString(),
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
  return (
    await post(
      '/judge-invitations/accept',
      { token: invitation.body.token },
      user.cookie,
    ).expect(200)
  ).body.judgeProfileId as string;
}
async function rubric(eventId: string, organizer: Actor) {
  const base = `/events/${eventId}/judging/rubrics`;
  const created = await post(
    base,
    {
      name: 'Stage 2 rubric',
      criteria: [
        { name: 'Impact', weight: '0.4', minScore: '0', maxScore: '10' },
        { name: 'Execution', weight: '0.6', minScore: '1', maxScore: '5' },
      ],
    },
    organizer.cookie,
  ).expect(201);
  return (
    await post(
      `${base}/${created.body.id}/publish`,
      {},
      organizer.cookie,
    ).expect(201)
  ).body;
}
async function submission(
  eventId: string,
  userId: string,
  status: 'DRAFT' | 'SUBMITTED' | 'WITHDRAWN' = 'SUBMITTED',
) {
  const team = await db.team.create({
    data: {
      eventId,
      createdById: userId,
      name: 'Judging team',
      slug: `judge-team-${unique()}`,
    },
  });
  const project = await db.project.create({
    data: {
      eventId,
      teamId: team.id,
      name: 'Judging project',
      slug: `judge-project-${unique()}`,
      status: 'ACTIVE',
    },
  });
  const row = await db.submission.create({
    data: {
      projectId: project.id,
      version: 1,
      title: 'Immutable submission',
      description: 'Private judging material',
      projectName: 'Judging project',
      status,
      createdById: userId,
      ...(status === 'DRAFT'
        ? {}
        : { submittedAt: new Date('2030-01-02T00:00:00Z') }),
    },
  });
  return { id: row.id, projectId: project.id, teamId: team.id };
}
const path = (eventId: string) => `/events/${eventId}/judging`;
const scores = (criteria: Array<{ id: string }>) =>
  criteria.map((c, i) => ({ criterionId: c.id, score: i === 0 ? '8' : '4' }));
let organizerA: Actor,
  organizerB: Actor,
  participant: Actor,
  judgeA: Actor,
  judgeB: Actor;
let eventA: string,
  eventB: string,
  profileA: string,
  profileB: string,
  profileAInB: string,
  profileBInB: string;
let rubricA: { id: string; criteria: Array<{ id: string }> },
  rubricB: { id: string; criteria: Array<{ id: string }> };
let submissionA: { id: string; projectId: string; teamId: string },
  submissionB: { id: string; projectId: string; teamId: string };
let assignmentA: string, assignmentB: string, assignmentOther: string;

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
  [organizerA, organizerB, participant, judgeA, judgeB] = await Promise.all([
    actor('organizer-a'),
    actor('organizer-b'),
    actor('participant'),
    actor('judge-a'),
    actor('judge-b'),
  ]);
  eventA = await event(organizerA);
  eventB = await event(organizerB);
  await post(`/events/${eventA}/registrations`, {}, participant.cookie).expect(
    201,
  );
  profileA = await judge(eventA, organizerA, judgeA);
  profileB = await judge(eventA, organizerA, judgeB);
  profileAInB = await judge(eventB, organizerB, judgeA);
  profileBInB = await judge(eventB, organizerB, judgeB);
  rubricA = await rubric(eventA, organizerA);
  rubricB = await rubric(eventB, organizerB);
  submissionA = await submission(eventA, participant.id);
  submissionB = await submission(eventB, participant.id);
  const a = await post(
    `${path(eventA)}/assignments/manual`,
    {
      judgeProfileId: profileA,
      submissionId: submissionA.id,
      rubricId: rubricA.id,
    },
    organizerA.cookie,
  ).expect(201);
  assignmentA = a.body.assignmentId as string;
  const b = await post(
    `${path(eventA)}/assignments/manual`,
    {
      judgeProfileId: profileB,
      submissionId: submissionA.id,
      rubricId: rubricA.id,
    },
    organizerA.cookie,
  ).expect(201);
  assignmentB = b.body.assignmentId as string;
  const other = await post(
    `${path(eventB)}/assignments/manual`,
    {
      judgeProfileId: profileBInB,
      submissionId: submissionB.id,
      rubricId: rubricB.id,
    },
    organizerB.cookie,
  ).expect(201);
  assignmentOther = other.body.assignmentId as string;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('Phase 4A Stage 2 manual assignment and evaluation', () => {
  it('creates published MANUAL runs bound to exact submission/rubric and audits atomically', async () => {
    const assignment = await db.judgeAssignment.findUniqueOrThrow({
      where: { id: assignmentA },
      include: { run: true },
    });
    expect(assignment.submissionId).toBe(submissionA.id);
    expect(assignment.rubricId).toBe(rubricA.id);
    expect(assignment.run.type).toBe('MANUAL');
    expect(assignment.run.status).toBe('PUBLISHED');
    for (const action of [
      'ASSIGNMENT_RUN_CREATED',
      'ASSIGNMENT_PUBLISHED',
      'JUDGE_ASSIGNED',
    ])
      expect(
        await db.auditEvent.count({ where: { eventId: eventA, action } }),
      ).toBeGreaterThan(0);
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileA,
        submissionId: submissionA.id,
        rubricId: rubricA.id,
      },
      organizerA.cookie,
    ).expect(409);
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileAInB,
        submissionId: submissionA.id,
        rubricId: rubricA.id,
      },
      organizerA.cookie,
    ).expect(409);
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileB,
        submissionId: submissionB.id,
        rubricId: rubricA.id,
      },
      organizerA.cookie,
    ).expect(409);
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileB,
        submissionId: submissionA.id,
        rubricId: rubricB.id,
      },
      organizerA.cookie,
    ).expect(409);
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileA,
        submissionId: submissionA.id,
        rubricId: rubricA.id,
      },
      judgeA.cookie,
    ).expect(403);
  });
  it('rejects draft, withdrawn, superseded, conflicted, and over-capacity assignments', async () => {
    const draft = await submission(eventA, participant.id, 'DRAFT');
    const withdrawn = await submission(eventA, participant.id, 'WITHDRAWN');
    for (const id of [draft.id, withdrawn.id])
      await post(
        `${path(eventA)}/assignments/manual`,
        { judgeProfileId: profileA, submissionId: id, rubricId: rubricA.id },
        organizerA.cookie,
      ).expect(409);
    const prior = await submission(eventA, participant.id);
    await db.submission.create({
      data: {
        projectId: prior.projectId,
        version: 2,
        title: 'New final',
        description: 'Second version',
        projectName: 'Judging project',
        status: 'SUBMITTED',
        submittedAt: now,
        createdById: participant.id,
      },
    });
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileA,
        submissionId: prior.id,
        rubricId: rubricA.id,
      },
      organizerA.cookie,
    ).expect(409);
    const target = await submission(eventA, participant.id);
    await post(
      `${path(eventA)}/conflicts`,
      { judgeProfileId: profileA, type: 'TEAM', targetId: target.teamId },
      organizerA.cookie,
    ).expect(201);
    await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileA,
        submissionId: target.id,
        rubricId: rubricA.id,
      },
      organizerA.cookie,
    ).expect(409);
    await patch(
      `${path(eventA)}/judges/${profileA}`,
      { maxAssignments: 1 },
      organizerA.cookie,
    ).expect(200);
    const extra = await submission(eventA, participant.id);
    const capacity = await post(
      `${path(eventA)}/assignments/manual`,
      {
        judgeProfileId: profileA,
        submissionId: extra.id,
        rubricId: rubricA.id,
      },
      organizerA.cookie,
    ).expect(409);
    expect(capacity.body.code).toBe('JUDGE_AT_CAPACITY');
  });
  it('makes previews invisible and returns only the judge own published assignment and evaluation', async () => {
    const preview = await db.assignmentRun.create({
      data: {
        eventId: eventA,
        rubricVersionId: rubricA.id,
        type: 'BATCH',
        reviewsPerSubmission: 1,
        algorithm: 'test',
        algorithmVersion: '1',
        allocationSource: 'greedy',
        createdById: organizerA.id,
      },
    });
    const hidden = await submission(eventA, participant.id);
    await db.assignmentRunProposal.create({
      data: {
        runId: preview.id,
        judgeProfileId: profileA,
        submissionId: hidden.id,
      },
    });
    const workspace = await get(
      `${path(eventA)}/workspace`,
      judgeA.cookie,
    ).expect(200);
    expect(
      workspace.body.assignments.some(
        (a: { submissionId: string }) => a.submissionId === hidden.id,
      ),
    ).toBe(false);
    await get(`${path(eventA)}/submissions/${hidden.id}`, judgeA.cookie).expect(
      404,
    );
    const own = await get(
      `${path(eventA)}/submissions/${submissionA.id}`,
      judgeA.cookie,
    ).expect(200);
    expect(own.body.assignmentId).toBe(assignmentA);
    expect(own.body.rubric.id).toBe(rubricA.id);
    expect(own.body.evaluation).toBeNull();
    expect(JSON.stringify(own.body)).not.toMatch(
      /password|tokenHash|createdById|judgeProfileId/i,
    );
  });
  it('returns 404 for unassigned and cross-event IDs and denies another judge evaluation', async () => {
    await get(
      `${path(eventA)}/assignments/${assignmentB}`,
      judgeA.cookie,
    ).expect(404);
    await get(
      `${path(eventB)}/assignments/${assignmentOther}`,
      judgeA.cookie,
    ).expect(404);
    await get(
      `${path(eventA)}/submissions/${submissionB.id}`,
      judgeA.cookie,
    ).expect(404);
    await get(
      `${path(eventB)}/submissions/${submissionA.id}`,
      judgeA.cookie,
    ).expect(404);
    await get(
      `${path(eventA)}/assignments/${assignmentA}`,
      participant.cookie,
    ).expect(404);
    await get(`${path(eventA)}/workspace`, participant.cookie).expect(403);
    await patch(
      `${path(eventA)}/assignments/${assignmentB}/evaluation`,
      { comments: 'not mine' },
      judgeA.cookie,
    ).expect(404);
  });
  it('saves partial drafts, edits scores, validates criterion IDs/ranges/unknown fields, and requires complete final scores', async () => {
    const endpoint = `${path(eventA)}/assignments/${assignmentA}/evaluation`;
    await patch(
      endpoint,
      { scores: [scores(rubricA.criteria)[0]], comments: 'first draft' },
      judgeA.cookie,
    ).expect(200);
    const incomplete = await post(
      `${endpoint}/submit`,
      {},
      judgeA.cookie,
    ).expect(400);
    expect(incomplete.body.code).toBe('EVALUATION_INCOMPLETE');
    await patch(
      endpoint,
      { scores: [{ criterionId: rubricA.criteria[0]!.id, score: '9' }] },
      judgeA.cookie,
    ).expect(200);
    await patch(
      endpoint,
      { scores: [{ criterionId: rubricA.criteria[1]!.id, score: '6' }] },
      judgeA.cookie,
    ).expect(400);
    await patch(
      endpoint,
      { scores: [{ criterionId: rubricB.criteria[1]!.id, score: '4' }] },
      judgeA.cookie,
    ).expect(400);
    await patch(
      endpoint,
      {
        scores: [
          {
            criterionId: rubricA.criteria[1]!.id,
            score: '4',
            unexpected: true,
          },
        ],
      },
      judgeA.cookie,
    ).expect(400);
    await patch(
      endpoint,
      { scores: [scores(rubricA.criteria)[1]], status: 'SUBMITTED' },
      judgeA.cookie,
    ).expect(400);
    const draft = await patch(
      endpoint,
      { scores: [scores(rubricA.criteria)[1]] },
      judgeA.cookie,
    ).expect(200);
    expect(draft.body.evaluation.status).toBe('IN_PROGRESS');
    expect(draft.body.evaluation.scores).toHaveLength(2);
    expect(
      draft.body.evaluation.scores.find(
        (s: { criterionId: string }) =>
          s.criterionId === rubricA.criteria[0]!.id,
      ).score,
    ).toBe('9');
  });
  it('submits once, keeps the final evaluation immutable, and handles concurrent double submission', async () => {
    const endpoint = `${path(eventA)}/assignments/${assignmentA}/evaluation`;
    const result = await post(`${endpoint}/submit`, {}, judgeA.cookie).expect(
      201,
    );
    expect(result.body.evaluation.status).toBe('SUBMITTED');
    await post(`${endpoint}/submit`, {}, judgeA.cookie).expect(409);
    await patch(endpoint, { comments: 'tamper' }, judgeA.cookie).expect(409);
    const own = await get(
      `${path(eventA)}/assignments/${assignmentA}`,
      judgeA.cookie,
    ).expect(200);
    expect(own.body.evaluation.id).toBe(result.body.evaluation.id);
    const other = await get(
      `${path(eventA)}/assignments/${assignmentB}`,
      judgeB.cookie,
    ).expect(200);
    expect(other.body.evaluation).toBeNull();
    const otherEndpoint = `${path(eventA)}/assignments/${assignmentB}/evaluation`;
    await patch(
      otherEndpoint,
      { scores: scores(rubricA.criteria) },
      judgeB.cookie,
    ).expect(200);
    const race = await Promise.all([
      post(`${otherEndpoint}/submit`, {}, judgeB.cookie),
      post(`${otherEndpoint}/submit`, {}, judgeB.cookie),
    ]);
    expect(race.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(
      await db.evaluation.count({
        where: { assignmentId: assignmentB, status: 'SUBMITTED' },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: {
          action: 'EVALUATION_SUBMITTED',
          eventId: eventA,
          metadata: { path: ['assignmentId'], equals: assignmentB },
        },
      }),
    ).toBe(1);
    const judgeBEvaluation = await db.evaluation.findUniqueOrThrow({
      where: { assignmentId: assignmentB },
      include: { scores: true },
    });
    const judgeAResponses = await Promise.all([
      get(`${path(eventA)}/workspace`, judgeA.cookie).expect(200),
      get(`${path(eventA)}/assignments/${assignmentA}`, judgeA.cookie).expect(
        200,
      ),
      get(
        `${path(eventA)}/submissions/${submissionA.id}`,
        judgeA.cookie,
      ).expect(200),
    ]);
    for (const response of judgeAResponses) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(judgeBEvaluation.id);
      expect(serialized).not.toContain('"score":"8"');
      for (const score of judgeBEvaluation.scores)
        expect(serialized).not.toContain(score.id);
    }
    expect(judgeAResponses[1]!.body.evaluation.scores).toHaveLength(2);
    expect(judgeAResponses[1]!.body.evaluation.scores).toEqual(
      expect.arrayContaining([
        { criterionId: rubricA.criteria[0]!.id, score: '9', comment: null },
        { criterionId: rubricA.criteria[1]!.id, score: '4', comment: null },
      ]),
    );
  });
  it('allows viewing before opening but rejects mutation before open and at exact close', async () => {
    const endpoint = `${path(eventB)}/assignments/${assignmentOther}/evaluation`;
    try {
      now = new Date(opening.getTime() - 1);
      await get(
        `${path(eventB)}/assignments/${assignmentOther}`,
        judgeB.cookie,
      ).expect(200);
      expect(
        (
          await patch(endpoint, { comments: 'early' }, judgeB.cookie).expect(
            409,
          )
        ).body.code,
      ).toBe('JUDGING_NOT_OPEN');
      now = opening;
      await patch(endpoint, { comments: 'at open' }, judgeB.cookie).expect(200);
      now = new Date(closing.getTime() - 1);
      await patch(
        endpoint,
        { comments: 'last millisecond' },
        judgeB.cookie,
      ).expect(200);
      now = closing;
      expect(
        (
          await patch(endpoint, { comments: 'at close' }, judgeB.cookie).expect(
            409,
          )
        ).body.code,
      ).toBe('JUDGING_CLOSED');
      expect(
        (
          await post(
            `${endpoint}/submit`,
            { scores: scores(rubricB.criteria) },
            judgeB.cookie,
          ).expect(409)
        ).body.code,
      ).toBe('JUDGING_CLOSED');
    } finally {
      now = new Date('2030-01-04T12:00:00Z');
    }
  });
  it('removes suspended and revoked judge access without erasing stored drafts/evaluations', async () => {
    const membership = await db.eventMembership.findUniqueOrThrow({
      where: {
        eventId_userId_role: {
          eventId: eventB,
          userId: judgeB.id,
          role: 'JUDGE',
        },
      },
    });
    const before = await db.evaluation.findUniqueOrThrow({
      where: { assignmentId: assignmentOther },
    });
    await db.eventMembership.update({
      where: { id: membership.id },
      data: { status: 'SUSPENDED' },
    });
    await get(`${path(eventB)}/workspace`, judgeB.cookie).expect(403);
    await get(
      `${path(eventB)}/assignments/${assignmentOther}`,
      judgeB.cookie,
    ).expect(404);
    await patch(
      `${path(eventB)}/assignments/${assignmentOther}/evaluation`,
      { comments: 'tamper' },
      judgeB.cookie,
    ).expect(404);
    await db.eventMembership.update({
      where: { id: membership.id },
      data: { status: 'REVOKED' },
    });
    await get(
      `${path(eventB)}/assignments/${assignmentOther}`,
      judgeB.cookie,
    ).expect(404);
    expect(
      (
        await db.evaluation.findUniqueOrThrow({
          where: { assignmentId: assignmentOther },
        })
      ).id,
    ).toBe(before.id);
  });
});
