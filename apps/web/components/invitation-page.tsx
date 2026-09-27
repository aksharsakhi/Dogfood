'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { api, message } from '../lib/client';

interface InvitationPreview {
  team: { id: string; name: string };
  event: { id: string; name: string; slug: string; status: string };
  expiresAt: string;
}

export function InvitationPage({ token }: { token: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) return;
    void api<InvitationPreview>(
      `/team-invitations/${encodeURIComponent(token)}`,
    )
      .then(setPreview)
      .catch((e) => {
        if (!message(e).startsWith('UNAUTHENTICATED:')) setError(message(e));
      });
  }, [token, user]);
  async function respond(action: 'accept' | 'reject') {
    setBusy(true);
    setError('');
    try {
      await api(`/team-invitations/${action}`, {
        method: 'POST',
        body: { token },
      });
      if (action === 'accept' && preview)
        router.push(`/events/${preview.event.id}`);
      else setError('Invitation declined.');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const returnTo = `/invitations/${encodeURIComponent(token)}`;
  return (
    <main>
      <h1>Team invitation</h1>
      {!user ? (
        <>
          <p>Log in or create the invited account to review this invitation.</p>
          <p>
            <a href={`/login?next=${encodeURIComponent(returnTo)}`}>Log in</a> ·{' '}
            <a href={`/register?next=${encodeURIComponent(returnTo)}`}>
              Create account
            </a>
          </p>
        </>
      ) : preview ? (
        <>
          <p>
            You are invited to join <strong>{preview.team.name}</strong> for{' '}
            <strong>{preview.event.name}</strong>.
          </p>
          <p>
            Invitation expires {new Date(preview.expiresAt).toLocaleString()}.
          </p>
          <p>
            <a href={`/events/${preview.event.id}`}>
              Open event to register as a participant
            </a>
            . Registration is required before accepting.
          </p>
          <button disabled={busy} onClick={() => void respond('accept')}>
            Accept invitation
          </button>{' '}
          <button disabled={busy} onClick={() => void respond('reject')}>
            Reject invitation
          </button>
        </>
      ) : (
        !error && <p>Loading invitation…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
