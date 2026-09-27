'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, GalleryProject, message, Track } from '../lib/client';
import { ProjectComments } from './project-comments';

interface GalleryResponse {
  items: GalleryProject[];
  total: number;
  page: number;
  pageSize: number;
}
export function Gallery({ eventId }: { eventId: string }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [trackId, setTrackId] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<GalleryResponse | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setData(null);
    const params = new URLSearchParams({ page: String(page), pageSize: '12' });
    if (query) params.set('search', query);
    if (trackId) params.set('trackId', trackId);
    void api<GalleryResponse>(`/events/${eventId}/gallery?${params}`).then(
      (result) => {
        setData(result);
        setError('');
      },
      (err) => {
        setData(null);
        setError(message(err));
      },
    );
  }, [eventId, query, trackId, page]);
  useEffect(load, [load]);
  useEffect(() => {
    void api<Track[]>(`/events/${eventId}/tracks`).then(setTracks, () => {});
  }, [eventId]);
  function searchSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPage(1);
    setQuery(search);
  }
  return (
    <main>
      <h1>Project gallery</h1>
      <p>
        <a href={`/events/${eventId}`}>Back to event</a>
        {' · '}
        <a href={`/events/${eventId}/vote`}>Community ballot</a>
        {' · '}
        <a href={`/events/${eventId}/voting/results`}>Community results</a>
      </p>
      <form onSubmit={searchSubmit}>
        <label>
          Search{' '}
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          Track{' '}
          <select
            value={trackId}
            onChange={(e) => {
              setPage(1);
              setTrackId(e.target.value);
            }}
          >
            <option value="">All tracks</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button>Search gallery</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading gallery…</p>}
      {data && (
        <>
          <p>{data.total} submitted projects</p>
          <ul>
            {data.items.map((project) => (
              <li key={project.id}>
                <a href={`/events/${eventId}/gallery/${project.id}`}>
                  {project.projectName}
                </a>{' '}
                — v{project.version} · {project.teamName}
                {project.trackName ? ` · ${project.trackName}` : ''}
                {project.tagline ? <p>{project.tagline}</p> : null}
              </li>
            ))}
          </ul>
          {page > 1 && (
            <button onClick={() => setPage(page - 1)}>Previous</button>
          )}
          {page * data.pageSize < data.total && (
            <button onClick={() => setPage(page + 1)}>Next</button>
          )}
        </>
      )}
    </main>
  );
}

export function GalleryDetail({
  eventId,
  projectId,
}: {
  eventId: string;
  projectId: string;
}) {
  const [project, setProject] = useState<GalleryProject | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<GalleryProject>(`/events/${eventId}/gallery/${projectId}`).then(
      setProject,
      (err) => setError(message(err)),
    );
  }, [eventId, projectId]);
  return (
    <main>
      <p>
        <a href={`/events/${eventId}/gallery`}>Back to gallery</a>
      </p>
      {error && <p role="alert">{error}</p>}
      {project ? (
        <>
          <h1>{project.projectName}</h1>
          {project.tagline && <p className="eyebrow">{project.tagline}</p>}
          <p>Submitted as: {project.title}</p>
          <p>
            Submitted version {project.version} · {project.teamName}
            {project.trackName ? ` · ${project.trackName}` : ''}
          </p>
          <p>{project.description}</p>
          {project.repositoryUrl && (
            <p>
              <a href={project.repositoryUrl}>Repository</a>
            </p>
          )}
          {project.demoUrl && (
            <p>
              <a href={project.demoUrl}>Demo</a>
            </p>
          )}
          <ProjectComments eventId={eventId} projectId={projectId} />
        </>
      ) : (
        !error && <p>Loading project…</p>
      )}
    </main>
  );
}
