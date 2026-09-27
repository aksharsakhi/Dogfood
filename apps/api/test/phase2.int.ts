import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
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

const testUrl = process.env.DATABASE_URL ?? '';
if (!testUrl.includes('phase2_test'))
  throw new Error(
    'Phase 2 integration tests require an isolated phase2_test database.',
  );
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID().slice(0, 12);
type Actor = { id: string; email: string; cookie: string };
type HttpResponse = Awaited<ReturnType<ReturnType<typeof request>['get']>>;
let app: NestFastifyApplication;
let now = new Date('2030-01-01T12:00:00.000Z');
const clock = { now: () => now };
const server = () => app.getHttpServer();
const post = (path: string, body: object = {}, cookie?: string) => {
  const q = request(server()).post(path).set('Origin', origin);
  if (cookie) q.set('Cookie', cookie);
  return q.send(body);
};
const patch = (path: string, body: object = {}, cookie?: string) => {
  const q = request(server()).patch(path).set('Origin', origin);
  if (cookie) q.set('Cookie', cookie);
  return q.send(body);
};
const get = (path: string, cookie?: string) => {
  const q = request(server()).get(path);
  if (cookie) q.set('Cookie', cookie);
  return q;
};
const tokenCookie = (res: HttpResponse) => {
  const header = res.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('Expected session cookie');
  return value.split(';')[0]!;
};
const newActor = async (prefix: string): Promise<Actor> => {
  const email = `${prefix}-${unique()}@example.test`;
  const created = await post('/auth/register', {
    email,
    password: 'A secure test password 123!',
    displayName: prefix,
  }).expect(201);
  const login = await post('/auth/login', {
    email,
    password: 'A secure test password 123!',
  }).expect(200);
  return { id: created.body.id as string, email, cookie: tokenCookie(login) };
};
const createEvent = async (actor: Actor, overrides: object = {}) => {
  const res = await post(
    '/events',
    {
      name: 'Phase 2 Test Event',
      slug: `event-${unique()}`,
      visibility: 'PUBLIC',
      minTeamSize: 1,
      maxTeamSize: 2,
      ...overrides,
    },
    actor.cookie,
  ).expect(201);
  return res.body as { id: string; slug: string; status: string };
};
let owner: Actor,
  teamOwner: Actor,
  member: Actor,
  outsider: Actor,
  otherOrganizer: Actor,
  fourth: Actor,
  admin: Actor,
  judge: Actor;
let eventA: { id: string; slug: string; status: string };
let eventB: { id: string; slug: string; status: string };
let teamId = '';
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.listen(0, '127.0.0.1');
  owner = await newActor('owner');
  teamOwner = await newActor('team-owner');
  member = await newActor('member');
  outsider = await newActor('outsider');
  otherOrganizer = await newActor('other-org');
  fourth = await newActor('fourth');
  const adminLogin = await post('/auth/login', {
    email: 'admin@dogfood.local',
    password: 'Dogfood-dev-only!',
  }).expect(200);
  admin = {
    id: adminLogin.body.id as string,
    email: 'admin@dogfood.local',
    cookie: tokenCookie(adminLogin),
  };
  const judgeLogin = await post('/auth/login', {
    email: 'judge1@dogfood.local',
    password: 'Dogfood-dev-only!',
  }).expect(200);
  judge = {
    id: judgeLogin.body.id as string,
    email: 'judge1@dogfood.local',
    cookie: tokenCookie(judgeLogin),
  };
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  await db.$disconnect();
});

