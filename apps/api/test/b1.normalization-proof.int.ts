import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Clock } from '../src/common/time';

if (!(process.env.DATABASE_URL ?? '').includes('_test'))
  throw new Error('Isolated test database required');

const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID().slice(0, 12);
const now = new Date('2030-01-04T12:00:00Z');
let app: NestFastifyApplication;

type Actor = { id: string; email: string; cookie: string };
interface ProjectScoreItem {
  projectId: string;
  rawAverage: string | number;
  aggregatedScore: string | number;
}
interface ProjectResultItem {
  projectId: string;
  rank: number;
  score: string | number;
}
interface JudgeStatItem {
  judgeProfileId: string;
  mean: string | number;
  populationStdDev: string | number;
  diagnostic: string | null;
}

const api = () => app.getHttpServer();

const post = (path: string, body: object = {}, cookie?: string) => {
  const req = request(api()).post(path).set('Origin', origin);
  if (cookie)
    req.set('Cookie', cookie.startsWith('Cookie: ') ? cookie.slice(8) : cookie);
  return req.send(body);
};

const get = (path: string, cookie?: string) => {
  const req = request(api()).get(path);
  if (cookie)
    req.set('Cookie', cookie.startsWith('Cookie: ') ? cookie.slice(8) : cookie);
  return req;
};

async function actor(label: string): Promise<Actor> {
  const email = `${label}-${unique()}@example.test`;
  const created = await post('/auth/register', {
    email,
    displayName: label,
    password: 'A secure test password 123!',
  }).expect(201);
  const login = await post('/auth/login', {
    email,
    password: 'A secure test password 123!',
  }).expect(200);
  const header = login.headers['set-cookie'];
  const cookie = (Array.isArray(header) ? header[0] : header) as string;
  return {
    id: created.body.id as string,
    email,
    cookie: cookie.split(';')[0]!,
  };
}

async function createEvent(organizer: Actor) {
  const created = await post(
    '/events',
    {
      name: 'B1 Normalization Proof Event',
      slug: `b1-proof-${unique()}`,
      visibility: 'PUBLIC',
      registrationOpensAt: '2029-01-01T00:00:00Z',
      registrationClosesAt: '2031-01-01T00:00:00Z',
      submissionClosesAt: '2030-01-03T00:00:00Z',
      judgingOpensAt: '2030-01-04T00:00:00Z',
      judgingClosesAt: '2030-01-06T00:00:00Z',
    },
    organizer.cookie,
  ).expect(201);
  await post(`/events/${created.body.id}/publish`, {}, organizer.cookie).expect(
    201,
  );
  return created.body.id as string;
}

async function onboardJudge(eventId: string, organizer: Actor, user: Actor) {
  const invitation = await post(
    `/events/${eventId}/judging/invitations`,
    { invitedUserId: user.id },
    organizer.cookie,
  ).expect(201);
  return (
    await post(
      '/judge-invitations/accept',
      { token: invitation.body.token },
      user.cookie,
    ).expect(200)
  ).body.judgeProfileId as string;
}

async function createRubric(
  eventId: string,
  organizer: Actor,
  criteria = [
    { name: 'Functionality', weight: '1.0', minScore: '0', maxScore: '10' },
  ],
) {
  const created = await post(
    `/events/${eventId}/judging/rubrics`,
    { name: 'Proof Rubric', criteria },
    organizer.cookie,
  ).expect(201);
  await post(
    `/events/${eventId}/judging/rubrics/${created.body.id}/publish`,
    {},
    organizer.cookie,
  ).expect(201);
  return created.body as {
    id: string;
    criteria: Array<{ id: string; name: string }>;
  };
}

async function createProjectAndSubmission(
  eventId: string,
  userId: string,
  name = 'Proof Project',
) {
  const team = await db.team.create({
    data: {
      eventId,
      createdById: userId,
      name: `Team ${name}`,
      slug: `team-${unique()}`,
    },
  });
  const project = await db.project.create({
    data: {
      eventId,
      teamId: team.id,
      name,
      slug: `proj-${unique()}`,
      status: 'ACTIVE',
    },
  });
  const submission = await db.submission.create({
    data: {
      projectId: project.id,
      version: 1,
      title: `${name} Submission`,
      description: 'Submission desc',
      projectName: name,
      status: 'SUBMITTED',
      createdById: userId,
      submittedAt: new Date('2030-01-02T00:00:00Z'),
    },
  });
  return { projectId: project.id, submissionId: submission.id };
}

