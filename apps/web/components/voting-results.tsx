'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Event } from '../lib/client';
import {
  type CommunityResults,
  VotingUiError,
  votingErrorMessage,
  votingRequest,
} from '../lib/voting';

export function VotingResults({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<Event | null>(null);
  const [results, setResults] = useState<CommunityResults | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (currentEvent: Event | null) => {
      setLoading(true);
      setError('');
      setResults(null);
      try {
        const data = await votingRequest<CommunityResults>(
          `/events/${eventId}/voting/results`,
        );
        setHidden(false);
        setResults(data);
      } catch (cause) {
        setHidden(
          cause instanceof VotingUiError && cause.code === 'RESULTS_HIDDEN',
        );
        setError(votingErrorMessage(cause, currentEvent ?? undefined));
      } finally {
        setLoading(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    void api<Event>(`/events/${eventId}`).then(
      (value) => {
        setEvent(value);
        void refresh(value);
      },
      (cause) => {
        setError(votingErrorMessage(cause));
        setLoading(false);
      },
    );
  }, [eventId, refresh]);

  return (
    <main className="raptors-workspace-container">
      <p className="eyebrow">Community choice</p>
      <h1>Community results</h1>
      <p>
        <a href={`/events/${eventId}`}>Event details</a> ·{' '}
        <a href={`/events/${eventId}/vote`}>Voting ballot</a>
      </p>
      {event && <p>{event.name}</p>}
      <button type="button" onClick={() => void refresh(event)}>
        Refresh results
      </button>
      {loading && <p role="status">Checking result visibility…</p>}
      {hidden && !loading && (
        <section
          aria-label="Results not yet visible"
          className="raptors-card-panel"
        >
          <h2>Results are not yet public</h2>
          <p>{error}</p>
        </section>
      )}
      {!hidden && error && <p role="alert">{error}</p>}
      {results && (
        <section
          aria-labelledby="result-list-heading"
          className="raptors-card-panel"
        >
          <h2 id="result-list-heading">Vote tallies</h2>
          {results.items.length ? (
            <ul className="voting-tally-list">
              {results.items.map((item) => (
                <li key={item.projectId}>
                  <span>{item.title}</span>
                  <strong>{item.votes} votes</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>No eligible submitted projects have results.</p>
          )}
        </section>
      )}
    </main>
  );
}
