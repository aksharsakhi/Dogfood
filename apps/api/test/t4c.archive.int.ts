import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import Fastify from 'fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { hashToken } from '../src/modules/identity/auth.service';
import { WebhookTransport } from '../src/modules/webhooks/webhook-transport';
import {
  canonicalSerialize,
  MAX_ARCHIVE_BYTES,
  packageHash,
  parseArchive,
  type EventArchive,
} from '../src/modules/event-archive/archive-format';
import { planArchive } from '../src/modules/event-archive/archive-plan';
import { semanticNormalize } from '../src/modules/event-archive/archive-normalize';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('T4C integration tests require an isolated _test database.');
const db = new PrismaClient();
const origin = 'http://localhost:3000';
let app: NestFastifyApplication;
let organizer: { id: string; cookie: string };
let outsider: { id: string; cookie: string };
let sourceEventId: string;
let archive: EventArchive;
let send: jest.Mock;
const api = () => app.getHttpServer();
const get = (path: string, cookie?: string) => {
  const call = request(api()).get(path);
  if (cookie) call.set('Cookie', cookie);
  return call;
};
const post = (path: string, body: object, cookie?: string) => {
  const call = request(api()).post(path).set('Origin', origin);
  if (cookie) call.set('Cookie', cookie);
  return call.send(body);
};
const changed = (edit: (copy: EventArchive) => void): EventArchive => {
  const copy: EventArchive = JSON.parse(JSON.stringify(archive));
  edit(copy);
  const { packageHash: ignored, ...unsigned } = copy;
  void ignored;
  copy.packageHash = packageHash(unsigned);
  return copy;
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
  process.env.VOTING_TOKEN_SECRET ??= 't4c-integration-voting-secret-32-chars';
  process.env.WEBHOOK_ENCRYPTION_KEY ??=
    't4c-integration-webhook-secret-32-chars';
  process.env.JUDGE_RECORD_SIGNING_KEY_SEED ??=
    '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  send = jest.fn().mockResolvedValue(204);
  const fastifyInstance = Fastify({
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
  });
  fastifyInstance.addHook('onRoute', (routeOptions) => {
    if (
      typeof routeOptions.url === 'string' &&
      routeOptions.url.includes('/events/archives/')
    ) {
      routeOptions.bodyLimit = MAX_ARCHIVE_BYTES + 1024 * 1024;
    }
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WebhookTransport)
    .useValue({ send })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(fastifyInstance),
  );
  await configureApp(app, origin);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  organizer = await actor('t4c-organizer');
  outsider = await actor('t4c-outsider');
  sourceEventId = randomUUID();
  await db.event.create({
    data: {
      id: sourceEventId,
      slug: `t4c-${sourceEventId}`,
      name: 'T4C source event',
      createdById: organizer.id,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      galleryVisibility: 'PUBLIC',
    },
  });
  await db.eventMembership.create({
    data: {
      eventId: sourceEventId,
      userId: organizer.id,
      role: 'ORGANIZER',
    },
  });
  await db.track.create({
    data: {
      eventId: sourceEventId,
      name: 'Track',
      slug: 'track',
    },
  });
  const result = await get(
    `/events/${sourceEventId}/archive`,
    organizer.cookie,
  );
  expect(result.status).toBe(200);
  archive = result.body as EventArchive;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('T4C canonical archive and validation', () => {
  it('canonicalizes object key order and hashes deterministically', () => {
    expect(canonicalSerialize({ b: 2, a: { y: 3, x: 1 } })).toBe(
      canonicalSerialize({ a: { x: 1, y: 3 }, b: 2 }),
    );
    const { packageHash: declared, ...unsigned } = archive;
    expect(packageHash(unsigned)).toBe(declared);
    expect(parseArchive(archive).packageHash).toBe(declared);
  });
  it('rejects unknown, secret and prototype-polluting fields', () => {
    expect(() =>
      parseArchive(
        changed((copy) => {
          (
            copy.payload.users[0] as object as Record<string, unknown>
          ).passwordHash = 'secret';
        }),
      ),
    ).toThrow();
    expect(() =>
      parseArchive(
        changed((copy) => {
          (copy as object as Record<string, unknown>).unexpected = 1;
        }),
      ),
    ).toThrow();
    expect(() =>
      parseArchive(
        JSON.stringify(archive).replace(
          '"format":',
          '"__proto__":{},"format":',
        ),
      ),
    ).toThrow();
  });
  it('rejects malformed JSON, version, manifest, checksum and size limits', () => {
    expect(() => parseArchive('{')).toThrow();
    expect(() =>
      parseArchive(
        changed((copy) => {
          (copy as { schemaVersion: number }).schemaVersion = 2;
        }),
      ),
    ).toThrow();
    expect(() =>
      parseArchive({
        ...archive,
        manifest: { ...archive.manifest, totalRows: 0 },
      }),
    ).toThrow();
    expect(() =>
      parseArchive({ ...archive, packageHash: '0'.repeat(64) }),
    ).toThrow();
    expect(() => parseArchive(' '.repeat(21 * 1024 * 1024))).toThrow();
    expect(() =>
      parseArchive({
        ...archive,
        payload: {
          ...archive.payload,
          users: Array(10_001).fill(archive.payload.users[0]),
        },
      }),
    ).toThrow();
  });
  it('rejects broken and cross-event references and ambiguous identities', () => {
    expect(() =>
      planArchive(
        changed((copy) => {
          copy.payload.entities.Track[0]!.eventId = randomUUID();
        }),
      ),
    ).toThrow();
    expect(() =>
      planArchive(
        changed((copy) => {
          copy.payload.entities.Track[0]!.eventId = randomUUID();
          copy.payload.entities.EventMembership[0]!.eventId = randomUUID();
        }),
      ),
    ).toThrow();
    expect(() =>
      planArchive(
        changed((copy) => {
          copy.payload.users.push({ ...copy.payload.users[0]! });
          copy.manifest.counts.users = (copy.manifest.counts.users ?? 0) + 1;
          copy.manifest.totalRows++;
        }),
      ),
    ).toThrow();
  });
  it('plans deterministic IDs and excludes credentials and secret material', () => {
    expect(planArchive(archive).ids).toEqual(planArchive(archive).ids);
    const json = JSON.stringify(archive);
    for (const field of [
      'passwordHash',
      'tokenHash',
      'secretCiphertext',
      'secretAuthTag',
      'privateKey',
      'voterIdentity',
    ])
      expect(json).not.toContain(field);
  });
});

describe('T4C organizer import', () => {
  it('enforces event-scoped export authorization', async () => {
    expect(
      (await get(`/events/${sourceEventId}/archive`, outsider.cookie)).status,
    ).toBe(403);
    expect(
      (await get(`/events/${randomUUID()}/archive`, organizer.cookie)).status,
    ).toBeGreaterThanOrEqual(403);
    expect((await get(`/events/${sourceEventId}/archive`)).status).toBe(401);
  });
  it('previews without event-domain writes and rejects unpreviewed/changed confirmation', async () => {
    const before = await db.event.count();
    const preview = await post(
      '/events/archives/preview',
      { archive },
      outsider.cookie,
    );
    expect(preview.status).toBe(201);
    expect(preview.body.packageHash).toBe(archive.packageHash);
    expect(preview.body.identityMappings).toHaveLength(1);
    expect(preview.body.privacyConsequences.length).toBeGreaterThan(0);
    expect(await db.event.count()).toBe(before);
    expect(
      (
        await post(
          '/events/archives/confirm',
          {
            archive,
            packageHash: '0'.repeat(64),
          },
          outsider.cookie,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(
          '/events/archives/confirm',
          {
            archive,
            packageHash: archive.packageHash,
          },
          organizer.cookie,
        )
      ).status,
    ).toBe(409);
  });
  it('imports atomically, preserves safe identity, and returns prior import on repeat', async () => {
    const result = await post(
      '/events/archives/confirm',
      {
        archive,
        packageHash: archive.packageHash,
      },
      outsider.cookie,
    );
    expect(result.status).toBe(201);
    expect(result.body.status).toBe('IMPORTED');
    const eventId = result.body.eventId as string;
    expect(eventId).not.toBe(sourceEventId);
    const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
    expect([event.status, event.visibility, event.galleryVisibility]).toEqual([
      'DRAFT',
      'PRIVATE',
      'HIDDEN',
    ]);
    expect(event.createdById).toBe(outsider.id);
    const placeholder = await db.user.findUniqueOrThrow({
      where: { id: planArchive(archive).ids.User![organizer.id]! },
    });
    expect(placeholder).toMatchObject({
      passwordHash: null,
      importedPlaceholder: true,
      status: 'DEACTIVATED',
      emailVerifiedAt: null,
    });
    expect(placeholder.email).not.toContain('example.test');
    expect(await db.session.count({ where: { userId: placeholder.id } })).toBe(
      0,
    );
    const repeat = await post(
      '/events/archives/confirm',
      {
        archive,
        packageHash: archive.packageHash,
      },
      outsider.cookie,
    );
    expect(repeat.body).toMatchObject({ status: 'ALREADY_IMPORTED', eventId });
    expect(
      await db.eventArchiveImport.count({
        where: { packageHash: archive.packageHash },
      }),
    ).toBe(1);
    const exported = await get(`/events/${eventId}/archive`, outsider.cookie);
    expect(exported.status).toBe(200);
    expect(
      semanticNormalize(
        exported.body as EventArchive,
        planArchive(archive).ids,
      ),
    ).toBe(semanticNormalize(archive));
    expect(send).not.toHaveBeenCalled();
  });
  it('rolls back every domain write when a late unique constraint rejects a row', async () => {
    const invalid = changed((copy) => {
      const duplicate = {
        ...copy.payload.entities.Track[0]!,
        id: randomUUID(),
      };
      copy.payload.entities.Track.push(duplicate);
      copy.manifest.counts.Track = (copy.manifest.counts.Track ?? 0) + 1;
      copy.manifest.totalRows++;
    });
    const plan = planArchive(invalid);
    const destEventId = plan.ids.Event![sourceEventId]!;
    const destPlaceholderUserId = plan.ids.User![organizer.id]!;

    expect(
      (
        await post(
          '/events/archives/preview',
          { archive: invalid },
          outsider.cookie,
        )
      ).status,
    ).toBe(201);

    const result = await post(
      '/events/archives/confirm',
      {
        archive: invalid,
        packageHash: invalid.packageHash,
      },
      outsider.cookie,
    );
    expect(result.status).toBeGreaterThanOrEqual(400);

    // Assert zero partial imported state survived the aborted transaction
    expect(
      await db.event.findUnique({
        where: { id: destEventId },
      }),
    ).toBeNull();
    expect(
      await db.user.findUnique({
        where: { id: destPlaceholderUserId },
      }),
    ).toBeNull();
    expect(
      await db.eventMembership.findMany({
        where: { eventId: destEventId },
      }),
    ).toHaveLength(0);
    expect(
      await db.track.findMany({
        where: { eventId: destEventId },
      }),
    ).toHaveLength(0);
    expect(
      await db.eventArchiveImport.count({
        where: { packageHash: invalid.packageHash },
      }),
    ).toBe(0);
    expect(
      await db.eventArchiveEntityMap.findMany({
        where: { destinationId: destEventId },
      }),
    ).toHaveLength(0);
  });

  it('negative controls: semantic normalizer detects dropped records and changed scalar fields', () => {
    const baseNormalized = semanticNormalize(archive);

    // Negative Control A: Dropped domain record
    const droppedTrack = changed((copy) => {
      copy.payload.entities.Track = [];
      copy.manifest.counts.Track = 0;
    });
    expect(semanticNormalize(droppedTrack)).not.toBe(baseNormalized);

    // Negative Control B: Changed scalar domain value
    const changedTrackName = changed((copy) => {
      copy.payload.entities.Track[0]!.name = 'Modified Track Name';
    });
    expect(semanticNormalize(changedTrackName)).not.toBe(baseNormalized);

    const changedEventName = changed((copy) => {
      copy.payload.event.name = 'Altered Event Title';
    });
    expect(semanticNormalize(changedEventName)).not.toBe(baseNormalized);
  });

  it('enforces database constraints and triggers for imported placeholders and secretless webhooks', async () => {
    const placeholderId = randomUUID();

    // 1. Placeholder guard: active status with placeholder flag is rejected
    await expect(
      db.user.create({
        data: {
          id: placeholderId,
          email: `imported-${placeholderId}@archive.invalid`,
          displayName: 'Illegal Placeholder',
          passwordHash: null,
          status: 'ACTIVE',
          importedPlaceholder: true,
        },
      }),
    ).rejects.toThrow();

    // 2. Placeholder guard: placeholder with password hash is rejected
    await expect(
      db.user.create({
        data: {
          id: placeholderId,
          email: `imported-${placeholderId}@archive.invalid`,
          displayName: 'Illegal Placeholder',
          passwordHash: 'some-hash',
          status: 'DEACTIVATED',
          importedPlaceholder: true,
        },
      }),
    ).rejects.toThrow();

    // 3. Valid placeholder creation
    const validPlaceholder = await db.user.create({
      data: {
        id: placeholderId,
        email: `imported-${placeholderId}@archive.invalid`,
        displayName: 'Valid Placeholder',
        passwordHash: null,
        status: 'DEACTIVATED',
        importedPlaceholder: true,
      },
    });
    expect(validPlaceholder.importedPlaceholder).toBe(true);

    // 4. Session trigger: session for placeholder is rejected
    await expect(
      db.session.create({
        data: {
          userId: placeholderId,
          tokenHash: 'dummy-token-hash-for-test',
          expiresAt: new Date('2035-01-01'),
        },
      }),
    ).rejects.toThrow();

    // 5. PlatformRole trigger: platform role for placeholder is rejected
    await expect(
      db.platformRole.create({
        data: {
          userId: placeholderId,
          role: 'ADMIN',
        },
      }),
    ).rejects.toThrow();

    // 6. Webhook constraint: active webhook without ciphertext is rejected
    await expect(
      db.webhookSubscription.create({
        data: {
          eventId: sourceEventId,
          createdById: organizer.id,
          url: 'https://example.test/webhook',
          eventTypes: ['event.updated'],
          active: true,
          secretCiphertext: null,
          secretIv: null,
          secretAuthTag: null,
        },
      }),
    ).rejects.toThrow();

    // 7. Append-only trigger: cannot delete or update EventArchiveImport
    const importRecord = await db.eventArchiveImport.findFirst({
      where: { packageHash: archive.packageHash },
    });
    if (importRecord) {
      await expect(
        db.eventArchiveImport.delete({
          where: { id: importRecord.id },
        }),
      ).rejects.toThrow();
    }
  });

  it('completes enriched round-trip preserving scoring, signed judge records, and privacy semantics', async () => {
    const richEventId = randomUUID();
    const richOrg = await actor('rich-organizer');
    const richJudge = await actor('rich-judge');
    const richParticipant = await actor('rich-participant');

    // 1. Create rich source event
    await db.event.create({
      data: {
        id: richEventId,
        slug: `rich-${richEventId}`,
        name: 'Rich Enriched Event',
        createdById: richOrg.id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        galleryVisibility: 'PUBLIC',
        votingAccessMode: 'OPEN',
      },
    });
    await db.eventMembership.createMany({
      data: [
        { eventId: richEventId, userId: richOrg.id, role: 'ORGANIZER' },
        { eventId: richEventId, userId: richJudge.id, role: 'JUDGE' },
        {
          eventId: richEventId,
          userId: richParticipant.id,
          role: 'PARTICIPANT',
        },
      ],
    });

    const trackId = randomUUID();
    await db.track.create({
      data: {
        id: trackId,
        eventId: richEventId,
        name: 'AI Track',
        slug: 'ai-track',
      },
    });

    const prizeId = randomUUID();
    await db.prize.create({
      data: {
        id: prizeId,
        eventId: richEventId,
        name: 'Grand Prize',
        description: 'First place',
      },
    });

    const teamId = randomUUID();
    await db.team.create({
      data: {
        id: teamId,
        eventId: richEventId,
        name: 'Alpha Team',
        slug: 'alpha-team',
        createdById: richParticipant.id,
      },
    });
    await db.teamMember.create({
      data: {
        eventId: richEventId,
        teamId,
        userId: richParticipant.id,
        role: 'OWNER',
      },
    });

    const projectId = randomUUID();
    await db.project.create({
      data: {
        id: projectId,
        eventId: richEventId,
        teamId,
        name: 'Alpha Project',
        slug: 'alpha-project',
        description: 'Super cool project',
        trackId,
      },
    });
    await db.submission.create({
      data: {
        projectId,
        version: 1,
        title: 'Alpha Project v1',
        description: 'Initial submission',
        projectName: 'Alpha Project',
        status: 'SUBMITTED',
        submittedAt: new Date(),
        createdById: richParticipant.id,
      },
    });

    const judgeProfileId = randomUUID();
    await db.judgeProfile.create({
      data: {
        id: judgeProfileId,
        eventMembershipId: (
          await db.eventMembership.findFirstOrThrow({
            where: { eventId: richEventId, userId: richJudge.id },
          })
        ).id,
      },
    });

    const rubricId = randomUUID();
    await db.rubric.create({
      data: {
        id: rubricId,
        eventId: richEventId,
        name: 'Default Rubric',
        version: 1,
        status: 'DRAFT',
      },
    });
    const criterionId = randomUUID();
    await db.rubricCriterion.create({
      data: {
        id: criterionId,
        rubricId,
        name: 'Innovation',
        description: 'How innovative',
        weight: 1.0,
        minScore: 0,
        maxScore: 10,
        displayOrder: 0,
      },
    });
    await db.rubric.update({
      where: { id: rubricId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    const runId = randomUUID();
    await db.assignmentRun.create({
      data: {
        id: runId,
        eventId: richEventId,
        rubricVersionId: rubricId,
        type: 'MANUAL',
        status: 'PUBLISHED',
        reviewsPerSubmission: 1,
        algorithm: 'DETERMINISTIC',
        algorithmVersion: 'V1',
        allocationSource: 'TEST',
        createdById: richOrg.id,
        publishedAt: new Date(),
      },
    });
    const assignmentId = randomUUID();
    await db.judgeAssignment.create({
      data: {
        id: assignmentId,
        eventId: richEventId,
        runId,
        rubricId,
        judgeProfileId,
        submissionId: (
          await db.submission.findFirstOrThrow({ where: { projectId } })
        ).id,
        assignmentMethod: 'MANUAL',
      },
    });

    const evaluationId = randomUUID();
    await db.evaluation.create({
      data: {
        id: evaluationId,
        assignmentId,
        rubricId,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });
    await db.evaluationScore.create({
      data: {
        evaluationId,
        criterionId,
        score: 9,
      },
    });
    await db.evaluation.update({
      where: { id: evaluationId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });

    const { createHash } = await import('node:crypto');
    const inputHash = createHash('sha256')
      .update(evaluationId)
      .digest('hex')
      .slice(0, 32);

    const scoreRunId = randomUUID();
    await db.scoreRun.create({
      data: {
        id: scoreRunId,
        eventId: richEventId,
        rubricVersionId: rubricId,
        algorithm: 'DEFAULT',
        algorithmVersion: 'V1',
        method: 'Z_SCORE',
        methodVersion: 'V1',
        parameters: {},
        inputEvaluationIds: [evaluationId],
        status: 'COMPLETED',
        inputSetHash: inputHash,
        completedAt: new Date(),
        createdById: richOrg.id,
      },
    });
    await db.normalizedScore.create({
      data: {
        scoreRunId,
        evaluationId,
        projectId,
        judgeProfileId,
        rawScore: 9,
        normalizedScore: 9,
      },
    });
    await db.projectScore.create({
      data: {
        scoreRunId,
        projectId,
        aggregatedScore: 9,
        rawAverage: 9,
        evaluationCount: 1,
        requiredCount: 1,
        coverageComplete: true,
      },
    });

    const {
      signingKeyFromSeed,
      canonicalizePayload,
      signCanonicalPayload,
      verifyCanonicalPayload,
    } = await import('../src/modules/judge-records/judge-records.crypto');
    const seed = randomBytes(32).toString('hex');
    const keyMaterial = signingKeyFromSeed(seed);
    const keyRecord = await db.judgeRecordSigningKey.create({
      data: {
        id: keyMaterial.keyId,
        publicKeyPem: keyMaterial.publicKeyPem,
        fingerprint: keyMaterial.fingerprint,
        retiredAt: new Date(),
      },
    });

    const subjectRecord = await db.judgeRecordSubject.create({
      data: {
        eventId: richEventId,
        judgeProfileId,
      },
    });

    const recordId = randomUUID();
    const payload = {
      schemaVersion: 1 as const,
      recordId,
      eventId: richEventId,
      subjectId: subjectRecord.id,
      assignmentCount: 1,
      evaluationCount: 1,
      issuedAt: new Date().toISOString(),
      issuerKeyId: keyRecord.id,
    };
    const canonicalPayload = canonicalizePayload(payload);
    const signature = signCanonicalPayload(
      canonicalPayload,
      keyMaterial.privateKey,
    );

    await db.judgeParticipationRecord.create({
      data: {
        id: recordId,
        eventId: richEventId,
        judgeProfileId,
        subjectId: subjectRecord.id,
        issuerKeyId: keyRecord.id,
        assignmentCount: 1,
        evaluationCount: 1,
        issuedAt: new Date(payload.issuedAt),
        canonicalPayload,
        signature,
      },
    });

    // Webhook subscription (active in source)
    const webhookId = randomUUID();
    const { createCipheriv } = await import('node:crypto');
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.WEBHOOK_ENCRYPTION_KEY!.padEnd(32).slice(0, 32)),
      iv,
    );
    const ciphertext = Buffer.concat([
      cipher.update('source-secret', 'utf8'),
      cipher.final(),
    ]).toString('base64url');
    const tag = cipher.getAuthTag().toString('base64url');

    await db.webhookSubscription.create({
      data: {
        id: webhookId,
        eventId: richEventId,
        createdById: richOrg.id,
        url: 'https://example.test/enriched-hook',
        eventTypes: ['event.updated'],
        active: true,
        secretCiphertext: ciphertext,
        secretIv: iv.toString('hex'),
        secretAuthTag: tag,
      },
    });

    // Live votes and live comments in source
    const voterId = randomUUID();
    await db.votingIdentity.create({
      data: {
        id: voterId,
        eventId: richEventId,
        mode: 'OPEN',
        openTokenHash:
          'dummy-token-hash-64-hex-characters-long-for-testing-purposes-001',
      },
    });
    await db.communityVote.create({
      data: {
        eventId: richEventId,
        projectId,
        identityId: voterId,
      },
    });
    await db.projectComment.create({
      data: {
        eventId: richEventId,
        projectId,
        identityId: voterId,
        body: 'Great project Alpha!',
        status: 'VISIBLE',
      },
    });

    // 2. Export rich source event
    const exportRes = await get(
      `/events/${richEventId}/archive`,
      richOrg.cookie,
    );
    expect(exportRes.status).toBe(200);
    const richArchive = exportRes.body as EventArchive;

    // Verify privacy in export
    expect(richArchive.payload.voteAggregates).toEqual([
      { projectId, count: 1 },
    ]);
    expect(richArchive.payload.comments).toHaveLength(1);
    expect(richArchive.payload.comments[0]!.body).toBe('Great project Alpha!');
    const exportJson = JSON.stringify(richArchive);
    expect(exportJson).not.toContain(voterId);
    expect(exportJson).not.toContain('source-secret');

    // Negative controls on rich archive
    const droppedComment = JSON.parse(JSON.stringify(richArchive));
    droppedComment.payload.comments = [];
    expect(semanticNormalize(droppedComment)).not.toBe(
      semanticNormalize(richArchive),
    );

    const changedVoteCount = JSON.parse(JSON.stringify(richArchive));
    changedVoteCount.payload.voteAggregates[0].count = 999;
    expect(semanticNormalize(changedVoteCount)).not.toBe(
      semanticNormalize(richArchive),
    );

    // 3. Preview and Confirm import into destination
    const previewRes = await post(
      '/events/archives/preview',
      { archive: richArchive },
      outsider.cookie,
    );
    expect(previewRes.status).toBe(201);

    const confirmRes = await post(
      '/events/archives/confirm',
      { archive: richArchive, packageHash: richArchive.packageHash },
      outsider.cookie,
    );
    expect(confirmRes.status).toBe(201);
    const destEventId = confirmRes.body.eventId as string;

    // 4. Export destination and verify semantic normalization equivalence
    const destExportRes = await get(
      `/events/${destEventId}/archive`,
      outsider.cookie,
    );
    expect(destExportRes.status).toBe(200);
    const destArchive = destExportRes.body as EventArchive;

    const plan = planArchive(richArchive);
    expect(semanticNormalize(destArchive, plan.ids)).toBe(
      semanticNormalize(richArchive),
    );

    // 5. Verify cryptographic validity of imported judge participation record
    const destRecord = await db.judgeParticipationRecord.findFirstOrThrow({
      where: { eventId: destEventId },
      include: { issuerKey: true },
    });
    expect(destRecord.sourceInstanceId).toBe(richArchive.source.instanceId);
    expect(
      verifyCanonicalPayload(
        destRecord.canonicalPayload,
        destRecord.signature,
        destRecord.issuerKey.publicKeyPem,
      ),
    ).toBe(true);

    // 6. Verify destination webhook is disabled and secretless
    const destWebhook = await db.webhookSubscription.findFirstOrThrow({
      where: { eventId: destEventId },
    });
    expect(destWebhook.active).toBe(false);
    expect(destWebhook.secretCiphertext).toBeNull();
    expect(destWebhook.secretIv).toBeNull();
    expect(destWebhook.secretAuthTag).toBeNull();

    // 7. Verify voting tally incorporates imported vote aggregate without double counting
    const destProject = await db.project.findFirstOrThrow({
      where: { eventId: destEventId },
    });
    const importedAgg = await db.importedVoteAggregate.findUniqueOrThrow({
      where: {
        eventId_projectId: {
          eventId: destEventId,
          projectId: destProject.id,
        },
      },
    });
    expect(importedAgg.count).toBe(1);
  });

  it('completes official fixture archive round-trip with semantic normalization equivalence', async () => {
    const { execFileSync } = await import('node:child_process');
    const { createHash } = await import('node:crypto');

    // Ensure official fixtures are imported in this test database
    execFileSync('npm', ['run', 'db:import:official'], {
      encoding: 'utf8',
      env: process.env,
    });

    const officialEventId = '8727a75d-bbe8-584a-9c95-d5c1a916e38c';
    const fixtureOrganizerCookie = createHash('sha256')
      .update('dogfood-2026-official-fixture:acceptance-cookie:organizer')
      .digest('base64url');
    const orgCookie = `dogfood_session=${fixtureOrganizerCookie}`;

    // 1. Export official fixture event
    const exportRes = await get(
      `/events/${officialEventId}/archive`,
      orgCookie,
    );
    expect(exportRes.status).toBe(200);
    const officialArchive = exportRes.body as EventArchive;
    expect(officialArchive.manifest.totalRows).toBeGreaterThan(0);

    // 2. Preview import with a new destination user
    const importActor = await actor('official-archive-importer');
    const previewRes = await post(
      '/events/archives/preview',
      { archive: officialArchive },
      importActor.cookie,
    );
    expect(previewRes.status).toBe(201);
    expect(previewRes.body.packageHash).toBe(officialArchive.packageHash);

    // 3. Confirm import into destination
    const confirmRes = await post(
      '/events/archives/confirm',
      { archive: officialArchive, packageHash: officialArchive.packageHash },
      importActor.cookie,
    );
    expect(confirmRes.status).toBe(201);
    expect(confirmRes.body.status).toBe('IMPORTED');
    const destEventId = confirmRes.body.eventId as string;

    // 4. Export destination event
    const destExportRes = await get(
      `/events/${destEventId}/archive`,
      importActor.cookie,
    );
    expect(destExportRes.status).toBe(200);
    const destArchive = destExportRes.body as EventArchive;

    // 5. Assert semantic normalization equivalence
    const plan = planArchive(officialArchive);
    expect(semanticNormalize(destArchive, plan.ids)).toBe(
      semanticNormalize(officialArchive),
    );
  });

  it('enforces route-scoped body limit: rejects oversized non-archive requests but accepts >1MB archive payloads within 20MB limit', async () => {
    // 1. Non-archive route with body > 1MB is rejected with 413
    const oversizedNonArchiveBody = {
      email: 'test@example.test',
      password: 'password123',
      displayName: 'x'.repeat(1024 * 1024 + 1024),
    };
    const nonArchiveRes = await post('/auth/register', oversizedNonArchiveBody);
    expect(nonArchiveRes.status).toBe(413);

    // 2. Archive route accepts payload > 1MB (e.g. 1.2MB) within MAX_ARCHIVE_BYTES
    const largeArchive = changed((copy) => {
      copy.payload.event.description = 'x'.repeat(600 * 1024);
      copy.payload.event.rules = 'y'.repeat(600 * 1024);
    });
    const largePayload = { archive: largeArchive };
    const previewRes = await post(
      '/events/archives/preview',
      largePayload,
      organizer.cookie,
    );
    expect(previewRes.status).toBe(201);
    expect(previewRes.body.packageHash).toBe(largeArchive.packageHash);

    // 3. Archive route rejects payload exceeding MAX_ARCHIVE_BYTES + 1MB with 413 or socket termination
    const exceedingBody = {
      archive: 'x'.repeat(MAX_ARCHIVE_BYTES + 1024 * 1024 + 1024),
    };
    try {
      const exceedingRes = await post(
        '/events/archives/preview',
        exceedingBody,
        organizer.cookie,
      );
      expect(exceedingRes.status).toBe(413);
    } catch (err: unknown) {
      expect(['ECONNRESET', 'EPIPE']).toContain(
        (err as { code?: string }).code,
      );
    }
  });

  it('combines imported historical vote aggregates with subsequent live community voting without double counting', async () => {
    // 1. Create a source event with a team and project, and 2 votes
    const testOrg = await actor('vote-combo-org');
    const testEvtId = randomUUID();
    const past = new Date(Date.now() - 3600000);
    const future = new Date(Date.now() + 3600000);
    await db.event.create({
      data: {
        id: testEvtId,
        slug: `vote-combo-${testEvtId}`,
        name: 'Vote Combo Event',
        createdById: testOrg.id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        galleryVisibility: 'PUBLIC',
        votingAccessMode: 'OPEN',
        votingOpensAt: past,
        votingClosesAt: future,
      },
    });
    await db.eventMembership.create({
      data: {
        id: randomUUID(),
        eventId: testEvtId,
        userId: testOrg.id,
        role: 'ORGANIZER',
      },
    });
    const teamId = randomUUID();
    await db.team.create({
      data: {
        id: teamId,
        eventId: testEvtId,
        name: 'Combo Team',
        slug: 'combo-team',
        createdById: testOrg.id,
        status: 'ACTIVE',
      },
    });
    const projId = randomUUID();
    await db.project.create({
      data: {
        id: projId,
        eventId: testEvtId,
        teamId,
        name: 'Combo Project',
        slug: 'combo-project',
        status: 'ACTIVE',
      },
    });
    await db.submission.create({
      data: {
        id: randomUUID(),
        projectId: projId,
        version: 1,
        title: 'Combo Submission',
        projectName: 'Combo Project',
        description: 'Demo',
        status: 'LOCKED',
        createdById: testOrg.id,
        submittedAt: past,
        lockedAt: past,
      },
    });
    for (let i = 0; i < 2; i++) {
      const vid = randomUUID();
      await db.votingIdentity.create({
        data: {
          id: vid,
          eventId: testEvtId,
          mode: 'OPEN',
          openTokenHash: randomBytes(32).toString('hex'),
        },
      });
      await db.communityVote.create({
        data: {
          id: randomUUID(),
          eventId: testEvtId,
          projectId: projId,
          identityId: vid,
          abuseSignalHash: randomBytes(32).toString('hex'),
          castAt: past,
        },
      });
    }

    // Export archive
    const exportRes = await get(`/events/${testEvtId}/archive`, testOrg.cookie);
    expect(exportRes.status).toBe(200);
    const voteArchive = exportRes.body as EventArchive;
    expect(voteArchive.payload.voteAggregates).toEqual([
      expect.objectContaining({ count: 2 }),
    ]);

    // Import into destination
    const destOrg = await actor('dest-vote-org');
    const previewRes = await post(
      '/events/archives/preview',
      { archive: voteArchive },
      destOrg.cookie,
    );
    expect(previewRes.status).toBe(201);

    const confirmRes = await post(
      '/events/archives/confirm',
      { archive: voteArchive, packageHash: voteArchive.packageHash },
      destOrg.cookie,
    );
    expect(confirmRes.status).toBe(201);
    const destEventId = confirmRes.body.eventId as string;

    // Step 2: Verify historical ballots / voter identities were NOT reconstructed
    const destBallots = await db.communityVote.count({
      where: { eventId: destEventId },
    });
    expect(destBallots).toBe(0);
    const destIdentities = await db.votingIdentity.count({
      where: { eventId: destEventId },
    });
    expect(destIdentities).toBe(0);

    const destProject = await db.project.findFirstOrThrow({
      where: { eventId: destEventId },
    });
    const importedAgg = await db.importedVoteAggregate.findUniqueOrThrow({
      where: {
        eventId_projectId: {
          eventId: destEventId,
          projectId: destProject.id,
        },
      },
    });
    expect(importedAgg.count).toBe(2);

    // Step 3: Open live voting on destination event according to normal lifecycle
    await db.event.update({
      where: { id: destEventId },
      data: {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        galleryVisibility: 'PUBLIC',
        votingAccessMode: 'OPEN',
        votingOpensAt: new Date(Date.now() - 3600000),
        votingClosesAt: new Date(Date.now() + 3600000),
      },
    });

    // Step 4: Cast exactly one new live CommunityVote for that project
    const voteRes = await post(`/events/${destEventId}/voting/votes`, {
      projectId: destProject.id,
    });
    expect(voteRes.status).toBe(201);

    // Step 5: Verify organizer tally = N + 1 = 3 (2 historical + 1 live)
    const orgResultsRes = await get(
      `/events/${destEventId}/voting/results`,
      destOrg.cookie,
    );
    expect(orgResultsRes.status).toBe(200);
    const orgItem = orgResultsRes.body.items.find(
      (it: { projectId: string }) => it.projectId === destProject.id,
    );
    expect(orgItem.votes).toBe(3);

    // Step 6: Verify public results remain hidden before the normal closing condition (403)
    const publicResultsBeforeClose = await get(
      `/events/${destEventId}/voting/results`,
    );
    expect(publicResultsBeforeClose.status).toBe(403);
    expect(publicResultsBeforeClose.body.code).toBe('RESULTS_HIDDEN');

    // Step 7: Advance / close the event through legitimate mechanism (votingClosesAt reached)
    await db.event.update({
      where: { id: destEventId },
      data: {
        votingClosesAt: new Date(Date.now() - 1000),
      },
    });

    // Step 8: Verify public tally after close = N + 1 = 3
    const publicResultsAfterClose = await get(
      `/events/${destEventId}/voting/results`,
    );
    expect(publicResultsAfterClose.status).toBe(200);
    const pubItem = publicResultsAfterClose.body.items.find(
      (it: { projectId: string }) => it.projectId === destProject.id,
    );
    expect(pubItem.votes).toBe(3);

    // Step 9: Proves historical aggregate was not double-counted (1 live vote + aggregate of 2 = exactly 3)
    const finalLiveVotes = await db.communityVote.count({
      where: { eventId: destEventId, projectId: destProject.id },
    });
    expect(finalLiveVotes).toBe(1);
    const finalAgg = await db.importedVoteAggregate.findUniqueOrThrow({
      where: {
        eventId_projectId: {
          eventId: destEventId,
          projectId: destProject.id,
        },
      },
    });
    expect(finalAgg.count).toBe(2);
  });
});
