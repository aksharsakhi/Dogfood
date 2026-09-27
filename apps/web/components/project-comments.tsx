'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, type Event } from '../lib/client';
import {
  type CommentPage,
  type VisibleComment,
  votingErrorMessage,
  votingRequest,
  votingTime,
} from '../lib/voting';

export function ProjectComments({
  eventId,
  projectId,
}: {
  eventId: string;
  projectId: string;
}) {
  const { user, loading: authLoading } = useAuth();
  const [event, setEvent] = useState<Event | null>(null);
  const [organizer, setOrganizer] = useState(false);
  const [items, setItems] = useState<VisibleComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hiddenId, setHiddenId] = useState<string | null>(null);
  const base = `/events/${eventId}/voting/projects/${projectId}/comments`;

  const loadPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ pageSize: '20' });
        if (cursor) params.set('cursor', cursor);
        const page = await votingRequest<CommentPage>(`${base}?${params}`);
        setItems((old) => (cursor ? [...old, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
        setError('');
      } catch (cause) {
        setError(votingErrorMessage(cause));
      } finally {
        setLoading(false);
      }
    },
    [base],
  );

  useEffect(() => {
    void api<Event>(`/events/${eventId}`).then(setEvent, () => {});
    void loadPage();
  }, [eventId, loadPage]);

  useEffect(() => {
    if (!user) {
      setOrganizer(false);
      return;
    }
    void api<Array<{ role: string; status: string }>>(
      `/events/${eventId}/memberships/me`,
    ).then(
      (memberships) =>
        setOrganizer(
          memberships.some(
            (item) => item.role === 'ORGANIZER' && item.status === 'ACTIVE',
          ),
        ),
      () => setOrganizer(false),
    );
  }, [eventId, user]);

  async function postComment(form: FormEvent<HTMLFormElement>) {
    form.preventDefault();
    setPosting(true);
    setError('');
    setNotice('');
    try {
      await votingRequest<VisibleComment>(base, {
        method: 'POST',
        body: {
          body,
          ...(event?.votingAccessMode === 'EMAIL_GATED' ? { email } : {}),
        },
      });
      setBody('');
      setNotice('Comment posted.');
      await loadPage();
    } catch (cause) {
      setError(votingErrorMessage(cause, event ?? undefined));
    } finally {
      setPosting(false);
    }
  }

  async function hide(commentId: string) {
    setError('');
    try {
      await votingRequest(`${base}/${commentId}/hide`, { method: 'PATCH' });
      setHiddenId(commentId);
      setItems((old) => old.filter((item) => item.id !== commentId));
      setNotice('Comment hidden.');
      await loadPage();
    } catch (cause) {
      setError(votingErrorMessage(cause));
    }
  }

  return (
    <section aria-labelledby="project-comments-heading">
      <h2 id="project-comments-heading">Project comments</h2>
      <p>Visible community discussion for this submitted project.</p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {hiddenId && <p>Hidden comment removed from the public discussion.</p>}
      {items.length ? (
        <ul className="voting-comment-list">
          {items.map((item) => (
            <li key={item.id}>
              <p>{item.body}</p>
              <small>{votingTime(item.createdAt)}</small>
              {organizer && (
                <button
                  type="button"
                  onClick={() => void hide(item.id)}
                  aria-label={`Hide comment posted ${votingTime(item.createdAt)}`}
                >
                  Hide comment
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !loading && <p>No visible comments yet.</p>
      )}
      {loading && <p role="status">Loading comments…</p>}
      {nextCursor && (
        <button
          type="button"
          onClick={() => void loadPage(nextCursor)}
          disabled={loading}
        >
          Load more comments
        </button>
      )}
      {event && (
        <form onSubmit={(form) => void postComment(form)}>
          <h3>Join the discussion</h3>
          {event.votingAccessMode === 'OPEN' && (
            <p>
              Your browser token is used for this comment; it does not identify
              a person.
            </p>
          )}
          {event.votingAccessMode === 'EMAIL_GATED' && (
            <>
              <p>No email is sent and inbox ownership is not checked.</p>
              <label>
                Email address
                <input
                  type="email"
                  value={email}
                  onChange={(input) => setEmail(input.target.value)}
                  required
                />
              </label>
            </>
          )}
          {event.votingAccessMode === 'AUTHENTICATED' &&
            !authLoading &&
            !user && (
              <p>
                <a href="/login">Log in</a> to comment with your account.
              </p>
            )}
          <label>
            Comment
            <textarea
              value={body}
              onChange={(input) => setBody(input.target.value)}
              minLength={1}
              maxLength={2000}
              required
            />
          </label>
          <button
            type="submit"
            disabled={
              posting || (event.votingAccessMode === 'AUTHENTICATED' && !user)
            }
          >
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      )}
    </section>
  );
}
