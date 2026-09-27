import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const suffix = () => randomUUID().slice(0, 12);
const hex = (value: string) => value.repeat(64).slice(0, 64);
let passed = 0;
let failed = 0;

async function check(name: string, test: () => Promise<void>) {
  try {
    await test();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`, error);
  }
}

async function rejects(
  operation: () => Promise<unknown>,
  code: string,
  expected: string,
) {
  let error: unknown;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `Expected ${expected} to reject`);
  assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
  assert.equal(error.code, code);
  assert.match(JSON.stringify(error.meta), new RegExp(expected));
}

async function user() {
  const key = suffix();
  return db.user.create({
    data: {
      email: `t3a-${key}@example.test`,
      displayName: `T3A ${key}`,
      passwordHash: 'database-test-only',
    },
  });
}

async function fixture(
  mode: 'OPEN' | 'EMAIL_GATED' | 'AUTHENTICATED' = 'AUTHENTICATED',
) {
  const organizer = await user();
  const key = suffix();
  const event = await db.event.create({
    data: {
      slug: `t3a-event-${key}`,
      name: `T3A event ${key}`,
      createdById: organizer.id,
      votingAccessMode: mode,
      visibility: 'PUBLIC',
      galleryVisibility: 'PUBLIC',
      status: 'PUBLISHED',
    },
  });
  const team = await db.team.create({
    data: {
      eventId: event.id,
      createdById: organizer.id,
      name: `T3A team ${key}`,
      slug: `t3a-team-${key}`,
    },
  });
  const project = await db.project.create({
    data: {
      eventId: event.id,
      teamId: team.id,
      name: `T3A project ${key}`,
      slug: `t3a-project-${key}`,
    },
  });
  return { organizer, event, project };
}

async function identity(eventId: string) {
  const voter = await user();
  const record = await db.votingIdentity.create({
    data: { eventId, mode: 'AUTHENTICATED', userId: voter.id },
  });
  return { voter, record };
}

async function main() {
  await check(
    'concurrent duplicate votes are rejected by event/identity uniqueness',
    async () => {
      const { event, project } = await fixture();
      const { record } = await identity(event.id);
      const outcomes = await Promise.allSettled([
        db.communityVote.create({
          data: {
            eventId: event.id,
            projectId: project.id,
            identityId: record.id,
          },
        }),
        db.communityVote.create({
          data: {
            eventId: event.id,
            projectId: project.id,
            identityId: record.id,
          },
        }),
      ]);
      assert.equal(
        outcomes.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      const loser = outcomes.find((result) => result.status === 'rejected');
      assert.ok(loser && loser.status === 'rejected');
      assert.ok(loser.reason instanceof Prisma.PrismaClientKnownRequestError);
      assert.equal(loser.reason.code, 'P2002');
      assert.deepEqual(loser.reason.meta?.target, ['eventId', 'identityId']);
      assert.equal(
        await db.communityVote.count({ where: { eventId: event.id } }),
        1,
      );
    },
  );

  await check(
    'one account cannot create two voting identities in one event',
    async () => {
      const { event } = await fixture();
      const { voter } = await identity(event.id);
      await rejects(
        () =>
          db.votingIdentity.create({
            data: {
              eventId: event.id,
              mode: 'AUTHENTICATED',
              userId: voter.id,
            },
          }),
        'P2002',
        'eventId.*userId',
      );
    },
  );

  await check(
    'vote and comment reject a project from another event',
    async () => {
      const a = await fixture();
      const b = await fixture();
      const { record } = await identity(a.event.id);
      await rejects(
        () =>
          db.communityVote.create({
            data: {
              eventId: a.event.id,
              projectId: b.project.id,
              identityId: record.id,
            },
          }),
        'P2003',
        'CommunityVote_projectId_eventId_fkey',
      );
      await rejects(
        () =>
          db.projectComment.create({
            data: {
              eventId: a.event.id,
              projectId: b.project.id,
              identityId: record.id,
              body: 'Wrong event',
            },
          }),
        'P2003',
        'ProjectComment_projectId_eventId_fkey',
      );
    },
  );

  await check(
    'vote and comment reject an identity from another event',
    async () => {
      const a = await fixture();
      const b = await fixture();
      const { record } = await identity(b.event.id);
      await rejects(
        () =>
          db.communityVote.create({
            data: {
              eventId: a.event.id,
              projectId: a.project.id,
              identityId: record.id,
            },
          }),
        'P2003',
        'CommunityVote_identityId_eventId_fkey',
      );
      await rejects(
        () =>
          db.projectComment.create({
            data: {
              eventId: a.event.id,
              projectId: a.project.id,
              identityId: record.id,
              body: 'Wrong voter event',
            },
          }),
        'P2003',
        'ProjectComment_identityId_eventId_fkey',
      );
    },
  );

  await check(
    'identity mode and credential shape are database-enforced',
    async () => {
      const { event } = await fixture();
      await rejects(
        () =>
          db.$executeRaw`INSERT INTO "VotingIdentity" ("id", "eventId", "mode", "emailHash") VALUES (${randomUUID()}::uuid, ${event.id}::uuid, 'AUTHENTICATED', ${hex('a')})`,
        'P2010',
        'VotingIdentity_mode_subject_check',
      );
      await rejects(
        () =>
          db.$executeRaw`INSERT INTO "VotingIdentity" ("id", "eventId", "mode", "openTokenHash") VALUES (${randomUUID()}::uuid, ${event.id}::uuid, 'OPEN', ${hex('b')})`,
        'P2010',
        '23503',
      );
    },
  );

  await check(
    'email and open identities deduplicate within their mode',
    async () => {
      const emailEvent = await fixture('EMAIL_GATED');
      const openEvent = await fixture('OPEN');
      const emailHash = hex('c');
      const openTokenHash = hex('d');
      await db.votingIdentity.create({
        data: {
          eventId: emailEvent.event.id,
          mode: 'EMAIL_GATED',
          emailHash,
          emailAcceptedAt: new Date(),
        },
      });
      await db.votingIdentity.create({
        data: { eventId: openEvent.event.id, mode: 'OPEN', openTokenHash },
      });
      await rejects(
        () =>
          db.votingIdentity.create({
            data: {
              eventId: emailEvent.event.id,
              mode: 'EMAIL_GATED',
              emailHash,
              emailAcceptedAt: new Date(),
            },
          }),
        'P2002',
        'eventId.*emailHash',
      );
      await rejects(
        () =>
          db.votingIdentity.create({
            data: { eventId: openEvent.event.id, mode: 'OPEN', openTokenHash },
          }),
        'P2002',
        'eventId.*openTokenHash',
      );
    },
  );

  await check(
    'an event mode cannot change after an identity exists',
    async () => {
      const { event } = await fixture();
      await identity(event.id);
      await rejects(
        () =>
          db.event.update({
            where: { id: event.id },
            data: { votingAccessMode: 'OPEN' },
          }),
        'P2003',
        'VotingIdentity_eventId_mode_fkey',
      );
    },
  );

  await check(
    'deleting a voter or voted project cannot erase votes',
    async () => {
      const { event, project } = await fixture();
      const { voter, record } = await identity(event.id);
      await db.communityVote.create({
        data: {
          eventId: event.id,
          projectId: project.id,
          identityId: record.id,
        },
      });
      await rejects(
        () => db.user.delete({ where: { id: voter.id } }),
        'P2003',
        'VotingIdentity_userId_fkey',
      );
      await rejects(
        () => db.project.delete({ where: { id: project.id } }),
        'P2003',
        'CommunityVote_projectId_eventId_fkey',
      );
      assert.equal(
        await db.communityVote.count({ where: { eventId: event.id } }),
        1,
      );
    },
  );

  await check(
    'deleting a commented project cannot erase comments',
    async () => {
      const { event, project } = await fixture();
      const { voter, record } = await identity(event.id);
      await db.projectComment.create({
        data: {
          eventId: event.id,
          projectId: project.id,
          identityId: record.id,
          body: 'Keep this',
        },
      });
      await rejects(
        () => db.project.delete({ where: { id: project.id } }),
        'P2003',
        'ProjectComment_projectId_eventId_fkey',
      );
      await rejects(
        () => db.user.delete({ where: { id: voter.id } }),
        'P2003',
        'VotingIdentity_userId_fkey',
      );
      assert.equal(
        await db.projectComment.count({ where: { eventId: event.id } }),
        1,
      );
    },
  );

  await check(
    'write buckets have atomic identity keys and nonnegative counts',
    async () => {
      const { event } = await fixture();
      const key = {
        eventId: event.id,
        action: 'VOTE' as const,
        subjectHash: hex('e'),
        windowStart: new Date('2026-01-01T00:00:00.000Z'),
      };
      await db.publicWriteBucket.create({ data: key });
      await rejects(
        () => db.publicWriteBucket.create({ data: key }),
        'P2002',
        'eventId.*action.*subjectHash.*windowStart',
      );
      await rejects(
        () =>
          db.$executeRaw`UPDATE "PublicWriteBucket" SET "attemptCount" = -1 WHERE "eventId" = ${event.id}::uuid`,
        'P2010',
        'PublicWriteBucket_nonnegative_attempts_check',
      );
    },
  );

  await check(
    'suspected duplicate signals do not reject different identities',
    async () => {
      const { event, project } = await fixture();
      const first = await identity(event.id);
      const second = await identity(event.id);
      const signal = hex('f');
      for (const identityId of [first.record.id, second.record.id]) {
        await db.communityVote.create({
          data: {
            eventId: event.id,
            projectId: project.id,
            identityId,
            abuseSignalHash: signal,
          },
        });
      }
      assert.equal(
        await db.communityVote.count({
          where: { eventId: event.id, abuseSignalHash: signal },
        }),
        2,
      );
    },
  );

  await check(
    'comment visible-to-hidden transition persists with moderation metadata',
    async () => {
      const { event, project, organizer } = await fixture();
      const { record } = await identity(event.id);
      const comment = await db.projectComment.create({
        data: {
          eventId: event.id,
          projectId: project.id,
          identityId: record.id,
          body: 'Needs review',
        },
      });
      assert.equal(comment.status, 'VISIBLE');
      const hiddenAt = new Date();
      await db.projectComment.update({
        where: { id: comment.id },
        data: { status: 'HIDDEN', hiddenAt, hiddenById: organizer.id },
      });
      const stored = await db.projectComment.findUniqueOrThrow({
        where: { id: comment.id },
      });
      assert.equal(stored.status, 'HIDDEN');
      assert.equal(stored.hiddenAt?.getTime(), hiddenAt.getTime());
      assert.equal(stored.hiddenById, organizer.id);
      await rejects(
        () =>
          db.$executeRaw`UPDATE "ProjectComment" SET "hiddenById" = NULL WHERE "id" = ${comment.id}::uuid`,
        'P2010',
        'ProjectComment_moderation_state_check',
      );
    },
  );

  await check(
    'audit records remain insert-only at the database level',
    async () => {
      const { event, organizer } = await fixture();
      const audit = await db.auditEvent.create({
        data: {
          eventId: event.id,
          actorUserId: organizer.id,
          action: 'T3A_TEST',
          entityType: 'Event',
          entityId: event.id,
        },
      });
      await rejects(
        () =>
          db.$executeRaw`UPDATE "AuditEvent" SET "action" = 'REWRITTEN' WHERE "id" = ${audit.id}::uuid`,
        'P2010',
        'AuditEvent is append-only',
      );
      await rejects(
        () =>
          db.$executeRaw`DELETE FROM "AuditEvent" WHERE "id" = ${audit.id}::uuid`,
        'P2010',
        'AuditEvent is append-only',
      );
    },
  );

  console.log(`T3A database invariants: ${passed} PASS, ${failed} FAIL`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
