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
  throw new Error(
    'Phase 3 integration tests require an isolated test database.',
  );
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID().slice(0, 12);
let now = new Date('2030-01-02T12:00:00Z');
let app: NestFastifyApplication;
const server = () => app.getHttpServer();
const post = (path: string, body: object = {}, cookie?: string) => {
  const q = request(server()).post(path).set('Origin', origin);
  if (cookie) q.set('Cookie', cookie);
  return q.send(body);
};
const patch = (path: string, body: object, cookie?: string) => {
  const q = request(server()).patch(path).set('Origin', origin);
  if (cookie) q.set('Cookie', cookie);
  return q.send(body);
};
const get = (path: string, cookie?: string) => {
  const q = request(server()).get(path);
  if (cookie) q.set('Cookie', cookie);
  return q;
};
type Actor = { id: string; email: string; cookie: string };
async function actor(prefix: string): Promise<Actor> {
  const email = `${prefix}-${unique()}@example.test`;
  const created = await post('/auth/register', {
    email,
    displayName: prefix,
    password: 'A secure test password 123!',
  }).expect(201);
  const login = await post('/auth/login', {
    email,
    password: 'A secure test password 123!',
  }).expect(200);
  const header = login.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') throw new Error('Expected session cookie');
  return {
    id: created.body.id as string,
    email,
    cookie: value.split(';')[0]!,
  };
}
async function event(owner: Actor, visibility = 'PUBLIC', minTeamSize = 1) {
  const result = await post(
    '/events',
    {
      name: 'Phase 3 Event',
      slug: `p3-${unique()}`,
      visibility,
      galleryVisibility: 'PUBLIC',
      minTeamSize,
      maxTeamSize: 3,
      submissionOpensAt: '2030-01-02T00:00:00Z',
      submissionClosesAt: '2030-01-03T00:00:00Z',
    },
    owner.cookie,
  ).expect(201);
  await post(`/events/${result.body.id}/publish`, {}, owner.cookie).expect(201);
  return result.body.id as string;
}
async function team(owner: Actor, eventId: string) {
  await post(`/events/${eventId}/registrations`, {}, owner.cookie).expect(201);
  const result = await post(
    `/events/${eventId}/teams`,
    { name: 'Builders', slug: `builders-${unique()}` },
    owner.cookie,
  ).expect(201);
  return result.body.id as string;
}
const draftBody = (title: string) => ({
  title,
  description: `${title} description`,
  repositoryUrl: 'https://example.test/repo',
});
const projectPath = (eventId: string, projectId: string) =>
  `/events/${eventId}/projects/${projectId}`;

let owner: Actor, organizer: Actor, member: Actor, outsider: Actor;
let eventId: string, teamId: string, projectId: string, trackId: string;
let privateEventId: string, privateProjectId: string;

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
  owner = await actor('project-owner');
  organizer = await actor('event-organizer');
  member = await actor('project-member');
  outsider = await actor('project-outsider');
  eventId = await event(organizer);
  teamId = await team(owner, eventId);
  await post(`/events/${eventId}/registrations`, {}, member.cookie).expect(201);
  const invitation = await post(
    `/events/${eventId}/teams/${teamId}/invitations`,
    { email: member.email },
    owner.cookie,
  ).expect(201);
  await post(
    '/team-invitations/accept',
    { token: invitation.body.token },
    member.cookie,
  ).expect(200);
  const track = await post(
    `/events/${eventId}/tracks`,
    { name: 'Apps', slug: `apps-${unique()}` },
    organizer.cookie,
  ).expect(201);
  trackId = track.body.id as string;
  privateEventId = await event(organizer, 'PRIVATE');
  await db.eventMembership.create({
    data: { eventId: privateEventId, userId: owner.id, role: 'PARTICIPANT' },
  });
  const privateTeam = await post(
    `/events/${privateEventId}/teams`,
    { name: 'Hidden', slug: `hidden-${unique()}` },
    owner.cookie,
  ).expect(201);
  const privateProject = await post(
    `/events/${privateEventId}/projects`,
    { teamId: privateTeam.body.id, name: 'Hidden', slug: `hidden-${unique()}` },
    owner.cookie,
  ).expect(201);
  privateProjectId = privateProject.body.id as string;
  const hiddenDraft = await post(
    `${projectPath(privateEventId, privateProjectId)}/submissions`,
    draftBody('Secret'),
    owner.cookie,
  ).expect(201);
  await post(
    `${projectPath(privateEventId, privateProjectId)}/submissions/${hiddenDraft.body.id}/submit`,
    {},
    owner.cookie,
  ).expect(201);
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  await db.$disconnect();
});

