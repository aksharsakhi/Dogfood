'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, message } from '../lib/client';
import type { PairwiseWorkspace, PairwiseMaterial } from '../lib/pairwise';

function ProjectCard({
  material,
  side,
  selected,
  disabled,
  choose,
}: {
  material: PairwiseMaterial;
  side: string;
  selected: boolean;
  disabled: boolean;
  choose: () => void;
}) {
  const s = material.submission;
  return (
    <article
      className={`pairwise-card${selected ? ' pairwise-selected' : ''}`}
      aria-label={`Project ${side}`}
    >
      <p className="eyebrow">Project {side}</p>
      <h3>{s.projectName ?? s.title}</h3>
      {s.projectTagline && <p>{s.projectTagline}</p>}
      <p>Immutable submission snapshot · version {s.version}</p>
      <h4>{s.title}</h4>
      <p>{s.description}</p>
      <nav>
        {s.repositoryUrl && (
          <a href={s.repositoryUrl} target="_blank" rel="noreferrer">
            Repository
          </a>
        )}
        {s.demoUrl && (
          <a href={s.demoUrl} target="_blank" rel="noreferrer">
            Demo
          </a>
        )}
      </nav>
      {!disabled && (
        <button aria-pressed={selected} onClick={choose}>
          Choose Project {side}
        </button>
      )}
      {disabled && selected && (
        <p>
          <strong>Selected winner</strong>
        </p>
      )}
    </article>
  );
}

export function PairwiseJudge({ eventId }: { eventId: string }) {
  const base = `/events/${eventId}/judging/pairwise`;
  const [workspace, setWorkspace] = useState<PairwiseWorkspace | null>(null);
  const [selected, setSelected] = useState('');
  const [winner, setWinner] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const data = await api<PairwiseWorkspace>(`${base}/workspace`);
    setWorkspace(data);
    setSelected((old) =>
      data.assignments.some((a) => a.assignmentId === old)
        ? old
        : ((
            data.assignments.find(
              (a) => !a.comparison && a.runStatus === 'PUBLISHED',
            ) ?? data.assignments[0]
          )?.assignmentId ?? ''),
    );
  }, [base]);
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, [load]);
  const assignment = workspace?.assignments.find(
    (a) => a.assignmentId === selected,
  );
  const closed = assignment?.runStatus === 'CLOSED';
  const submitted = !!assignment?.comparison;
  const chosen = assignment?.comparison?.winnerProjectId ?? winner;
  return (
    <main className="raptors-workspace-container">
      <div className="raptors-workspace-header">
        <span className="raptors-workspace-eyebrow">Peer Comparison Arena</span>
        <div className="raptors-workspace-title-row">
          <h1 className="raptors-workspace-title">Pairwise Mode</h1>
        </div>
        <p className="raptors-workspace-desc">
          Compare the two pinned submissions. Your final choice is immutable.
        </p>
      </div>

      <nav className="raptors-workspace-tabs" aria-label="Judge navigation">
        <a href={`/events/${eventId}`} className="raptors-tab-item">
          Event Overview
        </a>
        <a href={`/events/${eventId}/judge`} className="raptors-tab-item">
          My Assignments
        </a>
        <a
          href={`/events/${eventId}/judge/pairwise`}
          className="raptors-tab-item active"
        >
          Open Pairwise Mode
        </a>
        <a href={`/events/${eventId}/records`} className="raptors-tab-item">
          My Records
        </a>
      </nav>

      <p style={{ display: 'none' }}>
        <a href={`/events/${eventId}/judge`}>Judge workspace</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {!workspace && !error && <p role="status">Loading pairwise workspace…</p>}
      <button
        disabled={busy}
        onClick={() => {
          setError('');
          void load().catch((e) => setError(message(e)));
        }}
      >
        Refresh comparisons
      </button>
      {workspace && (
        <>
          <p>
            {workspace.assignments.filter((a) => a.comparison).length} of{' '}
            {workspace.assignments.length} comparisons completed
          </p>
          {!workspace.assignments.length && (
            <p>No published pairwise comparisons are assigned to you yet.</p>
          )}
          {!!workspace.assignments.length && (
            <>
              <label htmlFor="pairwise-comparison-select">Comparison</label>
              <select
                id="pairwise-comparison-select"
                aria-label="Comparison"
                disabled={busy}
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setWinner('');
                  setError('');
                }}
              >
                {workspace.assignments.map((a, i) => (
                  <option key={a.assignmentId} value={a.assignmentId}>
                    Comparison {i + 1} ·{' '}
                    {a.comparison
                      ? 'SUBMITTED'
                      : a.runStatus === 'CLOSED'
                        ? 'CLOSED'
                        : 'AVAILABLE'}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}
      {assignment && (
        <>
          <h2>Which project is stronger?</h2>
          <div className="pairwise-cards">
            <ProjectCard
              material={assignment.projectA}
              side="A"
              selected={chosen === assignment.projectA.projectId}
              disabled={busy || submitted || closed}
              choose={() => setWinner(assignment.projectA.projectId)}
            />
            <span className="pairwise-vs">VS</span>
            <ProjectCard
              material={assignment.projectB}
              side="B"
              selected={chosen === assignment.projectB.projectId}
              disabled={busy || submitted || closed}
              choose={() => setWinner(assignment.projectB.projectId)}
            />
          </div>
          {submitted ? (
            <p role="status">
              Comparison submitted — read-only. Submitted{' '}
              {new Date(assignment.comparison!.submittedAt).toLocaleString()}.
            </p>
          ) : closed ? (
            <p role="status">
              This run is closed. Pending comparisons can no longer be
              submitted.
            </p>
          ) : (
            <>
              <p>Choose a project, then confirm your final comparison.</p>
              <button
                disabled={busy || !winner}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api(
                      `${base}/assignments/${assignment.assignmentId}/submit`,
                      { method: 'POST', body: { winnerProjectId: winner } },
                    );
                    setWinner('');
                    await load();
                  } catch (e) {
                    setError(message(e));
                    await load().catch(() => undefined);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm and submit comparison
              </button>
              <p>
                If your eligibility or conflicts change, submission may be
                refused. Contact the organizer if that happens.
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
