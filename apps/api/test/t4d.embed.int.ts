import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { hashToken } from '../src/modules/identity/auth.service';
import {
  canonicalEmbedOrigins,
  embedFrameAncestors,
} from '../src/modules/events/embed-origins';
import {
  packageHash,
  parseArchive,
  type EventArchive,
} from '../src/modules/event-archive/archive-format';
import { semanticNormalize } from '../src/modules/event-archive/archive-normalize';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('Isolated _test database required.');
const db = new PrismaClient();
const webOrigin = 'http://localhost:3000';
let app: NestFastifyApplication;
let eventId: string;
let privateId: string;
let organizer: { id: string; cookie: string };
let otherOrganizer: { id: string; cookie: string };
let participant: { id: string; cookie: string };
let judge: { id: string; cookie: string };
let activeProjectId: string;
const get = (path: string, cookie?: string) => {
  const call = request(app.getHttpServer()).get(path);
  if (cookie) call.set('Cookie', cookie);
  return call;
};
const patch = (path: string, body: object, cookie?: string) => {
  const call = request(app.getHttpServer())
    .patch(path)
    .set('Origin', webOrigin);
  if (cookie) call.set('Cookie', cookie);
  return call.send(body);
};
async function actor(label: string) {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await db.user.create({
    data: {
      id,
      email: `${label}-${id}@example.test`,
      displayName: label,
      passwordHash: 'test-only',
    },
  });
  await db.session.create({
    data: {
      userId: id,
      tokenHash: hashToken(token),
      expiresAt: new Date('2035-01-01'),
    },
  });
  return { id, cookie: `dogfood_session=${token}` };
}
beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, webOrigin);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  [organizer, otherOrganizer, participant, judge] = await Promise.all([
    actor('embed-organizer'),
    actor('other-organizer'),
    actor('embed-participant'),
    actor('embed-judge'),
  ]);
  eventId = randomUUID();
  privateId = randomUUID();
  await db.event.createMany({
    data: [
      {
        id: eventId,
        slug: `embed-${eventId}`,
        name: 'Public embed event',
        createdById: organizer.id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        galleryVisibility: 'PUBLIC',
      },
      {
        id: privateId,
        slug: `private-${privateId}`,
        name: 'Private embed event',
        createdById: otherOrganizer.id,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        galleryVisibility: 'HIDDEN',
        embedAllowedOrigins: ['https://example.com'],
      },
    ],
  });
  await db.eventMembership.createMany({
    data: [
      { eventId, userId: organizer.id, role: 'ORGANIZER' },
      { eventId: privateId, userId: otherOrganizer.id, role: 'ORGANIZER' },
      { eventId, userId: participant.id, role: 'PARTICIPANT' },
      { eventId, userId: judge.id, role: 'JUDGE' },
    ],
  });
  const teamId = randomUUID();
  await db.team.create({
    data: {
      id: teamId,
      eventId,
      name: 'Public team',
      slug: `team-${teamId}`,
      createdById: participant.id,
      status: 'ACTIVE',
    },
  });
  for (const status of ['ACTIVE', 'DRAFT'] as const) {
    const id = randomUUID();
    if (status === 'ACTIVE') activeProjectId = id;
    await db.project.create({
      data: {
        id,
        eventId,
        teamId,
        name: `${status} project`,
        slug: `project-${id}`,
        status,
      },
    });
    await db.submission.create({
      data: {
        projectId: id,
        version: 1,
        title: `${status} title`,
        description: 'Submitted work',
        projectName: `${status} project`,
        status: 'SUBMITTED',
        createdById: participant.id,
        submittedAt: new Date(),
      },
    });
  }
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('T4D exact-origin configuration', () => {
  it('canonicalizes casing, default ports, trailing slash, and duplicates', () => {
    expect(
      canonicalEmbedOrigins([
        'HTTPS://EXAMPLE.COM:443/',
        'https://example.com',
        'http://localhost:3000/',
      ]),
    ).toEqual(['http://localhost:3000', 'https://example.com']);
  });
  it.each([
    '*',
    "'self'",
    'https:',
    'data:',
    'javascript:',
    'https://*.example.com',
    'https://example.com/path',
    'https://example.com/?x=1',
    'https://example.com/#x',
    'https://user@example.com',
    'https://example.com; script-src *',
    'https://example.com\n',
    'https://example.com\\',
  ])('rejects invalid or injected origin %s', (value) => {
    expect(() => canonicalEmbedOrigins([value])).toThrow();
  });
  it('produces a closed policy for empty lists and exact sources for configured lists', () => {
    expect(embedFrameAncestors([])).toBe("frame-ancestors 'none'");
    expect(embedFrameAncestors(['https://example.com'])).toBe(
      "frame-ancestors 'self' https://example.com",
    );
  });
  it('requires an event organizer for reads and writes, including cross-event access', async () => {
    const outboxBefore = await db.webhookOutboxEvent.count({
      where: { eventId, eventType: 'event.embed.config.changed' },
    });
    await get(`/events/${eventId}/embed-config`).expect(401);
    await patch(`/events/${eventId}/embed-config`, {
      allowedOrigins: [],
    }).expect(401);
    for (const actor of [otherOrganizer, participant, judge]) {
      await get(`/events/${eventId}/embed-config`, actor.cookie).expect(403);
      await patch(
        `/events/${eventId}/embed-config`,
        { allowedOrigins: [] },
        actor.cookie,
      ).expect(403);
    }
    await patch(
      `/events/${privateId}/embed-config`,
      { allowedOrigins: [] },
      organizer.cookie,
    ).expect(403);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'event.embed.config.changed' },
      }),
    ).toBe(outboxBefore);
  });
  it('persists canonical origins and records one audit event without public-read audit noise', async () => {
    const path = `/events/${eventId}/embed-config`;
    const outboxBefore = await db.webhookOutboxEvent.count({
      where: { eventId, eventType: 'event.embed.config.changed' },
    });
    const before = await db.auditEvent.count({
      where: { eventId, action: 'EVENT_EMBED_CONFIG_CHANGED' },
    });
    const result = await patch(
      path,
      { allowedOrigins: ['HTTPS://EXAMPLE.COM:443/', 'https://example.com'] },
      organizer.cookie,
    ).expect(200);
    expect(result.body.allowedOrigins).toEqual(['https://example.com']);
    expect((await get(path, organizer.cookie).expect(200)).body).toEqual({
      allowedOrigins: ['https://example.com'],
    });
    expect(
      (await db.event.findUniqueOrThrow({ where: { id: eventId } }))
        .embedAllowedOrigins,
    ).toEqual(['https://example.com']);
    await get(`/events/${eventId}/gallery/embed-meta`).expect(200);
    expect(
      await db.auditEvent.count({
        where: { eventId, action: 'EVENT_EMBED_CONFIG_CHANGED' },
      }),
    ).toBe(before + 1);
    const outbox = await db.webhookOutboxEvent.findMany({
      where: { eventId, eventType: 'event.embed.config.changed' },
      orderBy: { occurredAt: 'desc' },
      take: 1,
    });
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'event.embed.config.changed' },
      }),
    ).toBe(outboxBefore + 1);
    expect(outbox[0]?.payload).toMatchObject({
      eventType: 'event.embed.config.changed',
      eventId,
      entity: { type: 'Event', id: eventId },
    });
    // Existing update semantics audit every successful save, including an
    // identical canonical list; keep webhook behavior aligned with that audit.
    await patch(
      path,
      { allowedOrigins: ['https://example.com'] },
      organizer.cookie,
    ).expect(200);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'event.embed.config.changed' },
      }),
    ).toBe(outboxBefore + 2);
  });
  it('rejects malformed and injected origins at the authenticated API', async () => {
    const outboxBefore = await db.webhookOutboxEvent.count({
      where: { eventId, eventType: 'event.embed.config.changed' },
    });
    for (const value of [
      'https://*.example.com',
      'https://example.com/x',
      'https://example.com?x=1',
      'https://example.com; script-src *',
    ])
      await patch(
        `/events/${eventId}/embed-config`,
        { allowedOrigins: [value] },
        organizer.cookie,
      ).expect(400);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'event.embed.config.changed' },
      }),
    ).toBe(outboxBefore);
  });
});

