import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient, VotingAccessMode } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Clock } from '../src/common/time';
import { hashToken } from '../src/modules/identity/auth.service';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('Isolated test database required');
process.env.VOTING_TOKEN_SECRET =
  'T3B-only-integration-test-secret-that-is-long-enough';
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const opening = new Date('2030-01-01T00:00:00.000Z');
const closing = new Date('2030-02-01T00:00:00.000Z');
let now = new Date('2030-01-15T00:00:00.000Z');
let app: NestFastifyApplication;
type Actor = { id: string; cookie: string };
type Fixture = {
  eventId: string;
  organizer: Actor;
  owner: Actor;
  voter: Actor;
  projectIds: string[];
  teamId: string;
};
const api = () => app.getHttpServer();
const path = (eventId: string, suffix: string) =>
  `/events/${eventId}/voting/${suffix}`;
const post = (
  url: string,
  body: object = {},
  cookie?: string,
  agent = 't3b-test',
) => {
  const req = request(api())
    .post(url)
    .set('Origin', origin)
    .set('User-Agent', agent);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const get = (url: string, cookie?: string) => {
  const req = request(api()).get(url);
  if (cookie) req.set('Cookie', cookie);
  return req;
};
const patch = (url: string, body: object, cookie?: string) => {
  const req = request(api()).patch(url).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
async function actor(label: string): Promise<Actor> {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await db.user.create({
    data: {
      id,
      email: `${label}-${id}@example.test`,
      displayName: label,
      passwordHash: 'test',
    },
  });
  await db.session.create({
    data: {
      userId: id,
      tokenHash: hashToken(token),
      expiresAt: new Date('2031-01-01'),
    },
  });
  return { id, cookie: `dogfood_session=${token}` };
}
async function fixture(
  mode: VotingAccessMode = 'AUTHENTICATED',
  visible = true,
): Promise<Fixture> {
  const organizer = await actor('organizer');
  const owner = await actor('owner');
  const voter = await actor('voter');
  const eventId = randomUUID();
  await db.event.create({
    data: {
      id: eventId,
      slug: `t3b-${eventId}`,
      name: 'T3B event',
      createdById: organizer.id,
      status: 'PUBLISHED',
      visibility: visible ? 'PUBLIC' : 'PRIVATE',
      galleryVisibility: visible ? 'PUBLIC' : 'HIDDEN',
      votingAccessMode: mode,
      votingOpensAt: opening,
      votingClosesAt: closing,
    },
  });
  await db.eventMembership.createMany({
    data: [
      { eventId, userId: organizer.id, role: 'ORGANIZER' },
      { eventId, userId: owner.id, role: 'PARTICIPANT' },
      { eventId, userId: voter.id, role: 'PARTICIPANT' },
    ],
  });
  const teamId = randomUUID();
  await db.team.create({
    data: {
      id: teamId,
      eventId,
      name: 'Project team',
      slug: `team-${teamId}`,
      createdById: owner.id,
      status: 'ACTIVE',
    },
  });
  await db.teamMember.create({
    data: { eventId, teamId, userId: owner.id, role: 'OWNER' },
  });
  const projectIds: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const id = randomUUID();
    projectIds.push(id);
    await db.project.create({
      data: {
        id,
        eventId,
        teamId,
        name: `Project ${index}`,
        slug: `project-${index}`,
        status: 'ACTIVE',
      },
    });
    await db.submission.create({
      data: {
        projectId: id,
        version: 1,
        title: `Title ${index}`,
        description: 'Submitted work',
        projectName: `Project ${index}`,
        status: 'SUBMITTED',
        createdById: owner.id,
        submittedAt: new Date('2029-12-31T00:00:00Z'),
      },
    });
  }
  return { eventId, organizer, owner, voter, projectIds, teamId };
}

beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  jest.spyOn(app.get(Clock), 'now').mockImplementation(() => now);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
beforeEach(() => {
  now = new Date('2030-01-15T00:00:00.000Z');
});

describe('T3B public voting and abuse controls', () => {
  it('AUTHENTICATED resolves session, blocks a team owner, and rejects mass assignment', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'votes');
    await post(url, { projectId: f.projectIds[0] }, f.owner.cookie).expect(403);
    await post(
      url,
      { projectId: f.projectIds[0], identityId: randomUUID() },
      f.voter.cookie,
    ).expect(400);
    await post(
      url,
      { projectId: f.projectIds[0], email: 'wrong@example.test' },
      f.voter.cookie,
    ).expect(400);
    await post(url, { projectId: f.projectIds[0] }).expect(401);
  });

  it('accepts exactly one vote per identity, including concurrent attempts, and audits it', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'votes');
    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        post(url, { projectId: f.projectIds[0] }, f.voter.cookie),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.communityVote.count({ where: { eventId: f.eventId } }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { eventId: f.eventId, action: 'COMMUNITY_VOTE_CAST' },
      }),
    ).toBe(1);
  });

  it('uses exact opening and closing boundaries from the injected server clock', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'votes');
    now = new Date(opening.getTime() - 1);
    expect(
      (
        await post(url, { projectId: f.projectIds[0] }, f.voter.cookie).expect(
          409,
        )
      ).body.code,
    ).toBe('VOTING_NOT_OPEN');
    now = opening;
    await post(url, { projectId: f.projectIds[0] }, f.voter.cookie).expect(201);
    now = closing;
    expect(
      (
        await post(url, { projectId: f.projectIds[1] }, f.owner.cookie).expect(
          409,
        )
      ).body.code,
    ).toBe('VOTING_CLOSED');
  });

  it('enforces a timezone-offset window at the intended UTC instant', async () => {
    const f = await fixture();
    const configured = await patch(
      path(f.eventId, 'config'),
      {
        votingOpensAt: '2030-01-02T10:15:00+05:30',
        votingClosesAt: '2030-01-02T11:15:00+05:30',
      },
      f.organizer.cookie,
    ).expect(200);
    expect(configured.body.votingOpensAt).toBe('2030-01-02T04:45:00.000Z');
    expect(configured.body.votingClosesAt).toBe('2030-01-02T05:45:00.000Z');
    const stored = await db.event.findUniqueOrThrow({
      where: { id: f.eventId },
    });
    expect(stored.votingOpensAt?.toISOString()).toBe(
      '2030-01-02T04:45:00.000Z',
    );
    const url = path(f.eventId, 'votes');
    now = new Date('2030-01-02T04:44:59.999Z');
    expect(
      (await post(url, { projectId: f.projectIds[0] }, f.voter.cookie)).body
        .code,
    ).toBe('VOTING_NOT_OPEN');
    now = new Date('2030-01-02T04:45:00.000Z');
    await post(url, { projectId: f.projectIds[0] }, f.voter.cookie).expect(201);
    now = new Date('2030-01-02T05:44:59.999Z');
    await get(path(f.eventId, 'results')).expect(403);
    now = new Date('2030-01-02T05:45:00.000Z');
    expect(
      (await post(url, { projectId: f.projectIds[1] }, f.owner.cookie)).body
        .code,
    ).toBe('VOTING_CLOSED');
    await get(path(f.eventId, 'results')).expect(200);
  });

  it('keeps mode and identity consistent when config and first ballot race', async () => {
    const f = await fixture('OPEN');
    const [ballot, config] = await Promise.all([
      post(path(f.eventId, 'ballot')),
      patch(
        path(f.eventId, 'config'),
        { accessMode: 'EMAIL_GATED' },
        f.organizer.cookie,
      ),
    ]);
    expect([
      [201, 409],
      [400, 200],
    ]).toContainEqual([ballot.status, config.status]);
    const event = await db.event.findUniqueOrThrow({
      where: { id: f.eventId },
    });
    const identities = await db.votingIdentity.findMany({
      where: { eventId: f.eventId },
    });
    expect(
      identities.every((identity) => identity.mode === event.votingAccessMode),
    ).toBe(true);
    if (ballot.status === 201) {
      expect(config.body.code).toBe('VOTING_MODE_LOCKED');
      expect(identities).toHaveLength(1);
    } else {
      expect(ballot.body.code).toBe('EMAIL_REQUIRED');
      expect(identities).toHaveLength(0);
    }
  });

  it('rechecks the server clock after waiting for an event lock at the deadline', async () => {
    const f = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${f.eventId}::uuid FOR UPDATE`;
      locked();
      await blocker;
    });
    await ready;
    try {
      now = new Date(closing.getTime() - 1);
      const pending = post(
        path(f.eventId, 'votes'),
        { projectId: f.projectIds[0] },
        f.voter.cookie,
      ).then((result) => result);
      await new Promise((resolve) => setTimeout(resolve, 75));
      now = closing;
      release();
      await hold;
      expect((await pending).body.code).toBe('VOTING_CLOSED');
      expect(
        await db.communityVote.count({ where: { eventId: f.eventId } }),
      ).toBe(0);
      expect(
        await db.auditEvent.count({
          where: { eventId: f.eventId, action: 'COMMUNITY_VOTE_CAST' },
        }),
      ).toBe(0);
    } finally {
      release();
    }
  });

  it('rejects concurrent distinct voters queued across the exact close boundary', async () => {
    const f = await fixture();
    const voters = await Promise.all(
      Array.from({ length: 5 }, (_, index) => actor(`closing-voter-${index}`)),
    );
    let release!: () => void;
    let locked!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${f.eventId}::uuid FOR UPDATE`;
      locked();
      await blocker;
    });
    await ready;
    try {
      now = new Date(closing.getTime() - 1);
      const pending = voters.map((voter) =>
        post(
          path(f.eventId, 'votes'),
          { projectId: f.projectIds[0] },
          voter.cookie,
        ).then((response) => response),
      );
      await new Promise((resolve) => setTimeout(resolve, 75));
      now = closing;
      release();
      await hold;
      const responses = await Promise.all(pending);
      expect(responses.map((response) => response.status)).toEqual([
        409, 409, 409, 409, 409,
      ]);
      expect(responses.map((response) => response.body.code)).toEqual(
        Array(5).fill('VOTING_CLOSED'),
      );
      expect(
        await db.communityVote.count({ where: { eventId: f.eventId } }),
      ).toBe(0);
    } finally {
      release();
    }
  });

  it('rechecks project eligibility after a concurrent withdrawal commits', async () => {
    const f = await fixture();
    let release!: () => void;
    let locked!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${f.projectIds[0]}::uuid FOR UPDATE`;
      locked();
      await blocker;
      await tx.project.update({
        where: { id: f.projectIds[0] },
        data: { status: 'WITHDRAWN' },
      });
    });
    await ready;
    try {
      const pending = post(
        path(f.eventId, 'votes'),
        { projectId: f.projectIds[0] },
        f.voter.cookie,
      ).then((result) => result);
      await new Promise((resolve) => setTimeout(resolve, 75));
      release();
      await hold;
      expect((await pending).status).toBe(404);
      expect(
        await db.communityVote.count({ where: { eventId: f.eventId } }),
      ).toBe(0);
    } finally {
      release();
    }
  });

  it('hides all tallies before close and releases them exactly at close', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'results');
    now = new Date(closing.getTime() - 1);
    const denied = await get(url, f.voter.cookie).expect(403);
    expect(JSON.stringify(denied.body)).not.toMatch(/votes|turnout|projectId/);
    await get(url).expect(403);
    const judge = await actor('judge');
    await db.eventMembership.create({
      data: { eventId: f.eventId, userId: judge.id, role: 'JUDGE' },
    });
    await get(url, judge.cookie).expect(403);
    expect(
      (await get(url, f.organizer.cookie).expect(200)).body.items,
    ).toHaveLength(6);
    now = closing;
    const publicResult = await get(url).expect(200);
    expect(publicResult.body.items).toHaveLength(6);
    now = new Date(closing.getTime() + 1);
    await get(url, f.voter.cookie).expect(200);
  });

  it('keeps ballot order stable per identity, distinct across identities, complete, and tally-free', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'ballot');
    const a = await post(url, {}, f.voter.cookie).expect(201);
    const again = await post(url, {}, f.voter.cookie).expect(201);
    const b = await post(url, {}, f.owner.cookie).expect(201);
    const ids = (body: { items: Array<{ id: string }> }) =>
      body.items.map((row) => row.id);
    expect(ids(a.body)).toEqual(ids(again.body));
    expect(ids(a.body)).not.toEqual(ids(b.body));
    expect(new Set(ids(a.body))).toEqual(new Set(f.projectIds));
    expect(JSON.stringify(a.body)).not.toMatch(/votes|turnout|score|rank/);
  });

  it('OPEN uses a signed browser cookie; missing, tampered, and wrong-mode credentials are handled', async () => {
    const f = await fixture('OPEN');
    const url = path(f.eventId, 'ballot');
    const first = await post(url).expect(201);
    const header = first.headers['set-cookie'];
    const cookie = (Array.isArray(header) ? header[0] : header)!.split(';')[0]!;
    expect(cookie).toContain('dogfood_voter_');
    await post(url, {}, cookie).expect(201);
    await post(url, { email: 'a@example.test' }, cookie).expect(400);
    await post(url, {}, `${cookie}x`).expect(401);
    expect(
      await db.votingIdentity.count({
        where: { eventId: f.eventId, mode: 'OPEN' },
      }),
    ).toBe(1);
  });

  it('EMAIL_GATED deduplicates normalized email strings without a challenge or ownership claim', async () => {
    const f = await fixture('EMAIL_GATED');
    const url = path(f.eventId, 'ballot');
    await post(url, { email: ' Sample@Example.Test ' }).expect(201);
    await post(url, { email: 'sample@example.test' }).expect(201);
    await post(url, {}).expect(400);
    expect(
      await db.votingIdentity.count({ where: { eventId: f.eventId } }),
    ).toBe(1);
    const identity = await db.votingIdentity.findFirstOrThrow({
      where: { eventId: f.eventId },
    });
    expect(identity.emailAcceptedAt).toBeInstanceOf(Date);
    expect(
      await db.votingEmailChallenge.count({ where: { eventId: f.eventId } }),
    ).toBe(0);
    await post(path(f.eventId, 'votes'), {
      email: 'sample@example.test',
      projectId: f.projectIds[0],
    }).expect(201);
    expect(
      (
        await post(path(f.eventId, 'votes'), {
          email: 'SAMPLE@example.test',
          projectId: f.projectIds[1],
        }).expect(409)
      ).body.code,
    ).toBe('ALREADY_VOTED');
  });

  it('locks access mode after first identity and audits configuration', async () => {
    const f = await fixture('OPEN');
    await post(path(f.eventId, 'ballot')).expect(201);
    const result = await patch(
      path(f.eventId, 'config'),
      { accessMode: 'EMAIL_GATED' },
      f.organizer.cookie,
    ).expect(409);
    expect(result.body.code).toBe('VOTING_MODE_LOCKED');
    await patch(
      path(f.eventId, 'config'),
      { votingClosesAt: '2030-03-01T00:00:00Z' },
      f.organizer.cookie,
    ).expect(200);
    expect(
      await db.auditEvent.count({
        where: { eventId: f.eventId, action: 'VOTING_CONFIG_CHANGED' },
      }),
    ).toBe(1);
  });

  it('reads organizer voting configuration and lock state without creating an identity', async () => {
    const f = await fixture('OPEN');
    const url = path(f.eventId, 'config');
    await get(url).expect(401);
    await get(url, f.voter.cookie).expect(403);
    const before = await get(url, f.organizer.cookie).expect(200);
    expect(before.body).toEqual({
      accessMode: 'OPEN',
      votingOpensAt: opening.toISOString(),
      votingClosesAt: closing.toISOString(),
      votingConfigLocked: false,
    });
    expect(
      await db.votingIdentity.count({ where: { eventId: f.eventId } }),
    ).toBe(0);
    expect(await db.auditEvent.count({ where: { eventId: f.eventId } })).toBe(
      0,
    );
    await post(path(f.eventId, 'ballot')).expect(201);
    expect(
      (await get(url, f.organizer.cookie).expect(200)).body.votingConfigLocked,
    ).toBe(true);
    expect(
      await db.votingIdentity.count({ where: { eventId: f.eventId } }),
    ).toBe(1);
  });

  it('reports already-voted state without consuming write capacity or auditing the read', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'ballot');
    const before = await post(url, {}, f.voter.cookie).expect(201);
    expect(before.body.alreadyVoted).toBe(false);
    expect(before.body.items).toHaveLength(6);
    expect(
      await db.publicWriteBucket.count({ where: { eventId: f.eventId } }),
    ).toBe(0);
    expect(await db.auditEvent.count({ where: { eventId: f.eventId } })).toBe(
      0,
    );
    await post(
      path(f.eventId, 'votes'),
      { projectId: f.projectIds[0] },
      f.voter.cookie,
    ).expect(201);
    const bucketBefore = await db.publicWriteBucket.findMany({
      where: { eventId: f.eventId },
    });
    const auditBefore = await db.auditEvent.count({
      where: { eventId: f.eventId },
    });
    const after = await post(url, {}, f.voter.cookie).expect(201);
    expect(after.body.alreadyVoted).toBe(true);
    expect(after.body.items).toEqual(before.body.items);
    expect(
      await db.publicWriteBucket.findMany({ where: { eventId: f.eventId } }),
    ).toEqual(bucketBefore);
    expect(await db.auditEvent.count({ where: { eventId: f.eventId } })).toBe(
      auditBefore,
    );
    expect(
      await db.communityVote.count({ where: { eventId: f.eventId } }),
    ).toBe(1);
  });

  it('pages beyond 200 visible comments without gaps, duplicates, or cursor leakage', async () => {
    const f = await fixture();
    const other = await fixture();
    const identity = await db.votingIdentity.create({
      data: { eventId: f.eventId, mode: 'AUTHENTICATED', userId: f.voter.id },
    });
    const otherIdentity = await db.votingIdentity.create({
      data: {
        eventId: other.eventId,
        mode: 'AUTHENTICATED',
        userId: other.voter.id,
      },
    });
    const createdAt = new Date('2030-01-02T00:00:00.000Z');
    const entries = Array.from({ length: 223 }, (_, index) => ({
      id: randomUUID(),
      eventId: f.eventId,
      projectId: f.projectIds[0]!,
      identityId: identity.id,
      body: `comment-${index}`,
      createdAt,
      ...(index % 47 === 0
        ? {
            status: 'HIDDEN' as const,
            hiddenAt: createdAt,
            hiddenById: f.organizer.id,
          }
        : {}),
    }));
    await db.projectComment.createMany({ data: entries });
    const otherProjectComment = await db.projectComment.create({
      data: {
        eventId: f.eventId,
        projectId: f.projectIds[1]!,
        identityId: identity.id,
        body: 'other project',
      },
    });
    const otherEventComment = await db.projectComment.create({
      data: {
        eventId: other.eventId,
        projectId: other.projectIds[0]!,
        identityId: otherIdentity.id,
        body: 'other event',
      },
    });
    const url = path(f.eventId, `projects/${f.projectIds[0]}/comments`);
    const expected = await db.projectComment.findMany({
      where: {
        eventId: f.eventId,
        projectId: f.projectIds[0],
        status: 'VISIBLE',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    expect(expected.length).toBeGreaterThan(200);
    expect((await get(url).expect(200)).body.items).toHaveLength(200);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await get(
        `${url}?pageSize=37${cursor ? `&cursor=${cursor}` : ''}`,
      ).expect(200);
      seen.push(...page.body.items.map((item: { id: string }) => item.id));
      cursor = page.body.nextCursor as string | null;
    } while (cursor);
    expect(seen).toEqual(expected.map((item) => item.id));
    expect(new Set(seen).size).toBe(expected.length);
    for (const badCursor of [
      randomUUID(),
      entries.find((item) => item.status === 'HIDDEN')!.id,
      otherProjectComment.id,
      otherEventComment.id,
    ]) {
      const result = await get(`${url}?pageSize=10&cursor=${badCursor}`).expect(
        400,
      );
      expect(result.body.code).toBe('INVALID_COMMENT_CURSOR');
      expect(JSON.stringify(result.body)).not.toContain('other project');
      expect(JSON.stringify(result.body)).not.toContain('other event');
    }
    await get(`${url}?cursor=not-a-uuid`).expect(400);
    await get(`${url}?pageSize=201`).expect(400);
  });

  it('rejects cross-event and withdrawn projects, plus private galleries', async () => {
    const f = await fixture();
    const other = await fixture();
    await post(
      path(f.eventId, 'votes'),
      { projectId: other.projectIds[0] },
      f.voter.cookie,
    ).expect(404);
    await db.project.update({
      where: { id: f.projectIds[0] },
      data: { status: 'WITHDRAWN' },
    });
    await post(
      path(f.eventId, 'votes'),
      { projectId: f.projectIds[0] },
      f.voter.cookie,
    ).expect(404);
    const hidden = await fixture('OPEN', false);
    await post(path(hidden.eventId, 'ballot')).expect(404);
    await post(
      path(hidden.eventId, `projects/${hidden.projectIds[0]}/comments`),
      { body: 'private' },
    ).expect(404);
  });

  it('keeps T3 read and moderation routes within the requested event and project', async () => {
    const first = await fixture();
    const second = await fixture();
    const comment = await post(
      path(second.eventId, `projects/${second.projectIds[0]}/comments`),
      { body: 'other event private context' },
      second.voter.cookie,
    ).expect(201);
    await get(
      path(first.eventId, `projects/${second.projectIds[0]}/comments`),
    ).expect(404);
    await post(
      path(first.eventId, `projects/${second.projectIds[0]}/comments`),
      { body: 'wrong event' },
      first.voter.cookie,
    ).expect(404);
    await patch(
      path(
        first.eventId,
        `projects/${first.projectIds[0]}/comments/${comment.body.id}/hide`,
      ),
      {},
      first.organizer.cookie,
    ).expect(404);
    await get(path(first.eventId, 'config'), second.organizer.cookie).expect(
      403,
    );
    await get(path(first.eventId, 'audit'), second.organizer.cookie).expect(
      403,
    );
    await get(path(first.eventId, 'results')).expect(403);
    await post(
      path(first.eventId, 'ballot'),
      { email: 'wrong@example.test' },
      first.voter.cookie,
    ).expect(400);
    expect(
      await db.projectComment.findUniqueOrThrow({
        where: { id: comment.body.id },
      }),
    ).toMatchObject({ status: 'VISIBLE', eventId: second.eventId });
  });

  it('excludes a project whose latest non-draft version was withdrawn', async () => {
    const f = await fixture();
    await db.submission.create({
      data: {
        projectId: f.projectIds[0]!,
        version: 2,
        title: 'Withdrawn version',
        description: 'No longer eligible',
        status: 'WITHDRAWN',
        createdById: f.owner.id,
      },
    });
    const ballot = await post(
      path(f.eventId, 'ballot'),
      {},
      f.voter.cookie,
    ).expect(201);
    expect(
      ballot.body.items.map((row: { id: string }) => row.id),
    ).not.toContain(f.projectIds[0]);
    await post(
      path(f.eventId, 'votes'),
      { projectId: f.projectIds[0] },
      f.voter.cookie,
    ).expect(404);
    await get(path(f.eventId, `projects/${f.projectIds[0]}/comments`)).expect(
      404,
    );
    await post(
      path(f.eventId, `projects/${f.projectIds[0]}/comments`),
      { body: 'withdrawn' },
      f.voter.cookie,
    ).expect(404);
  });

  it('revokes authenticated voting and comment access for a suspended user', async () => {
    const f = await fixture();
    await post(path(f.eventId, 'ballot'), {}, f.voter.cookie).expect(201);
    await db.user.update({
      where: { id: f.voter.id },
      data: { status: 'SUSPENDED' },
    });
    await post(
      path(f.eventId, 'votes'),
      { projectId: f.projectIds[0] },
      f.voter.cookie,
    ).expect(401);
    await post(
      path(f.eventId, `projects/${f.projectIds[0]}/comments`),
      { body: 'denied' },
      f.voter.cookie,
    ).expect(401);
  });

  it('comments are bounded, escaped, visible only on eligible projects, and hide is organizer-only', async () => {
    const f = await fixture();
    const url = path(f.eventId, `projects/${f.projectIds[0]}/comments`);
    await post(url, { body: 'x', status: 'HIDDEN' }, f.voter.cookie).expect(
      400,
    );
    await post(url, { body: 'x'.repeat(2001) }, f.voter.cookie).expect(400);
    const created = await post(
      url,
      { body: '<script>alert(1)</script>' },
      f.voter.cookie,
    ).expect(201);
    expect(created.body.body).toContain('&lt;script&gt;');
    const commentId = created.body.id as string;
    expect((await get(url).expect(200)).body.items).toHaveLength(1);
    await patch(`${url}/${commentId}/hide`, {}, f.voter.cookie).expect(403);
    await patch(`${url}/${commentId}/hide`, {}, f.organizer.cookie).expect(200);
    expect((await get(url).expect(200)).body.items).toHaveLength(0);
    expect(
      await db.auditEvent.count({
        where: { eventId: f.eventId, action: 'PROJECT_COMMENT_HIDDEN' },
      }),
    ).toBe(1);
  });

  it('scopes comment reads and hide IDs to the project and event', async () => {
    const f = await fixture();
    const other = await fixture();
    const source = path(f.eventId, `projects/${f.projectIds[0]}/comments`);
    const comment = await post(
      source,
      { body: 'visible' },
      f.voter.cookie,
    ).expect(201);
    await get(
      path(f.eventId, `projects/${other.projectIds[0]}/comments`),
    ).expect(404);
    await patch(
      path(
        f.eventId,
        `projects/${f.projectIds[1]}/comments/${comment.body.id}/hide`,
      ),
      {},
      f.organizer.cookie,
    ).expect(404);
    await patch(
      path(
        other.eventId,
        `projects/${other.projectIds[0]}/comments/${comment.body.id}/hide`,
      ),
      {},
      other.organizer.cookie,
    ).expect(404);
    expect((await get(source).expect(200)).body.items).toHaveLength(1);
  });

  it('rate limits comment writes durably at the configured boundary', async () => {
    const f = await fixture();
    const url = path(f.eventId, `projects/${f.projectIds[0]}/comments`);
    for (let i = 0; i < 12; i += 1)
      await post(url, { body: `comment ${i}` }, f.voter.cookie).expect(201);
    const denied = await post(url, { body: 'overflow' }, f.voter.cookie).expect(
      429,
    );
    expect(denied.body.message).toMatch(/Retry after \d+ seconds/);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(
      await db.publicWriteBucket.count({
        where: { eventId: f.eventId, action: 'COMMENT' },
      }),
    ).toBe(1);
  });

  it('rate limits vote attempts at six per identity and resets at the next bucket', async () => {
    const f = await fixture();
    const url = path(f.eventId, 'votes');
    for (let i = 0; i < 6; i += 1)
      await post(url, { projectId: randomUUID() }, f.voter.cookie).expect(404);
    const denied = await post(
      url,
      { projectId: f.projectIds[0] },
      f.voter.cookie,
    ).expect(429);
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    now = new Date(now.getTime() + 10 * 60_000);
    await post(url, { projectId: f.projectIds[0] }, f.voter.cookie).expect(201);
  });

  it('flags related fast votes for organizer review without rejecting the second voter', async () => {
    const f = await fixture();
    const independent = await actor('independent');
    const url = path(f.eventId, 'votes');
    await post(url, { projectId: f.projectIds[0] }, f.voter.cookie).expect(201);
    await post(url, { projectId: f.projectIds[1] }, independent.cookie).expect(
      201,
    );
    const audit = await get(
      path(f.eventId, 'audit'),
      f.organizer.cookie,
    ).expect(200);
    expect(
      audit.body.items.some(
        (row: { action: string }) => row.action === 'COMMUNITY_VOTE_FLAGGED',
      ),
    ).toBe(true);
    expect(
      audit.body.items.every(
        (row: { description: string }) => row.description.length > 0,
      ),
    ).toBe(true);
    const firstPage = await get(
      path(f.eventId, 'audit?pageSize=1'),
      f.organizer.cookie,
    ).expect(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toMatch(/^[0-9a-f-]{36}$/);
    const secondPage = await get(
      path(f.eventId, `audit?pageSize=1&cursor=${firstPage.body.nextCursor}`),
      f.organizer.cookie,
    ).expect(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
    await get(path(f.eventId, 'audit'), f.voter.cookie).expect(403);
  });
});
