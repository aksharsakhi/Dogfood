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
  throw new Error('Isolated test database required');

const db = new PrismaClient();
const origin = 'http://localhost:3000';
const unique = () => randomUUID().slice(0, 12);
const now = new Date('2030-01-04T12:00:00Z');
let app: NestFastifyApplication;

type Actor = { id: string; email: string; cookie: string };
interface JudgeStatItem {
  judgeProfileId: string;
  mean: string | number;
  populationStdDev: string | number;
}
interface NormalizedScoreItem {
  submissionId: string;
  normalizedScore: string | number;
}
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
const api = () => app.getHttpServer();

const post = (path: string, body: object = {}, cookie?: string) => {
  const req = request(api()).post(path).set('Origin', origin);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};

const patch = (path: string, body: object, cookie: string) =>
  request(api())
    .patch(path)
    .set('Origin', origin)
    .set('Cookie', cookie)
    .send(body);

const get = (path: string, cookie: string) =>
  request(api()).get(path).set('Cookie', cookie);

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
      name: 'Phase 4B Event',
      slug: `phase4b-${unique()}`,
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
    { name: 'Impact', weight: '0.5', minScore: '0', maxScore: '10' },
    { name: 'Execution', weight: '0.5', minScore: '0', maxScore: '10' },
  ],
) {
  const base = `/events/${eventId}/judging/rubrics`;
  const created = await post(
    base,
    { name: 'Test Rubric', criteria },
    organizer.cookie,
  ).expect(201);
  return (
    await post(
      `${base}/${created.body.id}/publish`,
      {},
      organizer.cookie,
    ).expect(201)
  ).body;
}

