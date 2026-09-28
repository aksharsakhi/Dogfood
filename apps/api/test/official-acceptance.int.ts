import 'reflect-metadata';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PrismaClient, Session } from '@prisma/client';
import request from 'supertest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/bootstrap';

const db = new PrismaClient();
const identities = {
  organizer: { email: 'fixture-organizer@dogfood.invalid', role: 'ORGANIZER' },
  judge_a: { email: 'wei.lindqvist@example.org', role: 'JUDGE' },
  judge_b: { email: 'nadia.rahman@example.org', role: 'JUDGE' },
  participant: { email: 'priya1@example.org', role: 'PARTICIPANT' },
} as const;
type Role = keyof typeof identities;
const roles = Object.keys(identities) as Role[];
const eventId = '8727a75d-bbe8-584a-9c95-d5c1a916e38c';
const judgeAProfileId = '130e9f1c-64f2-5d81-8b58-ea3c1d6dcbb2';
const scoresPath = (targetId = judgeAProfileId, targetEvent = eventId) =>
  `/events/${targetEvent}/judging/judges/${targetId}/scores`;
const cookie = (role: Role) => first[role].slice('Cookie: '.length);
const runImporter = () =>
  execFileSync('npm', ['run', 'db:import:official'], {
    encoding: 'utf8',
    env: process.env,
  });
const parseHeaders = (output: string) => {
  const headers = {} as Record<Role, string>;
  for (const role of roles) {
    const match = output.match(
      new RegExp(
        `^${role}\\s+= "(Cookie: dogfood_session=[A-Za-z0-9_-]{43})"$`,
        'm',
      ),
    );
    assert.ok(match, `Missing ${role} acceptance header`);
    headers[role] = match[1]!;
  }
  return headers;
};

let app: NestFastifyApplication;
let first: Record<Role, string>;
let second: Record<Role, string>;
let before: Session[];
let after: Session[];

beforeAll(async () => {
  assert.match(
    process.env.DATABASE_URL ?? '',
    /official_(?:clean|seeded|acceptance_test)/,
    'Use an isolated official fixture test database',
  );
  first = parseHeaders(runImporter());
  before = await db.session.findMany({
    where: { userAgent: 'dogfood-official-fixture-acceptance' },
    orderBy: { id: 'asc' },
  });
  second = parseHeaders(runImporter());
  after = await db.session.findMany({
    where: { userAgent: 'dogfood-official-fixture-acceptance' },
    orderBy: { id: 'asc' },
  });
  app = await createApp('http://localhost:3000');
  await app.listen(0, '127.0.0.1');
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  await db.$disconnect();
});

describe('official acceptance identities', () => {
  for (const role of roles) {
    it(`${role} authenticates as active ${identities[role].role}`, async () => {
      const header = first[role];
      const token = header.split('=')[1]!;
      const person = identities[role];
      const user = await db.user.findUniqueOrThrow({
        where: { email: person.email },
      });
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', header.slice('Cookie: '.length))
        .expect(200);
      assert.equal(response.body.id, user.id);
      assert.equal(response.body.email, person.email);
      assert.equal(user.status, 'ACTIVE');
      const membership = await db.eventMembership.findUniqueOrThrow({
        where: {
          eventId_userId_role: { eventId, userId: user.id, role: person.role },
        },
      });
      assert.equal(membership.status, 'ACTIVE');
      const session = after.find((row) => row.userId === user.id);
      assert.ok(session);
      assert.equal(
        session.tokenHash,
        createHash('sha256').update(token).digest('hex'),
      );
      assert.notEqual(session.tokenHash, token);
      assert.equal(session.revokedAt, null);
      assert.ok(session.expiresAt > new Date());
      if (role === 'judge_a' || role === 'judge_b') {
        const profile = await db.judgeProfile.findUniqueOrThrow({
          where: { eventMembershipId: membership.id },
        });
        const count = await db.judgeAssignment.count({
          where: {
            eventId,
            judgeProfileId: profile.id,
            evaluation: { status: 'SUBMITTED' },
          },
        });
        assert.ok(count > 0, `${role} needs submitted fixture evaluations`);
      }
    });
  }
  it('selects genuinely different judges', () => {
    assert.notEqual(first.judge_a, first.judge_b);
    assert.notEqual(identities.judge_a.email, identities.judge_b.email);
  });
  it('reruns without duplicate sessions or changed headers', () => {
    assert.equal(before.length, 4);
    assert.equal(after.length, 4);
    assert.deepEqual(
      after.map((row) => row.id),
      before.map((row) => row.id),
    );
    assert.deepEqual(
      after.map((row) => row.tokenHash),
      before.map((row) => row.tokenHash),
    );
    assert.deepEqual(second, first);
  });
});

