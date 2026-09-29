'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, message } from '../lib/client';
import type {
  PairwiseRun,
  PairwisePreview,
  PairwiseProgress,
  PairwiseRanking,
} from '../lib/pairwise';

export function PairwiseOrganizer({ eventId }: { eventId: string }) {
  const base = `/events/${eventId}/judging/pairwise`;
  const [runs, setRuns] = useState<PairwiseRun[] | null>(null);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<PairwisePreview | null>(null);
  const [progress, setProgress] = useState<PairwiseProgress | null>(null);
  const [rankings, setRankings] = useState<PairwiseRanking[]>([]);
  const [ranking, setRanking] = useState<PairwiseRanking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(
    async () => setRuns(await api<PairwiseRun[]>(`${base}/runs`)),
    [base],
  );
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, [refresh]);
  const run = runs?.find((r) => r.id === selected);
  const load = useCallback(
    async (id: string) => {
      const [p, r] = await Promise.all([
        api<PairwiseProgress>(`${base}/runs/${id}/progress`),
        api<PairwiseRanking[]>(`${base}/runs/${id}/rankings`),
      ]);
      setProgress(p);
      setRankings(r);
      setRanking(
        (old) => r.find((item) => item.id === old?.id) ?? r[0] ?? null,
      );
    },
    [base],
  );
  useEffect(() => {
    setPreview(null);
    setProgress(null);
    setRankings([]);
    setRanking(null);
    if (selected) void load(selected).catch((e) => setError(message(e)));
  }, [selected, load]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="pairwise-heading">
      <h2 id="pairwise-heading">Pairwise Mode</h2>
      <p>
        Judges compare two frozen submissions at a time. Create an independent
        global ranking from their submitted comparisons.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!runs && !error && <p role="status">Loading pairwise runs…</p>}
      {runs?.length === 0 && <p>No pairwise runs yet.</p>}
      <div className="pairwise-actions">
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const created = await api<PairwiseRun>(`${base}/runs`, {
                method: 'POST',
                body: {},
              });
              await refresh();
              setSelected(created.id);
              setNotice('Pairwise draft created.');
            })
          }
        >
          Create pairwise run
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await refresh();
              if (selected) await load(selected);
            })
          }
        >
          Refresh pairwise progress
        </button>
      </div>
      {!!runs?.length && (
        <>
          <label htmlFor="pairwise-run-select">Pairwise run</label>
          <select
            id="pairwise-run-select"
            aria-label="Pairwise run"
            value={selected}
            disabled={busy}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a run</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.status} · {new Date(r.createdAt).toLocaleString()} ·{' '}
                {r.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </>
      )}
      {run && (
        <>
          <p>
            Run status: <strong>{run.status}</strong>
          </p>
          {run.status === 'DRAFT' ? (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () =>
                    setPreview(
                      await api<PairwisePreview>(
                        `${base}/runs/${run.id}/assignments/preview`,
                        { method: 'POST', body: {} },
                      ),
                    ),
                  )
                }
              >
                Preview pairwise assignments
              </button>
              {preview && (
                <>
                  <p>
                    {preview.diagnostics.projectCount} projects ·{' '}
                    {preview.diagnostics.judgeCount} judges ·{' '}
                    {preview.pairs.length} proposed comparisons ·{' '}
                    {preview.diagnostics.componentCount} graph components
                  </p>
                  <p>
                    {preview.diagnostics.graphConnected
                      ? 'Assignment graph connected.'
                      : 'A connected assignment graph is not feasible. Review judge capacity and conflicts.'}
                  </p>
                  <p>
                    {preview.diagnostics.conflictsExcluded} conflict exclusions
                    · {preview.diagnostics.unassignablePairs.length}{' '}
                    unassignable pairs
                  </p>
                  <details>
                    <summary>Assignment preview and judge workload</summary>
                    <ul>
                      {preview.pairs.map((p, i) => (
                        <li key={i}>
                          {p.projectAId} vs {p.projectBId} · judge{' '}
                          {p.judgeProfileId}
                        </li>
                      ))}
                    </ul>
                    <ul>
                      {preview.diagnostics.perJudgeWorkload.map((j) => (
                        <li key={j.judgeProfileId}>
                          {j.judgeProfileId}: {j.proposed} proposed,{' '}
                          {j.existing} existing
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button
                    disabled={busy || !preview.diagnostics.graphConnected}
                    onClick={() =>
                      void act(async () => {
                        await api(`${base}/runs/${run.id}/publish`, {
                          method: 'POST',
                          body: { proposalHash: preview.proposalHash },
                        });
                        setPreview(null);
                        await refresh();
                        await load(run.id);
                        setNotice('Pairwise assignments published.');
                      })
                    }
                  >
                    Publish pairwise assignments
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {!progress && <p role="status">Loading progress…</p>}
              {progress && (
                <>
                  <p>
                    {progress.submitted} of {progress.totalAssignments}{' '}
                    comparisons completed · {progress.pending} pending
                  </p>
                  <progress
                    value={progress.submitted}
                    max={progress.totalAssignments || 1}
                    aria-label="Pairwise completion"
                  />
                  <p>
                    Submitted evidence: {progress.evidenceGraph.projectCount}{' '}
                    projects · {progress.evidenceGraph.componentCount}{' '}
                    components ·{' '}
                    {progress.evidenceGraph.graphConnected
                      ? 'connected graph'
                      : 'disconnected graph'}
                  </p>
                  {!progress.evidenceGraph.graphConnected && (
                    <div role="alert">
                      <p>
                        Global ranking unavailable because the comparison graph
                        is disconnected.
                      </p>
                      <p>
                        More comparisons are needed to connect every project.
                      </p>
                      <details>
                        <summary>Disconnected components (project IDs)</summary>
                        <ul>
                          {progress.evidenceGraph.components.map((c, i) => (
                            <li key={i}>
                              {c.join(', ')}
                              {c.length === 1 ? ' — isolated project' : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  )}
                  <details>
                    <summary>Judge completion</summary>
                    <ul>
                      {progress.perJudge.map((j) => (
                        <li key={j.judgeProfileId}>
                          {j.judgeProfileId}: {j.submitted} of {j.total}{' '}
                          completed
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
              <div className="pairwise-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await api<PairwiseRanking>(
                        `${base}/runs/${run.id}/rankings`,
                        { method: 'POST', body: {} },
                      );
                      await load(run.id);
                      setRanking(result);
                      setNotice(
                        'Ranking ready. Identical evidence reuses its existing ranking.',
                      );
                    })
                  }
                >
                  Run Bradley–Terry ranking
                </button>
                {run.status === 'PUBLISHED' && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        if (
                          !window.confirm(
                            'Close this run? Pending comparisons can no longer be submitted.',
                          )
                        )
                          return;
                        await api(`${base}/runs/${run.id}/close`, {
                          method: 'POST',
                          body: {},
                        });
                        await refresh();
                        await load(run.id);
                      })
                    }
                  >
                    Close pairwise run
                  </button>
                )}
              </div>
              {run.status === 'CLOSED' && (
                <p>
                  This run is closed. Its submitted evidence and historical
                  rankings remain available.
                </p>
              )}
              {!rankings.length && <p>No ranking snapshots yet.</p>}
              {!!rankings.length && (
                <>
                  <label htmlFor="historical-ranking-select">
                    Historical ranking
                  </label>
                  <select
                    id="historical-ranking-select"
                    aria-label="Historical ranking"
                    value={ranking?.id ?? ''}
                    disabled={busy}
                    onChange={(e) =>
                      void act(async () =>
                        setRanking(
                          await api<PairwiseRanking>(
                            `${base}/rankings/${e.target.value}`,
                          ),
                        ),
                      )
                    }
                  >
                    {rankings.map((r) => (
                      <option key={r.id} value={r.id}>
                        {new Date(r.createdAt).toLocaleString()} ·{' '}
                        {r.comparisonCount} comparisons ·{' '}
                        {r.stale ? 'STALE' : 'CURRENT'} · {r.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {ranking && (
                <article aria-label="Pairwise ranking results">
                  <h3>Global ranking</h3>
                  {ranking.stale && (
                    <p role="alert">
                      Stale ranking: new comparisons have been submitted. This
                      historical snapshot is unchanged. Run ranking again to
                      include the new evidence.
                    </p>
                  )}
                  <p>
                    {ranking.algorithm}_{ranking.algorithmVersion} · lambda ={' '}
                    {ranking.lambda} ·{' '}
                    {ranking.componentCount === 1
                      ? 'connected graph'
                      : `${ranking.componentCount} components`}
                  </p>
                  <p>
                    {ranking.comparisonCount} comparisons in snapshot ·{' '}
                    {ranking.currentComparisonCount} currently submitted ·{' '}
                    {ranking.projectCount} projects
                  </p>
                  <div className="pairwise-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Project</th>
                          <th>Canonical strength</th>
                          <th>Wins</th>
                          <th>Losses</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranking.results.map((r) => (
                          <tr key={r.projectId}>
                            <td>{r.rank}</td>
                            <td>{r.projectName}</td>
                            <td>{r.canonicalStrength}</td>
                            <td>{r.wins}</td>
                            <td>{r.losses}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p>Equal strengths at six decimals share a rank (1, 1, 3).</p>
                  {ranking.separationRisk && (
                    <p>
                      Separated evidence: ridge regularization keeps strengths
                      finite. Estimates are sensitive to regularization.
                    </p>
                  )}
                  <details>
                    <summary>Ranking diagnostics</summary>
                    <p>
                      Converged: {String(ranking.converged)} · iterations:{' '}
                      {ranking.iterations} · final delta: {ranking.finalDelta}
                    </p>
                    <p>
                      Strongly connected win graph:{' '}
                      {String(ranking.stronglyConnectedWinGraph)} · separation
                      risk: {String(ranking.separationRisk)} · regularization
                      sensitive: {String(ranking.regularizationSensitive)}
                    </p>
                    <p>Created: {ranking.createdAt}</p>
                    <p>
                      Input hash: <code>{ranking.inputSetHash}</code>
                    </p>
                    <p>
                      Ranking ID: <code>{ranking.id}</code>
                    </p>
                  </details>
                </article>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
