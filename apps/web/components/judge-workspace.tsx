'use client';
import { useEffect, useState } from 'react';
import { api, message } from '../lib/client';

type Workspace = {
  assigned: number;
  completed: number;
  draft: number;
  remaining: number;
  assignments: Array<{
    assignmentId: string;
    title: string;
    projectName: string | null;
    status: string;
  }>;
};
type Detail = {
  assignmentId: string;
  submission: {
    title: string;
    description: string;
    projectName: string | null;
    projectTagline: string | null;
    repositoryUrl: string | null;
    demoUrl: string | null;
    version: number;
  };
  rubric: {
    id: string;
    name: string;
    version: number;
    criteria: Array<{
      id: string;
      name: string;
      description: string | null;
      weight: string;
      minScore: string;
      maxScore: string;
    }>;
  };
  evaluation: {
    status: string;
    comments: string | null;
    scores: Array<{
      criterionId: string;
      score: string;
      comment: string | null;
    }>;
  } | null;
};
export function JudgeWorkspace({ eventId }: { eventId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Workspace>(`/events/${eventId}/judging/workspace`).then(
      setWorkspace,
      (e) => setError(message(e)),
    );
  }, [eventId]);
  return (
    <main className="raptors-workspace-container">
      <div className="raptors-workspace-header">
        <span className="raptors-workspace-eyebrow">Judge Portal</span>
        <div className="raptors-workspace-title-row">
          <h1 className="raptors-workspace-title">Judge workspace</h1>
        </div>
        <p className="raptors-workspace-desc">
          Your assigned evaluation workload. Grade projects against the official
          rubric criteria and submit verified scores.
        </p>
      </div>

      <nav className="raptors-workspace-tabs" aria-label="Judge navigation">
        <a href={`/events/${eventId}`} className="raptors-tab-item">
          Event Overview
        </a>
        <a
          href={`/events/${eventId}/judge`}
          className="raptors-tab-item active"
        >
          My Assignments
        </a>
        <a
          href={`/events/${eventId}/judge/pairwise`}
          className="raptors-tab-item"
        >
          Open Pairwise Mode
        </a>
        <a href={`/events/${eventId}/records`} className="raptors-tab-item">
          My Records
        </a>
      </nav>

      <p style={{ display: 'none' }}>
        <a href={`/events/${eventId}/judge/pairwise`}>Open Pairwise Mode</a>
      </p>
      <p style={{ display: 'none' }}>
        <a href={`/events/${eventId}`}>Event page</a>
      </p>

      {error && <p role="alert">{error}</p>}
      {workspace && (
        <>
          <p style={{ margin: '0 0 16px', color: '#666', fontSize: '13px' }}>
            {workspace.assigned} assigned · {workspace.completed} completed ·{' '}
            {workspace.draft} draft · {workspace.remaining} remaining
          </p>
          <div className="raptors-stat-grid">
            <div className="raptors-stat-card">
              <div className="raptors-stat-card-num">{workspace.assigned}</div>
              <div className="raptors-stat-card-label">Assigned Projects</div>
            </div>
            <div className="raptors-stat-card">
              <div className="raptors-stat-card-num">{workspace.completed}</div>
              <div className="raptors-stat-card-label">Completed Reviews</div>
            </div>
            <div className="raptors-stat-card">
              <div className="raptors-stat-card-num">{workspace.draft}</div>
              <div className="raptors-stat-card-label">Draft Reviews</div>
            </div>
            <div className="raptors-stat-card">
              <div className="raptors-stat-card-num">{workspace.remaining}</div>
              <div className="raptors-stat-card-label">Remaining Reviews</div>
            </div>
          </div>

          <section className="raptors-card-panel" aria-label="Assignments List">
            <div className="raptors-card-header">
              <h2 className="raptors-card-title">Assigned Submissions</h2>
              <span className="raptors-rubric-tag">
                {workspace.assignments.length} total
              </span>
            </div>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {workspace.assignments.map((a) => (
                <li
                  key={a.assignmentId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 18px',
                    background: '#fafaf7',
                    border: '1px solid #e4e4dc',
                    borderRadius: '8px',
                  }}
                >
                  <a
                    href={`/events/${eventId}/judge/${a.assignmentId}`}
                    style={{
                      fontWeight: 600,
                      color: '#090909',
                      textDecoration: 'none',
                    }}
                  >
                    {a.projectName ?? a.title}
                  </a>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background:
                        a.status === 'COMPLETED' ? '#090909' : '#eaeae4',
                      color: a.status === 'COMPLETED' ? '#ffffff' : '#333333',
                    }}
                  >
                    {a.status}
                  </span>
                </li>
              ))}
            </ul>
            {workspace.assigned === 0 && <p>No published assignments yet.</p>}
          </section>
        </>
      )}
    </main>
  );
}
export function JudgeEvaluation({
  eventId,
  assignmentId,
}: {
  eventId: string;
  assignmentId: string;
}) {
  const base = `/events/${eventId}/judging/assignments/${assignmentId}`;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void api<Detail>(base).then(
      (data) => {
        setDetail(data);
        setComments(data.evaluation?.comments ?? '');
        setScores(
          Object.fromEntries(
            data.evaluation?.scores.map((s) => [s.criterionId, s.score]) ?? [],
          ),
        );
      },
      (e) => setError(message(e)),
    );
  }, [base]);
  async function save(submit: boolean) {
    setError('');
    setNotice('');
    if (!detail) return;
    try {
      const body = {
        comments,
        scores: detail.rubric.criteria
          .filter(
            (criterion) =>
              scores[criterion.id] !== undefined && scores[criterion.id] !== '',
          )
          .map((criterion) => ({
            criterionId: criterion.id,
            score: scores[criterion.id],
          })),
      };
      const updated = await api<Detail>(
        submit ? `${base}/evaluation/submit` : `${base}/evaluation`,
        { method: submit ? 'POST' : 'PATCH', body },
      );
      setDetail(updated);
      setNotice(submit ? 'Evaluation submitted.' : 'Draft saved.');
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <main className="raptors-workspace-container">
      <div style={{ marginBottom: '16px' }}>
        <a
          href={`/events/${eventId}/judge`}
          className="raptors-text-link"
          style={{ fontSize: '13.5px', fontWeight: 600 }}
        >
          ← Back to Judge workspace
        </a>
      </div>
      <div className="raptors-workspace-header">
        <span className="raptors-workspace-eyebrow">Rubric Evaluation</span>
        <h1 className="raptors-workspace-title">Evaluate assignment</h1>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {detail && (
        <>
          <section
            className="raptors-card-panel"
            aria-label="Project Information"
          >
            <div className="raptors-card-header">
              <h2>
                {detail.submission.projectName ?? detail.submission.title}
              </h2>
              <span className="raptors-rubric-tag">
                Submission v{detail.submission.version}
              </span>
            </div>
            <p style={{ fontWeight: 600, color: '#333333' }}>
              Submission v{detail.submission.version}: {detail.submission.title}
            </p>
            {detail.submission.projectTagline && (
              <p style={{ fontStyle: 'italic', color: '#666666' }}>
                {detail.submission.projectTagline}
              </p>
            )}
            <p style={{ lineHeight: '1.6', margin: '14px 0' }}>
              {detail.submission.description}
            </p>
            <div className="raptors-action-row">
              {detail.submission.repositoryUrl && (
                <a
                  href={detail.submission.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="raptors-btn-secondary btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  View Repository ↗
                </a>
              )}
              {detail.submission.demoUrl && (
                <a
                  href={detail.submission.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="raptors-btn-secondary btn-secondary"
                  style={{ textDecoration: 'none' }}
                >
                  Live Demo ↗
                </a>
              )}
            </div>
          </section>

          <section className="raptors-card-panel" aria-label="Rubric Scoring">
            <div className="raptors-card-header">
              <h2>
                {detail.rubric.name} v{detail.rubric.version}
              </h2>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background:
                    detail.evaluation?.status === 'SUBMITTED'
                      ? '#090909'
                      : '#eaeae4',
                  color:
                    detail.evaluation?.status === 'SUBMITTED'
                      ? '#ffffff'
                      : '#333333',
                }}
              >
                Status: {detail.evaluation?.status ?? 'NOT_STARTED'}
              </span>
            </div>

            {detail.evaluation?.status === 'SUBMITTED' && (
              <div className="raptors-immutable-banner">
                <span>
                  ✓ Evaluation submitted — read-only immutable snapshot.
                </span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save(false);
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  marginBottom: '20px',
                }}
              >
                {detail.rubric.criteria.map((criterion) => (
                  <div key={criterion.id} className="raptors-rubric-card">
                    <div className="raptors-rubric-header">
                      <span className="raptors-rubric-name">
                        {criterion.name}
                      </span>
                      <div className="raptors-rubric-meta">
                        <span className="raptors-rubric-tag">
                          Weight {criterion.weight}
                        </span>
                        <span className="raptors-rubric-tag">
                          Range {criterion.minScore}–{criterion.maxScore}
                        </span>
                      </div>
                    </div>
                    {criterion.description && (
                      <p
                        style={{
                          fontSize: '13px',
                          color: '#666666',
                          margin: '4px 0 10px',
                        }}
                      >
                        {criterion.description}
                      </p>
                    )}
                    <label style={{ marginTop: '8px' }}>
                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: '#444444',
                        }}
                      >
                        Score ({criterion.minScore}–{criterion.maxScore})
                      </span>
                      <input
                        type="number"
                        step="0.0001"
                        min={criterion.minScore}
                        max={criterion.maxScore}
                        value={scores[criterion.id] ?? ''}
                        disabled={detail.evaluation?.status === 'SUBMITTED'}
                        onChange={(e) =>
                          setScores((old) => ({
                            ...old,
                            [criterion.id]: e.target.value,
                          }))
                        }
                        style={{ maxWidth: '240px' }}
                      />
                    </label>
                  </div>
                ))}
              </div>

              <label style={{ marginBottom: '20px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  Evaluation Comments
                </span>
                <textarea
                  value={comments}
                  rows={4}
                  placeholder="Provide qualitative feedback and notes for the participant and organizers..."
                  disabled={detail.evaluation?.status === 'SUBMITTED'}
                  onChange={(e) => setComments(e.target.value)}
                />
              </label>

              {detail.evaluation?.status !== 'SUBMITTED' && (
                <div className="raptors-action-row">
                  <button
                    type="submit"
                    className="raptors-btn-secondary btn-secondary"
                  >
                    Save draft
                  </button>
                  <button
                    type="button"
                    className="raptors-btn-primary btn-primary"
                    onClick={() => void save(true)}
                  >
                    Submit evaluation
                  </button>
                </div>
              )}
            </form>
          </section>
        </>
      )}
    </main>
  );
}