describe('project ownership and integrity', () => {
  it('rejects malformed and unsafe project URLs with a structured client error', async () => {
    const path = `/events/${eventId}/projects`;
    const malformed = await post(
      path,
      {
        teamId,
        name: 'Bad URL',
        slug: `bad-url-${unique()}`,
        repositoryUrl: 'https://?x',
      },
      owner.cookie,
    ).expect(400);
    expect(malformed.body.code).toBe('INVALID_URL');
    const unsafe = await post(
      path,
      {
        teamId,
        name: 'Unsafe URL',
        slug: `unsafe-url-${unique()}`,
        demoUrl: 'javascript:alert(1)',
      },
      owner.cookie,
    ).expect(400);
    expect(unsafe.body.code).toBe('VALIDATION_ERROR');
  });
  it('allows an active member to create and edit a scoped project', async () => {
    const created = await post(
      `/events/${eventId}/projects`,
      {
        teamId,
        trackId,
        name: 'Public App',
        slug: `public-${unique()}`,
        tagline: 'A public project',
      },
      member.cookie,
    ).expect(201);
    projectId = created.body.id as string;
    const updated = await patch(
      projectPath(eventId, projectId),
      { name: 'Public App Updated' },
      owner.cookie,
    ).expect(200);
    expect(updated.body.name).toBe('Public App Updated');
    expect(
      (await get(`/events/${eventId}/projects/me`, member.cookie).expect(200))
        .body,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: projectId })]),
    );
    expect(
      await db.auditEvent.count({
        where: { action: 'PROJECT_CREATED', entityId: projectId },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({
        where: { action: 'PROJECT_UPDATED', entityId: projectId },
      }),
    ).toBe(1);
  });
  it('rejects unauthenticated, unrelated, cross-event, and mass-assignment mutations', async () => {
    await post(`/events/${eventId}/projects`, {
      teamId,
      name: 'No auth',
      slug: `no-${unique()}`,
    }).expect(401);
    await patch(
      projectPath(eventId, projectId),
      { name: 'Hijack' },
      outsider.cookie,
    ).expect(403);
    await get(projectPath(eventId, projectId), outsider.cookie).expect(403);
    await patch(
      projectPath(privateEventId, projectId),
      { name: 'Cross event' },
      owner.cookie,
    ).expect(404);
    await post(
      `/events/${eventId}/projects`,
      {
        teamId: privateProjectId,
        name: 'Cross team',
        slug: `cross-${unique()}`,
      },
      owner.cookie,
    ).expect(404);
    await post(
      `/events/${eventId}/projects`,
      {
        teamId,
        trackId: privateProjectId,
        name: 'Wrong track',
        slug: `wrong-${unique()}`,
      },
      owner.cookie,
    ).expect(400);
    await patch(
      projectPath(eventId, projectId),
      { teamId: privateProjectId },
      owner.cookie,
    ).expect(400);
    await patch(
      projectPath(eventId, projectId),
      { eventId: privateEventId },
      owner.cookie,
    ).expect(400);
  });
  it('rejects duplicate event slugs and an unrelated team', async () => {
    const slug = `duplicate-${unique()}`;
    await post(
      `/events/${eventId}/projects`,
      { teamId, name: 'First', slug },
      owner.cookie,
    ).expect(201);
    await post(
      `/events/${eventId}/projects`,
      { teamId, name: 'Second', slug },
      owner.cookie,
    ).expect(409);
    const other = await actor('other-team');
    const otherTeam = await team(other, eventId);
    await post(
      `/events/${eventId}/projects`,
      { teamId: otherTeam, name: 'No', slug: `no-${unique()}` },
      owner.cookie,
    ).expect(403);
  });
});