describe('authentication and sessions', () => {
  it('registers normalized email without returning a hash and audits registration', async () => {
    const user = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(user.email).toBe(owner.email);
    expect(user.passwordHash).toMatch(/^scrypt\$/);
    const event = await db.auditEvent.findFirst({
      where: { action: 'AUTH_REGISTER', actorUserId: owner.id },
    });
    expect(event).toBeTruthy();
    const me = await get('/auth/me', owner.cookie).expect(200);
    expect(me.body).toEqual({
      id: owner.id,
      email: owner.email,
      displayName: 'owner',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });
  it('rejects duplicate email including case variants', async () => {
    const res = await post('/auth/register', {
      email: owner.email.toUpperCase(),
      password: 'Another secure password 123!',
      displayName: 'duplicate',
    }).expect(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });
  it('uses a generic invalid-credential error for wrong and unknown accounts', async () => {
    const wrong = await post('/auth/login', {
      email: owner.email,
      password: 'wrong',
    }).expect(401);
    const unknown = await post('/auth/login', {
      email: `missing-${unique()}@example.test`,
      password: 'wrong',
    }).expect(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.message).toBe(wrong.body.message);
  });
  it('stores only the hash of a random cookie token', async () => {
    const raw = owner.cookie.split('=')[1]!;
    const session = await db.session.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(raw).digest('hex') },
    });
    expect(session.tokenHash).not.toBe(raw);
    expect(session.expiresAt.getTime()).toBeGreaterThan(now.getTime());
    const response = await get('/auth/me', owner.cookie).expect(200);
    expect(response.headers['x-request-id']).toBeTruthy();
  });
  it('rejects unauthenticated requests and cross-site mutation origins', async () => {
    expect((await get('/auth/me').expect(401)).body.code).toBe(
      'UNAUTHENTICATED',
    );
    expect(
      (
        await request(server())
          .post('/events')
          .set('Origin', 'https://attacker.example')
          .set('Cookie', owner.cookie)
          .send({ name: 'bad', slug: 'bad' })
          .expect(403)
      ).body.code,
    ).toBe('CSRF_REJECTED');
  });
  it('revokes on logout and clears the cookie idempotently', async () => {
    const account = await newActor('logout');
    const first = await post('/auth/logout', {}, account.cookie).expect(204);
    expect(first.headers['set-cookie']).toBeDefined();
    await get('/auth/me', account.cookie).expect(401);
    await post('/auth/logout', {}, account.cookie).expect(204);
    const raw = account.cookie.split('=')[1]!;
    expect(
      (
        await db.session.findUniqueOrThrow({
          where: { tokenHash: createHash('sha256').update(raw).digest('hex') },
        })
      ).revokedAt,
    ).toBeTruthy();
  });
  it('rejects expired sessions and suspended users', async () => {
    const expired = await newActor('expired');
    await db.session.updateMany({
      where: { userId: expired.id },
      data: { expiresAt: new Date(now.getTime() - 1000) },
    });
    await get('/auth/me', expired.cookie).expect(401);
    const suspended = await newActor('suspended');
    await db.user.update({
      where: { id: suspended.id },
      data: { status: 'SUSPENDED' },
    });
    await get('/auth/me', suspended.cookie).expect(401);
    await post('/auth/login', {
      email: suspended.email,
      password: 'A secure test password 123!',
    }).expect(401);
  });
});