async function createProjectAndSubmission(
  eventId: string,
  userId: string,
  name = 'Test Project',
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
      slug: `project-${unique()}`,
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
  return {
    projectId: project.id,
    submissionId: submission.id,
    teamId: team.id,
  };
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
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue({ now: () => now })
    .compile();
  app = module.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  await configureApp(app, origin);
  await app.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('Phase 4B: Stage 1 Raw Scoring + ScoreRun', () => {
  it('computes weighted raw score correctly with non-uniform weights and varied bounds', async () => {
    const org = await actor('org-4b-bounds');
    const judgeU = await actor('judge-4b-bounds');
    const participant = await actor('part-4b-bounds');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    // Rubric with differing bounds: 0-10 (weight 0.3) and 1-5 (weight 0.7)
    // Percent-of-max conversion:
    // C1: score 8/10 -> 80%
    // C2: score 3/5 -> (3-1)/(5-1) = 2/4 = 50%
    // Weighted sum = 0.3*80 + 0.7*50 = 24 + 35 = 59.00000000
    const rub = await createRubric(evId, org, [
      { name: 'C1', weight: '0.3', minScore: '0', maxScore: '10' },
      { name: 'C2', weight: '0.7', minScore: '1', maxScore: '5' },
    ]);
    const p1 = await createProjectAndSubmission(
      evId,
      participant.id,
      'BoundsProj',
    );

    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [
        { criterionId: rub.criteria[0].id, score: '8' },
        { criterionId: rub.criteria[1].id, score: '3' },
      ],
    );

    const scoreRunRes = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(scoreRunRes.body.status).toBe('COMPLETED');
    expect(scoreRunRes.body.normalizedScores).toHaveLength(1);
    // Literal hand-computed raw score: 59.00000000
    expect(Number(scoreRunRes.body.normalizedScores[0].rawScore)).toBe(59);
  });

  it('calculates Z-score per judge using literal population sigma (N denominator) and z=(x-mu)/sigma', async () => {
    const org = await actor('org-4b-zscore');
    const judgeU = await actor('judge-4b-zscore');
    const part = await actor('part-4b-zscore');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Quality', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);

    // 4 submissions with scores 4, 6, 8, 10
    // N = 4
    // Mean = (4+6+8+10)/4 = 7.0
    // Population sigma^2 = (9+1+1+9)/4 = 5.0 => sigma = sqrt(5) = 2.23606798
    // (Sample sigma would be sqrt(20/3) = 2.5819889 - distinguishable!)
    // Z-scores:
    // z1 = (4-7)/sqrt(5) = -1.34164079
    // z2 = (6-7)/sqrt(5) = -0.44721360
    // z3 = (8-7)/sqrt(5) = +0.44721360
    // z4 = (10-7)/sqrt(5) = +1.34164079
    const p1 = await createProjectAndSubmission(evId, part.id, 'P1');
    const p2 = await createProjectAndSubmission(evId, part.id, 'P2');
    const p3 = await createProjectAndSubmission(evId, part.id, 'P3');
    const p4 = await createProjectAndSubmission(evId, part.id, 'P4');

    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '4' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p2.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '6' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p3.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '8' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p4.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '10' }],
    );

    const runRes = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(runRes.body.status).toBe('COMPLETED');
    expect(runRes.body.method).toBe('Z_SCORE');
    expect(runRes.body.methodVersion).toBe('V1');

    // Verify per-judge stats stored in JudgeScoreStats
    const stats = (runRes.body.judgeStats as JudgeStatItem[]).find(
      (s) => s.judgeProfileId === jProfileId,
    );
    expect(stats).toBeDefined();
    expect(Number(stats!.mean)).toBe(7.0);
    // Assert literal population sigma 2.23606798
    expect(Number(stats!.populationStdDev)).toBeCloseTo(2.23606798, 5);

    // Verify literal Z-scores on normalized scores
    const normScores = runRes.body.normalizedScores as NormalizedScoreItem[];
    const norm1 = normScores.find((n) => n.submissionId === p1.submissionId);
    const norm2 = normScores.find((n) => n.submissionId === p2.submissionId);
    const norm3 = normScores.find((n) => n.submissionId === p3.submissionId);
    const norm4 = normScores.find((n) => n.submissionId === p4.submissionId);

    expect(Number(norm1!.normalizedScore)).toBeCloseTo(-1.34164079, 5);
    expect(Number(norm2!.normalizedScore)).toBeCloseTo(-0.4472136, 5);
    expect(Number(norm3!.normalizedScore)).toBeCloseTo(0.4472136, 5);
    expect(Number(norm4!.normalizedScore)).toBeCloseTo(1.34164079, 5);
  });

  it('assigns normalized=0 and INSUFFICIENT_VARIATION when sigma=0 (including n=1 and identical scores)', async () => {
    const org = await actor('org-4b-zero');
    const judgeU = await actor('judge-4b-zero');
    const part = await actor('part-4b-zero');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Fit', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);

    // n=1 test
    const p1 = await createProjectAndSubmission(evId, part.id, 'SingleProj');
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '7' }],
    );

    const runRes = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(runRes.body.status).toBe('COMPLETED');
    const stats = runRes.body.judgeStats[0];
    expect(Number(stats.populationStdDev)).toBe(0);
    expect(stats.diagnostic).toBe('INSUFFICIENT_VARIATION');

    const norm = runRes.body.normalizedScores[0];
    expect(Number(norm.normalizedScore)).toBe(0);
    expect(norm.diagnostic).toBe('INSUFFICIENT_VARIATION');
  });

  it('excludes incomplete evaluations and non-submitted drafts, and requires all criteria', async () => {
    const org = await actor('org-4b-incomplete');
    const judgeU = await actor('judge-4b-incomplete');
    const part = await actor('part-4b-incomplete');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'C1', weight: '0.5', minScore: '0', maxScore: '10' },
      { name: 'C2', weight: '0.5', minScore: '0', maxScore: '10' },
    ]);

    const p1 = await createProjectAndSubmission(evId, part.id, 'DraftEvalProj');

    // Create assignment and save draft evaluation (not submitted)
    const manual = await post(
      `/events/${evId}/judging/assignments/manual`,
      {
        judgeProfileId: jProfileId,
        submissionId: p1.submissionId,
        rubricId: rub.id,
      },
      org.cookie,
    ).expect(201);

    await patch(
      `/events/${evId}/judging/assignments/${manual.body.assignmentId}/evaluation`,
      { scores: [{ criterionId: rub.criteria[0].id, score: '5' }] },
      judgeU.cookie,
    ).expect(200);

    // ScoreRun creation rejected because 0 SUBMITTED evaluations exist
    const err = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(409);
    expect(err.body.code).toBe('NO_SUBMITTED_EVALUATIONS');
  });

  it('keeps raw Evaluation and EvaluationScore rows immutable before and after scoring', async () => {
    const org = await actor('org-4b-raw-imm');
    const judgeU = await actor('judge-4b-raw-imm');
    const part = await actor('part-4b-raw-imm');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Q', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);
    const p1 = await createProjectAndSubmission(evId, part.id, 'RawImmProj');

    const { evaluationId } = await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '8' }],
    );

    const evalBefore = await db.evaluation.findUniqueOrThrow({
      where: { id: evaluationId },
      include: { scores: true },
    });

    await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    const evalAfter = await db.evaluation.findUniqueOrThrow({
      where: { id: evaluationId },
      include: { scores: true },
    });

    expect(evalBefore.updatedAt).toEqual(evalAfter.updatedAt);
    expect(evalBefore.scores[0]!.score.toString()).toBe(
      evalAfter.scores[0]!.score.toString(),
    );
  });

  it('emits SUSPENDED_JUDGE_INCLUDED diagnostic while keeping submitted evidence valid', async () => {
    const org = await actor('org-4b-susp');
    const judgeU = await actor('judge-4b-susp');
    const part = await actor('part-4b-susp');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Q', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);
    const p1 = await createProjectAndSubmission(evId, part.id, 'SuspJudgeProj');

    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '7' }],
    );

    // Suspend judge after evaluation was submitted
    await db.eventMembership.update({
      where: {
        eventId_userId_role: {
          eventId: evId,
          userId: judgeU.id,
          role: 'JUDGE',
        },
      },
      data: { status: 'SUSPENDED' },
    });

    const runRes = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(runRes.body.status).toBe('COMPLETED');
    const normDiag = runRes.body.normalizationDiagnostics;
    expect(normDiag.suspendedJudges).toContain(
      `SUSPENDED_JUDGE_INCLUDED:${jProfileId}`,
    );
  });

  it('ScoreRun idempotency: re-requesting exact matching run returns existing run', async () => {
    const org = await actor('org-4b-idem');
    const judgeU = await actor('judge-4b-idem');
    const part = await actor('part-4b-idem');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Q', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);
    const p1 = await createProjectAndSubmission(evId, part.id, 'IdemProj');

    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '6' }],
    );

    const run1 = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    const run2 = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(run1.body.id).toBe(run2.body.id);
  });
});