describe('versioned submissions and deadlines', () => {
  it('rejects draft creation before opening and allows it at opening', async () => {
    now = new Date('2030-01-01T23:59:59Z');
    await post(
      `${projectPath(eventId, projectId)}/submissions`,
      draftBody('Early'),
      owner.cookie,
    ).expect(409);
    now = new Date('2030-01-02T00:00:00Z');
    const created = await post(
      `${projectPath(eventId, projectId)}/submissions`,
      draftBody('Version one'),
      owner.cookie,
    ).expect(201);
    expect(created.body).toMatchObject({ version: 1, status: 'DRAFT' });
    await post(
      `${projectPath(eventId, projectId)}/submissions`,
      draftBody('No auth'),
    ).expect(401);
    await patch(
      `${projectPath(eventId, projectId)}/submissions/${created.body.id}`,
      { title: 'Outsider' },
      outsider.cookie,
    ).expect(403);
    await patch(
      `${projectPath(eventId, projectId)}/submissions/${created.body.id}`,
      { title: 'Version one edited' },
      member.cookie,
    ).expect(200);
    expect(
      await db.auditEvent.count({
        where: {
          action: 'SUBMISSION_DRAFT_UPDATED',
          entityId: created.body.id,
        },
      }),
    ).toBe(1);
  });
  it('preserves submitted snapshots and selects the latest submitted over a higher draft', async () => {
    const base = projectPath(eventId, projectId);
    const v1 = (await get(`${base}/submissions`, owner.cookie).expect(200))
      .body[0];
    await post(`${base}/submissions/${v1.id}/submit`, {}, owner.cookie).expect(
      201,
    );
    await patch(
      `${base}/submissions/${v1.id}`,
      { title: 'Tampered' },
      owner.cookie,
    ).expect(409);
    const v2 = await post(
      `${base}/submissions`,
      draftBody('Version two'),
      owner.cookie,
    ).expect(201);
    await patch(
      `${base}/submissions/${v2.body.id}`,
      { description: 'Version two edited' },
      owner.cookie,
    ).expect(200);
    await post(
      `${base}/submissions/${v2.body.id}/submit`,
      {},
      owner.cookie,
    ).expect(201);
    const v3 = await post(
      `${base}/submissions`,
      draftBody('Unsubmitted version three'),
      owner.cookie,
    ).expect(201);
    expect(v3.body.version).toBe(3);
    const latest = await get(`${base}/submissions/latest`, owner.cookie).expect(
      200,
    );
    expect(latest.body.id).toBe(v2.body.id);
    const history = await get(`${base}/submissions`, owner.cookie).expect(200);
    expect(history.body.map((s: { status: string }) => s.status)).toEqual([
      'SUBMITTED',
      'SUBMITTED',
      'DRAFT',
    ]);
    expect(history.body[0].title).toBe('Version one edited');
    expect(history.body[1].description).toBe('Version two edited');
    await expect(
      db.submission.update({
        where: { id: v1.id },
        data: { title: 'Database tamper' },
      }),
    ).rejects.toThrow();
  });
  it('locks mutation at the exact close boundary and after it', async () => {
    const base = projectPath(eventId, projectId);
    const v3 = (await get(`${base}/submissions`, owner.cookie).expect(200))
      .body[2];
    now = new Date('2030-01-03T00:00:00Z');
    await patch(
      `${base}/submissions/${v3.id}`,
      { title: 'Too late' },
      owner.cookie,
    ).expect(409);
    await post(`${base}/submissions/${v3.id}/submit`, {}, owner.cookie).expect(
      409,
    );
    await post(
      `${base}/submissions`,
      draftBody('Too late'),
      owner.cookie,
    ).expect(409);
    await patch(base, { name: 'Too late' }, owner.cookie).expect(409);
    now = new Date('2030-01-03T00:00:01Z');
    await post(`${base}/submissions/${v3.id}/submit`, {}, owner.cookie).expect(
      409,
    );
    expect(
      (await get(`${base}/submissions/latest`, owner.cookie).expect(200)).body
        .version,
    ).toBe(2);
    now = new Date('2030-01-02T12:00:00Z');
  });
  it('rejects departed members immediately', async () => {
    const freshOwner = await actor('departure-owner');
    const freshMember = await actor('departure-member');
    const freshTeam = await team(freshOwner, eventId);
    await post(
      `/events/${eventId}/registrations`,
      {},
      freshMember.cookie,
    ).expect(201);
    const invitation = await post(
      `/events/${eventId}/teams/${freshTeam}/invitations`,
      { email: freshMember.email },
      freshOwner.cookie,
    ).expect(201);
    await post(
      '/team-invitations/accept',
      { token: invitation.body.token },
      freshMember.cookie,
    ).expect(200);
    const freshProject = await post(
      `/events/${eventId}/projects`,
      { teamId: freshTeam, name: 'Departure', slug: `departure-${unique()}` },
      freshMember.cookie,
    ).expect(201);
    await post(
      `/events/${eventId}/teams/${freshTeam}/leave`,
      {},
      freshMember.cookie,
    ).expect(204);
    await patch(
      projectPath(eventId, freshProject.body.id),
      { name: 'Former member' },
      freshMember.cookie,
    ).expect(403);
    await post(
      `${projectPath(eventId, freshProject.body.id)}/submissions`,
      draftBody('Former member'),
      freshMember.cookie,
    ).expect(403);
    await db.eventMembership.update({
      where: {
        eventId_userId_role: {
          eventId,
          userId: freshOwner.id,
          role: 'PARTICIPANT',
        },
      },
      data: { status: 'REVOKED' },
    });
    await get(
      projectPath(eventId, freshProject.body.id),
      freshOwner.cookie,
    ).expect(403);
    await patch(
      projectPath(eventId, freshProject.body.id),
      { name: 'Revoked participant' },
      freshOwner.cookie,
    ).expect(403);
  });
});

