'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, message } from '../lib/client';

type Judge = {
  id: string;
  displayName: string;
  email: string;
  membershipStatus: string;
  available: boolean;
  maxAssignments: number | null;
};
type Criterion = {
  name: string;
  weight: string;
  minScore: string;
  maxScore: string;
};
type Rubric = {
  id: string;
  name: string;
  version: number;
  status: string;
  criteria: Array<Criterion & { id: string }>;
};
type Conflict = {
  id: string;
  judgeProfileId: string;
  type: string;
  teamId: string | null;
  projectId: string | null;
  reason: string | null;
};
type Coverage = {
  submissionId: string;
  projectId: string;
  assigned: number;
  completed: number;
  shortfall: number;
};
type Progress = {
  activeJudges: number;
  eligibleSubmissions: number;
  reviewsPerSubmission: number;
  requiredEvaluations: number;
  publishedCoverage: number;
  completedEvaluations: number;
  remainingEvaluations: number;
  judges: Array<{
    judgeProfileId: string;
    assigned: number;
    completed: number;
    remaining: number;
  }>;
  submissions: Coverage[];
};
type Preflight = {
  required: number;
  achievable: number;
  shortfall: number;
  affectedSubmissions: Array<{ submissionId: string; reasons: string[] }>;
  perSubmission: Array<{ submissionId: string; eligibleJudgeCount: number }>;
  connectivity: { components: number };
  warnings: string[];
};
type Preview = {
  runId: string;
  status: string;
  allocationSource: string;
  proposals: Array<{ judgeProfileId: string; submissionId: string }>;
  stats: { required: number; achievable: number; shortfall: number };
};

type ScoreRunItem = {
  id: string;
  status: string;
  method: string;
  methodVersion: string;
  rubricVersionId: string | null;
  evaluationCount: number;
  createdAt: string;
  completedAt: string | null;
  freshness: 'CURRENT' | 'STALE';
};

type ProjectScoreItem = {
  id: string;
  projectId: string;
  aggregatedScore: string;
  rawAverage: string;
  evaluationCount: number;
  requiredCount: number;
  coverageComplete: boolean;
};

type JudgeScoreStat = {
  judgeProfileId: string;
  evaluationCount: number;
  mean: string;
  populationStdDev: string;
  diagnostic: string | null;
};

type ScoreRunDetail = ScoreRunItem & {
  projectScores: ProjectScoreItem[];
  judgeStats: JudgeScoreStat[];
  coverageDiagnostics: Array<{
    projectId: string;
    required: number;
    submitted: number;
    coverageComplete: boolean;
  }> | null;
  normalizationDiagnostics: {
    judges: Array<{ judgeProfileId: string; diagnostic: string | null }>;
    suspendedJudges: string[];
  } | null;
};

type ResultRunItem = {
  id: string;
  scoreRunId: string;
  status: string;
  coverageIncomplete: boolean;
  overrideReason: string | null;
  rankingPolicy: string;
  rankingVersion: string;
  generatedAt: string;
};

type ProjectResultItem = {
  id: string;
  projectId: string;
  score: string;
  rank: number;
};

type ResultRunDetail = ResultRunItem & {
  projectResults: ProjectResultItem[];
};

