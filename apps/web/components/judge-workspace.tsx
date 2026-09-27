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
    <main>
      <h1>Judge workspace</h1>
      <p>
        <a href={`/events/${eventId}`}>Event page</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {workspace && (
        <>
          <p>
            {workspace.assigned} assigned · {workspace.completed} completed ·{' '}
            {workspace.draft} draft · {workspace.remaining} remaining
          </p>
          <ul>
            {workspace.assignments.map((a) => (
              <li key={a.assignmentId}>
                <a href={`/events/${eventId}/judge/${a.assignmentId}`}>
                  {a.projectName ?? a.title}
                </a>{' '}
                · {a.status}
              </li>
            ))}
          </ul>
          {workspace.assigned === 0 && <p>No published assignments yet.</p>}
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
    <main>
      <p>
        <a href={`/events/${eventId}/judge`}>Judge workspace</a>
      </p>
      <h1>Evaluate assignment</h1>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {detail && (
        <>
          <h2>{detail.submission.projectName ?? detail.submission.title}</h2>
          <p>
            Submission v{detail.submission.version}: {detail.submission.title}
          </p>
          {detail.submission.projectTagline && (
            <p>{detail.submission.projectTagline}</p>
          )}
          <p>{detail.submission.description}</p>
          {detail.submission.repositoryUrl && (
            <p>
              <a href={detail.submission.repositoryUrl}>Repository</a>
            </p>
          )}
          {detail.submission.demoUrl && (
            <p>
              <a href={detail.submission.demoUrl}>Demo</a>
            </p>
          )}
          <h2>
            {detail.rubric.name} v{detail.rubric.version}
          </h2>
          <p>Status: {detail.evaluation?.status ?? 'NOT_STARTED'}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            {detail.rubric.criteria.map((criterion) => (
              <label key={criterion.id}>
                {criterion.name} · weight {criterion.weight} ·{' '}
                {criterion.minScore}–{criterion.maxScore}
                {criterion.description && <span>{criterion.description}</span>}
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
                />
              </label>
            ))}
            <label>
              Comments{' '}
              <textarea
                value={comments}
                disabled={detail.evaluation?.status === 'SUBMITTED'}
                onChange={(e) => setComments(e.target.value)}
              />
            </label>
            {detail.evaluation?.status !== 'SUBMITTED' && (
              <>
                <button type="submit">Save draft</button>{' '}
                <button type="button" onClick={() => void save(true)}>
                  Submit evaluation
                </button>
              </>
            )}
          </form>
        </>
      )}
    </main>
  );
}