describe('concurrent operations', () => {
  let concurrentProject = '';
  beforeAll(async () => {
    concurrentProject = (
      await post(
        `/events/${eventId}/projects`,
        { teamId, name: 'Concurrent', slug: `concurrent-${unique()}` },
        owner.cookie,
      ).expect(201)
    ).body.id as string;
  });
  it('serializes simultaneous next-version creation', async () => {
    const base = projectPath(eventId, concurrentProject);
    const results = await Promise.all([
      post(`${base}/submissions`, draftBody('A'), owner.cookie),
      post(`${base}/submissions`, draftBody('B'), owner.cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await get(`${base}/submissions`, owner.cookie).expect(200)).body.map(
        (s: { version: number }) => s.version,
      ),
    ).toEqual([1]);
  });
  it('accepts only one simultaneous submit for the same draft', async () => {
    const base = projectPath(eventId, concurrentProject);
    const draft = (await get(`${base}/submissions`, owner.cookie).expect(200))
      .body[0];
    const results = await Promise.all([
      post(`${base}/submissions/${draft.id}/submit`, {}, owner.cookie),
      post(`${base}/submissions/${draft.id}/submit`, {}, owner.cookie),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await db.auditEvent.count({
        where: { action: 'SUBMISSION_SUBMITTED', entityId: draft.id },
      }),
    ).toBe(1);
  });
  it('serializes concurrent replacement-version creation and submission', async () => {
    const base = projectPath(eventId, concurrentProject);
    const created = await Promise.all([
      post(`${base}/submissions`, draftBody('Replacement A'), owner.cookie),
      post(`${base}/submissions`, draftBody('Replacement B'), owner.cookie),
    ]);
    expect(created.map((r) => r.status).sort()).toEqual([201, 409]);
    const draft = created.find((r) => r.status === 201)!.body;
    const submitted = await Promise.all([
      post(`${base}/submissions/${draft.id}/submit`, {}, owner.cookie),
      post(
        `${base}/submissions`,
        draftBody('Another replacement'),
        owner.cookie,
      ),
    ]);
    expect(submitted[0]!.status).toBe(201);
    expect([201, 409]).toContain(submitted[1]!.status);
    const history = (await get(`${base}/submissions`, owner.cookie).expect(200))
      .body as Array<{ version: number; status: string }>;
    expect(history.map((s) => s.version)).toEqual(
      submitted[1]!.status === 201 ? [1, 2, 3] : [1, 2],
    );
    expect(history[1]!.status).toBe('SUBMITTED');
    if (history[2]) expect(history[2].status).toBe('DRAFT');
    expect(
      (await get(`${base}/submissions/latest`, owner.cookie).expect(200)).body
        .version,
    ).toBe(2);
  });
  it('rejects a submit that waits on a lock until the close boundary', async () => {
    const project = await post(
      `/events/${eventId}/projects`,
      {
        teamId,
        name: 'Deadline race',
        slug: `deadline-race-${unique()}`,
      },
      owner.cookie,
    ).expect(201);
    const base = projectPath(eventId, project.body.id);
    const draft = await post(
      `${base}/submissions`,
      draftBody('Deadline race'),
      owner.cookie,
    ).expect(201);
    let release!: () => void;
    let locked!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.body.id}::uuid FOR UPDATE`;
      locked();
      await blocker;
    });
    await ready;
    try {
      const pending = post(
        `${base}/submissions/${draft.body.id}/submit`,
        {},
        owner.cookie,
      ).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 100));
      now = new Date('2030-01-03T00:00:00Z');
      release();
      await hold;
      expect((await pending).status).toBe(409);
      expect(
        (
          await db.submission.findUniqueOrThrow({
            where: { id: draft.body.id as string },
          })
        ).status,
      ).toBe('DRAFT');
      expect(
        await db.auditEvent.count({
          where: {
            action: 'SUBMISSION_SUBMITTED',
            entityId: draft.body.id as string,
          },
        }),
      ).toBe(0);
    } finally {
      release();
      now = new Date('2030-01-02T12:00:00Z');
    }
  });
});

describe('public gallery', () => {
  it('obeys gallery publication independently of public event visibility', async () => {
    await patch(
      `/events/${eventId}`,
      { galleryVisibility: 'HIDDEN' },
      organizer.cookie,
    ).expect(200);
    await get(`/events/${eventId}`).expect(200);
    await get(`/events/${eventId}/gallery`).expect(404);
    await get(`/events/${eventId}/gallery/${projectId}`).expect(404);
    await patch(
      `/events/${eventId}`,
      { galleryVisibility: 'AFTER_SUBMISSIONS_CLOSE' },
      organizer.cookie,
    ).expect(200);
    await get(`/events/${eventId}/gallery`).expect(404);
    now = new Date('2030-01-03T00:00:00Z');
    try {
      await get(`/events/${eventId}/gallery`).expect(200);
      await get(`/events/${eventId}/gallery/${projectId}`).expect(200);
    } finally {
      now = new Date('2030-01-02T12:00:00Z');
    }
    await patch(
      `/events/${eventId}`,
      { galleryVisibility: 'PUBLIC' },
      organizer.cookie,
    ).expect(200);
    await get(`/events/${eventId}/gallery`).expect(200);
  });
  it('uses the latest submitted version and excludes drafts and private events', async () => {
    const list = await get(`/events/${eventId}/gallery`).expect(200);
    const item = list.body.items.find(
      (p: { id: string }) => p.id === projectId,
    );
    expect(item).toMatchObject({ version: 2, title: 'Version two', trackId });
    expect(JSON.stringify(item)).not.toMatch(
      /email|password|tokenHash|auditEvent|createdById/i,
    );
    await get(`/events/${privateEventId}/gallery`).expect(404);
    await get(`/events/${privateEventId}/gallery/${privateProjectId}`).expect(
      404,
    );
    const draftOnly = await post(
      `/events/${eventId}/projects`,
      { teamId, name: 'Draft only', slug: `draft-only-${unique()}` },
      owner.cookie,
    ).expect(201);
    await post(
      `${projectPath(eventId, draftOnly.body.id)}/submissions`,
      draftBody('Draft only'),
      owner.cookie,
    ).expect(201);
    const after = await get(`/events/${eventId}/gallery`).expect(200);
    expect(
      after.body.items.some((p: { id: string }) => p.id === draftOnly.body.id),
    ).toBe(false);
  });
  it('does not republish a previous version after the latest submitted version is withdrawn', async () => {
    const project = await post(
      `/events/${eventId}/projects`,
      { teamId, name: 'Withdrawn snapshot', slug: `withdrawn-${unique()}` },
      owner.cookie,
    ).expect(201);
    const base = projectPath(eventId, project.body.id);
    const first = await post(
      `${base}/submissions`,
      draftBody('First'),
      owner.cookie,
    ).expect(201);
    await post(
      `${base}/submissions/${first.body.id}/submit`,
      {},
      owner.cookie,
    ).expect(201);
    const second = await post(
      `${base}/submissions`,
      draftBody('Second'),
      owner.cookie,
    ).expect(201);
    await post(
      `${base}/submissions/${second.body.id}/submit`,
      {},
      owner.cookie,
    ).expect(201);
    await db.submission.update({
      where: { id: second.body.id },
      data: { status: 'WITHDRAWN' },
    });
    const gallery = await get(`/events/${eventId}/gallery`).expect(200);
    expect(
      gallery.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(project.body.id);
    await get(`/events/${eventId}/gallery/${project.body.id}`).expect(404);
  });
  it('searches snapshots, filters track, and paginates deterministically', async () => {
    const defaultSized = await get(
      `/events/${eventId}/gallery?page=1&pageSize=12`,
    ).expect(200);
    expect(defaultSized.body).toMatchObject({ page: 1, pageSize: 12 });
    const search = await get(
      `/events/${eventId}/gallery?search=Version%20two`,
    ).expect(200);
    expect(
      search.body.items.some((p: { id: string }) => p.id === projectId),
    ).toBe(true);
    const filtered = await get(
      `/events/${eventId}/gallery?trackId=${trackId}`,
    ).expect(200);
    expect(filtered.body.items.map((p: { id: string }) => p.id)).toContain(
      projectId,
    );
    expect(
      filtered.body.items.every(
        (p: { trackId: string }) => p.trackId === trackId,
      ),
    ).toBe(true);
    const first = await get(
      `/events/${eventId}/gallery?page=1&pageSize=1`,
    ).expect(200);
    const second = await get(
      `/events/${eventId}/gallery?page=2&pageSize=1`,
    ).expect(200);
    expect(first.body.total).toBeGreaterThanOrEqual(2);
    expect(first.body.items[0].id).not.toBe(second.body.items[0].id);
    expect(
      (await get(`/events/${eventId}/gallery?page=1&pageSize=1`).expect(200))
        .body.items[0].id,
    ).toBe(first.body.items[0].id);
    const detail = await get(`/events/${eventId}/gallery/${projectId}`).expect(
      200,
    );
    expect(detail.body).toMatchObject({ id: projectId, version: 2 });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /email|password|tokenHash|auditEvent|createdById/i,
    );
  });
  it.each([
    'page=0',
    'page=-1',
    'page=1.5',
    'page=NaN',
    'page=999999999999999999999',
    'pageSize=0',
    'pageSize=51',
    'pageSize=1.5',
  ])('rejects malformed gallery pagination: %s', async (query) => {
    const response = await get(`/events/${eventId}/gallery?${query}`).expect(
      400,
    );
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });
  it('keeps gallery identity and track from the submitted snapshot after project edits', async () => {
    const before = (
      await get(`/events/${eventId}/gallery/${projectId}`).expect(200)
    ).body;
    await patch(
      projectPath(eventId, projectId),
      { name: 'Working name changed', trackId: null },
      owner.cookie,
    ).expect(200);
    const after = (
      await get(`/events/${eventId}/gallery/${projectId}`).expect(200)
    ).body;
    expect(after).toMatchObject({
      projectName: before.projectName,
      trackId: before.trackId,
      trackName: before.trackName,
    });
    const filtered = await get(
      `/events/${eventId}/gallery?trackId=${trackId}`,
    ).expect(200);
    expect(
      filtered.body.items.map((item: { id: string }) => item.id),
    ).toContain(projectId);
  });
});

describe('final submission eligibility', () => {
  it('requires the active roster to meet the event minimum', async () => {
    const e = await event(organizer, 'PUBLIC', 2);
    const t = await team(owner, e);
    const p = await post(
      `/events/${e}/projects`,
      { teamId: t, name: 'Team work', slug: `team-work-${unique()}` },
      owner.cookie,
    ).expect(201);
    const base = projectPath(e, p.body.id);
    const draft = await post(
      `${base}/submissions`,
      draftBody('Not ready'),
      owner.cookie,
    ).expect(201);
    await post(
      `${base}/submissions/${draft.body.id}/submit`,
      {},
      owner.cookie,
    ).expect(409);
    await post(`/events/${e}/registrations`, {}, member.cookie).expect(201);
    const invitation = await post(
      `/events/${e}/teams/${t}/invitations`,
      { email: member.email },
      owner.cookie,
    ).expect(201);
    await post(
      '/team-invitations/accept',
      { token: invitation.body.token },
      member.cookie,
    ).expect(200);
    await post(
      `${base}/submissions/${draft.body.id}/submit`,
      {},
      owner.cookie,
    ).expect(201);
  });
  it('enforces a track submission limit at the final submit boundary', async () => {
    const e = await event(organizer);
    const t = await team(owner, e);
    const otherTeam = await team(member, e);
    const track = await post(
      `/events/${e}/tracks`,
      { name: 'Limited', slug: `limited-${unique()}`, maxSubmissions: 1 },
      organizer.cookie,
    ).expect(201);
    const drafts: Array<{ base: string; id: string; actor: Actor }> = [];
    for (const index of [1, 2]) {
      const actor = index === 1 ? owner : member;
      const project = await post(
        `/events/${e}/projects`,
        {
          teamId: index === 1 ? t : otherTeam,
          trackId: track.body.id,
          name: `Limited ${index}`,
          slug: `limited-${index}-${unique()}`,
        },
        actor.cookie,
      ).expect(201);
      const base = projectPath(e, project.body.id);
      const draft = await post(
        `${base}/submissions`,
        draftBody(`Limited ${index}`),
        actor.cookie,
      ).expect(201);
      drafts.push({ base, id: draft.body.id, actor });
    }
    const results = await Promise.all(
      drafts.map(({ base, id, actor }) =>
        post(`${base}/submissions/${id}/submit`, {}, actor.cookie),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.code).toBe(
      'TRACK_FULL',
    );
  });
});
