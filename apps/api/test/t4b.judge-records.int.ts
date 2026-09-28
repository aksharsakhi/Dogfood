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
import { AccessService } from '../src/common/auth/access.service';
import { Clock } from '../src/common/time';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { hashToken } from '../src/modules/identity/auth.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { JudgeRecordsService } from '../src/modules/judge-records/judge-records.service';
import { signingKeyFromSeed } from '../src/modules/judge-records/judge-records.crypto';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('T4B tests require an isolated _test database.');
const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID();
let app: NestFastifyApplication;
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
      expiresAt: new Date('2035-01-01T00:00:00Z'),
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
const get = (path: string, cookie?: string) => {
  const req = request(api()).get(path);
  if (cookie) req.set('Cookie', cookie);
  return req;
};

let organizer: Actor;
let participant: Actor;
let otherParticipant: Actor;
let judge: Actor;
let otherJudge: Actor;
let eventId: string;
let judgeProfileId: string;
let projectId: string;
let judgeUserId: string;

beforeAll(async () => {
  process.env.VOTING_TOKEN_SECRET ??= 't4b-integration-voting-secret-32-chars';
  process.env.WEBHOOK_ENCRYPTION_KEY ??= 't4b-integration-webhook-key-32-chars';
  process.env.JUDGE_RECORD_SIGNING_KEY_SEED ??=
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  organizer = await actor('t4b-organizer');
  participant = await actor('t4b-participant');
  otherParticipant = await actor('t4b-other-participant');
  judge = await actor('t4b-judge');
  otherJudge = await actor('t4b-other-judge');
  judgeUserId = judge.id;
  eventId = unique();
  await db.event.create({
    data: {
      id: eventId,
      slug: `t4b-${eventId}`,
      name: 'T4B records event',
      createdById: organizer.id,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    },
  });
  await db.eventMembership.createMany({
    data: [
      { eventId, userId: organizer.id, role: 'ORGANIZER' },
      { eventId, userId: participant.id, role: 'PARTICIPANT' },
      { eventId, userId: otherParticipant.id, role: 'PARTICIPANT' },
      { eventId, userId: judge.id, role: 'JUDGE' },
      { eventId, userId: otherJudge.id, role: 'JUDGE' },
    ],
  });
  await db.registration.createMany({
    data: [
      { eventId, userId: participant.id, status: 'APPROVED' },
      { eventId, userId: otherParticipant.id, status: 'APPROVED' },
    ],
  });
  const judgeMembership = await db.eventMembership.findUniqueOrThrow({
    where: {
      eventId_userId_role: { eventId, userId: judge.id, role: 'JUDGE' },
    },
  });
  const judgeProfile = await db.judgeProfile.create({
    data: { eventMembershipId: judgeMembership.id },
  });
  judgeProfileId = judgeProfile.id;
  const team = await db.team.create({
    data: {
      eventId,
      name: 'T4B Team',
      slug: `t4b-team-${eventId}`,
      createdById: participant.id,
      status: 'ACTIVE',
    },
  });
  const joinedAt = new Date('2030-01-01T00:00:00Z');
  await db.teamMember.create({
    data: {
      eventId,
      teamId: team.id,
      userId: participant.id,
      role: 'OWNER',
      joinedAt,
    },
  });
  const project = await db.project.create({
    data: {
      eventId,
      teamId: team.id,
      name: 'Untrusted <script> name',
      slug: `t4b-project-${eventId}`,
      status: 'ACTIVE',
    },
  });
  projectId = project.id;
  const submittedAt = new Date('2030-02-01T00:00:00Z');
  const submission = await db.submission.create({
    data: {
      projectId,
      version: 1,
      title: 'Snapshot <script>alert(1)</script>',
      description: 'Stored snapshot description',
      repositoryUrl: 'https://example.test/repo',
      projectName: 'T4B Snapshot Project',
      status: 'LOCKED',
      createdById: participant.id,
      submittedAt,
      lockedAt: submittedAt,
    },
  });
  const rubric = await db.rubric.create({
    data: {
      eventId,
      name: 'Private rubric must not be claimed',
      version: 1,
      status: 'PUBLISHED',
      publishedAt: submittedAt,
    },
  });
  const run = await db.assignmentRun.create({
    data: {
      eventId,
      rubricVersionId: rubric.id,
      type: 'MANUAL',
      status: 'PUBLISHED',
      reviewsPerSubmission: 1,
      algorithm: 'T4B_TEST',
      algorithmVersion: '1',
      allocationSource: 'TEST',
      createdById: organizer.id,
      publishedAt: submittedAt,
    },
  });
  const assignment = await db.judgeAssignment.create({
    data: {
      eventId,
      runId: run.id,
      rubricId: rubric.id,
      judgeProfileId,
      submissionId: submission.id,
      assignmentMethod: 'MANUAL',
      assignedById: organizer.id,
      status: 'COMPLETED',
    },
  });
  await db.evaluation.create({
    data: {
      assignmentId: assignment.id,
      rubricId: rubric.id,
      status: 'SUBMITTED',
      comments: 'PRIVATE EVALUATION TEXT',
      submittedAt,
      lockedAt: submittedAt,
    },
  });
});

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('T4B certificates and signed judge participation records', () => {
  it('generates only data-supported registration and project certificates with ownership checks', async () => {
    const registration = await get(
      `/events/${eventId}/certificates/registration/me`,
      participant.cookie,
    ).expect(200);
    expect(registration.headers['content-type']).toContain('text/html');
    expect(registration.text).toContain('registration record');
    expect(registration.text).toContain('T4B records event');
    expect(registration.text).not.toMatch(
      /attendance|winner|verified identity/i,
    );

    const ownProject = await get(
      `/events/${eventId}/certificates/projects/me`,
      participant.cookie,
    ).expect(200);
    expect(ownProject.text).toContain('T4B Snapshot Project');
    expect(ownProject.text).toContain('Stored snapshot description');
    expect(ownProject.text).toContain('&lt;script&gt;');
    expect(ownProject.text).not.toContain('<script>alert(1)</script>');
    expect(ownProject.text).not.toContain('PRIVATE EVALUATION TEXT');
    expect(ownProject.text).not.toContain('Private rubric must not be claimed');
    expect(ownProject.text).not.toMatch(/attendance|winner|verified identity/i);

    await get(
      `/events/${eventId}/certificates/registration/${otherParticipant.id}`,
      participant.cookie,
    ).expect(403);
    await get(
      `/events/${eventId}/certificates/projects/${projectId}/participants/${otherParticipant.id}`,
      participant.cookie,
    ).expect(403);
    const organizerCopy = await get(
      `/events/${eventId}/certificates/registration/${otherParticipant.id}`,
      organizer.cookie,
    ).expect(200);
    expect(organizerCopy.text).toContain('t4b-other-participant');
    await get(
      `/events/${eventId}/certificates/projects/${unique()}/participants/${participant.id}`,
      organizer.cookie,
    ).expect(404);
  });

  it('issues public, PII-free signatures and restricts judge record views by ownership', async () => {
    const outboxBefore = await db.webhookOutboxEvent.count({
      where: { eventId, eventType: 'judge.participation.record.issued' },
    });
    const issued = await post(
      `/events/${eventId}/judge-records/${judgeProfileId}`,
      {},
      organizer.cookie,
    ).expect(201);
    const issueEvents = await db.webhookOutboxEvent.findMany({
      where: { eventId, eventType: 'judge.participation.record.issued' },
      orderBy: { occurredAt: 'desc' },
      take: 1,
    });
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'judge.participation.record.issued' },
      }),
    ).toBe(outboxBefore + 1);
    expect(issueEvents[0]?.payload).toMatchObject({
      eventId,
      eventType: 'judge.participation.record.issued',
      entity: { type: 'JudgeParticipationRecord', id: issued.body.id },
      judgeProfileId,
    });
    const serializedWebhook = JSON.stringify(issueEvents[0]?.payload);
    for (const forbidden of [
      process.env.JUDGE_RECORD_SIGNING_KEY_SEED,
      process.env.WEBHOOK_ENCRYPTION_KEY,
      process.env.VOTING_TOKEN_SECRET,
      organizer.cookie,
    ])
      if (forbidden) expect(serializedWebhook).not.toContain(forbidden);
    expect(serializedWebhook).not.toMatch(
      /passwordHash|signingSecret|privateKey|secretCiphertext|canonicalPayload|signature/,
    );
    expect(issued.body.payload).toMatchObject({
      schemaVersion: 1,
      eventId,
      subjectId: expect.any(String),
      assignmentCount: 1,
      evaluationCount: 1,
      recordId: issued.body.id,
      issuerKeyId: expect.any(String),
    });
    expect(Object.keys(issued.body.payload).sort()).toEqual(
      [
        'assignmentCount',
        'evaluationCount',
        'eventId',
        'issuedAt',
        'issuerKeyId',
        'recordId',
        'schemaVersion',
        'subjectId',
      ].sort(),
    );
    const publicJson = JSON.stringify(issued.body.payload);
    expect(publicJson).not.toContain(judgeUserId);
    expect(publicJson).not.toContain('t4b-judge');
    expect(publicJson).not.toContain('PRIVATE EVALUATION TEXT');
    expect(publicJson).not.toContain('Private rubric');

    const verified = await get(
      `/judge-records/${issued.body.id}/verify`,
    ).expect(200);
    expect(verified.body).toMatchObject({
      signatureValid: true,
      status: 'ACTIVE',
      payload: issued.body.payload,
    });
    expect(verified.body.publicKey.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.body.canonicalPayload).toBe(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(issued.body.payload).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        ),
      ),
    );
    const keys = await get('/judge-records/keys').expect(200);
    expect(JSON.stringify(keys.body)).not.toContain(
      process.env.JUDGE_RECORD_SIGNING_KEY_SEED,
    );
    const audit = await db.auditEvent.findMany({
      where: { eventId, entityType: 'JudgeParticipationRecord' },
    });
    expect(JSON.stringify(audit)).not.toContain(
      process.env.JUDGE_RECORD_SIGNING_KEY_SEED,
    );
    const own = await get(
      `/events/${eventId}/judge-records/me`,
      judge.cookie,
    ).expect(200);
    expect(own.body).toHaveLength(1);
    await get(`/events/${eventId}/judge-records`, participant.cookie).expect(
      403,
    );
    await get(
      `/events/${eventId}/judge-records/${issued.body.id}/certificate`,
      otherJudge.cookie,
    ).expect(404);
    const printed = await get(
      `/events/${eventId}/judge-records/${issued.body.id}/certificate`,
      judge.cookie,
    ).expect(200);
    expect(printed.headers['content-type']).toContain('text/html');
    expect(printed.text).toContain(issued.body.signature);
    expect(printed.text).not.toContain('t4b-judge-');
  });

  it('corrects and revokes by appending signed statements without invalidating prior signatures', async () => {
    const issuedBefore = await db.webhookOutboxEvent.count({
      where: { eventId, eventType: 'judge.participation.record.issued' },
    });
    const revokedBefore = await db.webhookOutboxEvent.count({
      where: { eventId, eventType: 'judge.participation.record.revoked' },
    });
    const original = await post(
      `/events/${eventId}/judge-records/${judgeProfileId}`,
      {},
      organizer.cookie,
    ).expect(201);
    const correction = await post(
      `/events/${eventId}/judge-records/${judgeProfileId}`,
      { supersedesRecordId: original.body.id },
      organizer.cookie,
    ).expect(201);
    expect(correction.body.payload.supersedesRecordId).toBe(original.body.id);
    const oldAfterCorrection = await get(
      `/judge-records/${original.body.id}/verify`,
    ).expect(200);
    expect(oldAfterCorrection.body).toMatchObject({
      signatureValid: true,
      status: 'SUPERSEDED',
      supersededByRecordId: correction.body.id,
    });
    await post(
      `/events/${eventId}/judge-records/${correction.body.id}/revoke`,
      {},
      organizer.cookie,
    ).expect(201);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'judge.participation.record.issued' },
      }),
    ).toBe(issuedBefore + 2);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'judge.participation.record.revoked' },
      }),
    ).toBe(revokedBefore + 1);
    const revokeEvent = await db.webhookOutboxEvent.findFirstOrThrow({
      where: { eventId, eventType: 'judge.participation.record.revoked' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(revokeEvent.payload).toMatchObject({
      recordId: correction.body.id,
      eventId,
      eventType: 'judge.participation.record.revoked',
    });
    const serializedRevoke = JSON.stringify(revokeEvent.payload);
    for (const forbidden of [
      process.env.JUDGE_RECORD_SIGNING_KEY_SEED,
      process.env.WEBHOOK_ENCRYPTION_KEY,
      process.env.VOTING_TOKEN_SECRET,
      organizer.cookie,
    ])
      if (forbidden) expect(serializedRevoke).not.toContain(forbidden);
    expect(serializedRevoke).not.toMatch(
      /passwordHash|signingSecret|privateKey|secretCiphertext|canonicalPayload|signature/,
    );
    const revoked = await get(
      `/judge-records/${correction.body.id}/verify`,
    ).expect(200);
    expect(revoked.body).toMatchObject({
      signatureValid: true,
      status: 'REVOKED',
      revocation: { signatureValid: true },
    });
    expect(revoked.body.revocation.payload.recordId).toBe(correction.body.id);
    await post(
      `/events/${eventId}/judge-records/${judgeProfileId}`,
      { supersedesRecordId: randomUUID() },
      organizer.cookie,
    ).expect(404);
    await post(
      `/events/${eventId}/judge-records/${judgeProfileId}`,
      {},
      participant.cookie,
    ).expect(403);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'judge.participation.record.issued' },
      }),
    ).toBe(issuedBefore + 2);
    expect(
      await db.webhookOutboxEvent.count({
        where: { eventId, eventType: 'judge.participation.record.revoked' },
      }),
    ).toBe(revokedBefore + 1);

    await expect(
      db.judgeParticipationRecord.update({
        where: { id: original.body.id },
        data: { assignmentCount: 99 },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.judgeParticipationRecord.delete({ where: { id: original.body.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.judgeRecordRevocation.delete({
        where: { recordId: correction.body.id },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it('keeps records verifiable under retired public keys after rotation', async () => {
    const issued = await post(
      `/events/${eventId}/judge-records/${judgeProfileId}`,
      {},
      organizer.cookie,
    ).expect(201);
    const previousSeed = process.env.JUDGE_RECORD_SIGNING_KEY_SEED;
    const nextSeed =
      'f13b9ac471e20568d04ca398b7215f6e9a3c0d84b65721fe039a6dc28514be70';
    process.env.JUDGE_RECORD_SIGNING_KEY_SEED = nextSeed;
    try {
      const service = new JudgeRecordsService(
        db as unknown as DatabaseService,
        app.get(AccessService),
        app.get(AuditService),
        app.get(Clock),
      );
      await service.onModuleInit();
      const result = await service.verify(issued.body.id);
      expect(result.signatureValid).toBe(true);
      const keyState = await service.publicKeys();
      const activeKey = signingKeyFromSeed(nextSeed);
      expect(keyState.activeKeyId).toBe(activeKey.keyId);
      expect(
        keyState.keys.find((key) => key.id === issued.body.issuerKeyId)?.active,
      ).toBe(false);
      expect(
        keyState.rotations.some(
          (rotation) =>
            rotation.previousKeyId === issued.body.issuerKeyId &&
            rotation.activeKeyId === activeKey.keyId &&
            rotation.previousFingerprint === issued.body.fingerprint &&
            rotation.activeFingerprint === activeKey.fingerprint,
        ),
      ).toBe(true);
    } finally {
      if (previousSeed === undefined)
        delete process.env.JUDGE_RECORD_SIGNING_KEY_SEED;
      else process.env.JUDGE_RECORD_SIGNING_KEY_SEED = previousSeed;
    }
  });

  it('rejects a second active signing key at the database level under concurrent inserts', async () => {
    await db.judgeRecordSigningKey.updateMany({
      where: { retiredAt: null },
      data: { retiredAt: new Date() },
    });
    const candidates = ['a', 'b'].map((label) => {
      const fingerprint = randomBytes(32).toString('hex');
      return {
        id: `ed25519-sha256:${fingerprint}`,
        fingerprint,
        publicKeyPem: `test-public-key-${label}`,
      };
    });

    const attempts = await Promise.allSettled(
      candidates.map((data) => db.judgeRecordSigningKey.create({ data })),
    );
    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'P2002' });
    expect(
      await db.judgeRecordSigningKey.count({ where: { retiredAt: null } }),
    ).toBe(1);
  });
});
