import { PrismaClient } from '@prisma/client';
import { scryptSync } from 'node:crypto';
const db = new PrismaClient();
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = new Date('2026-01-01T00:00:00Z');
async function seed() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Development seed is disabled in production.');
  // Fixed salt ONLY for these public development credentials. Real signup needs random salts.
  const salt = 'dogfood-public-development-fixture';
  const passwordHash = `scrypt$${salt}$${scryptSync('Dogfood-dev-only!', salt, 64).toString('hex')}`;
  await db.$transaction(async (tx) => {
    const names = [
      'Admin',
      'Organizer',
      'Participant One',
      'Participant Two',
      'Participant Three',
      'Judge One',
      'Judge Two',
    ];
    for (const [i, displayName] of names.entries()) {
      await tx.user.upsert({
        where: { id: uuid(i + 1) },
        update: {},
        create: {
          id: uuid(i + 1),
          email: `${['admin', 'organizer', 'participant1', 'participant2', 'participant3', 'judge1', 'judge2'][i]}@dogfood.local`,
          displayName,
          passwordHash,
          createdAt: at,
          updatedAt: at,
        },
      });
    }
    await tx.platformRole.upsert({
      where: { userId_role: { userId: uuid(1), role: 'ADMIN' } },
      update: {},
      create: { userId: uuid(1), role: 'ADMIN', createdAt: at },
    });
    await tx.event.upsert({
      where: { id: uuid(10) },
      update: {},
      create: {
        id: uuid(10),
        slug: 'dogfood-demo',
        name: 'Dogfood Demo Hackathon',
        timezone: 'UTC',
        visibility: 'PUBLIC',
        galleryVisibility: 'PUBLIC',
        status: 'PUBLISHED',
        createdById: uuid(2),
        createdAt: at,
        updatedAt: at,
      },
    });
    for (const user of [2, 3, 4, 5, 6, 7]) {
      const role =
        user === 2 ? 'ORGANIZER' : user >= 6 ? 'JUDGE' : 'PARTICIPANT';
      await tx.eventMembership.upsert({
        where: { id: uuid(20 + user) },
        update: {},
        create: {
          id: uuid(20 + user),
          eventId: uuid(10),
          userId: uuid(user),
          role,
          createdAt: at,
          updatedAt: at,
        },
      });
      if (role === 'PARTICIPANT')
        await tx.registration.upsert({
          where: { id: uuid(30 + user) },
          update: {},
          create: {
            id: uuid(30 + user),
            eventId: uuid(10),
            userId: uuid(user),
            status: 'APPROVED',
            registeredAt: at,
            updatedAt: at,
          },
        });
    }
    for (const [i, name] of ['Open Innovation', 'Developer Tools'].entries()) {
      await tx.track.upsert({
        where: { id: uuid(40 + i) },
        update: {},
        create: {
          id: uuid(40 + i),
          eventId: uuid(10),
          name,
          slug: i === 0 ? 'open' : 'devtools',
          createdAt: at,
          updatedAt: at,
        },
      });
      await tx.prize.upsert({
        where: { id: uuid(50 + i) },
        update: {},
        create: {
          id: uuid(50 + i),
          eventId: uuid(10),
          trackId: uuid(40 + i),
          name: `${name} Prize`,
          position: 1,
          createdAt: at,
          updatedAt: at,
        },
      });
    }
    await tx.team.upsert({
      where: { id: uuid(60) },
      update: {},
      create: {
        id: uuid(60),
        eventId: uuid(10),
        name: 'The Builders',
        slug: 'builders',
        createdById: uuid(3),
        status: 'ACTIVE',
        createdAt: at,
        updatedAt: at,
      },
    });
    for (const user of [3, 4, 5])
      await tx.teamMember.upsert({
        where: { id: uuid(60 + user) },
        update: {},
        create: {
          id: uuid(60 + user),
          eventId: uuid(10),
          teamId: uuid(60),
          userId: uuid(user),
          role: user === 3 ? 'OWNER' : 'MEMBER',
          joinedAt: at,
        },
      });
    await tx.project.upsert({
      where: { id: uuid(70) },
      update: {},
      create: {
        id: uuid(70),
        eventId: uuid(10),
        teamId: uuid(60),
        trackId: uuid(40),
        name: 'Welcome to Dogfood',
        slug: 'welcome',
        description: 'A deterministic demonstration project.',
        status: 'ACTIVE',
        createdAt: at,
        updatedAt: at,
      },
    });
    await tx.submission.upsert({
      where: { id: uuid(80) },
      update: {},
      create: {
        id: uuid(80),
        projectId: uuid(70),
        version: 1,
        title: 'Welcome to Dogfood',
        description: 'The first immutable demo submission.',
        projectName: 'Welcome to Dogfood',
        trackId: uuid(40),
        trackName: 'Open Innovation',
        status: 'LOCKED',
        createdById: uuid(3),
        createdAt: at,
        submittedAt: at,
        lockedAt: at,
      },
    });
    for (const user of [6, 7])
      await tx.judgeProfile.upsert({
        where: { id: uuid(90 + user) },
        update: {},
        create: {
          id: uuid(90 + user),
          eventMembershipId: uuid(20 + user),
          organization: 'Demo Judges',
          maxAssignments: 5,
          createdAt: at,
          updatedAt: at,
        },
      });
    await tx.rubric.upsert({
      where: { id: uuid(100) },
      update: {},
      create: {
        id: uuid(100),
        eventId: uuid(10),
        name: 'Demo Rubric',
        version: 1,
        createdAt: at,
      },
    });
    for (const [i, name] of ['Impact', 'Execution', 'Originality'].entries())
      await tx.rubricCriterion.upsert({
        where: { id: uuid(101 + i) },
        update: {},
        create: {
          id: uuid(101 + i),
          rubricId: uuid(100),
          name,
          weight: i === 0 ? '0.4' : '0.3',
          minScore: 0,
          maxScore: 10,
          displayOrder: i,
          createdAt: at,
        },
      });
  });
  console.log('Development fixtures ready. Password: Dogfood-dev-only!');
}
void seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