describe('events and event authorization', () => {
  it('creates events with organizer membership and audit atomically', async () => {
    await post('/events', { name: 'No auth', slug: `none-${unique()}` }).expect(
      401,
    );
    eventA = await createEvent(owner, {
      registrationOpensAt: '2029-12-31T00:00:00.000Z',
      registrationClosesAt: '2030-02-01T00:00:00.000Z',
    });
    eventB = await createEvent(otherOrganizer);
    expect(
      await db.eventMembership.findUnique({
        where: {
          eventId_userId_role: {
            eventId: eventA.id,
            userId: owner.id,
            role: 'ORGANIZER',
          },
        },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(
      await db.auditEvent.count({
        where: { action: 'EVENT_CREATED', eventId: eventA.id },
      }),
    ).toBe(1);
    expect(
      (
        await get(`/events/${eventA.id}/memberships/me`, owner.cookie).expect(
          200,
        )
      ).body,
    ).toEqual([{ role: 'ORGANIZER', status: 'ACTIVE' }]);
    await get(`/events/${eventA.id}/memberships`, member.cookie).expect(403);
    const memberships = await get(
      `/events/${eventA.id}/memberships`,
      owner.cookie,
    ).expect(200);
    expect(memberships.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'ORGANIZER',
          user: expect.objectContaining({ id: owner.id }),
        }),
      ]),
    );
  });
  it('rejects invalid windows and forbidden mass assignment', async () => {
    const bad = await post(
      '/events',
      {
        name: 'Bad',
        slug: `bad-${unique()}`,
        registrationOpensAt: '2030-02-01T00:00:00Z',
        registrationClosesAt: '2030-01-01T00:00:00Z',
      },
      owner.cookie,
    ).expect(400);
    expect(bad.body.code).toBe('INVALID_EVENT_WINDOW');
    expect(
      (
        await patch(
          `/events/${eventA.id}`,
          { createdById: outsider.id },
          owner.cookie,
        ).expect(400)
      ).body.code,
    ).toBe('VALIDATION_ERROR');
    await patch(
      `/events/${eventA.id}`,
      { status: 'COMPLETED' },
      owner.cookie,
    ).expect(400);
  });
  it('enforces organizer, judge, participant, and admin boundaries', async () => {
    await patch(
      `/events/${eventA.id}`,
      { name: 'Unrelated' },
      otherOrganizer.cookie,
    ).expect(403);
    await patch(`/events/${eventA.id}`, { name: 'Judge' }, judge.cookie).expect(
      403,
    );
    await patch(
      `/events/${eventA.id}`,
      { name: 'Participant' },
      member.cookie,
    ).expect(403);
    await patch(
      `/events/${eventA.id}`,
      { name: 'Admin edit' },
      admin.cookie,
    ).expect(200);
    await patch(
      `/events/${eventA.id}`,
      { name: 'Owner edit' },
      owner.cookie,
    ).expect(200);
    expect(
      await db.auditEvent.count({
        where: { action: 'EVENT_UPDATED', eventId: eventA.id },
      }),
    ).toBe(2);
  });
  it('hides private events and lists only public discoverable events', async () => {
    const privateEvent = await createEvent(owner, { visibility: 'PRIVATE' });
    await post(`/events/${privateEvent.id}/publish`, {}, owner.cookie).expect(
      201,
    );
    await get(`/events/${privateEvent.id}`).expect(404);
    await get(`/events/${privateEvent.id}`, owner.cookie).expect(200);
    const publicList = await get('/events').expect(200);
    expect(
      (publicList.body as Array<{ id: string }>).some(
        (e) => e.id === privateEvent.id,
      ),
    ).toBe(false);
    const unlisted = await createEvent(owner, { visibility: 'UNLISTED' });
    await post(`/events/${unlisted.id}/publish`, {}, owner.cookie).expect(201);
    await get(`/events/${unlisted.id}`).expect(200);
    const nextList = await get('/events').expect(200);
    expect(
      (nextList.body as Array<{ id: string }>).some(
        (e) => e.id === unlisted.id,
      ),
    ).toBe(false);
  });
  it('scopes tracks and prizes to their event and publishes once', async () => {
    const track = await post(
      `/events/${eventA.id}/tracks`,
      { name: 'Build', slug: `build-${unique()}` },
      owner.cookie,
    ).expect(201);
    await post(
      `/events/${eventB.id}/prizes`,
      { name: 'Wrong track', trackId: track.body.id },
      otherOrganizer.cookie,
    ).expect(400);
    await patch(
      `/events/${eventA.id}/tracks/${track.body.id}`,
      { name: 'Other event' },
      otherOrganizer.cookie,
    ).expect(403);
    const prize = await post(
      `/events/${eventA.id}/prizes`,
      {
        name: 'First',
        trackId: track.body.id,
        amount: '1000.00',
        currency: 'USD',
      },
      owner.cookie,
    ).expect(201);
    expect(prize.body.trackId).toBe(track.body.id);
    await post(`/events/${eventA.id}/publish`, {}, owner.cookie).expect(201);
    expect(
      (await post(`/events/${eventA.id}/publish`, {}, owner.cookie).expect(409))
        .body.code,
    ).toBe('INVALID_STATE_TRANSITION');
    await get(`/events/${eventA.id}`).expect(200);
    expect(
      await db.auditEvent.count({
        where: { action: 'EVENT_PUBLISHED', eventId: eventA.id },
      }),
    ).toBe(1);
  });
});