const emptyCriterion = (): Criterion => ({
  name: '',
  weight: '',
  minScore: '0',
  maxScore: '10',
});
export function JudgingOrganizer({ eventId }: { eventId: string }) {
  const base = `/events/${eventId}/judging`;
  const [judges, setJudges] = useState<Judge[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [reviews, setReviews] = useState(1);
  const [rubricId, setRubricId] = useState('');
  const [criteria, setCriteria] = useState<Criterion[]>([
    emptyCriterion(),
    emptyCriterion(),
  ]);
  const [rubricName, setRubricName] = useState('Judging rubric');
  const [inviteLink, setInviteLink] = useState('');
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledge, setAcknowledge] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Phase 4B scoring & results state
  const [scoreRuns, setScoreRuns] = useState<ScoreRunItem[]>([]);
  const [selectedScoreRun, setSelectedScoreRun] =
    useState<ScoreRunDetail | null>(null);
  const [resultRuns, setResultRuns] = useState<ResultRunItem[]>([]);
  const [selectedResultRun, setSelectedResultRun] =
    useState<ResultRunDetail | null>(null);
  const [targetScoreRunId, setTargetScoreRunId] = useState('');
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [coverageBlocked, setCoverageBlocked] = useState(false);

  const load = useCallback(async () => {
    const [j, r, c, p, sRuns, rRuns] = await Promise.all([
      api<Judge[]>(`${base}/judges`),
      api<Rubric[]>(`${base}/rubrics`),
      api<Conflict[]>(`${base}/conflicts`),
      api<Progress>(`${base}/progress?reviewsPerSubmission=${reviews}`),
      api<ScoreRunItem[]>(`${base}/scoring/runs`).catch(() => []),
      api<ResultRunItem[]>(`${base}/results/runs`).catch(() => []),
    ]);
    setJudges(j);
    setRubrics(r);
    setConflicts(c);
    setProgress(p);
    setScoreRuns(sRuns);
    setResultRuns(rRuns);
    setRubricId(
      (current) => current || r.find((x) => x.status === 'PUBLISHED')?.id || '',
    );
    if (!targetScoreRunId && sRuns.length > 0) {
      const completed = sRuns.find((s) => s.status === 'COMPLETED');
      if (completed) setTargetScoreRunId(completed.id);
    }
  }, [base, reviews, targetScoreRunId]);
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, [load]);
  async function run(action: () => Promise<void>) {
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(message(e));
    }
  }
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    await run(async () => {
      const response = await api<{ token: string }>(`${base}/invitations`, {
        method: 'POST',
        body: { email: String(data.get('email')) },
      });
      setInviteLink(
        `${window.location.origin}/judge-invitations/${response.token}`,
      );
      setNotice(
        'Judge invitation created. Share the link with the intended judge.',
      );
      form.reset();
      await load();
    });
  }
  async function saveRubric(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await run(async () => {
      const created = await api<Rubric>(`${base}/rubrics`, {
        method: 'POST',
        body: { name: rubricName, criteria },
      });
      setRubricId(created.id);
      setNotice('Draft rubric created. Publish it before assigning.');
      await load();
    });
  }
  async function declareConflict(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    await run(async () => {
      await api(`${base}/conflicts`, {
        method: 'POST',
        body: {
          judgeProfileId: String(data.get('judgeProfileId')),
          type: String(data.get('type')),
          targetId: String(data.get('targetId')),
          reason: String(data.get('reason')) || undefined,
        },
      });
      setNotice('Conflict declared.');
      form.reset();
      await load();
    });
  }
  const selectedRubric = rubrics.find((r) => r.id === rubricId);
  const judgeName = (id: string) =>
    judges.find((j) => j.id === id)?.displayName ?? id;
  return (
    <main>
      <h1>Judging setup and progress</h1>
      <p>
        <a href={`/events/${eventId}/manage`}>Event settings</a> ·{' '}
        <a href={`/events/${eventId}`}>Event page</a> ·{' '}
        <a href={`/events/${eventId}/judging/records`}>Participation records</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Judges">
        <h2>Judges</h2>
        <form onSubmit={(e) => void invite(e)}>
          <label>
            Judge email <input name="email" type="email" required />
          </label>
          <button type="submit">Invite judge</button>
        </form>
        {inviteLink && (
          <p>
            Invitation link: <a href={inviteLink}>{inviteLink}</a>
          </p>
        )}
        <ul>
          {judges.map((j) => (
            <li key={j.id}>
              {j.displayName} ({j.email}) · {j.membershipStatus}
              {j.available ? '' : ' · unavailable'} · capacity{' '}
              {j.maxAssignments ?? 'unlimited'}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Rubrics">
        <h2>Rubric</h2>
        <form onSubmit={(e) => void saveRubric(e)}>
          <label>
            Rubric name{' '}
            <input
              value={rubricName}
              onChange={(e) => setRubricName(e.target.value)}
              required
            />
          </label>
          {criteria.map((c, i) => (
            <fieldset key={i}>
              <legend>Criterion {i + 1}</legend>
              {(['name', 'weight', 'minScore', 'maxScore'] as const).map(
                (field) => (
                  <label key={field}>
                    {field === 'minScore'
                      ? 'Minimum score'
                      : field === 'maxScore'
                        ? 'Maximum score'
                        : field}
                    <input
                      value={c[field]}
                      required
                      onChange={(e) =>
                        setCriteria((old) =>
                          old.map((item, index) =>
                            index === i
                              ? { ...item, [field]: e.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                ),
              )}
              {criteria.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setCriteria((old) => old.filter((_, index) => index !== i))
                  }
                >
                  Remove criterion
                </button>
              )}
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => setCriteria((old) => [...old, emptyCriterion()])}
          >
            Add criterion
          </button>{' '}
          <button type="submit">Create draft rubric</button>
        </form>
        <label>
          Rubric version{' '}
          <select
            value={rubricId}
            onChange={(e) => setRubricId(e.target.value)}
          >
            <option value="">Select rubric</option>
            {rubrics.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} v{r.version} · {r.status}
              </option>
            ))}
          </select>
        </label>
        {selectedRubric?.status === 'DRAFT' && (
          <button
            onClick={() =>
              void run(async () => {
                await api(`${base}/rubrics/${rubricId}/publish`, {
                  method: 'POST',
                });
                setNotice('Rubric published.');
                await load();
              })
            }
          >
            Publish rubric
          </button>
        )}
      </section>
      <section aria-label="Conflicts">
        <h2>Conflicts</h2>
        <form onSubmit={(e) => void declareConflict(e)}>
          <label>
            Judge{' '}
            <select name="judgeProfileId" required>
              {judges.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Target type{' '}
            <select name="type">
              <option value="PROJECT">Project</option>
              <option value="TEAM">Team</option>
            </select>
          </label>
          <label>
            Project or team ID{' '}
            <input
              name="targetId"
              required
              placeholder="Copy an ID from coverage below"
            />
          </label>
          <label>
            Reason <input name="reason" />
          </label>
          <button type="submit">Declare conflict</button>
        </form>
        <ul>
          {conflicts.map((c) => (
            <li key={c.id}>
              {judgeName(c.judgeProfileId)} · {c.type} {c.projectId ?? c.teamId}{' '}
              · {c.reason ?? 'No reason'}{' '}
              <button
                onClick={() =>
                  void run(async () => {
                    await api(`${base}/conflicts/${c.id}`, {
                      method: 'DELETE',
                    });
                    await load();
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Assignments">
        <h2>Assignments</h2>
        <label>
          Reviews per submission{' '}
          <input
            type="number"
            min="1"
            max="20"
            value={reviews}
            onChange={(e) => setReviews(Number(e.target.value))}
          />
        </label>
        <p>
          <button
            disabled={!selectedRubric || selectedRubric.status !== 'PUBLISHED'}
            onClick={() =>
              void run(async () => {
                setPreflight(
                  await api<Preflight>(`${base}/assignments/preflight`, {
                    method: 'POST',
                    body: { rubricId, reviewsPerSubmission: reviews },
                  }),
                );
              })
            }
          >
            Run preflight
          </button>{' '}
          <button
            disabled={!selectedRubric || selectedRubric.status !== 'PUBLISHED'}
            onClick={() =>
              void run(async () => {
                setPreview(
                  await api<Preview>(`${base}/assignments/preview`, {
                    method: 'POST',
                    body: { rubricId, reviewsPerSubmission: reviews },
                  }),
                );
              })
            }
          >
            Generate preview
          </button>
        </p>
        {preflight && (
          <div>
            <p>
              Required {preflight.required} · achievable {preflight.achievable}{' '}
              · shortfall {preflight.shortfall} · graph components{' '}
              {preflight.connectivity.components}
            </p>
            {preflight.warnings.map((w) => (
              <p role="status" key={w}>
                {w}
              </p>
            ))}
            <ul>
              {preflight.affectedSubmissions.map((s) => (
                <li key={s.submissionId}>
                  {s.submissionId}: {s.reasons.join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
        {preview && (
          <div>
            <h3>Preview</h3>
            <p>
              Run {preview.runId} · {preview.allocationSource} ·{' '}
              {preview.proposals.length} proposed pairs · shortfall{' '}
              {preview.stats.shortfall}
            </p>
            <ul>
              {preview.proposals.map((p) => (
                <li key={`${p.judgeProfileId}-${p.submissionId}`}>
                  {judgeName(p.judgeProfileId)} → {p.submissionId}
                </li>
              ))}
            </ul>
            <label>
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              Acknowledge publishing while submissions are open
            </label>
            <button
              disabled={
                preview.stats.shortfall > 0 || preview.status !== 'PREVIEW'
              }
              onClick={() =>
                void run(async () => {
                  await api(
                    `${base}/assignments/runs/${preview.runId}/publish`,
                    {
                      method: 'POST',
                      body: { acknowledgeOpenSubmissions: acknowledge },
                    },
                  );
                  setPreview(null);
                  setNotice('Assignments published.');
                  await load();
                })
              }
            >
              Publish assignments
            </button>
          </div>
        )}
      </section>
      <section aria-label="Judging progress">
        <h2>Progress</h2>
        <button onClick={() => void run(load)}>Refresh progress</button>
        {progress && (
          <>
            <p>
              {progress.activeJudges} active judges ·{' '}
              {progress.eligibleSubmissions} eligible submissions ·{' '}
              {progress.requiredEvaluations} required reviews ·{' '}
              {progress.publishedCoverage} assigned ·{' '}
              {progress.completedEvaluations} completed ·{' '}
              {progress.remainingEvaluations} remaining
            </p>
            <h3>Per judge</h3>
            <ul>
              {progress.judges.map((j) => (
                <li key={j.judgeProfileId}>
                  {judgeName(j.judgeProfileId)}: {j.assigned} assigned,{' '}
                  {j.completed} completed, {j.remaining} remaining
                </li>
              ))}
            </ul>
            <h3>Per project</h3>
            <ul>
              {progress.submissions.map((s) => (
                <li key={s.submissionId}>
                  Project {s.projectId} · submission {s.submissionId}:{' '}
                  {s.assigned} assigned, {s.completed} completed, {s.shortfall}{' '}
                  shortfall
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-label="Scoring and Normalization">
        <h2>Scoring (Z_SCORE_V1)</h2>
        <div style={{ marginBottom: '1rem' }}>
          <button
            onClick={() =>
              void run(async () => {
                const res = await api<ScoreRunDetail>(`${base}/scoring/runs`, {
                  method: 'POST',
                  body: rubricId ? { rubricVersionId: rubricId } : {},
                });
                setSelectedScoreRun(res);
                setNotice(`ScoreRun ${res.id} created.`);
                await load();
              })
            }
          >
            Run scoring (Z_SCORE_V1)
          </button>
        </div>
        <h3>Score runs</h3>
        {scoreRuns.length === 0 ? (
          <p>No score runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Method</th>
                <th>Created</th>
                <th>Evaluations</th>
                <th>Freshness</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {scoreRuns.map((sr) => (
                <tr key={sr.id}>
                  <td>
                    <code>{sr.id.slice(0, 8)}...</code>
                  </td>
                  <td>
                    {sr.method} {sr.methodVersion}
                  </td>
                  <td>{new Date(sr.createdAt).toLocaleString()}</td>
                  <td>{sr.evaluationCount}</td>
                  <td>
                    <span
                      style={{
                        fontWeight: 'bold',
                        color: sr.freshness === 'CURRENT' ? 'green' : 'orange',
                      }}
                    >
                      {sr.freshness}
                    </span>
                  </td>
                  <td>{sr.status}</td>
                  <td>
                    <button
                      onClick={() =>
                        void run(async () => {
                          const res = await api<ScoreRunDetail>(
                            `${base}/scoring/runs/${sr.id}`,
                          );
                          setSelectedScoreRun(res);
                        })
                      }
                    >
                      View details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selectedScoreRun && (
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              border: '1px solid #ccc',
            }}
          >
            <h3>
              Score run details: <code>{selectedScoreRun.id}</code>
            </h3>
            <p>
              Method: {selectedScoreRun.method} {selectedScoreRun.methodVersion}{' '}
              · Freshness: <strong>{selectedScoreRun.freshness}</strong>
            </p>
            {selectedScoreRun.normalizationDiagnostics && (
              <div>
                <h4>Normalization diagnostic</h4>
                <ul>
                  {selectedScoreRun.normalizationDiagnostics.judges.map((j) => (
                    <li key={j.judgeProfileId}>
                      Judge {j.judgeProfileId.slice(0, 8)}:{' '}
                      {j.diagnostic ?? 'OK'}
                    </li>
                  ))}
                  {selectedScoreRun.normalizationDiagnostics.suspendedJudges.map(
                    (s) => (
                      <li key={s} style={{ color: 'red' }}>
                        {s}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            )}
            <h4>Project scores</h4>
            <table>
              <thead>
                <tr>
                  <th>Project ID</th>
                  <th>Raw average</th>
                  <th>Normalized score</th>
                  <th>Submitted / Required</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {selectedScoreRun.projectScores.map((ps) => (
                  <tr key={ps.id}>
                    <td>
                      <code>{ps.projectId.slice(0, 8)}...</code>
                    </td>
                    <td>{Number(ps.rawAverage).toFixed(2)}</td>
                    <td>{Number(ps.aggregatedScore).toFixed(6)}</td>
                    <td>
                      {ps.evaluationCount} / {ps.requiredCount}
                    </td>
                    <td>
                      <span
                        style={{
                          color: ps.coverageComplete ? 'green' : 'red',
                        }}
                      >
                        {ps.coverageComplete ? 'Complete' : 'Incomplete'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Results and Rankings">
        <h2>Results</h2>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Select completed ScoreRun:{' '}
            <select
              value={targetScoreRunId}
              onChange={(e) => setTargetScoreRunId(e.target.value)}
            >
              <option value="">-- Choose ScoreRun --</option>
              {scoreRuns
                .filter((s) => s.status === 'COMPLETED')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id.slice(0, 8)}... ({s.freshness}, {s.evaluationCount}{' '}
                    evals)
                  </option>
                ))}
            </select>
          </label>{' '}
          <button
            disabled={!targetScoreRunId}
            onClick={() =>
              void run(async () => {
                setCoverageBlocked(false);
                try {
                  const res = await api<ResultRunDetail>(
                    `${base}/results/runs`,
                    {
                      method: 'POST',
                      body: { scoreRunId: targetScoreRunId },
                    },
                  );
                  setSelectedResultRun(res);
                  setNotice(`ResultRun ${res.id} created.`);
                  await load();
                } catch (e: unknown) {
                  if (
                    e instanceof Error &&
                    e.message.includes('INCOMPLETE_COVERAGE')
                  ) {
                    setCoverageBlocked(true);
                  }
                  throw e;
                }
              })
            }
          >
            Create ResultRun
          </button>
        </div>

        {coverageBlocked && (
          <div
            style={{
              padding: '1rem',
              border: '1px solid orange',
              marginBottom: '1rem',
            }}
          >
            <h3>Incomplete coverage warning</h3>
            <p>
              Coverage is incomplete for some projects. To proceed, confirm the
              override and specify a reason.
            </p>
            <label>
              <input
                type="checkbox"
                checked={confirmIncomplete}
                onChange={(e) => setConfirmIncomplete(e.target.checked)}
              />
              Confirm incomplete coverage override
            </label>
            <br />
            <label>
              Override reason:{' '}
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Reason for proceeding with incomplete coverage"
                style={{ width: '300px' }}
              />
            </label>
            <br />
            <button
              disabled={!confirmIncomplete || !overrideReason.trim()}
              onClick={() =>
                void run(async () => {
                  const res = await api<ResultRunDetail>(
                    `${base}/results/runs`,
                    {
                      method: 'POST',
                      body: {
                        scoreRunId: targetScoreRunId,
                        confirmIncomplete: true,
                        overrideReason,
                      },
                    },
                  );
                  setSelectedResultRun(res);
                  setNotice(`ResultRun ${res.id} created with override.`);
                  setConfirmIncomplete(false);
                  setOverrideReason('');
                  setCoverageBlocked(false);
                  await load();
                })
              }
            >
              Override and create ResultRun
            </button>
          </div>
        )}

        <h3>Result runs</h3>
        {resultRuns.length === 0 ? (
          <p>No result runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ResultRun ID</th>
                <th>ScoreRun ID</th>
                <th>Generated</th>
                <th>Coverage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {resultRuns.map((rr) => (
                <tr key={rr.id}>
                  <td>
                    <code>{rr.id.slice(0, 8)}...</code>
                  </td>
                  <td>
                    <code>{rr.scoreRunId.slice(0, 8)}...</code>
                  </td>
                  <td>{new Date(rr.generatedAt).toLocaleString()}</td>
                  <td>
                    {rr.coverageIncomplete ? (
                      <span style={{ color: 'orange' }}>
                        Incomplete (Overridden)
                      </span>
                    ) : (
                      <span style={{ color: 'green' }}>Complete</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        void run(async () => {
                          const res = await api<ResultRunDetail>(
                            `${base}/results/runs/${rr.id}`,
                          );
                          setSelectedResultRun(res);
                        })
                      }
                    >
                      View rankings
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selectedResultRun && (
          <div
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              border: '1px solid #ccc',
            }}
          >
            <h3>
              Result rankings (ResultRun <code>{selectedResultRun.id}</code>)
            </h3>
            <p>
              Derived from ScoreRun <code>{selectedResultRun.scoreRunId}</code>{' '}
              · Policy: {selectedResultRun.rankingPolicy}{' '}
              {selectedResultRun.rankingVersion} · Coverage:{' '}
              {selectedResultRun.coverageIncomplete ? (
                <span style={{ color: 'orange' }}>
                  Incomplete: {selectedResultRun.overrideReason}
                </span>
              ) : (
                <span style={{ color: 'green' }}>Complete</span>
              )}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Project ID</th>
                  <th>Normalized score</th>
                </tr>
              </thead>
              <tbody>
                {selectedResultRun.projectResults.map((pr) => (
                  <tr key={pr.id}>
                    <td>
                      <strong>{pr.rank}</strong>
                    </td>
                    <td>
                      <code>{pr.projectId.slice(0, 8)}...</code>
                    </td>
                    <td>{Number(pr.score).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="CSV Exports">
        <h2>CSV Exports</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {[
            { type: 'judges', label: 'Export Judges CSV' },
            { type: 'assignments', label: 'Export Assignments CSV' },
            { type: 'progress', label: 'Export Progress CSV' },
            { type: 'raw-evaluations', label: 'Export Raw Evaluations CSV' },
            {
              type: 'normalized-scores',
              label: 'Export Normalized Scores CSV',
            },
            { type: 'project-scores', label: 'Export Project Scores CSV' },
            { type: 'results', label: 'Export Results CSV' },
          ].map(({ type, label }) => (
            <button
              key={type}
              onClick={() =>
                void run(async () => {
                  let url = `${base}/exports/${type}`;
                  if (
                    type === 'normalized-scores' ||
                    type === 'project-scores'
                  ) {
                    if (selectedScoreRun)
                      url += `?scoreRunId=${selectedScoreRun.id}`;
                  } else if (type === 'results') {
                    if (selectedResultRun)
                      url += `?resultRunId=${selectedResultRun.id}`;
                  }
                  const res = await fetch(`/api${url}`);
                  if (!res.ok) {
                    const err = await res.json().catch(() => null);
                    throw new Error(err?.message ?? `Failed to export ${type}`);
                  }
                  const text = await res.text();
                  const blob = new Blob([text], {
                    type: 'text/csv;charset=utf-8;',
                  });
                  const dlUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = dlUrl;
                  a.download = `${type}-${eventId}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(dlUrl);
                  setNotice(`Downloaded ${type}-${eventId}.csv`);
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