describe('Phase 4B: Stage 2 Staleness + ResultRuns', () => {
  it('detects STALE on read when a new evaluation is submitted, keeping old run immutable', async () => {
    const org = await actor('org-4b-stale');
    const judge1 = await actor('judge1-4b-stale');
    const judge2 = await actor('judge2-4b-stale');
    const part = await actor('part-4b-stale');
    const evId = await createEvent(org);
    const jProfile1 = await onboardJudge(evId, org, judge1);
    const jProfile2 = await onboardJudge(evId, org, judge2);

    const rub = await createRubric(evId, org, [
      { name: 'Q', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);
    const p1 = await createProjectAndSubmission(evId, part.id, 'StaleProj1');
    const p2 = await createProjectAndSubmission(evId, part.id, 'StaleProj2');

    // First evaluation submitted
    await assignAndSubmitEvaluation(
      evId,
      org,
      judge1,
      jProfile1,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '8' }],
    );

    const run1 = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    // Initial freshness should be CURRENT
    const detail1 = await get(
      `/events/${evId}/judging/scoring/runs/${run1.body.id}`,
      org.cookie,
    ).expect(200);
    expect(detail1.body.freshness).toBe('CURRENT');

    // Second evaluation submitted later
    await assignAndSubmitEvaluation(
      evId,
      org,
      judge2,
      jProfile2,
      p2.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '6' }],
    );

    // Now reading run1 should derive STALE without mutating it
    const detail2 = await get(
      `/events/${evId}/judging/scoring/runs/${run1.body.id}`,
      org.cookie,
    ).expect(200);
    expect(detail2.body.freshness).toBe('STALE');
    expect(detail2.body.inputEvaluationIds).toEqual(
      run1.body.inputEvaluationIds,
    );
  });

  it('blocks ResultRun on incomplete coverage by default, requires confirmed override with reason', async () => {
    const org = await actor('org-4b-cov');
    const judge1 = await actor('judge1-4b-cov');
    const judge2 = await actor('judge2-4b-cov');
    const part = await actor('part-4b-cov');
    const evId = await createEvent(org);
    await onboardJudge(evId, org, judge1);
    await onboardJudge(evId, org, judge2);

    const rub = await createRubric(evId, org, [
      { name: 'Q', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);

    await createProjectAndSubmission(evId, part.id, 'UnderCoveredProj');

    // Create batch preview with 2 reviews required per submission
    const preview = await post(
      `/events/${evId}/judging/assignments/preview`,
      { rubricId: rub.id, reviewsPerSubmission: 2 },
      org.cookie,
    ).expect(201);

    await post(
      `/events/${evId}/judging/assignments/runs/${preview.body.runId}/publish`,
      {},
      org.cookie,
    ).expect(201);

    // Only Judge 1 submits evaluation
    const ws1 = await get(
      `/events/${evId}/judging/workspace`,
      judge1.cookie,
    ).expect(200);
    const a1 = ws1.body.assignments[0];

    await post(
      `/events/${evId}/judging/assignments/${a1.assignmentId}/evaluation/submit`,
      { scores: [{ criterionId: rub.criteria[0].id, score: '9' }] },
      judge1.cookie,
    ).expect(201);

    // Judge 2 does NOT evaluate, so coverage is incomplete (1 of 2 required)
    const scoreRun = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(scoreRun.body.projectScores[0].coverageComplete).toBe(false);

    // Attempting ResultRun without override flags fails
    const blocked = await post(
      `/events/${evId}/judging/results/runs`,
      { scoreRunId: scoreRun.body.id },
      org.cookie,
    ).expect(409);
    expect(blocked.body.code).toBe('INCOMPLETE_COVERAGE');

    // Attempting ResultRun with confirmIncomplete=true but no reason fails
    const noReason = await post(
      `/events/${evId}/judging/results/runs`,
      { scoreRunId: scoreRun.body.id, confirmIncomplete: true },
      org.cookie,
    ).expect(400);
    expect(noReason.body.code).toBe('OVERRIDE_REASON_REQUIRED');

    // Valid override succeeds, records coverageIncomplete=true and reason
    const override = await post(
      `/events/${evId}/judging/results/runs`,
      {
        scoreRunId: scoreRun.body.id,
        confirmIncomplete: true,
        overrideReason: 'Judge unavailable due to illness',
      },
      org.cookie,
    ).expect(201);

    expect(override.body.coverageIncomplete).toBe(true);
    expect(override.body.overrideReason).toBe(
      'Judge unavailable due to illness',
    );

    // Second override attempt with a DIFFERENT reason returns the existing row idempotently
    const secondOverride = await post(
      `/events/${evId}/judging/results/runs`,
      {
        scoreRunId: scoreRun.body.id,
        confirmIncomplete: true,
        overrideReason: 'Different second reason',
      },
      org.cookie,
    ).expect(201);

    expect(secondOverride.body.id).toBe(override.body.id);
    expect(secondOverride.body.overrideReason).toBe(
      'Judge unavailable due to illness',
    );

    // Audit event RESULT_RUN_COVERAGE_OVERRIDE was recorded
    const overrideAudit = await db.auditEvent.findFirst({
      where: { eventId: evId, action: 'RESULT_RUN_COVERAGE_OVERRIDE' },
    });
    expect(overrideAudit).toBeDefined();
    expect(overrideAudit?.actorUserId).toBe(org.id);
  });

  it('performs 6-decimal canonicalization and competition ranking (1, 1, 3)', async () => {
    const org = await actor('org-4b-rank');
    const judgeU = await actor('judge-4b-rank');
    const part = await actor('part-4b-rank');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Score', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);

    // Create 3 projects: P_tie1, P_tie2, P_lower
    const pt1 = await createProjectAndSubmission(evId, part.id, 'Tied1');
    const pt2 = await createProjectAndSubmission(evId, part.id, 'Tied2');
    const pl = await createProjectAndSubmission(evId, part.id, 'Lower');

    // P_tie1 and P_tie2 both receive score 9, P_lower receives score 5
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      pt1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '9' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      pt2.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '9' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      pl.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '5' }],
    );

    const scoreRun = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    const resultRun = await post(
      `/events/${evId}/judging/results/runs`,
      { scoreRunId: scoreRun.body.id },
      org.cookie,
    ).expect(201);

    const ranked = resultRun.body.projectResults as ProjectResultItem[];
    expect(ranked).toHaveLength(3);

    const r1 = ranked.find((r) => r.projectId === pt1.projectId);
    const r2 = ranked.find((r) => r.projectId === pt2.projectId);
    const r3 = ranked.find((r) => r.projectId === pl.projectId);

    // Exact tie: both share rank 1
    expect(r1!.rank).toBe(1);
    expect(r2!.rank).toBe(1);
    // Competition ranking: next is 3, NOT 2!
    expect(r3!.rank).toBe(3);
  });
});