describe('peer score isolation and checker route behavior', () => {
  it('maps the exact fixture identities and routes in .dogfood.toml', () => {
    const config = readFileSync('.dogfood.toml', 'utf8');
    const value = (name: string) => {
      const match = config.match(
        new RegExp(`^${name}\\s*=\\s*"([^"]+)"$`, 'm'),
      );
      assert.ok(match, `Missing ${name}`);
      return match[1];
    };
    expect(value('base_url')).toBe('http://localhost:4000');
    expect(config).toMatch(/^claimed\s*=\s*\["T1", "T2"\]$/m);
    for (const role of roles) expect(value(role)).toBe(first[role]);
    expect(value('gallery')).toBe(`/events/${eventId}/gallery?pageSize=50`);
    expect(value('submit')).toBe(
      `/events/${eventId}/projects/7bece727-8867-5a98-871d-abf22410a43a/submissions/70c1a52c-ec67-5c04-9f4a-324ff02becbe/submit`,
    );
    expect(value('judge_scores')).toBe(scoresPath());
    expect(value('peer_scores')).toBe(scoresPath());
    expect(value('csv_export')).toBe(
      `/events/${eventId}/judging/exports/raw-evaluations`,
    );
  });

  it('returns only judge A submitted raw evaluations and scores to judge A', async () => {
    const response = await request(app.getHttpServer())
      .get(scoresPath())
      .set('Cookie', cookie('judge_a'))
      .expect(200);
    expect(Object.keys(response.body).sort()).toEqual([
      'evaluations',
      'judgeProfileId',
    ]);
    expect(response.body.judgeProfileId).toBe(judgeAProfileId);
    const own = await db.evaluation.findMany({
      where: {
        status: 'SUBMITTED',
        assignment: { eventId, judgeProfileId: judgeAProfileId },
      },
      include: { assignment: true, scores: true },
    });
    expect(own).toHaveLength(6);
    expect(response.body.evaluations).toHaveLength(own.length);
    for (const item of response.body.evaluations as Array<
      Record<string, unknown>
    >) {
      expect(Object.keys(item).sort()).toEqual([
        'assignmentId',
        'comments',
        'evaluationId',
        'scores',
        'submissionId',
        'submittedAt',
      ]);
      const expected = own.find((row) => row.id === item.evaluationId);
      expect(expected).toBeDefined();
      expect(item.assignmentId).toBe(expected?.assignmentId);
      expect(item.submissionId).toBe(expected?.assignment.submissionId);
      expect(item.comments).toBe(expected?.comments);
      const scores = item.scores as Array<Record<string, unknown>>;
      expect(scores).toHaveLength(expected!.scores.length);
      for (const score of scores) {
        expect(Object.keys(score).sort()).toEqual([
          'comment',
          'criterionId',
          'score',
        ]);
        const source = expected!.scores.find(
          (row) => row.criterionId === score.criterionId,
        );
        expect(score.score).toBe(source?.score.toString());
        expect(score.comment).toBe(source?.comment);
      }
    }
  });

  it('returns 403 for judge B requesting judge A scores', async () => {
    const result = await request(app.getHttpServer())
      .get(scoresPath())
      .set('Cookie', cookie('judge_b'))
      .expect(403);
    expect(result.body.code).toBe('PEER_SCORES_FORBIDDEN');
    expect(Object.keys(result.body).sort()).toEqual([
      'code',
      'details',
      'message',
      'requestId',
    ]);
    expect(result.body.details).toBeNull();
  });

  it('returns 403 for a participant requesting judge A scores', async () => {
    const result = await request(app.getHttpServer())
      .get(scoresPath())
      .set('Cookie', cookie('participant'))
      .expect(403);
    expect(result.body.code).toBe('JUDGE_ACCESS_REQUIRED');
  });

  it('returns 401 without a session', async () => {
    await request(app.getHttpServer()).get(scoresPath()).expect(401);
  });

  it('does not expose an event A profile when judge A is also active in event B', async () => {
    const organizer = await db.user.findUniqueOrThrow({
      where: { email: identities.organizer.email },
    });
    const judgeA = await db.user.findUniqueOrThrow({
      where: { email: identities.judge_a.email },
    });
    const otherEvent = await db.event.create({
      data: {
        slug: `peer-isolation-${randomUUID()}`,
        name: 'Peer isolation test',
        createdById: organizer.id,
      },
    });
    const membership = await db.eventMembership.create({
      data: { eventId: otherEvent.id, userId: judgeA.id, role: 'JUDGE' },
    });
    const profile = await db.judgeProfile.create({
      data: { eventMembershipId: membership.id },
    });
    try {
      const result = await request(app.getHttpServer())
        .get(scoresPath(judgeAProfileId, otherEvent.id))
        .set('Cookie', cookie('judge_a'))
        .expect(403);
      expect(result.body.code).toBe('PEER_SCORES_FORBIDDEN');
      await request(app.getHttpServer())
        .get(scoresPath(profile.id, eventId))
        .set('Cookie', cookie('judge_a'))
        .expect(403);
    } finally {
      await db.judgeProfile.delete({ where: { id: profile.id } });
      await db.eventMembership.delete({ where: { id: membership.id } });
      await db.event.delete({ where: { id: otherEvent.id } });
    }
  });

  it('preserves the existing wrong-judge assignment 404', async () => {
    const assignment = await db.judgeAssignment.findFirstOrThrow({
      where: { eventId, judgeProfileId: judgeAProfileId },
      select: { id: true },
    });
    const result = await request(app.getHttpServer())
      .get(`/events/${eventId}/judging/assignments/${assignment.id}`)
      .set('Cookie', cookie('judge_b'))
      .expect(404);
    expect(result.body.code).toBe('ASSIGNMENT_NOT_FOUND');
  });

  it('serves a first-page fixture title in anonymous gallery JSON', async () => {
    const response = await request(app.getHttpServer())
      .get(`/events/${eventId}/gallery?pageSize=50`)
      .expect(200);
    expect(
      ['Glass Signal', 'Small Meadow', 'Deep Compass'].some((title) =>
        response.text.includes(title),
      ),
    ).toBe(true);
  });

  it('rejects the exact late-submit probe at the server deadline check', async () => {
    const projectId = '7bece727-8867-5a98-871d-abf22410a43a';
    const submissionId = '70c1a52c-ec67-5c04-9f4a-324ff02becbe';
    const response = await request(app.getHttpServer())
      .post(
        `/events/${eventId}/projects/${projectId}/submissions/${submissionId}/submit`,
      )
      .set('Cookie', cookie('participant'))
      .send({ title: 'dogfood-late-submission-probe', summary: 'probe' })
      .expect(409);
    expect(response.body.code).toBe('SUBMISSION_CLOSED');
  });

  it('returns organizer raw evaluation CSV with a comma in the first line', async () => {
    const response = await request(app.getHttpServer())
      .get(`/events/${eventId}/judging/exports/raw-evaluations`)
      .set('Cookie', cookie('organizer'))
      .expect(200);
    expect(response.text.split(/\r?\n/)[0]).toContain(',');
  });
});
