'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, Event, message, Team, TeamInvitation, User } from '../lib/client';
import { ProjectPanel } from './project-panel';
export function TeamPanel({
  eventId,
  user,
  submissionOpensAt,
  submissionClosesAt,
  timezone,
}: {
  eventId: string;
  user: User;
  submissionOpensAt: string | null;
  submissionClosesAt: string | null;
  timezone: string;
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [newToken, setNewToken] = useState('');
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [maxTeamSize, setMaxTeamSize] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(() => {
    void api<Team | null>(`/events/${eventId}/teams/me`).then(setTeam, (e) =>
      setError(message(e)),
    );
  }, [eventId]);
  useEffect(refresh, [refresh]);
  useEffect(() => {
    void api<Event>(`/events/${eventId}`).then(
      (event) => setMaxTeamSize(event.maxTeamSize),
      () => {},
    );
  }, [eventId]);
  useEffect(() => {
    if (
      !team ||
      !team.members.some(
        (member) => member.userId === user.id && member.role === 'OWNER',
      )
    ) {
      setInvitations([]);
      return;
    }
    void api<TeamInvitation[]>(
      `/events/${eventId}/teams/${team.id}/invitations`,
    ).then(setInvitations, (e) => setError(message(e)));
  }, [eventId, team, user.id]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/events/${eventId}/teams`, {
        method: 'POST',
        body: { name: String(f.get('name')), slug: String(f.get('slug')) },
      });
      refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const result = await api<{ token: string }>(
        `/events/${eventId}/teams/${team?.id}/invitations`,
        { method: 'POST', body: { email: String(f.get('email')) } },
      );
      setNewToken(result.token);
      setCopied(false);
      refresh();
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function copyInviteLink() {
    if (!newToken) return;
    const link = `${window.location.origin}/invitations/${newToken}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError(
        'Copy is unavailable here. Select and copy the invitation link shown below.',
      );
    }
  }
  async function revoke(invitationId: string) {
    if (!team) return;
    try {
      await api<void>(
        `/events/${eventId}/teams/${team.id}/invitations/${invitationId}/revoke`,
        { method: 'POST' },
      );
      setError('');
      setInvitations(
        await api<TeamInvitation[]>(
          `/events/${eventId}/teams/${team.id}/invitations`,
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  async function accept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api('/team-invitations/accept', {
        method: 'POST',
        body: { token },
      });
      setToken('');
      setError('');
      refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  async function leave() {
    if (!team) return;
    try {
      await api(`/events/${eventId}/teams/${team.id}/leave`, {
        method: 'POST',
      });
      refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!team) return;
    try {
      await api(`/events/${eventId}/teams/${team.id}`, {
        method: 'PATCH',
        body: { name: String(new FormData(e.currentTarget).get('name')) },
      });
      setError('');
      refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  async function remove(userId: string) {
    if (!team) return;
    try {
      await api<void>(
        `/events/${eventId}/teams/${team.id}/members/${userId}/remove`,
        { method: 'POST' },
      );
      setError('');
      refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  const isOwner =
    team?.members.some((m) => m.userId === user.id && m.role === 'OWNER') ??
    false;
  return (
    <section className="raptors-card-panel">
      <h2>Your team</h2>
      {team ? (
        <>
          <p>
            <strong>{team.name}</strong> · {team.status} · {team.members.length}
            /{maxTeamSize ?? '…'} members
          </p>
          <ul>
            {team.members.map((m) => (
              <li key={m.id}>
                {m.user.displayName}
                {m.role === 'OWNER' ? ' · Owner' : ''}
                {isOwner && m.userId !== user.id && (
                  <button onClick={() => void remove(m.userId)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
          <button onClick={() => void leave()}>Leave team</button>
          {isOwner && (
            <>
              <form onSubmit={rename}>
                <h3>Rename team</h3>
                <label>
                  Name
                  <input name="name" defaultValue={team.name} required />
                </label>
                <button>Rename</button>
              </form>
              <form onSubmit={invite}>
                <h3>Invite a member</h3>
                <label>
                  Email
                  <input type="email" name="email" required />
                </label>
                <button>Generate invitation</button>
              </form>
            </>
          )}
          {newToken && (
            <div>
              <p>
                Share this invitation link privately. The token is shown once
                and is not saved in the browser.
              </p>
              <label>
                Invitation link
                <input
                  readOnly
                  value={`${typeof window === 'undefined' ? '' : window.location.origin}/invitations/${newToken}`}
                />
              </label>
              <button type="button" onClick={() => void copyInviteLink()}>
                {copied ? 'Copied' : 'Copy invite link'}
              </button>
            </div>
          )}
          {isOwner && (
            <section>
              <h3>Invitation history</h3>
              {invitations.length ? (
                <ul>
                  {invitations.map((invitation) => (
                    <li key={invitation.id}>
                      {invitation.email ?? 'Registered user'} ·{' '}
                      {invitation.status} · expires{' '}
                      {new Date(invitation.expiresAt).toLocaleString()}
                      {invitation.status === 'PENDING' && (
                        <button
                          type="button"
                          onClick={() => void revoke(invitation.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No invitations yet.</p>
              )}
            </section>
          )}
          <ProjectPanel
            eventId={eventId}
            teamId={team.id}
            submissionOpensAt={submissionOpensAt}
            submissionClosesAt={submissionClosesAt}
            timezone={timezone}
          />
        </>
      ) : (
        <>
          <form onSubmit={create}>
            <h3>Create a team</h3>
            <label>
              Name
              <input name="name" required />
            </label>
            <label>
              Slug
              <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
            </label>
            <button>Create team</button>
          </form>
          <form onSubmit={accept}>
            <h3>Join with an invitation</h3>
            <label>
              Invitation token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </label>
            <button>Join team</button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