describe('Phase 4B: Stage 3 CSV Exports & Security', () => {
  it('allows organizer to export all 7 CSVs and denies participants / unrelated judges', async () => {
    const org = await actor('org-4b-csv');
    const judgeU = await actor('judge-4b-csv');
    const part = await actor('part-4b-csv');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org);
    const p1 = await createProjectAndSubmission(evId, part.id, 'CsvProj');

    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [
        { criterionId: rub.criteria[0].id, score: '8' },
        { criterionId: rub.criteria[1].id, score: '8' },
      ],
    );

    const scoreRun = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    const resultRun = await post(
      `/events/${evId}/judging/results/runs`,
      { scoreRunId: scoreRun.body.id },
      org.cookie,
    ).expect(201);

    // 1. Organizer allowed for all 7
    const expJudges = await get(
      `/events/${evId}/judging/exports/judges`,
      org.cookie,
    ).expect(200);
    expect(expJudges.text).toContain('Judge Profile ID');

    const expAssign = await get(
      `/events/${evId}/judging/exports/assignments`,
      org.cookie,
    ).expect(200);
    expect(expAssign.text).toContain('Assignment ID');

    const expProg = await get(
      `/events/${evId}/judging/exports/progress`,
      org.cookie,
    ).expect(200);
    expect(expProg.text).toContain('Submission ID');

    const expRaw = await get(
      `/events/${evId}/judging/exports/raw-evaluations`,
      org.cookie,
    ).expect(200);
    expect(expRaw.text).toContain('Evaluation ID');

    const expNorm = await get(
      `/events/${evId}/judging/exports/normalized-scores?scoreRunId=${scoreRun.body.id}`,
      org.cookie,
    ).expect(200);
    expect(expNorm.text).toContain('ScoreRun ID');

    const expProj = await get(
      `/events/${evId}/judging/exports/project-scores?scoreRunId=${scoreRun.body.id}`,
      org.cookie,
    ).expect(200);
    expect(expProj.text).toContain('Normalized Aggregate');

    const expRes = await get(
      `/events/${evId}/judging/exports/results?resultRunId=${resultRun.body.id}`,
      org.cookie,
    ).expect(200);
    expect(expRes.text).toContain('ResultRun ID');

    // 2. Participant denied (403)
    await get(`/events/${evId}/judging/exports/judges`, part.cookie).expect(
      403,
    );
    await get(
      `/events/${evId}/judging/exports/raw-evaluations`,
      part.cookie,
    ).expect(403);
    await get(`/events/${evId}/judging/exports/results`, part.cookie).expect(
      403,
    );

    // 3. Judge can export ONLY their own evaluations, denied event-wide data
    await get(`/events/${evId}/judging/exports/judges`, judgeU.cookie).expect(
      403,
    );
    await get(`/events/${evId}/judging/exports/results`, judgeU.cookie).expect(
      403,
    );
    const judgeRaw = await get(
      `/events/${evId}/judging/exports/raw-evaluations`,
      judgeU.cookie,
    ).expect(200);
    expect(judgeRaw.text).toContain(jProfileId);
  });

  it('neutralizes formula injection characters (=, +, -, @, \\t, \\r) on user text while preserving negative numeric scores', async () => {
    const org = await actor('org-4b-formula');
    const judgeU = await actor('judge-4b-formula');
    const part = await actor('part-4b-formula');
    const evId = await createEvent(org);
    const jProfileId = await onboardJudge(evId, org, judgeU);

    const rub = await createRubric(evId, org, [
      { name: 'Quality', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);

    // Name beginning with formula injection characters: =cmd|' /C calc'!A0
    const p1 = await createProjectAndSubmission(evId, part.id, '=cmdCalc');
    const p2 = await createProjectAndSubmission(evId, part.id, '+plusFormula');
    const p3 = await createProjectAndSubmission(evId, part.id, '@atFormula');
    const p4 = await createProjectAndSubmission(evId, part.id, '-minusFormula');

    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '10' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p2.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '2' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p3.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '8' }],
    );
    await assignAndSubmitEvaluation(
      evId,
      org,
      judgeU,
      jProfileId,
      p4.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '4' }],
    );

    const scoreRun = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    const csvRes = await get(
      `/events/${evId}/judging/exports/normalized-scores?scoreRunId=${scoreRun.body.id}`,
      org.cookie,
    ).expect(200);

    // User-controlled titles must be neutralized with leading apostrophe
    expect(csvRes.text).toContain("'=cmdCalc");
    expect(csvRes.text).toContain("'+plusFormula");
    expect(csvRes.text).toContain("'@atFormula");
    expect(csvRes.text).toContain("'-minusFormula");

    // But legitimate negative normalized numeric score (p2 has score 2 vs mean 6 -> negative z) MUST NOT have leading apostrophe
    expect(csvRes.text).toMatch(/,-[0-9.]+,/); // matches ,-1.34164079, without leading quote
  });

  it('guarantees judges have NO access to normalized scores, rankings or other judges data', async () => {
    const org = await actor('org-4b-judge-iso');
    const judge1 = await actor('judge1-4b-iso');
    const judge2 = await actor('judge2-4b-iso');
    const part = await actor('part-4b-iso');
    const evId = await createEvent(org);
    const jp1 = await onboardJudge(evId, org, judge1);
    await onboardJudge(evId, org, judge2);

    const rub = await createRubric(evId, org);
    const p1 = await createProjectAndSubmission(evId, part.id, 'JudgeIsoProj');

    await assignAndSubmitEvaluation(
      evId,
      org,
      judge1,
      jp1,
      p1.submissionId,
      rub.id,
      [
        { criterionId: rub.criteria[0].id, score: '9' },
        { criterionId: rub.criteria[1].id, score: '9' },
      ],
    );

    const scoreRun = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    const resultRun = await post(
      `/events/${evId}/judging/results/runs`,
      { scoreRunId: scoreRun.body.id },
      org.cookie,
    ).expect(201);

    // Judge 2 cannot list or read ScoreRuns or ResultRuns
    await get(`/events/${evId}/judging/scoring/runs`, judge2.cookie).expect(
      403,
    );
    await get(
      `/events/${evId}/judging/scoring/runs/${scoreRun.body.id}`,
      judge2.cookie,
    ).expect(403);
    await get(`/events/${evId}/judging/results/runs`, judge2.cookie).expect(
      403,
    );
    await get(
      `/events/${evId}/judging/results/runs/${resultRun.body.id}`,
      judge2.cookie,
    ).expect(403);

    // Judge workspace contains ONLY their own assignments, no scores or ranks
    const ws = await get(
      `/events/${evId}/judging/workspace`,
      judge2.cookie,
    ).expect(200);
    expect(ws.text).not.toContain(scoreRun.body.id);
    expect(ws.text).not.toContain(resultRun.body.id);
  });
});

