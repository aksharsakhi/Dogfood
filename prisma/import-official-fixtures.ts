/** Import the root DOGFOOD 2026 fixture without changing the development seed.
 *
 * All fixture identities are UUIDs derived from an entity kind and external ID.
 * The synthetic organizer and fields absent from the fixture use documented
 * deterministic defaults. Existing immutable rows are checked, never updated.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

type Fixture = {
  event: { id: string; name: string; submissions_close: string };
  tracks: { id: string; name: string }[];
  judges: { id: string; name: string; email: string; tracks: string[] }[];
  teams: { id: string; name: string; members: string[] }[];
  projects: {
    id: string;
    team: string;
    track: string;
    title: string;
    summary: string;
    repo_url: string;
    submitted_at: string;
  }[];
  scores: {
    judge: string;
    project: string;
    criteria: Record<string, number>;
    comment: string;
  }[];
};

const db = new PrismaClient();
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures.json'), 'utf8'),
) as Fixture;
const keys = ['functionality', 'quality', 'innovation'] as const;
const id = (kind: string, source: string): string => {
  const bytes = createHash('sha256')
    .update(`dogfood-2026-official-fixture:${kind}:${source}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const sourceId = {
  event: id('event', fixture.event.id),
  actor: id('user', 'fixture-organizer@dogfood.invalid'),
  rubric: id('rubric', fixture.event.id),
  run: id('assignment-run', fixture.event.id),
};
const acceptance = {
  organizer: 'fixture-organizer@dogfood.invalid',
  judge_a: 'wei.lindqvist@example.org', // jdg_02: six evaluations
  judge_b: 'nadia.rahman@example.org', // jdg_16: six, four shared projects
  participant: 'priya1@example.org', // first member of tm_01
} as const;
type AcceptanceRole = keyof typeof acceptance;
const acceptanceRoles = Object.keys(acceptance) as AcceptanceRole[];
const acceptanceToken = (role: AcceptanceRole) =>
  createHash('sha256')
    .update(`dogfood-2026-official-fixture:acceptance-cookie:${role}`)
    .digest('base64url');
const acceptanceSessionId = (role: AcceptanceRole) =>
  id('acceptance-session', role);
const userId = (email: string) => id('user', email.toLowerCase());
const memberId = (email: string, role: string) =>
  id('membership', `${fixture.event.id}:${role}:${email.toLowerCase()}`);
const scoreKey = (judge: string, project: string) => `${judge}:${project}`;
const date = (value: string) => {
  const parsed = new Date(value);
  assert.ok(
    Number.isFinite(parsed.valueOf()),
    `Invalid fixture date: ${value}`,
  );
  return parsed;
};
const close = date(fixture.event.submissions_close);
const firstSubmission = new Date(
  Math.min(
    ...fixture.projects.map((project) => date(project.submitted_at).valueOf()),
  ),
);

function validateSource() {
  assert.ok(fixture.event.id && fixture.event.name);
  assert.ok(fixture.projects.length > 0 && fixture.scores.length > 0);
  assert.ok(firstSubmission < close, 'Fixture closes before its submissions');
  const unique = (values: string[], label: string) =>
    assert.equal(new Set(values).size, values.length, `Duplicate ${label}`);
  for (const collection of ['tracks', 'judges', 'teams', 'projects'] as const)
    unique(
      fixture[collection].map((row) => row.id),
      `${collection} ID`,
    );
  const tracks = new Set(fixture.tracks.map((row) => row.id));
  const teams = new Set(fixture.teams.map((row) => row.id));
  const judges = new Set(fixture.judges.map((row) => row.id));
  const projects = new Set(fixture.projects.map((row) => row.id));
  const emails = fixture.teams.flatMap((team) =>
    team.members.map((e) => e.toLowerCase()),
  );
  unique(emails, 'team-member email');
  unique(
    fixture.judges.map((judge) => judge.email.toLowerCase()),
    'judge email',
  );
  assert.ok(
    fixture.judges.every(
      (judge) => !emails.includes(judge.email.toLowerCase()),
    ),
    'A judge is also a fixture team member',
  );
  for (const judge of fixture.judges)
    for (const track of judge.tracks)
      assert.ok(tracks.has(track), `Missing judge track ${track}`);
  for (const project of fixture.projects) {
    assert.ok(teams.has(project.team), `Missing team ${project.team}`);
    assert.ok(tracks.has(project.track), `Missing track ${project.track}`);
    assert.ok(
      date(project.submitted_at) <= close,
      `Late fixture project ${project.id}`,
    );
  }
  unique(
    fixture.scores.map((score) => scoreKey(score.judge, score.project)),
    'score pair',
  );
  for (const score of fixture.scores) {
    assert.ok(judges.has(score.judge), `Missing judge ${score.judge}`);
    assert.ok(projects.has(score.project), `Missing project ${score.project}`);
    assert.deepEqual(Object.keys(score.criteria).sort(), [...keys].sort());
    for (const value of Object.values(score.criteria))
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 5);
  }
}

function inertPasswordHash(): string {
  // Fixture accounts do not have a known password; acceptance uses cookies.
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(randomBytes(32), salt, 64).toString('hex')}`;
}

async function importFixture() {
  validateSource();
  assert.equal(
    fixture.judges.find((judge) => judge.id === 'jdg_02')?.email,
    acceptance.judge_a,
  );
  assert.equal(
    fixture.judges.find((judge) => judge.id === 'jdg_16')?.email,
    acceptance.judge_b,
  );
  assert.ok(
    fixture.teams.some((team) => team.members.includes(acceptance.participant)),
  );
  for (const role of ['judge_a', 'judge_b'] as const)
    assert.ok(
      fixture.scores.some(
        (score) => score.judge === (role === 'judge_a' ? 'jdg_02' : 'jdg_16'),
      ),
      `${role} needs imported scoring data`,
    );
  await db.$transaction(
    async (tx) => {
      const ensureUser = async (email: string, displayName: string) => {
        const normalized = email.toLowerCase();
        const key = userId(normalized);
        const existing = await tx.user.findUnique({ where: { id: key } });
        if (existing) {
          assert.equal(existing.email, normalized);
          assert.equal(existing.displayName, displayName);
          assert.equal(existing.status, 'ACTIVE');
          return;
        }
        await tx.user.create({
          data: {
            id: key,
            email: normalized,
            displayName,
            passwordHash: inertPasswordHash(),
            createdAt: firstSubmission,
          },
        });
      };
      const actorEmail = 'fixture-organizer@dogfood.invalid';
      await ensureUser(actorEmail, 'Official Fixture Organizer');
      for (const judge of fixture.judges)
        await ensureUser(judge.email, judge.name);
      for (const team of fixture.teams)
        for (const email of team.members)
          await ensureUser(email, email.split('@')[0]);

      const event = await tx.event.findUnique({
        where: { id: sourceId.event },
      });
      if (event) {
        assert.equal(event.name, fixture.event.name);
        assert.equal(
          event.slug,
          `official-${fixture.event.id.replaceAll('_', '-')}`,
        );
        assert.equal(event.createdById, sourceId.actor);
        assert.equal(event.status, 'PUBLISHED');
        assert.equal(event.visibility, 'PUBLIC');
        assert.equal(event.galleryVisibility, 'PUBLIC');
        assert.equal(
          event.submissionClosesAt?.toISOString(),
          close.toISOString(),
        );
      } else {
        await tx.event.create({
          data: {
            id: sourceId.event,
            slug: `official-${fixture.event.id.replaceAll('_', '-')}`,
            name: fixture.event.name,
            timezone: 'UTC',
            submissionClosesAt: close,
            status: 'PUBLISHED',
            visibility: 'PUBLIC',
            galleryVisibility: 'PUBLIC',
            createdById: sourceId.actor,
            createdAt: firstSubmission,
          },
        });
      }

      const ensureMembership = async (
        email: string,
        role: 'ORGANIZER' | 'PARTICIPANT' | 'JUDGE',
      ) => {
        const key = memberId(email, role);
        const existing = await tx.eventMembership.findUnique({
          where: { id: key },
        });
        if (existing) {
          assert.equal(existing.eventId, sourceId.event);
          assert.equal(existing.userId, userId(email));
          assert.equal(existing.role, role);
          assert.equal(existing.status, 'ACTIVE');
        } else {
          await tx.eventMembership.create({
            data: {
              id: key,
              eventId: sourceId.event,
              userId: userId(email),
              role,
              status: 'ACTIVE',
              createdAt: firstSubmission,
            },
          });
        }
      };
      await ensureMembership(actorEmail, 'ORGANIZER');
      for (const judge of fixture.judges)
        await ensureMembership(judge.email, 'JUDGE');
      for (const team of fixture.teams)
        for (const email of team.members) {
          await ensureMembership(email, 'PARTICIPANT');
          const key = id(
            'registration',
            `${fixture.event.id}:${email.toLowerCase()}`,
          );
          const existing = await tx.registration.findUnique({
            where: { id: key },
          });
          if (existing) {
            assert.equal(existing.eventId, sourceId.event);
            assert.equal(existing.userId, userId(email));
            assert.equal(existing.status, 'APPROVED');
          } else {
            await tx.registration.create({
              data: {
                id: key,
                eventId: sourceId.event,
                userId: userId(email),
                status: 'APPROVED',
                registeredAt: firstSubmission,
              },
            });
          }
        }

      // This explicitly invoked fixture importer installs known, acceptance-only
      // cookies. Normal login continues to generate random session tokens.
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      for (const role of acceptanceRoles) {
        const key = acceptanceSessionId(role);
        const tokenHash = createHash('sha256')
          .update(acceptanceToken(role))
          .digest('hex');
        const existing = await tx.session.findUnique({ where: { id: key } });
        if (existing) {
          assert.equal(existing.userId, userId(acceptance[role]));
          assert.equal(existing.tokenHash, tokenHash);
          assert.equal(
            existing.userAgent,
            'dogfood-official-fixture-acceptance',
          );
          if (existing.revokedAt || existing.expiresAt <= new Date())
            await tx.session.update({
              where: { id: key },
              data: { revokedAt: null, expiresAt },
            });
        } else {
          await tx.session.create({
            data: {
              id: key,
              userId: userId(acceptance[role]),
              tokenHash,
              expiresAt,
              userAgent: 'dogfood-official-fixture-acceptance',
            },
          });
        }
      }

      for (const track of fixture.tracks) {
        const key = id('track', track.id);
        const slug = `official-${track.id.replaceAll('_', '-')}`;
        const existing = await tx.track.findUnique({ where: { id: key } });
        if (existing) {
          assert.equal(existing.eventId, sourceId.event);
          assert.equal(existing.name, track.name);
          assert.equal(existing.slug, slug);
        } else {
          await tx.track.create({
            data: {
              id: key,
              eventId: sourceId.event,
              name: track.name,
              slug,
              createdAt: firstSubmission,
            },
          });
        }
      }

      for (const team of fixture.teams) {
        const key = id('team', team.id);
        const owner = userId(team.members[0]);
        const slug = `official-${team.id.replaceAll('_', '-')}`;
        const existing = await tx.team.findUnique({ where: { id: key } });
        if (existing) {
          assert.equal(existing.eventId, sourceId.event);
          assert.equal(existing.name, team.name);
          assert.equal(existing.slug, slug);
          assert.equal(existing.createdById, owner);
          assert.equal(existing.status, 'ACTIVE');
        } else {
          await tx.team.create({
            data: {
              id: key,
              eventId: sourceId.event,
              name: team.name,
              slug,
              createdById: owner,
              status: 'ACTIVE',
              createdAt: firstSubmission,
            },
          });
        }
        for (const [index, email] of team.members.entries()) {
          const memberKey = id(
            'team-member',
            `${team.id}:${email.toLowerCase()}`,
          );
          const role = index === 0 ? 'OWNER' : 'MEMBER';
          const member = await tx.teamMember.findUnique({
            where: { id: memberKey },
          });
          if (member) {
            assert.equal(member.eventId, sourceId.event);
            assert.equal(member.teamId, key);
            assert.equal(member.userId, userId(email));
            assert.equal(member.role, role);
            assert.equal(member.leftAt, null);
          } else {
            await tx.teamMember.create({
              data: {
                id: memberKey,
                eventId: sourceId.event,
                teamId: key,
                userId: userId(email),
                role,
                joinedAt: firstSubmission,
              },
            });
          }
        }
      }

      for (const project of fixture.projects) {
        const key = id('project', project.id);
        const team = fixture.teams.find((row) => row.id === project.team)!;
        const slug = `official-${project.id.replaceAll('_', '-')}`;
        const existing = await tx.project.findUnique({ where: { id: key } });
        if (existing) {
          assert.equal(existing.eventId, sourceId.event);
          assert.equal(existing.teamId, id('team', project.team));
          assert.equal(existing.trackId, id('track', project.track));
          assert.equal(existing.name, project.title);
          assert.equal(existing.slug, slug);
          assert.equal(existing.description, project.summary);
          assert.equal(existing.repositoryUrl, project.repo_url);
          assert.equal(existing.status, 'ACTIVE');
        } else {
          await tx.project.create({
            data: {
              id: key,
              eventId: sourceId.event,
              teamId: id('team', project.team),
              trackId: id('track', project.track),
              name: project.title,
              slug,
              description: project.summary,
              repositoryUrl: project.repo_url,
              status: 'ACTIVE',
              createdAt: date(project.submitted_at),
            },
          });
        }
        const snapshotId = id('submission', project.id);
        const snapshot = await tx.submission.findUnique({
          where: { id: snapshotId },
        });
        const submittedAt = date(project.submitted_at);
        const trackName = fixture.tracks.find(
          (row) => row.id === project.track,
        )!.name;
        if (snapshot) {
          assert.equal(snapshot.projectId, key);
          assert.equal(snapshot.version, 1);
          assert.equal(snapshot.title, project.title);
          assert.equal(snapshot.description, project.summary);
          assert.equal(snapshot.repositoryUrl, project.repo_url);
          assert.equal(snapshot.trackId, id('track', project.track));
          assert.equal(snapshot.trackName, trackName);
          assert.equal(snapshot.status, 'LOCKED');
          assert.equal(
            snapshot.submittedAt?.toISOString(),
            submittedAt.toISOString(),
          );
          assert.equal(snapshot.lockedAt?.toISOString(), close.toISOString());
        } else {
          await tx.submission.create({
            data: {
              id: snapshotId,
              projectId: key,
              version: 1,
              title: project.title,
              description: project.summary,
              repositoryUrl: project.repo_url,
              projectName: project.title,
              trackId: id('track', project.track),
              trackName,
              status: 'LOCKED',
              createdById: userId(team.members[0]),
              createdAt: submittedAt,
              submittedAt,
              lockedAt: close,
            },
          });
        }
      }

      for (const judge of fixture.judges) {
        const key = id('judge-profile', judge.id);
        const membership = memberId(judge.email, 'JUDGE');
        const existing = await tx.judgeProfile.findUnique({
          where: { id: key },
        });
        if (existing) {
          assert.equal(existing.eventMembershipId, membership);
          assert.equal(existing.available, true);
        } else {
          await tx.judgeProfile.create({
            data: {
              id: key,
              eventMembershipId: membership,
              available: true,
              createdAt: firstSubmission,
            },
          });
        }
        for (const track of judge.tracks) {
          const where = {
            judgeProfileId_trackId: {
              judgeProfileId: key,
              trackId: id('track', track),
            },
          };
          const expertise = await tx.judgeExpertise.findUnique({ where });
          if (expertise) assert.equal(expertise.expertiseLevel, 3);
          else
            await tx.judgeExpertise.create({
              data: {
                judgeProfileId: key,
                trackId: id('track', track),
                expertiseLevel: 3,
              },
            });
        }
      }

      const rubric = await tx.rubric.findUnique({
        where: { id: sourceId.rubric },
      });
      if (rubric) {
        assert.equal(rubric.eventId, sourceId.event);
        assert.equal(rubric.name, 'Official Fixture Criteria');
        assert.equal(rubric.version, 1);
        assert.equal(rubric.status, 'PUBLISHED');
      } else {
        await tx.rubric.create({
          data: {
            id: sourceId.rubric,
            eventId: sourceId.event,
            name: 'Official Fixture Criteria',
            version: 1,
            status: 'DRAFT',
            createdAt: firstSubmission,
          },
        });
      }
      for (const [index, criterion] of keys.entries()) {
        const key = id('criterion', criterion);
        const weight =
          index === keys.length - 1 ? '0.333333334' : '0.333333333';
        const existing = await tx.rubricCriterion.findUnique({
          where: { id: key },
        });
        if (existing) {
          assert.equal(existing.rubricId, sourceId.rubric);
          assert.equal(existing.name, criterion);
          assert.equal(existing.weight.toString(), weight);
          assert.equal(existing.minScore.toString(), '0');
          assert.equal(existing.maxScore.toString(), '5');
          assert.equal(existing.displayOrder, index);
        } else {
          assert.equal(rubric, null, 'Published rubric is missing a criterion');
          await tx.rubricCriterion.create({
            data: {
              id: key,
              rubricId: sourceId.rubric,
              name: criterion,
              weight,
              minScore: 0,
              maxScore: 5,
              displayOrder: index,
              createdAt: firstSubmission,
            },
          });
        }
      }
      if (!rubric)
        await tx.rubric.update({
          where: { id: sourceId.rubric },
          data: { status: 'PUBLISHED', publishedAt: firstSubmission },
        });

      const run = await tx.assignmentRun.findUnique({
        where: { id: sourceId.run },
      });
      if (run) {
        assert.equal(run.eventId, sourceId.event);
        assert.equal(run.rubricVersionId, sourceId.rubric);
        assert.equal(run.status, 'PUBLISHED');
        assert.equal(run.type, 'BATCH');
      } else {
        await tx.assignmentRun.create({
          data: {
            id: sourceId.run,
            eventId: sourceId.event,
            rubricVersionId: sourceId.rubric,
            type: 'BATCH',
            status: 'PUBLISHED',
            reviewsPerSubmission: Math.min(
              ...fixture.projects.map(
                (project) =>
                  fixture.scores.filter((score) => score.project === project.id)
                    .length,
              ),
            ),
            algorithm: 'OFFICIAL_FIXTURE',
            algorithmVersion: '1',
            allocationSource: 'IMPORT',
            createdById: sourceId.actor,
            createdAt: close,
            publishedAt: close,
          },
        });
      }
      for (const score of fixture.scores) {
        const pair = scoreKey(score.judge, score.project);
        const assignmentId = id('assignment', pair);
        const judgeProfileId = id('judge-profile', score.judge);
        const submissionId = id('submission', score.project);
        const assignment = await tx.judgeAssignment.findUnique({
          where: { id: assignmentId },
        });
        if (assignment) {
          assert.equal(assignment.eventId, sourceId.event);
          assert.equal(assignment.runId, sourceId.run);
          assert.equal(assignment.rubricId, sourceId.rubric);
          assert.equal(assignment.judgeProfileId, judgeProfileId);
          assert.equal(assignment.submissionId, submissionId);
        } else {
          await tx.judgeAssignment.create({
            data: {
              id: assignmentId,
              eventId: sourceId.event,
              runId: sourceId.run,
              rubricId: sourceId.rubric,
              judgeProfileId,
              submissionId,
              assignmentMethod: 'ALGORITHMIC',
              assignedById: sourceId.actor,
              assignedAt: close,
              status: 'COMPLETED',
            },
          });
        }
        const evaluationId = id('evaluation', pair);
        const evaluation = await tx.evaluation.findUnique({
          where: { id: evaluationId },
        });
        if (evaluation) {
          assert.equal(evaluation.assignmentId, assignmentId);
          assert.equal(evaluation.rubricId, sourceId.rubric);
          assert.equal(evaluation.status, 'SUBMITTED');
          assert.equal(evaluation.comments, score.comment);
          assert.equal(
            evaluation.submittedAt?.toISOString(),
            close.toISOString(),
          );
        } else {
          await tx.evaluation.create({
            data: {
              id: evaluationId,
              assignmentId,
              rubricId: sourceId.rubric,
              status: 'IN_PROGRESS',
              comments: score.comment,
              startedAt: close,
              createdAt: close,
            },
          });
        }
        for (const criterion of keys) {
          const key = id('evaluation-score', `${pair}:${criterion}`);
          const existing = await tx.evaluationScore.findUnique({
            where: { id: key },
          });
          if (existing) {
            assert.equal(existing.evaluationId, evaluationId);
            assert.equal(existing.criterionId, id('criterion', criterion));
            assert.equal(existing.score.toNumber(), score.criteria[criterion]);
          } else {
            assert.equal(
              evaluation,
              null,
              'Submitted evaluation is missing a score',
            );
            await tx.evaluationScore.create({
              data: {
                id: key,
                evaluationId,
                criterionId: id('criterion', criterion),
                score: score.criteria[criterion],
                createdAt: close,
              },
            });
          }
        }
        if (!evaluation)
          await tx.evaluation.update({
            where: { id: evaluationId },
            data: { status: 'SUBMITTED', submittedAt: close },
          });
      }
    },
    { timeout: 120_000 },
  );

  // Verify exact fixture identities and relationships after commit. A second
  // invocation executes the same checks without touching immutable rows.
  const [
    event,
    memberships,
    registrations,
    tracks,
    teams,
    members,
    projects,
    submissions,
    judges,
    expertise,
    rubrics,
    criteria,
    runs,
    assignments,
    evaluations,
    scores,
  ] = await Promise.all([
    db.event.findUniqueOrThrow({ where: { id: sourceId.event } }),
    db.eventMembership.findMany({ where: { eventId: sourceId.event } }),
    db.registration.findMany({ where: { eventId: sourceId.event } }),
    db.track.findMany({ where: { eventId: sourceId.event } }),
    db.team.findMany({ where: { eventId: sourceId.event } }),
    db.teamMember.findMany({ where: { eventId: sourceId.event } }),
    db.project.findMany({ where: { eventId: sourceId.event } }),
    db.submission.findMany({
      where: {
        projectId: { in: fixture.projects.map((p) => id('project', p.id)) },
      },
    }),
    db.judgeProfile.findMany({
      where: { eventMembership: { eventId: sourceId.event } },
    }),
    db.judgeExpertise.findMany({
      where: {
        judgeProfileId: {
          in: fixture.judges.map((judge) => id('judge-profile', judge.id)),
        },
      },
    }),
    db.rubric.findMany({ where: { eventId: sourceId.event } }),
    db.rubricCriterion.findMany({ where: { rubricId: sourceId.rubric } }),
    db.assignmentRun.findMany({ where: { eventId: sourceId.event } }),
    db.judgeAssignment.findMany({ where: { eventId: sourceId.event } }),
    db.evaluation.findMany({
      where: { assignment: { eventId: sourceId.event } },
    }),
    db.evaluationScore.findMany({
      where: { evaluation: { assignment: { eventId: sourceId.event } } },
    }),
  ]);
  assert.equal(event.submissionClosesAt?.toISOString(), close.toISOString());
  assert.equal(
    memberships.length,
    fixture.judges.length +
      fixture.teams.flatMap((team) => team.members).length +
      1,
  );
  assert.equal(
    registrations.length,
    fixture.teams.flatMap((team) => team.members).length,
  );
  assert.equal(tracks.length, fixture.tracks.length);
  assert.equal(teams.length, fixture.teams.length);
  assert.equal(
    members.length,
    fixture.teams.flatMap((team) => team.members).length,
  );
  assert.equal(projects.length, fixture.projects.length);
  assert.equal(submissions.length, fixture.projects.length);
  assert.equal(judges.length, fixture.judges.length);
  assert.equal(
    expertise.length,
    fixture.judges.flatMap((judge) => judge.tracks).length,
  );
  assert.equal(rubrics.length, 1);
  assert.equal(criteria.length, keys.length);
  assert.equal(runs.length, 1);
  assert.equal(assignments.length, fixture.scores.length);
  assert.equal(evaluations.length, fixture.scores.length);
  assert.equal(scores.length, fixture.scores.length * keys.length);
  for (const project of fixture.projects) {
    const row = projects.find((item) => item.id === id('project', project.id));
    const snapshot = submissions.find(
      (item) => item.id === id('submission', project.id),
    );
    assert.equal(row?.name, project.title);
    assert.equal(row?.teamId, id('team', project.team));
    assert.equal(
      snapshot?.submittedAt?.toISOString(),
      date(project.submitted_at).toISOString(),
    );
  }
  for (const score of fixture.scores) {
    const pair = scoreKey(score.judge, score.project);
    const assignment = assignments.find(
      (item) => item.id === id('assignment', pair),
    );
    const evaluation = evaluations.find(
      (item) => item.id === id('evaluation', pair),
    );
    assert.equal(assignment?.judgeProfileId, id('judge-profile', score.judge));
    assert.equal(assignment?.submissionId, id('submission', score.project));
    assert.equal(evaluation?.assignmentId, assignment?.id);
    assert.equal(evaluation?.comments, score.comment);
    for (const criterion of keys)
      assert.equal(
        scores
          .find(
            (item) =>
              item.id === id('evaluation-score', `${pair}:${criterion}`),
          )
          ?.score.toNumber(),
        score.criteria[criterion],
      );
  }
  const duplicate = fixture.projects.filter(
    (project) => project.title === 'Dry Harbour',
  );
  assert.equal(duplicate.length, 2);
  assert.notEqual(
    id('project', duplicate[0].id),
    id('project', duplicate[1].id),
  );
  console.log(
    JSON.stringify({
      eventId: sourceId.event,
      deadline: event.submissionClosesAt?.toISOString(),
      memberships: memberships.length,
      registrations: registrations.length,
      tracks: tracks.length,
      judges: judges.length,
      teams: teams.length,
      members: members.length,
      projects: projects.length,
      submissions: submissions.length,
      criteria: criteria.length,
      assignments: assignments.length,
      evaluations: evaluations.length,
      scores: scores.length,
    }),
  );
  console.log('Acceptance-only fixture headers (treat as credentials):');
  for (const role of acceptanceRoles)
    console.log(
      `${role.padEnd(11)} = "Cookie: dogfood_session=${acceptanceToken(role)}"`,
    );
}

void importFixture()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