describe('registration', () => {
  it('does not let suspended participants restore their own role or manage a team', async () => {
    const candidate = await newActor('suspended-participant');
    await post(
      `/events/${eventA.id}/registrations`,
      {},
      candidate.cookie,
    ).expect(201);
    const team = await post(
      `/events/${eventA.id}/teams`,
      { name: 'Suspension test', slug: `suspended-${unique()}` },
      candidate.cookie,
    ).expect(201);
    await db.eventMembership.update({
      where: {
        eventId_userId_role: {
          eventId: eventA.id,
          userId: candidate.id,
          role: 'PARTICIPANT',
        },
      },
      data: { status: 'SUSPENDED' },
    });
    await get(
      `/events/${eventA.id}/teams/${team.body.id}`,
      candidate.cookie,
    ).expect(403);
    await patch(
      `/events/${eventA.id}/teams/${team.body.id}`,
      { name: 'Bypass' },
      candidate.cookie,
    ).expect(403);
    await db.registration.update({
      where: { eventId_userId: { eventId: eventA.id, userId: candidate.id } },
      data: { status: 'WITHDRAWN', withdrawnAt: now },
    });
    await post(
      `/events/${eventA.id}/registrations`,
      {},
      candidate.cookie,
    ).expect(403);
  });
  it('serializes simultaneous conflicting role creation', async () => {
    const candidate = await newActor('role-race');
    const results = await Promise.allSettled(
      ['PARTICIPANT', 'JUDGE'].map((role) =>
        db.eventMembership.create({
          data: {
            eventId: eventA.id,
            userId: candidate.id,
            role: role as 'PARTICIPANT' | 'JUDGE',
          },
        }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(
      await db.eventMembership.count({
        where: { eventId: eventA.id, userId: candidate.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });
  it('approves registration and active participant role in one transaction', async () => {
    const organizerConflict = await post(
      `/events/${eventA.id}/registrations`,
      {},
      owner.cookie,
    ).expect(409);
    expect(organizerConflict.body.code).toBe('ROLE_CONFLICT');
    const res = await post(
      `/events/${eventA.id}/registrations`,
      {},
      teamOwner.cookie,
    ).expect(201);
    expect(res.body.status).toBe('APPROVED');
    await expect(
      db.eventMembership.create({
        data: { eventId: eventA.id, userId: teamOwner.id, role: 'JUDGE' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      db.eventMembership.create({
        data: { eventId: eventA.id, userId: owner.id, role: 'JUDGE' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await post(
      `/events/${eventA.id}/registrations`,
      {},
      otherOrganizer.cookie,
    ).expect(201);
    expect(
      await db.eventMembership.findUnique({
        where: {
          eventId_userId_role: {
            eventId: eventA.id,
            userId: teamOwner.id,
            role: 'PARTICIPANT',
          },
        },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
    await post(
      `/events/${eventA.id}/registrations`,
      {},
      teamOwner.cookie,
    ).expect(409);
    expect(
      await db.auditEvent.count({
        where: {
          action: 'REGISTRATION_CREATED',
          eventId: eventA.id,
          actorUserId: teamOwner.id,
        },
      }),
    ).toBe(1);
  });
  it('enforces opening and closing time with injected clock', async () => {
    const timed = await createEvent(owner, {
      registrationOpensAt: '2030-01-02T00:00:00Z',
      registrationClosesAt: '2030-01-03T00:00:00Z',
    });
    await post(`/events/${timed.id}/publish`, {}, owner.cookie).expect(201);
    await post(`/events/${timed.id}/registrations`, {}, outsider.cookie).expect(
      409,
    );
    now = new Date('2030-01-02T12:00:00Z');
    await post(`/events/${timed.id}/registrations`, {}, outsider.cookie).expect(
      201,
    );
    now = new Date('2030-01-03T00:00:00Z');
    await post(`/events/${timed.id}/registrations`, {}, fourth.cookie).expect(
      409,
    );
    now = new Date('2030-01-01T12:00:00Z');
  });
  it('restricts registration lists and supports withdrawal/re-entry', async () => {
    await get(`/events/${eventA.id}/registrations`, owner.cookie).expect(200);
    await get(`/events/${eventA.id}/registrations`, member.cookie).expect(403);
    await get(
      `/events/${eventA.id}/registrations`,
      otherOrganizer.cookie,
    ).expect(403);
    await post(
      `/events/${eventA.id}/registrations/withdraw`,
      {},
      teamOwner.cookie,
    ).expect(201);
    expect(
      await db.eventMembership.findUnique({
        where: {
          eventId_userId_role: {
            eventId: eventA.id,
            userId: teamOwner.id,
            role: 'PARTICIPANT',
          },
        },
      }),
    ).toMatchObject({ status: 'REVOKED' });
    await post(
      `/events/${eventA.id}/registrations`,
      {},
      teamOwner.cookie,
    ).expect(201);
    expect(
      await db.eventMembership.findUnique({
        where: {
          eventId_userId_role: {
            eventId: eventA.id,
            userId: teamOwner.id,
            role: 'PARTICIPANT',
          },
        },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('teams and invitations', () => {
  it('creates an owned team and rejects a second active team', async () => {
    const team = await post(
      `/events/${eventA.id}/teams`,
      { name: 'Builders', slug: `builders-${unique()}` },
      teamOwner.cookie,
    ).expect(201);
    teamId = team.body.id as string;
    expect(
      await db.teamMember.findFirst({
        where: { teamId, userId: teamOwner.id, leftAt: null },
      }),
    ).toMatchObject({ role: 'OWNER' });
    await post(
      `/events/${eventA.id}/teams`,
      { name: 'Other', slug: `other-${unique()}` },
      teamOwner.cookie,
    ).expect(409);
    await post(
      `/events/${eventA.id}/teams`,
      { name: 'Unauthorized', slug: `unauth-${unique()}` },
      member.cookie,
    ).expect(403);
    await get(`/events/${eventA.id}/teams/${teamId}`, outsider.cookie).expect(
      403,
    );
    expect(
      await db.auditEvent.count({
        where: { action: 'TEAM_CREATED', entityId: teamId },
      }),
    ).toBe(1);
  });
  it('invites with a hashed token and rejects wrong recipients', async () => {
    await post(`/events/${eventA.id}/registrations`, {}, member.cookie).expect(
      201,
    );
    const invitation = await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: member.email },
      teamOwner.cookie,
    ).expect(201);
    const raw = invitation.body.token as string;
    const saved = await db.teamInvitation.findUniqueOrThrow({
      where: { id: invitation.body.id as string },
    });
    expect(saved.tokenHash).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
    expect(JSON.stringify(saved)).not.toContain(raw);
    const preview = await get(`/team-invitations/${raw}`, member.cookie).expect(
      200,
    );
    expect(preview.body).toMatchObject({
      team: { id: teamId },
      event: { id: eventA.id },
    });
    expect(JSON.stringify(preview.body)).not.toMatch(
      /email|tokenHash|createdById/i,
    );
    await get(`/team-invitations/${raw}`, outsider.cookie).expect(403);
    await post(
      '/team-invitations/accept',
      { token: raw },
      outsider.cookie,
    ).expect(403);
    await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: outsider.email },
      member.cookie,
    ).expect(403);
    await post(
      '/team-invitations/accept',
      { token: raw },
      member.cookie,
    ).expect(200);
    await post(
      '/team-invitations/accept',
      { token: raw },
      member.cookie,
    ).expect(409);
    expect(await db.teamMember.count({ where: { teamId, leftAt: null } })).toBe(
      2,
    );
    expect(
      await db.auditEvent.count({
        where: { action: 'TEAM_INVITATION_ACCEPTED', entityId: saved.id },
      }),
    ).toBe(1);
  });
  it('blocks member management, outsider access, owner exit, and withdrawal while on a team', async () => {
    await patch(
      `/events/${eventA.id}/teams/${teamId}`,
      { name: 'Hijack' },
      member.cookie,
    ).expect(403);
    await patch(
      `/events/${eventA.id}/teams/${teamId}`,
      { name: 'Hijack' },
      outsider.cookie,
    ).expect(403);
    await post(
      `/events/${eventA.id}/teams/${teamId}/leave`,
      {},
      teamOwner.cookie,
    ).expect(409);
    await post(
      `/events/${eventA.id}/registrations/withdraw`,
      {},
      member.cookie,
    ).expect(409);
    await patch(
      `/events/${eventA.id}/teams/${teamId}`,
      { name: 'Renamed' },
      teamOwner.cookie,
    ).expect(200);
  });
  it('allows a member to participate in another event independently', async () => {
    await post(
      `/events/${eventB.id}/publish`,
      {},
      otherOrganizer.cookie,
    ).expect(201);
    await post(`/events/${eventB.id}/registrations`, {}, member.cookie).expect(
      201,
    );
    await post(
      `/events/${eventB.id}/teams`,
      { name: 'Cross-event', slug: `cross-${unique()}` },
      member.cookie,
    ).expect(201);
    expect(
      await db.teamMember.count({ where: { userId: member.id, leftAt: null } }),
    ).toBe(2);
  });
  it('enforces team capacity and expiry/revocation/rejection', async () => {
    await post(
      `/events/${eventA.id}/registrations`,
      {},
      outsider.cookie,
    ).expect(201);
    const full = await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: outsider.email },
      teamOwner.cookie,
    ).expect(409);
    expect(full.body.code).toBe('TEAM_FULL');
    await post(
      `/events/${eventA.id}/teams/${teamId}/members/${member.id}/remove`,
      {},
      teamOwner.cookie,
    ).expect(204);
    const invitation = await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: outsider.email },
      teamOwner.cookie,
    ).expect(201);
    await db.teamInvitation.update({
      where: { id: invitation.body.id as string },
      data: { expiresAt: new Date(now.getTime() - 1000) },
    });
    await post(
      '/team-invitations/accept',
      { token: invitation.body.token },
      outsider.cookie,
    ).expect(409);
    const valid = await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: fourth.email },
      teamOwner.cookie,
    ).expect(201);
    await post(
      `/events/${eventA.id}/teams/${teamId}/invitations/${valid.body.id}/revoke`,
      {},
      teamOwner.cookie,
    ).expect(204);
    await post(
      '/team-invitations/accept',
      { token: valid.body.token },
      fourth.cookie,
    ).expect(409);
    const reject = await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: member.email },
      teamOwner.cookie,
    ).expect(201);
    await post(
      '/team-invitations/reject',
      { token: reject.body.token },
      member.cookie,
    ).expect(200);
    await post(
      '/team-invitations/accept',
      { token: reject.body.token },
      member.cookie,
    ).expect(409);
  });
  it('allows departed members to join again, but disbands a sole-owner team', async () => {
    const rejoin = await post(
      `/events/${eventA.id}/teams/${teamId}/invitations`,
      { email: member.email },
      teamOwner.cookie,
    ).expect(201);
    await post(
      '/team-invitations/accept',
      { token: rejoin.body.token },
      member.cookie,
    ).expect(200);
    await post(
      `/events/${eventA.id}/teams/${teamId}/leave`,
      {},
      member.cookie,
    ).expect(204);
    expect(
      await db.teamMember.findFirst({ where: { teamId, userId: member.id } }),
    ).toMatchObject({ leftAt: expect.any(Date) });
    await post(
      `/events/${eventA.id}/teams/${teamId}/leave`,
      {},
      teamOwner.cookie,
    ).expect(204);
    expect(
      await db.team.findUniqueOrThrow({ where: { id: teamId } }),
    ).toMatchObject({ status: 'DISBANDED' });
    expect(
      await db.auditEvent.count({
        where: { action: 'TEAM_DISBANDED', entityId: teamId },
      }),
    ).toBe(1);
  });
  it('serializes competing acceptances for the final slot', async () => {
    const raceTeam = await post(
      `/events/${eventA.id}/teams`,
      { name: 'Race', slug: `race-${unique()}` },
      teamOwner.cookie,
    ).expect(201);
    const a = await post(
      `/events/${eventA.id}/teams/${raceTeam.body.id}/invitations`,
      { email: outsider.email },
      teamOwner.cookie,
    ).expect(201);
    await post(`/events/${eventA.id}/registrations`, {}, fourth.cookie).expect(
      201,
    );
    const b = await post(
      `/events/${eventA.id}/teams/${raceTeam.body.id}/invitations`,
      { email: fourth.email },
      teamOwner.cookie,
    ).expect(201);
    const results = await Promise.all([
      post(
        '/team-invitations/accept',
        { token: a.body.token },
        outsider.cookie,
      ),
      post('/team-invitations/accept', { token: b.body.token }, fourth.cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await db.teamMember.count({
        where: { teamId: raceTeam.body.id as string, leftAt: null },
      }),
    ).toBe(2);
  });
});

describe('audit boundaries', () => {
  it('never records raw session or invitation tokens or password hashes', async () => {
    const rows = await db.auditEvent.findMany({
      where: { actorUserId: teamOwner.id },
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(teamOwner.cookie.split('=')[1]!);
    const user = await db.user.findUniqueOrThrow({
      where: { id: teamOwner.id },
    });
    expect(text).not.toContain(user.passwordHash);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'AUTH_REGISTER',
        'AUTH_LOGIN_SUCCESS',
        'REGISTRATION_CREATED',
        'TEAM_CREATED',
      ]),
    );
  });
});