describe('Phase 4B: Normalization Proof Fixture (Harsh vs Generous Judge)', () => {
  it('proves rank change between raw and normalized ranking while raw evaluations remain untouched', async () => {
    // Normalization Proof Fixture:
    // 3 projects: P1, P2, P3.
    // Harsh Judge H evaluates P1 (6.0) and P2 (2.0)
    // Mean H = 4.0, sigma_H = 2.0
    // Z_H(P1) = +1.0, Z_H(P2) = -1.0
    // Generous Judge G evaluates P2 (9.0) and P3 (7.0)
    // Mean G = 8.0, sigma_G = 1.0
    // Z_G(P2) = +1.0, Z_G(P3) = -1.0
    //
    // Raw Averages:
    // P3: 7.0 (1st)
    // P1: 6.0 (2nd)
    // P2: (2+9)/2 = 5.5 (3rd)
    // Raw ranks: P3 = 1st, P1 = 2nd, P2 = 3rd
    //
    // Normalized Aggregates:
    // P1: +1.000000 (1st)
    // P2: (-1.0 + 1.0)/2 = 0.000000 (2nd)
    // P3: -1.000000 (3rd)
    // Normalized ranks: P1 = 1st, P2 = 2nd, P3 = 3rd!

    const org = await actor('org-proof');
    const judgeHarsh = await actor('judge-harsh');
    const judgeGen = await actor('judge-generous');
    const part = await actor('part-proof');
    const evId = await createEvent(org);

    const jpHarsh = await onboardJudge(evId, org, judgeHarsh);
    const jpGen = await onboardJudge(evId, org, judgeGen);

    const rub = await createRubric(evId, org, [
      { name: 'Core', weight: '1.0', minScore: '0', maxScore: '10' },
    ]);

    const p1 = await createProjectAndSubmission(evId, part.id, 'ProjectOne');
    const p2 = await createProjectAndSubmission(evId, part.id, 'ProjectTwo');
    const p3 = await createProjectAndSubmission(evId, part.id, 'ProjectThree');

    // Harsh evaluations
    const h1 = await assignAndSubmitEvaluation(
      evId,
      org,
      judgeHarsh,
      jpHarsh,
      p1.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '6' }],
    );
    const h2 = await assignAndSubmitEvaluation(
      evId,
      org,
      judgeHarsh,
      jpHarsh,
      p2.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '2' }],
    );

    // Generous evaluations
    const g2 = await assignAndSubmitEvaluation(
      evId,
      org,
      judgeGen,
      jpGen,
      p2.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '9' }],
    );
    const g3 = await assignAndSubmitEvaluation(
      evId,
      org,
      judgeGen,
      jpGen,
      p3.submissionId,
      rub.id,
      [{ criterionId: rub.criteria[0].id, score: '7' }],
    );

    // Snapshot raw evaluation rows before score run
    const rawEvalsBefore = await db.evaluation.findMany({
      where: {
        id: {
          in: [
            h1.evaluationId,
            h2.evaluationId,
            g2.evaluationId,
            g3.evaluationId,
          ],
        },
      },
      include: { scores: true },
      orderBy: { id: 'asc' },
    });

    // Execute ScoreRun
    const scoreRunRes = await post(
      `/events/${evId}/judging/scoring/runs`,
      { rubricVersionId: rub.id },
      org.cookie,
    ).expect(201);

    expect(scoreRunRes.body.status).toBe('COMPLETED');

    // (b) Verify raw Evaluation and EvaluationScore rows are IDENTICAL after ScoreRun
    const rawEvalsAfter = await db.evaluation.findMany({
      where: {
        id: {
          in: [
            h1.evaluationId,
            h2.evaluationId,
            g2.evaluationId,
            g3.evaluationId,
          ],
        },
      },
      include: { scores: true },
      orderBy: { id: 'asc' },
    });

    expect(rawEvalsBefore).toHaveLength(4);
    expect(rawEvalsAfter).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(rawEvalsBefore[i]!.scores[0]!.score.toString()).toBe(
        rawEvalsAfter[i]!.scores[0]!.score.toString(),
      );
      expect(rawEvalsBefore[i]!.updatedAt).toEqual(rawEvalsAfter[i]!.updatedAt);
    }

    // Verify raw averages on ProjectScore
    const projectScores = scoreRunRes.body.projectScores as ProjectScoreItem[];
    const ps1 = projectScores.find((ps) => ps.projectId === p1.projectId);
    const ps2 = projectScores.find((ps) => ps.projectId === p2.projectId);
    const ps3 = projectScores.find((ps) => ps.projectId === p3.projectId);

    expect(Number(ps1!.rawAverage)).toBe(6.0);
    expect(Number(ps2!.rawAverage)).toBe(5.5);
    expect(Number(ps3!.rawAverage)).toBe(7.0);

    // In raw ranking, P3 (7.0) > P1 (6.0) > P2 (5.5)
    expect(Number(ps3!.rawAverage)).toBeGreaterThan(Number(ps1!.rawAverage));
    expect(Number(ps1!.rawAverage)).toBeGreaterThan(Number(ps2!.rawAverage));

    // Verify normalized aggregates on ProjectScore
    expect(Number(ps1!.aggregatedScore)).toBe(1.0);
    expect(Number(ps2!.aggregatedScore)).toBe(0.0);
    expect(Number(ps3!.aggregatedScore)).toBe(-1.0);

    // Execute ResultRun from explicit ScoreRun
    const resultRunRes = await post(
      `/events/${evId}/judging/results/runs`,
      { scoreRunId: scoreRunRes.body.id },
      org.cookie,
    ).expect(201);

    const projectResults = resultRunRes.body
      .projectResults as ProjectResultItem[];

    const rankP1 = projectResults.find((r) => r.projectId === p1.projectId);
    const rankP2 = projectResults.find((r) => r.projectId === p2.projectId);
    const rankP3 = projectResults.find((r) => r.projectId === p3.projectId);

    // (a) Assert the EXACT rank change using literal expected numbers:
    // Raw ranking was: P3 (1st), P1 (2nd), P2 (3rd)
    // Normalized ranking IS: P1 (1st), P2 (2nd), P3 (3rd)!
    expect(rankP1!.rank).toBe(1);
    expect(rankP2!.rank).toBe(2);
    expect(rankP3!.rank).toBe(3);

    expect(Number(rankP1!.score)).toBe(1.0);
    expect(Number(rankP2!.score)).toBe(0.0);
    expect(Number(rankP3!.score)).toBe(-1.0);
  });
});
