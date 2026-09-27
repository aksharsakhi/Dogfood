'use client';
import { useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, message } from '../lib/client';
export function JudgeInvitation({ token }: { token: string }) {
  const { user } = useAuth();
  const [eventId, setEventId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ eventId: string }>(
        '/judge-invitations/accept',
        {
          method: 'POST',
          body: { token },
        },
      );
      setEventId(result.eventId);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const returnTo = `/judge-invitations/${encodeURIComponent(token)}`;
  return (
    <main>
      <h1>Judge invitation</h1>
      {!user ? (
        <p>
          <a href={`/login?next=${encodeURIComponent(returnTo)}`}>Log in</a> or{' '}
          <a href={`/register?next=${encodeURIComponent(returnTo)}`}>
            create the invited account
          </a>{' '}
          to accept.
        </p>
      ) : eventId ? (
        <p>
          Invitation accepted.{' '}
          <a href={`/events/${eventId}/judge`}>Open judge workspace</a>
        </p>
      ) : (
        <button disabled={busy} onClick={() => void accept()}>
          Accept judge invitation
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
