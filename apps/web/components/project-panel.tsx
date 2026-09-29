'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, message, Project, Submission, Track } from '../lib/client';

export function ProjectPanel({
  eventId,
  teamId,
  timezone,
  submissionOpensAt,
  submissionClosesAt,
}: {
  eventId: string;
  teamId: string;
  timezone: string;
  submissionOpensAt: string | null;
  submissionClosesAt: string | null;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<Submission[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const selected = projects.find((p) => p.id === selectedId);
  const draft = history.find((s) => s.status === 'DRAFT');
  const latest = [...history]
    .reverse()
    .find((s) => s.status === 'SUBMITTED' || s.status === 'LOCKED');
  const canSubmit =
    (!submissionOpensAt || now >= Date.parse(submissionOpensAt)) &&
    (!submissionClosesAt || now < Date.parse(submissionClosesAt));
  const canEditProject =
    !submissionClosesAt || now < Date.parse(submissionClosesAt);
  const refresh = useCallback(async () => {
    try {
      const list = await api<Project[]>(`/events/${eventId}/projects/me`);
      setProjects(list.filter((p) => p.teamId === teamId));
      setSelectedId((current) =>
        list.some((p) => p.id === current && p.teamId === teamId)
          ? current
          : (list.find((p) => p.teamId === teamId)?.id ?? ''),
      );
    } catch (e) {
      setError(message(e));
    }
  }, [eventId, teamId]);
  useEffect(() => {
    void refresh();
    void api<Track[]>(`/events/${eventId}/tracks`).then(setTracks, () => {});
  }, [refresh, eventId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const refreshHistory = useCallback(async () => {
    if (!selectedId) {
      setHistory([]);
      return;
    }
    try {
      setHistory(
        await api<Submission[]>(
          `/events/${eventId}/projects/${selectedId}/submissions`,
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }, [eventId, selectedId]);
  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);
  async function createProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api(`/events/${eventId}/projects`, {
        method: 'POST',
        body: {
          teamId,
          name: String(form.get('name')),
          slug: String(form.get('slug')),
          ...(form.get('trackId')
            ? { trackId: String(form.get('trackId')) }
            : {}),
          tagline: String(form.get('tagline')) || undefined,
          description: String(form.get('description')) || undefined,
          repositoryUrl: String(form.get('repositoryUrl')) || undefined,
          demoUrl: String(form.get('demoUrl')) || undefined,
        },
      });
      setError('');
      setNotice('Project created.');
      await refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  async function editProject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = new FormData(e.currentTarget);
    try {
      await api(`/events/${eventId}/projects/${selected.id}`, {
        method: 'PATCH',
        body: {
          name: String(form.get('name')),
          tagline: String(form.get('tagline')),
          description: String(form.get('description')),
          trackId: form.get('trackId') ? String(form.get('trackId')) : null,
          repositoryUrl: String(form.get('repositoryUrl')) || null,
          demoUrl: String(form.get('demoUrl')) || null,
        },
      });
      setError('');
      setNotice('Project updated.');
      await refresh();
    } catch (err) {
      setError(message(err));
    }
  }
  async function createDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const form = new FormData(e.currentTarget);
    try {
      await api(`/events/${eventId}/projects/${selected.id}/submissions`, {
        method: 'POST',
        body: {
          title: String(form.get('title')),
          description: String(form.get('description')),
          repositoryUrl: String(form.get('repositoryUrl')) || null,
          demoUrl: String(form.get('demoUrl')) || null,
        },
      });
      setError('');
      setNotice('Draft created.');
      await refreshHistory();
    } catch (err) {
      setError(message(err));
    }
  }
  async function editDraft(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || !draft) return;
    const form = new FormData(e.currentTarget);
    try {
      await api(
        `/events/${eventId}/projects/${selected.id}/submissions/${draft.id}`,
        {
          method: 'PATCH',
          body: {
            title: String(form.get('title')),
            description: String(form.get('description')),
            repositoryUrl: String(form.get('repositoryUrl')) || null,
            demoUrl: String(form.get('demoUrl')) || null,
          },
        },
      );
      setError('');
      setNotice('Draft saved.');
      await refreshHistory();
    } catch (err) {
      setError(message(err));
    }
  }
  async function submit() {
    if (!selected || !draft) return;
    if (
      !window.confirm(
        `You are about to submit version ${draft.version}. Submitted versions cannot be edited.`,
      )
    )
      return;
    try {
      await api(
        `/events/${eventId}/projects/${selected.id}/submissions/${draft.id}/submit`,
        { method: 'POST' },
      );
      setError('');
      setNotice(`Version ${draft.version} submitted.`);
      await refresh();
      await refreshHistory();
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <section className="raptors-card-panel">
      <h2>Projects and submissions</h2>
      <div className="raptors-lifecycle-stepper" aria-label="Builder lifecycle">
        <span className="raptors-step done">✓ 1. Registered</span>
        <span className={`raptors-step ${teamId ? 'done' : 'active'}`}>
          {teamId ? '✓ ' : ''}2. Team Formed
        </span>
        <span
          className={`raptors-step ${selected ? 'done' : teamId ? 'active' : ''}`}
        >
          {selected ? '✓ ' : ''}3. Project Created
        </span>
        <span
          className={`raptors-step ${latest ? 'done' : draft ? 'active' : ''}`}
        >
          {latest ? '✓ ' : draft ? '● ' : ''}4. Draft Saved
        </span>
        <span className={`raptors-step ${latest ? 'done' : ''}`}>
          {latest ? '✓ 5. Submitted' : '5. Final Submission'}
        </span>
      </div>
      <p>
        Submission deadline:{' '}
        {submissionClosesAt
          ? new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: timezone,
            }).format(new Date(submissionClosesAt))
          : 'No deadline configured'}
        .
      </p>
      <p>
        {canSubmit
          ? 'Submission editing is currently available.'
          : 'Submission editing is currently closed.'}
      </p>
      <form onSubmit={createProject}>
        <h3>Create project</h3>
        <label>
          Name <input name="name" required />
        </label>
        <label>
          Slug <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
        </label>
        <label>
          Track{' '}
          <select name="trackId">
            <option value="">No track</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tagline <input name="tagline" maxLength={240} />
        </label>
        <label>
          Description <textarea name="description" maxLength={10000} />
        </label>
        <label>
          Repository URL <input name="repositoryUrl" type="url" />
        </label>
        <label>
          Demo URL <input name="demoUrl" type="url" />
        </label>
        <button disabled={!canEditProject}>Create project</button>
      </form>
      {projects.length > 0 && (
        <>
          <label>
            Current project{' '}
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <form key={selected.id} onSubmit={editProject}>
                <h3>Edit project</h3>
                <label>
                  Name{' '}
                  <input name="name" defaultValue={selected.name} required />
                </label>
                <label>
                  Tagline{' '}
                  <input name="tagline" defaultValue={selected.tagline ?? ''} />
                </label>
                <label>
                  Description{' '}
                  <textarea
                    name="description"
                    defaultValue={selected.description ?? ''}
                  />
                </label>
                <label>
                  Track{' '}
                  <select name="trackId" defaultValue={selected.trackId ?? ''}>
                    <option value="">No track</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Repository URL{' '}
                  <input
                    name="repositoryUrl"
                    type="url"
                    defaultValue={selected.repositoryUrl ?? ''}
                  />
                </label>
                <label>
                  Demo URL{' '}
                  <input
                    name="demoUrl"
                    type="url"
                    defaultValue={selected.demoUrl ?? ''}
                  />
                </label>
                <button disabled={!canEditProject}>Save project</button>
              </form>
              <h3>Submission versions</h3>
              <p>
                Latest submitted:{' '}
                {latest ? `v${latest.version} — ${latest.title}` : 'None'}
              </p>
              <ul className="raptors-version-list">
                {history.map((s) => (
                  <li key={s.id} className="raptors-version-item">
                    <span>
                      v{s.version} — {s.status} — {s.title}
                    </span>
                    <span
                      className={`raptors-version-tag ${s.status === 'DRAFT' ? 'raptors-version-tag-draft' : ''}`}
                    >
                      {s.status === 'SUBMITTED'
                        ? 'Immutable Snapshot'
                        : s.status}
                    </span>
                  </li>
                ))}
              </ul>
              {draft ? (
                <>
                  <form key={draft.id} onSubmit={editDraft}>
                    <h4>Edit draft v{draft.version}</h4>
                    <label>
                      Title{' '}
                      <input name="title" defaultValue={draft.title} required />
                    </label>
                    <label>
                      Description{' '}
                      <textarea
                        name="description"
                        defaultValue={draft.description}
                        required
                      />
                    </label>
                    <label>
                      Repository URL{' '}
                      <input
                        name="repositoryUrl"
                        type="url"
                        defaultValue={draft.repositoryUrl ?? ''}
                      />
                    </label>
                    <label>
                      Demo URL{' '}
                      <input
                        name="demoUrl"
                        type="url"
                        defaultValue={draft.demoUrl ?? ''}
                      />
                    </label>
                    <button disabled={!canSubmit}>Save draft</button>
                  </form>
                  <button disabled={!canSubmit} onClick={() => void submit()}>
                    Submit v{draft.version}
                  </button>
                </>
              ) : (
                <form onSubmit={createDraft}>
                  <h4>
                    {latest ? 'Create next version' : 'Create first draft'}
                  </h4>
                  <label>
                    Title{' '}
                    <input name="title" defaultValue={selected.name} required />
                  </label>
                  <label>
                    Description{' '}
                    <textarea
                      name="description"
                      defaultValue={selected.description ?? ''}
                      required
                    />
                  </label>
                  <label>
                    Repository URL <input name="repositoryUrl" type="url" />
                  </label>
                  <label>
                    Demo URL <input name="demoUrl" type="url" />
                  </label>
                  <button disabled={!canSubmit}>Create draft</button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
