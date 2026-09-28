import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';

if (!(process.env.DATABASE_URL ?? '').includes('_test')) {
  throw new Error('Isolated test database required for integration tests');
}

const db = new PrismaClient();

describe('Phase B4.1 — Database Invariants Proof', () => {
  let organizerUserId: string;
  let event1Id: string;
  let event2Id: string;
  let judge1MembershipId: string;
  let judge1ProfileId: string;
  let judge2MembershipId: string;
  let judge2ProfileId: string;
  let project1AId: string;
  let project1BId: string;
  let project1CId: string;
  let project2AId: string;
  let pairwiseRun1Id: string;

  beforeAll(async () => {
    // 1. Create organizer user
    const organizer = await db.user.create({
      data: {
        email: `b41-org-${randomUUID()}@example.test`,
        displayName: 'B4.1 Organizer',
        passwordHash: 'test-hash-organizer',
      },
    });
    organizerUserId = organizer.id;

    // 2. Create Event 1 and Event 2
    const event1 = await db.event.create({
      data: {
        name: 'B4.1 Invariant Test Event 1',
        slug: `b41-evt1-${randomUUID().slice(0, 8)}`,
        createdById: organizerUserId,
      },
    });
    event1Id = event1.id;

    const event2 = await db.event.create({
      data: {
        name: 'B4.1 Invariant Test Event 2',
        slug: `b41-evt2-${randomUUID().slice(0, 8)}`,
        createdById: organizerUserId,
      },
    });
    event2Id = event2.id;

    // 3. Create Judge 1 for Event 1
    const judge1User = await db.user.create({
      data: {
        email: `b41-judge1-${randomUUID()}@example.test`,
        displayName: 'Judge 1 (Event 1)',
        passwordHash: 'test-hash-judge1',
      },
    });
    const mem1 = await db.eventMembership.create({
      data: {
        eventId: event1Id,
        userId: judge1User.id,
        role: 'JUDGE',
      },
    });
    judge1MembershipId = mem1.id;
    const prof1 = await db.judgeProfile.create({
      data: { eventMembershipId: judge1MembershipId },
    });
    judge1ProfileId = prof1.id;

    // 4. Create Judge 2 for Event 2 (Cross-event judge)
    const judge2User = await db.user.create({
      data: {
        email: `b41-judge2-${randomUUID()}@example.test`,
        displayName: 'Judge 2 (Event 2)',
        passwordHash: 'test-hash-judge2',
      },
    });
    const mem2 = await db.eventMembership.create({
      data: {
        eventId: event2Id,
        userId: judge2User.id,
        role: 'JUDGE',
      },
    });
    judge2MembershipId = mem2.id;
    const prof2 = await db.judgeProfile.create({
      data: { eventMembershipId: judge2MembershipId },
    });
    judge2ProfileId = prof2.id;

    // 5. Create Projects for Event 1 (teams first)
    const team1A = await db.team.create({
      data: {
        eventId: event1Id,
        name: 'Team 1A',
        slug: `team-1a-${randomUUID().slice(0, 8)}`,
        createdById: organizerUserId,
      },
    });
    const p1A = await db.project.create({
      data: {
        eventId: event1Id,
        teamId: team1A.id,
        name: 'Project 1A',
        slug: `proj-1a-${randomUUID().slice(0, 8)}`,
      },
    });
    project1AId = p1A.id;

    const team1B = await db.team.create({
      data: {
        eventId: event1Id,
        name: 'Team 1B',
        slug: `team-1b-${randomUUID().slice(0, 8)}`,
        createdById: organizerUserId,
      },
    });
    const p1B = await db.project.create({
      data: {
        eventId: event1Id,
        teamId: team1B.id,
        name: 'Project 1B',
        slug: `proj-1b-${randomUUID().slice(0, 8)}`,
      },
    });
    project1BId = p1B.id;

    const team1C = await db.team.create({
      data: {
        eventId: event1Id,
        name: 'Team 1C',
        slug: `team-1c-${randomUUID().slice(0, 8)}`,
        createdById: organizerUserId,
      },
    });
    const p1C = await db.project.create({
      data: {
        eventId: event1Id,
        teamId: team1C.id,
        name: 'Project 1C',
        slug: `proj-1c-${randomUUID().slice(0, 8)}`,
      },
    });
    project1CId = p1C.id;

    // 6. Create Project for Event 2 (Cross-event project)
    const team2A = await db.team.create({
      data: {
        eventId: event2Id,
        name: 'Team 2A',
        slug: `team-2a-${randomUUID().slice(0, 8)}`,
        createdById: organizerUserId,
      },
    });
    const p2A = await db.project.create({
      data: {
        eventId: event2Id,
        teamId: team2A.id,
        name: 'Project 2A',
        slug: `proj-2a-${randomUUID().slice(0, 8)}`,
      },
    });
    project2AId = p2A.id;

    // 7. Create PairwiseRun for Event 1
    const run = await db.pairwiseRun.create({
      data: {
        eventId: event1Id,
        createdById: organizerUserId,
        algorithm: 'BRADLEY_TERRY_RIDGE',
        algorithmVersion: 'V1',
        lambda: new Prisma.Decimal('0.01'),
      },
    });
    pairwiseRun1Id = run.id;
  });

  afterAll(async () => {
    // Teardown
    await db.pairwiseProjectResult
      .deleteMany({
        where: { rankingRun: { pairwiseRunId: pairwiseRun1Id } },
      })
      .catch(() => {});
    await db.pairwiseRankingRun
      .deleteMany({
        where: { pairwiseRunId: pairwiseRun1Id },
      })
      .catch(() => {});
    await db.pairwiseComparison
      .deleteMany({
        where: { assignment: { runId: pairwiseRun1Id } },
      })
      .catch(() => {});
    await db.pairwiseAssignment
      .deleteMany({
        where: { runId: pairwiseRun1Id },
      })
      .catch(() => {});
    await db.pairwiseRun
      .deleteMany({
        where: { id: pairwiseRun1Id },
      })
      .catch(() => {});

    await db.$disconnect();
  });

  // Helper to ensure canonical order in tests
  function canonicalPair(idA: string, idB: string): [string, string] {
    return idA < idB ? [idA, idB] : [idB, idA];
  }

  // =========================================================================
  // 1. NO SELF PAIRS: projectAId != projectBId
  // =========================================================================
  it('Invariant 1: rejects assignment where projectAId == projectBId', async () => {
    await expect(
      db.pairwiseAssignment.create({
        data: {
          runId: pairwiseRun1Id,
          judgeProfileId: judge1ProfileId,
          projectAId: project1AId,
          projectBId: project1AId, // Self pair
        },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 2. CANONICAL ORDER: projectAId < projectBId
  // =========================================================================
  it('Invariant 2: rejects assignment where projectAId > projectBId (non-canonical order)', async () => {
    const [lowerId, higherId] = canonicalPair(project1AId, project1BId);

    // Intentionally pass higherId as projectAId and lowerId as projectBId
    await expect(
      db.pairwiseAssignment.create({
        data: {
          runId: pairwiseRun1Id,
          judgeProfileId: judge1ProfileId,
          projectAId: higherId,
          projectBId: lowerId,
        },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 3. UNIQUE PAIR PER JUDGE PER RUN
  // =========================================================================
  it('Invariant 3: rejects duplicate same judge + same pair + same run', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1BId);

    // First creation succeeds
    const assignment1 = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });
    expect(assignment1.id).toBeDefined();

    // Duplicate creation for same judge + same pair + same run must be rejected
    await expect(
      db.pairwiseAssignment.create({
        data: {
          runId: pairwiseRun1Id,
          judgeProfileId: judge1ProfileId,
          projectAId: pA,
          projectBId: pB,
        },
      }),
    ).rejects.toThrow();

    // Cleanup assignment1 for subsequent tests
    await db.pairwiseAssignment.delete({ where: { id: assignment1.id } });
  });

  // =========================================================================
  // 4. SAME EVENT: Cross-event references must fail
  // =========================================================================
  it('Invariant 4a: rejects assignment with project from another event', async () => {
    const [pA, pB] = canonicalPair(project1AId, project2AId); // project2A is from Event 2

    await expect(
      db.pairwiseAssignment.create({
        data: {
          runId: pairwiseRun1Id, // Event 1
          judgeProfileId: judge1ProfileId, // Event 1
          projectAId: pA,
          projectBId: pB,
        },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 4b: rejects assignment with judge profile from another event', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1BId); // Both Event 1

    await expect(
      db.pairwiseAssignment.create({
        data: {
          runId: pairwiseRun1Id, // Event 1
          judgeProfileId: judge2ProfileId, // Event 2!
          projectAId: pA,
          projectBId: pB,
        },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 5. COMPARISON CONSISTENCY
  // =========================================================================
  it('Invariant 5a: rejects comparison where winner is outside assignment pair', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    // winner is project1C, which is outside {pA, pB}
    await expect(
      db.pairwiseComparison.create({
        data: {
          assignmentId: assignment.id,
          winnerProjectId: project1CId,
          loserProjectId: pB,
        },
      }),
    ).rejects.toThrow();

    await db.pairwiseAssignment.delete({ where: { id: assignment.id } });
  });

  it('Invariant 5b: rejects comparison where loser is outside assignment pair', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    // loser is project1C, which is outside {pA, pB}
    await expect(
      db.pairwiseComparison.create({
        data: {
          assignmentId: assignment.id,
          winnerProjectId: pA,
          loserProjectId: project1CId,
        },
      }),
    ).rejects.toThrow();

    await db.pairwiseAssignment.delete({ where: { id: assignment.id } });
  });

  it('Invariant 5c: rejects comparison where winner == loser', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    await expect(
      db.pairwiseComparison.create({
        data: {
          assignmentId: assignment.id,
          winnerProjectId: pA,
          loserProjectId: pA, // Self comparison
        },
      }),
    ).rejects.toThrow();

    await db.pairwiseAssignment.delete({ where: { id: assignment.id } });
  });

  // =========================================================================
  // 6. SUBMITTED EVIDENCE IMMUTABILITY
  // =========================================================================
  it('Invariant 6a: rejects updating winner or loser of submitted comparison', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    const comparison = await db.pairwiseComparison.create({
      data: {
        assignmentId: assignment.id,
        winnerProjectId: pA,
        loserProjectId: pB,
      },
    });
    expect(comparison.id).toBeDefined();

    // Attempt to update/flip winner and loser must fail
    await expect(
      db.pairwiseComparison.update({
        where: { id: comparison.id },
        data: {
          winnerProjectId: pB,
          loserProjectId: pA,
        },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 6b: rejects deleting a submitted comparison', async () => {
    const [pA, pB] = canonicalPair(project1AId, project1CId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    const comparison = await db.pairwiseComparison.create({
      data: {
        assignmentId: assignment.id,
        winnerProjectId: pA,
        loserProjectId: pB,
      },
    });

    // Attempt to delete submitted comparison must fail
    await expect(
      db.pairwiseComparison.delete({
        where: { id: comparison.id },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 6c: rejects modifying assignment projects or judge once comparison submitted', async () => {
    const [pA, pB] = canonicalPair(project1BId, project1CId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: pairwiseRun1Id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    await db.pairwiseComparison.create({
      data: {
        assignmentId: assignment.id,
        winnerProjectId: pA,
        loserProjectId: pB,
      },
    });

    // Attempt to change projectAId or judge on the assignment
    await expect(
      db.pairwiseAssignment.update({
        where: { id: assignment.id },
        data: { projectAId: project1AId < pB ? project1AId : pB },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 7. HISTORICAL RANKING IMMUTABILITY
  // =========================================================================
  it('Invariant 7a: rejects updating or deleting a PairwiseRankingRun', async () => {
    const rankingRun = await db.pairwiseRankingRun.create({
      data: {
        pairwiseRunId: pairwiseRun1Id,
        algorithm: 'BRADLEY_TERRY_RIDGE',
        algorithmVersion: 'V1',
        lambda: new Prisma.Decimal('0.01'),
        inputSetHash:
          '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        comparisonCount: 1,
        projectCount: 2,
        componentCount: 1,
        converged: true,
        iterations: 5,
        finalDelta: new Prisma.Decimal('0.000000001'),
        stronglyConnectedWinGraph: true,
        separationRisk: false,
      },
    });
    expect(rankingRun.id).toBeDefined();

    // Attempt UPDATE
    await expect(
      db.pairwiseRankingRun.update({
        where: { id: rankingRun.id },
        data: { converged: false },
      }),
    ).rejects.toThrow();

    // Attempt DELETE
    await expect(
      db.pairwiseRankingRun.delete({
        where: { id: rankingRun.id },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 7b: rejects updating or deleting a PairwiseProjectResult', async () => {
    const rankingRun = await db.pairwiseRankingRun.create({
      data: {
        pairwiseRunId: pairwiseRun1Id,
        algorithm: 'BRADLEY_TERRY_RIDGE',
        algorithmVersion: 'V1',
        lambda: new Prisma.Decimal('0.01'),
        inputSetHash:
          'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        comparisonCount: 2,
        projectCount: 2,
        componentCount: 1,
        converged: true,
        iterations: 6,
        finalDelta: new Prisma.Decimal('0.000000001'),
        stronglyConnectedWinGraph: true,
        separationRisk: false,
      },
    });

    const projectResult = await db.pairwiseProjectResult.create({
      data: {
        rankingRunId: rankingRun.id,
        projectId: project1AId,
        strength: new Prisma.Decimal('0.50000000'),
        canonicalStrength: new Prisma.Decimal('0.500000'),
        rank: 1,
        wins: 1,
        losses: 0,
      },
    });
    expect(projectResult.id).toBeDefined();

    // Attempt UPDATE
    await expect(
      db.pairwiseProjectResult.update({
        where: { id: projectResult.id },
        data: { rank: 2 },
      }),
    ).rejects.toThrow();

    // Attempt DELETE
    await expect(
      db.pairwiseProjectResult.delete({
        where: { id: projectResult.id },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 8. PAIRWISE RUN LIFECYCLE IMMUTABILITY
  // =========================================================================
  it('Invariant 8a: PairwiseRun semantic identity cannot be modified once published', async () => {
    const publishedRun = await db.pairwiseRun.create({
      data: {
        eventId: event1Id,
        createdById: organizerUserId,
        status: 'PUBLISHED',
      },
    });

    // Attempting to change eventId, lambda, or algorithm must fail
    await expect(
      db.pairwiseRun.update({
        where: { id: publishedRun.id },
        data: { lambda: new Prisma.Decimal('0.05') },
      }),
    ).rejects.toThrow();

    await expect(
      db.pairwiseRun.update({
        where: { id: publishedRun.id },
        data: { eventId: event2Id },
      }),
    ).rejects.toThrow();

    // Closing the run is allowed
    const closed = await db.pairwiseRun.update({
      where: { id: publishedRun.id },
      data: { status: 'CLOSED' },
    });
    expect(closed.status).toBe('CLOSED');

    // Reopening the closed run is rejected
    await expect(
      db.pairwiseRun.update({
        where: { id: publishedRun.id },
        data: { status: 'PUBLISHED' },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 8b: PairwiseRun cannot be deleted once published or once downstream state exists', async () => {
    const testRun = await db.pairwiseRun.create({
      data: {
        eventId: event1Id,
        createdById: organizerUserId,
      },
    });
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    await db.pairwiseAssignment.create({
      data: {
        runId: testRun.id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
      },
    });

    // Attempting to delete testRun must fail due to trigger and FK
    await expect(
      db.pairwiseRun.delete({
        where: { id: testRun.id },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 9. ASSIGNMENT STATUS CONSISTENCY
  // =========================================================================
  it('Invariant 9a: PairwiseAssignment cannot be created with status SUBMITTED without comparison', async () => {
    const testRun = await db.pairwiseRun.create({
      data: {
        eventId: event1Id,
        createdById: organizerUserId,
      },
    });
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    await expect(
      db.pairwiseAssignment.create({
        data: {
          runId: testRun.id,
          judgeProfileId: judge1ProfileId,
          projectAId: pA,
          projectBId: pB,
          status: 'SUBMITTED',
        },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 9b: PairwiseAssignment cannot be updated to SUBMITTED without comparison', async () => {
    const testRun = await db.pairwiseRun.create({
      data: {
        eventId: event1Id,
        createdById: organizerUserId,
      },
    });
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: testRun.id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
        status: 'PENDING',
      },
    });

    await expect(
      db.pairwiseAssignment.update({
        where: { id: assignment.id },
        data: { status: 'SUBMITTED' },
      }),
    ).rejects.toThrow();
  });

  it('Invariant 9c: Creating PairwiseComparison syncs assignment status to SUBMITTED and prevents reverting to PENDING', async () => {
    const testRun = await db.pairwiseRun.create({
      data: {
        eventId: event1Id,
        createdById: organizerUserId,
      },
    });
    const [pA, pB] = canonicalPair(project1AId, project1BId);
    const assignment = await db.pairwiseAssignment.create({
      data: {
        runId: testRun.id,
        judgeProfileId: judge1ProfileId,
        projectAId: pA,
        projectBId: pB,
        status: 'PENDING',
      },
    });

    await db.pairwiseComparison.create({
      data: {
        assignmentId: assignment.id,
        winnerProjectId: pA,
        loserProjectId: pB,
      },
    });

    // Check that status was synced to SUBMITTED
    const updated = await db.pairwiseAssignment.findUnique({
      where: { id: assignment.id },
    });
    expect(updated?.status).toBe('SUBMITTED');

    // Attempting to revert to PENDING must fail
    await expect(
      db.pairwiseAssignment.update({
        where: { id: assignment.id },
        data: { status: 'PENDING' },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 10. RANKING RESULT SAME EVENT SCOPE
  // =========================================================================
  it('Invariant 10: PairwiseProjectResult cannot reference project from another event', async () => {
    const rankingRun = await db.pairwiseRankingRun.create({
      data: {
        pairwiseRunId: pairwiseRun1Id, // Event 1
        algorithm: 'BRADLEY_TERRY_RIDGE',
        algorithmVersion: 'V1',
        lambda: new Prisma.Decimal('0.01'),
        inputSetHash:
          '1111111111111111111111111111111111111111111111111111111111111111',
        comparisonCount: 1,
        projectCount: 2,
        componentCount: 1,
        converged: true,
        iterations: 4,
        finalDelta: new Prisma.Decimal('0.000000001'),
        stronglyConnectedWinGraph: true,
        separationRisk: false,
      },
    });

    // project2AId is from Event 2!
    await expect(
      db.pairwiseProjectResult.create({
        data: {
          rankingRunId: rankingRun.id,
          projectId: project2AId,
          strength: new Prisma.Decimal('1.0'),
          canonicalStrength: new Prisma.Decimal('1.0'),
          rank: 1,
          wins: 1,
          losses: 0,
        },
      }),
    ).rejects.toThrow();
  });

  // =========================================================================
  // 11. METRICS CHECK CONSTRAINTS
  // =========================================================================
  it('Invariant 11: CHECK constraints reject negative metrics or invalid rank', async () => {
    const rankingRun = await db.pairwiseRankingRun.create({
      data: {
        pairwiseRunId: pairwiseRun1Id,
        algorithm: 'BRADLEY_TERRY_RIDGE',
        algorithmVersion: 'V1',
        lambda: new Prisma.Decimal('0.01'),
        inputSetHash:
          '2222222222222222222222222222222222222222222222222222222222222222',
        comparisonCount: 1,
        projectCount: 2,
        componentCount: 1,
        converged: true,
        iterations: 4,
        finalDelta: new Prisma.Decimal('0.000000001'),
      },
    });

    // rank must be >= 1 (0 rejected)
    await expect(
      db.pairwiseProjectResult.create({
        data: {
          rankingRunId: rankingRun.id,
          projectId: project1AId,
          strength: new Prisma.Decimal('1.0'),
          canonicalStrength: new Prisma.Decimal('1.0'),
          rank: 0,
          wins: 1,
          losses: 0,
        },
      }),
    ).rejects.toThrow();

    // wins must be >= 0 (-1 rejected)
    await expect(
      db.pairwiseProjectResult.create({
        data: {
          rankingRunId: rankingRun.id,
          projectId: project1AId,
          strength: new Prisma.Decimal('1.0'),
          canonicalStrength: new Prisma.Decimal('1.0'),
          rank: 1,
          wins: -1,
          losses: 0,
        },
      }),
    ).rejects.toThrow();

    // componentCount must be >= 1 (0 rejected)
    await expect(
      db.pairwiseRankingRun.create({
        data: {
          pairwiseRunId: pairwiseRun1Id,
          algorithm: 'BRADLEY_TERRY_RIDGE',
          algorithmVersion: 'V1',
          lambda: new Prisma.Decimal('0.01'),
          inputSetHash:
            '3333333333333333333333333333333333333333333333333333333333333333',
          comparisonCount: 1,
          projectCount: 2,
          componentCount: 0,
          converged: true,
          iterations: 4,
          finalDelta: new Prisma.Decimal('0.000000001'),
        },
      }),
    ).rejects.toThrow();
  });
});
