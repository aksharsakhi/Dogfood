'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, type Event } from '../lib/client';
import {
  type BallotResponse,
  VotingUiError,
  votingErrorMessage,
  votingRequest,
  votingTime,
} from '../lib/voting';

export function VotingBallot({ eventId }: { eventId: string }) {
  const { user, loading: authLoading } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [ballot, setBallot] = useState<BallotResponse | null>(null);
  const [email, setEmail] = useState('');
  const [activeEmail, setActiveEmail] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [casting, setCasting] = useState(false);

  useEffect(() => {
    void api<Event>(`/events/${eventId}`).then(setEvent, (cause) =>
      setError(votingErrorMessage(cause)),
    );
  }, [eventId]);

  const loadBallot = useCallback(
    async (address?: string) => {
      setLoading(true);
      setError('');
      try {
        const next = await votingRequest<BallotResponse>(
          `/events/${eventId}/voting/ballot`,
          {
            method: 'POST',
            body: address ? { email: address } : {},
          },
        );
        setBallot(next);
        if (address) setActiveEmail(address);
      } catch (cause) {
        setError(votingErrorMessage(cause, event ?? undefined));
      } finally {
        setLoading(false);
      }
    },
    [eventId, event],
  );

  useEffect(() => {
    if (!event || authLoading) return;
    if (event.votingAccessMode === 'OPEN') void loadBallot();
    if (event.votingAccessMode === 'AUTHENTICATED' && user) void loadBallot();
  }, [event, authLoading, user, loadBallot]);

  async function choose(projectId: string, title: string) {
    setCasting(true);
    setError('');
    try {
      await votingRequest(`/events/${eventId}/voting/votes`, {
        method: 'POST',
        body: {
          projectId,
          ...(event?.votingAccessMode === 'EMAIL_GATED'
            ? { email: activeEmail }
            : {}),
        },
      });
      setConfirmation(title);
      setBallot((current) =>
        current ? { ...current, alreadyVoted: true } : current,
      );
    } catch (cause) {
      if (cause instanceof VotingUiError && cause.code === 'ALREADY_VOTED')
        setBallot((current) =>
          current ? { ...current, alreadyVoted: true } : current,
        );
      setError(votingErrorMessage(cause, event ?? undefined));
    } finally {
      setCasting(false);
    }
  }

  function submitEmail(form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    setConfirmation('');
    void loadBallot(email.trim());
  }

  return (
    <main className="raptors-workspace-container">
      <p className="eyebrow">Community choice</p>
      <h1>Cast your vote</h1>
      <p>
        <a href={`/events/${eventId}`}>Event details</a> ·{' '}
        <a href={`/events/${eventId}/gallery`}>Project gallery</a> ·{' '}
        <a href={`/events/${eventId}/voting/results`}>Community results</a>
      </p>
      {event && (
        <>
          <p>
            {event.name} · Voting opens {votingTime(event.votingOpensAt)} and
            closes {votingTime(event.votingClosesAt)}.
          </p>
          {event.votingAccessMode === 'OPEN' && (
            <section className="voting-note">
              <h2>Browser-based ballot</h2>
              <p>
                No login is needed. This browser receives a voting token. It
                identifies a browser, not a person; clearing cookies or using
                another browser can obtain another vote.
              </p>
              {ballot && (
                <p role="status">
                  Browser voting identity ready on this device.
                </p>
              )}
            </section>
          )}
          {event.votingAccessMode === 'EMAIL_GATED' && (
            <section className="voting-note">
              <h2>Email-string ballot</h2>
              <p>
                One vote is allowed per normalized email string. No email is
                sent, and this does not prove control of the inbox.
              </p>
              <form onSubmit={submitEmail}>
                <label>
                  Email address
                  <input
                    type="email"
                    value={email}
                    onChange={(input) => setEmail(input.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={loading}>
                  Open email-string ballot
                </button>
              </form>
            </section>
          )}
          {event.votingAccessMode === 'AUTHENTICATED' && (
            <section className="voting-note">
              <h2>Account ballot</h2>
              <p>
                Your existing account is your voting identity. You cannot vote
                for a project submitted by your own team.
              </p>
              {!authLoading && !user && (
                <p>
                  <a href="/login">Log in</a> to open this ballot.
                </p>
              )}
            </section>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading your ballot…</p>}
      {confirmation && (
        <section aria-label="Vote confirmation" className="voting-confirmation">
          <h2>Vote recorded</h2>
          <p>Your vote for {confirmation} was recorded. Thank you.</p>
        </section>
      )}
      {ballot?.alreadyVoted && !confirmation && (
        <section aria-label="Already voted" className="voting-confirmation">
          <h2>Already voted</h2>
          <p>
            This voting identity has already cast its one vote for this event.
          </p>
        </section>
      )}
      {ballot && !ballot.alreadyVoted && (
        <section aria-labelledby="ballot-heading">
          <h2 id="ballot-heading">Projects on your ballot</h2>
          <p>
            Projects appear in the stable order provided for your voting
            identity. Choose one.
          </p>
          {ballot.items.length ? (
            <ol className="voting-ballot-list">
              {ballot.items.map((project) => (
                <li key={project.id}>
                  <h3>{project.title}</h3>
                  <p>{project.description}</p>
                  <p>
                    <a href={`/events/${eventId}/gallery/${project.id}`}>
                      View project and comments
                    </a>
                  </p>
                  <button
                    type="button"
                    disabled={casting}
                    onClick={() => void choose(project.id, project.title)}
                  >
                    Vote for {project.title}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>No eligible submitted projects are on this ballot yet.</p>
          )}
        </section>
      )}
    </main>
  );
}