async function assignAndSubmitEvaluation(
  eventId: string,
  organizer: Actor,
  judgeUser: Actor,
  judgeProfileId: string,
  submissionId: string,
  rubricId: string,
  criterionScores: Array<{ criterionId: string; score: string }>,
) {
  const manual = await post(
    `/events/${eventId}/judging/assignments/manual`,
    { judgeProfileId, submissionId, rubricId },
    organizer.cookie,
  ).expect(201);

  const assignmentId = manual.body.assignmentId as string;

  const submitted = await post(
    `/events/${eventId}/judging/assignments/${assignmentId}/evaluation/submit`,
    { scores: criterionScores },
    judgeUser.cookie,
  ).expect(201);

  const evalId = submitted.body.evaluation?.id ?? submitted.body.id;
  return { assignmentId, evaluationId: evalId as string };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(Clock)
    .useValue({ now: () => now })
    .compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.listen(0, '127.0.0.1');
}, 60000);

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('B1: Normalization Proof — Mathematical Verification', () => {
  it('proves harsh vs generous judge calibration, zero-variance handling, and ranking reversal against independent hand-computed values', async () => {
    // ------------------------------------------------------------------
    // INDEPENDENT HAND-COMPUTED SPECIFICATION:
    //
    // Rubric: 1 criterion, weight = 1.0, bounds = [0, 10]
    //
    // Projects:
    //   P1: evaluated by Judge H (score 6.0)
    //   P2: evaluated by Judge H (score 2.0) and Judge G (score 9.0)
    //   P3: evaluated by Judge G (score 7.0)
    //
    // Judge H (Harsh):
    //   Evaluations: [6.0, 2.0]
    //   μ_H = (6.0 + 2.0) / 2 = 4.0
    //   σ_H = sqrt(((6 - 4)^2 + (2 - 4)^2) / 2) = sqrt((4 + 4) / 2) = sqrt(4) = 2.0
    //   Z_H(P1) = (6.0 - 4.0) / 2.0 = +1.00000000
    //   Z_H(P2) = (2.0 - 4.0) / 2.0 = -1.00000000
    //
    // Judge G (Generous):
    //   Evaluations: [9.0, 7.0]
    //   μ_G = (9.0 + 7.0) / 2 = 8.0
    //   σ_G = sqrt(((9 - 8)^2 + (7 - 8)^2) / 2) = sqrt((1 + 1) / 2) = sqrt(1) = 1.0
    //   Z_G(P2) = (9.0 - 8.0) / 1.0 = +1.00000000
    //   Z_G(P3) = (7.0 - 8.0) / 1.0 = -1.00000000
    //
    // Raw Averages:
    //   P3: 7.00000000  -> Rank 1
    //   P1: 6.00000000  -> Rank 2
    //   P2: (2.0 + 9.0) / 2 = 5.50000000 -> Rank 3
    //   Raw Order: P3 (1st) > P1 (2nd) > P2 (3rd)
    //
    // Normalized Aggregates:
    //   P1: +1.00000000 -> Rank 1
    //   P2: (-1.00000000 + 1.00000000) / 2 = 0.00000000 -> Rank 2
    //   P3: -1.00000000 -> Rank 3
    //   Normalized Order: P1 (1st) > P2 (2nd) > P3 (3rd)
    //
    // The ranking completely reverses between P1 and P3!
    // P3 falls from 1st to 3rd (-2 places).
    // P1 rises from 2nd to 1st (+1 place).
    // ------------------------------------------------------------------

    const org = await actor('b1-org');
    const judgeH = await actor('judge-harsh');
    const judgeG = await actor('judge-generous');
    const part = await actor('b1-participant');
    const eventId = await createEvent(org);

    const jpH = await onboardJudge(eventId, org, judgeH);
    const jpG = await onboardJudge(eventId, org, judgeG);

    const rubric = await createRubric(eventId, org);
    const criterionId = rubric.criteria[0]!.id;

    const p1 = await createProjectAndSubmission(
      eventId,
      part.id,
      'Project Alpha',
    );
    const p2 = await createProjectAndSubmission(
      eventId,
      part.id,
      'Project Beta',
    );
    const p3 = await createProjectAndSubmission(
      eventId,
      part.id,
      'Project Gamma',
    );

    // 1. Submit evaluations
    const h1 = await assignAndSubmitEvaluation(
      eventId,
      org,
      judgeH,
      jpH,
      p1.submissionId,
      rubric.id,
      [{ criterionId, score: '6' }],
    );
    const h2 = await assignAndSubmitEvaluation(
      eventId,
      org,
      judgeH,
      jpH,
      p2.submissionId,
      rubric.id,
      [{ criterionId, score: '2' }],
    );
    const g2 = await assignAndSubmitEvaluation(
      eventId,
      org,
      judgeG,
      jpG,
      p2.submissionId,
      rubric.id,
      [{ criterionId, score: '9' }],
    );
    const g3 = await assignAndSubmitEvaluation(
      eventId,
      org,
      judgeG,
      jpG,
      p3.submissionId,
      rubric.id,
      [{ criterionId, score: '7' }],
    );

    // Snapshot raw evaluation rows before ScoreRun
    const rawBefore = await db.evaluationScore.findMany({
      where: {
        evaluationId: {
          in: [
            h1.evaluationId,
            h2.evaluationId,
            g2.evaluationId,
            g3.evaluationId,
          ],
        },
      },
      orderBy: { evaluationId: 'asc' },
    });

    // 2. Execute ScoreRun
    const scoreRunRes = await post(
      `/events/${eventId}/judging/scoring/runs`,
      { rubricVersionId: rubric.id },
      org.cookie,
    ).expect(201);

    expect(scoreRunRes.body.status).toBe('COMPLETED');
    expect(scoreRunRes.body.method).toBe('Z_SCORE');
    expect(scoreRunRes.body.methodVersion).toBe('V1');

    // 3. Immutability check: raw evaluations and scores remain untouched
    const rawAfter = await db.evaluationScore.findMany({
      where: {
        evaluationId: {
          in: [
            h1.evaluationId,
            h2.evaluationId,
            g2.evaluationId,
            g3.evaluationId,
          ],
        },
      },
      orderBy: { evaluationId: 'asc' },
    });
    expect(rawAfter).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(rawAfter[i]!.score.toString()).toBe(
        rawBefore[i]!.score.toString(),
      );
      expect(rawAfter[i]!.criterionId).toBe(rawBefore[i]!.criterionId);
    }

    // 4. Verify judge distribution statistics match literal hand-derived values
    const judgeStats = scoreRunRes.body.judgeStats as JudgeStatItem[];
    const statH = judgeStats.find((s) => s.judgeProfileId === jpH);
    const statG = judgeStats.find((s) => s.judgeProfileId === jpG);

    // Harsh Judge: mean = 4.0, std dev = 2.0
    expect(Number(statH!.mean)).toBe(4.0);
    expect(Number(statH!.populationStdDev)).toBe(2.0);
    expect(statH!.diagnostic).toBeNull();

    // Generous Judge: mean = 8.0, std dev = 1.0
    expect(Number(statG!.mean)).toBe(8.0);
    expect(Number(statG!.populationStdDev)).toBe(1.0);
    expect(statG!.diagnostic).toBeNull();

    // 5. Verify literal normalized score values on ProjectScore
    const projectScores = scoreRunRes.body.projectScores as ProjectScoreItem[];
    const ps1 = projectScores.find((ps) => ps.projectId === p1.projectId);
    const ps2 = projectScores.find((ps) => ps.projectId === p2.projectId);
    const ps3 = projectScores.find((ps) => ps.projectId === p3.projectId);

    // Raw Averages: P3 (7.0) > P1 (6.0) > P2 (5.5)
    expect(Number(ps1!.rawAverage)).toBe(6.0);
    expect(Number(ps2!.rawAverage)).toBe(5.5);
    expect(Number(ps3!.rawAverage)).toBe(7.0);

    // Normalized Aggregates: P1 (+1.0) > P2 (0.0) > P3 (-1.0)
    expect(Number(ps1!.aggregatedScore)).toBe(1.0);
    expect(Number(ps2!.aggregatedScore)).toBe(0.0);
    expect(Number(ps3!.aggregatedScore)).toBe(-1.0);

    // 6. Create ResultRun and assert competition rank change
    const resultRunRes = await post(
      `/events/${eventId}/judging/results/runs`,
      { scoreRunId: scoreRunRes.body.id },
      org.cookie,
    ).expect(201);

    const projectResults = resultRunRes.body
      .projectResults as ProjectResultItem[];
    const rankP1 = projectResults.find((r) => r.projectId === p1.projectId);
    const rankP2 = projectResults.find((r) => r.projectId === p2.projectId);
    const rankP3 = projectResults.find((r) => r.projectId === p3.projectId);

    // Assert the exact rank change:
    // In Raw: P3 was 1st, P1 was 2nd, P2 was 3rd
    // In Normalized: P1 IS 1st, P2 IS 2nd, P3 IS 3rd
    expect(rankP1!.rank).toBe(1);
    expect(rankP2!.rank).toBe(2);
    expect(rankP3!.rank).toBe(3);

    // Scores match canonical 6-decimal representation
    expect(Number(rankP1!.score)).toBe(1.0);
    expect(Number(rankP2!.score)).toBe(0.0);
    expect(Number(rankP3!.score)).toBe(-1.0);

    // 7. Test Idempotency and InputSetHash
    const sortedEvalIds = [
      h1.evaluationId,
      h2.evaluationId,
      g2.evaluationId,
      g3.evaluationId,
    ].sort();
    const expectedHash = createHash('sha256')
      .update(sortedEvalIds.join(','))
      .digest('hex')
      .slice(0, 32);
    const scoreRunDb = await db.scoreRun.findUniqueOrThrow({
      where: { id: scoreRunRes.body.id },
    });
    expect(scoreRunDb.inputSetHash).toBe(expectedHash);

    const rerunRes = await post(
      `/events/${eventId}/judging/scoring/runs`,
      { rubricVersionId: rubric.id },
      org.cookie,
    ).expect(201);
    expect(rerunRes.body.id).toBe(scoreRunRes.body.id);
  });

  it('demonstrates normalization rank inversions and zero-variance diagnostics on the official acceptance fixture', async () => {
    // Ensure official fixture is present in test database
    execFileSync('npm', ['run', 'db:import:official'], {
      encoding: 'utf8',
      env: process.env,
    });

    // Since Clock is mocked to 2030, ensure fixture acceptance sessions are unexpired
    await db.session.updateMany({
      where: { userAgent: 'dogfood-official-fixture-acceptance' },
      data: { expiresAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000) },
    });

    const token = createHash('sha256')
      .update('dogfood-2026-official-fixture:acceptance-cookie:organizer')
      .digest('base64url');
    const organizerCookie = `dogfood_session=${token}`;

    const eventId = '8727a75d-bbe8-584a-9c95-d5c1a916e38c'; // Sample Hack 2026

    // 1. Run scoring engine on official fixture
    const scoreRunRes = await post(
      `/events/${eventId}/judging/scoring/runs`,
      {},
      organizerCookie,
    ).expect(201);

    expect(scoreRunRes.body.status).toBe('COMPLETED');
    expect(scoreRunRes.body.method).toBe('Z_SCORE');
    expect(scoreRunRes.body.methodVersion).toBe('V1');

    // 2. Create ResultRun from ScoreRun
    const resultRunRes = await post(
      `/events/${eventId}/judging/results/runs`,
      { scoreRunId: scoreRunRes.body.id },
      organizerCookie,
    ).expect(201);

    expect(resultRunRes.body.rankingPolicy).toBe('COMPETITION');
    expect(resultRunRes.body.rankingVersion).toBe('V1');

    // 3. Verify exactly 30 judges processed
    const judgeStats = scoreRunRes.body.judgeStats as JudgeStatItem[];
    expect(judgeStats).toHaveLength(30);

    // 4. Verify exactly 3 zero-variance judges exist and receive INSUFFICIENT_VARIATION
    const zeroVarJudges = judgeStats.filter(
      (js) => Number(js.populationStdDev) === 0,
    );
    expect(zeroVarJudges).toHaveLength(3);
    for (const zv of zeroVarJudges) {
      expect(zv.diagnostic).toBe('INSUFFICIENT_VARIATION');
    }

    // 5. Compare Raw Ranks vs Normalized Ranks across all 41 projects
    const projectScores = scoreRunRes.body.projectScores as Array<
      ProjectScoreItem & { id: string }
    >;
    expect(projectScores).toHaveLength(41);

    // Compute raw ranking using competition rank rule
    const sortedByRaw = [...projectScores].sort((a, b) => {
      const diff = Number(b.rawAverage) - Number(a.rawAverage);
      if (Math.abs(diff) > 1e-8) return diff > 0 ? 1 : -1;
      return a.projectId.localeCompare(b.projectId);
    });

    const rawRankMap = new Map<string, number>();
    for (let i = 0; i < sortedByRaw.length; i++) {
      const prev = sortedByRaw[i - 1];
      const rank =
        prev &&
        Math.abs(Number(sortedByRaw[i]!.rawAverage) - Number(prev.rawAverage)) <
          1e-6
          ? rawRankMap.get(prev.projectId)!
          : i + 1;
      rawRankMap.set(sortedByRaw[i]!.projectId, rank);
    }

    const projectResults = resultRunRes.body
      .projectResults as ProjectResultItem[];
    const normRankMap = new Map<string, number>();
    for (const pr of projectResults) {
      normRankMap.set(pr.projectId, pr.rank);
    }

    let rankChangeCount = 0;
    for (const ps of projectScores) {
      const rRank = rawRankMap.get(ps.projectId)!;
      const nRank = normRankMap.get(ps.projectId)!;
      if (rRank !== nRank) rankChangeCount++;
    }

    // 36 out of 41 projects change rank!
    expect(rankChangeCount).toBe(36);

    // 6. Prove specific rank inversion: Slow Trail vs Salt Ledger
    const slowTrail = await db.project.findFirstOrThrow({
      where: { eventId, name: 'Slow Trail' },
    });
    const saltLedger = await db.project.findFirstOrThrow({
      where: { eventId, name: 'Salt Ledger' },
    });

    const slowTrailScore = projectScores.find(
      (ps) => ps.projectId === slowTrail.id,
    )!;
    const saltLedgerScore = projectScores.find(
      (ps) => ps.projectId === saltLedger.id,
    )!;

    const slowTrailResult = projectResults.find(
      (pr) => pr.projectId === slowTrail.id,
    )!;
    const saltLedgerResult = projectResults.find(
      (pr) => pr.projectId === saltLedger.id,
    )!;

    // In Raw: Salt Ledger (4.3333, Rank 1) > Slow Trail (4.0000, Rank 6)
    expect(Number(saltLedgerScore.rawAverage)).toBeCloseTo(4.33333333, 4);
    expect(Number(slowTrailScore.rawAverage)).toBeCloseTo(4.0, 4);
    expect(rawRankMap.get(saltLedger.id)).toBe(1);
    expect(rawRankMap.get(slowTrail.id)).toBe(6);

    // In Normalized: Slow Trail (0.931783, Rank 2) > Salt Ledger (0.866998, Rank 3)
    expect(Number(slowTrailResult.score)).toBeCloseTo(0.931783, 5);
    expect(Number(saltLedgerResult.score)).toBeCloseTo(0.866998, 5);
    expect(slowTrailResult.rank).toBe(2);
    expect(saltLedgerResult.rank).toBe(3);

    // 7. Verify CSV exports match normalized results
    const csvRes = await get(
      `/events/${eventId}/judging/exports/results`,
      organizerCookie,
    ).expect(200);

    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    expect(csvRes.text).toContain('Iron Switch');
    expect(csvRes.text).toContain('Slow Trail');
    expect(csvRes.text).toContain('Salt Ledger');
    expect(csvRes.text).toContain(
      ',2,c5934fa0-83e4-5c35-a09d-f0dd166a318e,Slow Trail,0.931783',
    );
    expect(csvRes.text).toContain(
      ',3,169e0c81-5d80-55c9-80b1-9ba5c6f51439,Salt Ledger,0.866998',
    );
  });
});