describe('T4D public projection and archive', () => {
  it('returns the same public metadata and gallery with or without a session', async () => {
    const meta = `/events/${eventId}/gallery/embed-meta`;
    expect((await get(meta).expect(200)).body).toEqual(
      (await get(meta, organizer.cookie).expect(200)).body,
    );
    const path = `/events/${eventId}/gallery`;
    expect((await get(path).expect(200)).body).toEqual(
      (await get(path, organizer.cookie).expect(200)).body,
    );
  });
  it('inherits public gallery visibility and excludes hidden projects', async () => {
    const result = await get(`/events/${eventId}/gallery`).expect(200);
    expect(result.body.items.map((item: { id: string }) => item.id)).toEqual([
      activeProjectId,
    ]);
    await get(
      `/events/${privateId}/gallery/embed-meta`,
      otherOrganizer.cookie,
    ).expect(404);
    await get(`/events/${privateId}/gallery`, otherOrganizer.cookie).expect(
      404,
    );
    await db.event.update({
      where: { id: eventId },
      data: { galleryVisibility: 'HIDDEN' },
    });
    await get(`/events/${eventId}/gallery/embed-meta`).expect(404);
    await db.event.update({
      where: { id: eventId },
      data: { galleryVisibility: 'PUBLIC' },
    });
    await db.event.update({
      where: { id: eventId },
      data: { status: 'DRAFT' },
    });
    await get(`/events/${eventId}/gallery/embed-meta`).expect(404);
    await db.event.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED' },
    });
  });
  it('preserves origins in v1 archives while accepting older v1 packages and importing privately', async () => {
    const result = await get(
      `/events/${eventId}/archive`,
      organizer.cookie,
    ).expect(200);
    const archive = result.body as EventArchive;
    expect(archive.payload.event.embedAllowedOrigins).toEqual([
      'https://example.com',
    ]);
    expect(parseArchive(archive).packageHash).toBe(archive.packageHash);
    const old = JSON.parse(JSON.stringify(archive)) as EventArchive;
    delete old.payload.event.embedAllowedOrigins;
    const { packageHash: ignored, ...unsigned } = old;
    void ignored;
    old.packageHash = packageHash(unsigned);
    expect(parseArchive(old).packageHash).toBe(old.packageHash);
    expect(semanticNormalize(old)).toContain('"embedAllowedOrigins":[]');
    const preview = await request(app.getHttpServer())
      .post('/events/archives/preview')
      .set('Origin', webOrigin)
      .set('Cookie', organizer.cookie)
      .send({ archive })
      .expect(201);
    const confirmation = await request(app.getHttpServer())
      .post('/events/archives/confirm')
      .set('Origin', webOrigin)
      .set('Cookie', organizer.cookie)
      .send({
        archive,
        packageHash: preview.body.packageHash ?? archive.packageHash,
      })
      .expect(201);
    const destinationId = confirmation.body.eventId as string;
    const imported = await db.event.findUniqueOrThrow({
      where: { id: destinationId },
    });
    expect([
      imported.status,
      imported.visibility,
      imported.galleryVisibility,
    ]).toEqual(['DRAFT', 'PRIVATE', 'HIDDEN']);
    expect(imported.embedAllowedOrigins).toEqual(['https://example.com']);
    await get(`/events/${destinationId}/gallery/embed-meta`).expect(404);
    const destinationArchive = (
      await get(`/events/${destinationId}/archive`, organizer.cookie).expect(
        200,
      )
    ).body as EventArchive;
    expect(destinationArchive.payload.event.embedAllowedOrigins).toEqual([
      'https://example.com',
    ]);
    const oldPreview = await request(app.getHttpServer())
      .post('/events/archives/preview')
      .set('Origin', webOrigin)
      .set('Cookie', organizer.cookie)
      .send({ archive: old })
      .expect(201);
    const oldImport = await request(app.getHttpServer())
      .post('/events/archives/confirm')
      .set('Origin', webOrigin)
      .set('Cookie', organizer.cookie)
      .send({ archive: old, packageHash: oldPreview.body.packageHash })
      .expect(201);
    expect(
      (
        await db.event.findUniqueOrThrow({
          where: { id: oldImport.body.eventId as string },
        })
      ).embedAllowedOrigins,
    ).toEqual([]);
  });
});
