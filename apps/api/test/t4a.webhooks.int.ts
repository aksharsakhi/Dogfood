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
import { WebhookTransport } from '../src/modules/webhooks/webhook-transport';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { webhookTypes } from '../src/modules/audit/audit.service';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('T4A integration tests require an isolated _test database.');
process.env.VOTING_TOKEN_SECRET =
  't4a-integration-voting-secret-32-chars-minimum';
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID();
let app: NestFastifyApplication;
let send: jest.Mock;
type Actor = { id: string; cookie: string };

async function actor(label: string): Promise<Actor> {
  const id = unique();
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

const api = () => app.getHttpServer();
const post = (path: string, body: object, cookie?: string) => {
  const req = request(api()).post(path).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const patch = (path: string, body: object, cookie?: string) => {
  const req = request(api()).patch(path).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};
const get = (path: string, cookie?: string) => {
  const req = request(api()).get(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
};

async function eventFixture(organizer: Actor) {
  const eventId = unique();
  await db.event.create({
    data: {
      id: eventId,
      slug: `t4a-${eventId}`,
      name: 'T4A event',
      createdById: organizer.id,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      galleryVisibility: 'PUBLIC',
      votingAccessMode: 'AUTHENTICATED',
      votingOpensAt: new Date('2020-01-01'),
      votingClosesAt: new Date('2035-01-01'),
    },
  });
  await db.eventMembership.create({
    data: { eventId, userId: organizer.id, role: 'ORGANIZER' },
  });
  return eventId;
}

beforeAll(async () => {
  send = jest.fn().mockResolvedValue(204);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WebhookTransport)
    .useValue({ send })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

beforeEach(async () => {
  await db.webhookDeliveryAttempt.deleteMany();
  await db.webhookDelivery.deleteMany();
  await db.webhookSubscription.deleteMany();
});

describe('T4A REST mutation coverage and durable webhooks', () => {
  it('maps every audited domain mutation family while excluding auth and reads', () => {
    const expected = [
      'EVENT_CREATED',
      'EVENT_UPDATED',
      'EVENT_PUBLISHED',
      'TRACK_CREATED',
      'TRACK_UPDATED',
      'TRACK_DELETED',
      'PRIZE_CREATED',
      'PRIZE_UPDATED',
      'PRIZE_DELETED',
      'REGISTRATION_CREATED',
      'REGISTRATION_WITHDRAWN',
      'TEAM_CREATED',
      'TEAM_UPDATED',
      'TEAM_MEMBER_LEFT',
      'TEAM_MEMBER_REMOVED',
      'TEAM_DISBANDED',
      'TEAM_INVITATION_CREATED',
      'TEAM_INVITATION_REVOKED',
      'TEAM_INVITATION_ACCEPTED',
      'TEAM_INVITATION_REJECTED',
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'SUBMISSION_DRAFT_CREATED',
      'SUBMISSION_DRAFT_UPDATED',
      'SUBMISSION_SUBMITTED',
      'JUDGE_INVITED',
      'JUDGE_INVITE_REVOKED',
      'JUDGE_ACCEPTED',
      'JUDGE_PROFILE_UPDATED',
      'CONFLICT_DECLARED',
      'CONFLICT_REMOVED',
      'RUBRIC_CREATED',
      'RUBRIC_UPDATED',
      'RUBRIC_PUBLISHED',
      'ASSIGNMENT_RUN_CREATED',
      'ASSIGNMENT_PUBLISHED',
      'JUDGE_ASSIGNED',
      'EVALUATION_DRAFT_SAVED',
      'EVALUATION_SUBMITTED',
      'SCORE_RUN_CREATED',
      'RESULT_RUN_CREATED',
      'RESULT_RUN_COVERAGE_OVERRIDE',
      'VOTING_IDENTITY_CREATED',
      'VOTING_CONFIG_CHANGED',
      'COMMUNITY_VOTE_CAST',
      'COMMUNITY_VOTE_FLAGGED',
      'PROJECT_COMMENT_POSTED',
      'PROJECT_COMMENT_HIDDEN',
    ];
    for (const action of expected) expect(webhookTypes[action]).toBeTruthy();
    expect(webhookTypes.AUTH_REGISTER).toBeUndefined();
    expect(webhookTypes.CSV_EXPORTED).toBeUndefined();
  });

  it('commits event creation and its outbox event atomically', async () => {
    const organizer = await actor('event-creator');
    const slug = `atomic-${unique()}`;
    const response = await post(
      '/events',
      { name: 'Atomic event', slug, visibility: 'PUBLIC' },
      organizer.cookie,
    ).expect(201);
    const outbox = await db.webhookOutboxEvent.findFirst({
      where: { eventId: response.body.id, eventType: 'event.created' },
    });
    expect(outbox).toBeTruthy();
    await expect(
      db.webhookOutboxEvent.update({
        where: { id: outbox!.id },
        data: { eventType: 'tampered.event' },
      }),
    ).rejects.toThrow('Webhook outbox events are immutable');
  });

  it('instruments a T2 rubric mutation with a transactional outbox event', async () => {
    const organizer = await actor('rubric-owner');
    const eventId = await eventFixture(organizer);
    const created = await post(
      `/events/${eventId}/judging/rubrics`,
      {
        name: 'T4A coverage rubric',
        criteria: [
          { name: 'Quality', weight: '1', minScore: '0', maxScore: '5' },
        ],
      },
      organizer.cookie,
    ).expect(201);
    const outbox = await db.webhookOutboxEvent.findFirstOrThrow({
      where: { eventId, eventType: 'rubric.created' },
    });
    expect(outbox.payload).toMatchObject({ entity: { id: created.body.id } });
  });

  it('rolls back an event when the transactional outbox insert fails', async () => {
    const organizer = await actor('rollback-creator');
    const slug = `rollback-${unique()}`;
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION t4a_reject_outbox_insert() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced T4A outbox failure'; END;
      $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER t4a_reject_outbox BEFORE INSERT ON "WebhookOutboxEvent"
      FOR EACH ROW EXECUTE FUNCTION t4a_reject_outbox_insert()`);
    try {
      await post(
        '/events',
        { name: 'Must roll back', slug },
        organizer.cookie,
      ).expect(500);
      expect(await db.event.findUnique({ where: { slug } })).toBeNull();
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS t4a_reject_outbox ON "WebhookOutboxEvent"',
      );
      await db.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS t4a_reject_outbox_insert()',
      );
    }
  });

  it('reveals the signing secret only on creation and scopes webhook operations to organizers/events', async () => {
    const organizer = await actor('webhook-owner');
    const outsider = await actor('webhook-outsider');
    const eventId = await eventFixture(organizer);
    const otherEventId = await eventFixture(outsider);
    await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://127.0.0.1/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(400);
    const created = await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://8.8.8.8/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(201);
    expect(created.body.signingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const secret = created.body.signingSecret as string;
    expect(created.body).not.toHaveProperty('secretCiphertext');
    const persisted = await db.webhookSubscription.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(persisted.secretCiphertext).not.toBe(secret);
    const listed = await get(
      `/events/${eventId}/webhooks`,
      organizer.cookie,
    ).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    expect(JSON.stringify(listed.body)).not.toContain('secretCiphertext');
    await get(`/events/${eventId}/webhooks`, outsider.cookie).expect(403);
    await patch(
      `/events/${eventId}`,
      { name: 'Delivery for IDOR check' },
      organizer.cookie,
    ).expect(200);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: created.body.id },
    });
    await get(`/events/${eventId}/webhook-deliveries`, outsider.cookie).expect(
      403,
    );
    await post(
      `/events/${otherEventId}/webhook-deliveries/${delivery.id}/replay`,
      {},
      outsider.cookie,
    ).expect(404);
    await patch(
      `/events/${otherEventId}/webhooks/${created.body.id}`,
      { active: false },
      organizer.cookie,
    ).expect(403);
  });

  it('records a failed post-commit delivery, retries, and replays with the same delivery ID', async () => {
    const organizer = await actor('delivery-owner');
    const eventId = await eventFixture(organizer);
    const created = await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://8.8.8.8/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(201);
    send.mockReset().mockResolvedValueOnce(503).mockResolvedValueOnce(204);
    const updated = await patch(
      `/events/${eventId}`,
      { name: 'Committed name' },
      organizer.cookie,
    ).expect(200);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: created.body.id },
      include: { outboxEvent: true },
    });
    const service = app.get(WebhooksService);
    await service.processOne();
    const failed = await db.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(failed.status).toBe('RETRYING');
    const signedBody = JSON.parse(send.mock.calls[0]![4] as string) as Record<
      string,
      unknown
    >;
    expect(signedBody).toMatchObject({
      schemaVersion: 1,
      eventType: 'event.updated',
      deliveryId: delivery.id,
      eventId,
    });
    const history = await get(
      `/events/${eventId}/webhook-deliveries`,
      organizer.cookie,
    ).expect(200);
    expect(history.body.items[0]).toMatchObject({
      id: delivery.id,
      status: 'RETRYING',
      attempts: 1,
      lastError: 'http_delivery_failed',
    });
    expect(
      await db.event.findUniqueOrThrow({ where: { id: eventId } }),
    ).toMatchObject({ name: 'Committed name' });
    await post(
      `/events/${eventId}/webhook-deliveries/${delivery.id}/replay`,
      {},
      organizer.cookie,
    ).expect(201);
    await service.processOne();
    const delivered = await db.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
    });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.id).toBe(delivery.id);
    expect(delivered.manualReplays).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[1]![4] as string).deliveryId).toBe(
      delivery.id,
    );
    expect(updated.body.name).toBe('Committed name');
  });

  it('exhausts the finite retry cycle and stores each attempt', async () => {
    const organizer = await actor('exhaustion-owner');
    const eventId = await eventFixture(organizer);
    const created = await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://8.8.8.8/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(201);
    await patch(
      `/events/${eventId}`,
      { name: 'Retry exhaustion' },
      organizer.cookie,
    ).expect(200);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: created.body.id },
    });
    send.mockReset().mockResolvedValue(503);
    const service = app.get(WebhooksService);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0)
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { nextAttemptAt: new Date(Date.now() - 1_000) },
        });
      await service.processOne();
    }
    const exhausted = await db.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: { history: true },
    });
    expect(exhausted.status).toBe('EXHAUSTED');
    expect(exhausted.attempts).toBe(8);
    expect(exhausted.history).toHaveLength(8);
  });

  it('allows only one worker to claim a delivery concurrently', async () => {
    const organizer = await actor('concurrency-owner');
    const eventId = await eventFixture(organizer);
    const created = await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://8.8.8.8/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(201);
    await patch(
      `/events/${eventId}`,
      { name: 'Single claim' },
      organizer.cookie,
    ).expect(200);
    send.mockReset().mockResolvedValue(204);
    const service = app.get(WebhooksService);
    const results = await Promise.all([
      service.processOne(),
      service.processOne(),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: created.body.id },
    });
    expect(delivery.attempts).toBe(1);
    expect(delivery.status).toBe('DELIVERED');
  });

  it('creates T3 identity and vote outbox events without private fingerprint fields', async () => {
    const organizer = await actor('vote-organizer');
    const voter = await actor('vote-voter');
    const owner = await actor('vote-owner');
    const eventId = await eventFixture(organizer);
    await db.eventMembership.createMany({
      data: [
        { eventId, userId: voter.id, role: 'PARTICIPANT' },
        { eventId, userId: owner.id, role: 'PARTICIPANT' },
      ],
    });
    const teamId = unique();
    await db.team.create({
      data: {
        id: teamId,
        eventId,
        name: 'Vote team',
        slug: `team-${teamId}`,
        createdById: owner.id,
        status: 'ACTIVE',
      },
    });
    await db.teamMember.create({
      data: { eventId, teamId, userId: owner.id, role: 'OWNER' },
    });
    const projectId = unique();
    await db.project.create({
      data: {
        id: projectId,
        eventId,
        teamId,
        name: 'Ballot project',
        slug: `project-${projectId}`,
        status: 'ACTIVE',
      },
    });
    await db.submission.create({
      data: {
        projectId,
        version: 1,
        title: 'Ballot title',
        description: 'Public',
        projectName: 'Ballot project',
        createdById: owner.id,
        status: 'SUBMITTED',
        submittedAt: new Date('2029-01-01'),
      },
    });
    await post(
      `/events/${eventId}/webhooks`,
      {
        url: 'https://8.8.8.8/hooks',
        eventTypes: ['voting.identity.created', 'community.vote.cast'],
      },
      organizer.cookie,
    ).expect(201);
    await post(`/events/${eventId}/voting/ballot`, {}, voter.cookie).expect(
      201,
    );
    await post(
      `/events/${eventId}/voting/votes`,
      { projectId },
      voter.cookie,
    ).expect(201);
    const outbox = await db.webhookOutboxEvent.findMany({
      where: {
        eventId,
        eventType: { in: ['voting.identity.created', 'community.vote.cast'] },
      },
      orderBy: { occurredAt: 'asc' },
    });
    expect(outbox.map((row) => row.eventType)).toEqual([
      'voting.identity.created',
      'community.vote.cast',
    ]);
    const serialized = JSON.stringify(outbox.map((row) => row.payload));
    expect(serialized).not.toContain('abuseSignalHash');
    expect(serialized).not.toContain('openTokenHash');
    expect(serialized).not.toContain('emailHash');
  });

  it('keeps pending delivery state across API module restart', async () => {
    const organizer = await actor('restart-owner');
    const eventId = await eventFixture(organizer);
    const created = await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://8.8.8.8/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(201);
    const signingSecret = created.body.signingSecret as string;
    await patch(
      `/events/${eventId}`,
      { name: 'Survives restart' },
      organizer.cookie,
    ).expect(200);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: created.body.id },
    });
    expect(delivery.status).toBe('PENDING');
    await app.close();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WebhookTransport)
      .useValue({ send })
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await configureApp(app, origin);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    expect(
      await db.webhookDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({
      status: 'PENDING',
      outboxEventId: delivery.outboxEventId,
    });
    send.mockReset().mockResolvedValue(204);
    await app.get(WebhooksService).processOne();
    expect(send).toHaveBeenCalledWith(
      'https://8.8.8.8/hooks',
      signingSecret,
      delivery.id,
      'event.updated',
      expect.any(String),
    );
    expect(
      await db.webhookDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ status: 'DELIVERED', id: delivery.id });
  });

  it('does not decrypt an existing webhook secret with a replacement key', async () => {
    const organizer = await actor('wrong-key-owner');
    const eventId = await eventFixture(organizer);
    const created = await post(
      `/events/${eventId}/webhooks`,
      { url: 'https://8.8.8.8/hooks', eventTypes: ['event.updated'] },
      organizer.cookie,
    ).expect(201);
    await patch(
      `/events/${eventId}`,
      { name: 'Committed before wrong-key delivery' },
      organizer.cookie,
    ).expect(200);
    const delivery = await db.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: created.body.id },
    });
    const originalKey = process.env.WEBHOOK_ENCRYPTION_KEY;
    process.env.WEBHOOK_ENCRYPTION_KEY =
      'different-independent-replacement-key-32-chars';
    send.mockClear();
    try {
      await app.get(WebhooksService).processOne();
    } finally {
      process.env.WEBHOOK_ENCRYPTION_KEY = originalKey;
    }
    expect(send).not.toHaveBeenCalled();
    expect(
      await db.webhookDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      }),
    ).toMatchObject({ status: 'RETRYING', attempts: 1 });
    expect(
      await db.event.findUniqueOrThrow({ where: { id: eventId } }),
    ).toMatchObject({ name: 'Committed before wrong-key delivery' });
  });
});
