'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, GalleryProject, message, Track } from '../lib/client';
import { ProceduralScene } from './procedural-scene';
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
    <div className="raptors-gallery-page">
      {/* ── BREADCRUMB / NAV ── */}
      <div className="raptors-gallery-subnav">
        <a href={`/events/${eventId}`} className="raptors-back-link">
          ← Back to event
        </a>
        <div className="raptors-gallery-ballot-links">
          <a href={`/events/${eventId}/vote`} className="raptors-text-link">
            Community ballot
          </a>
          <span className="raptors-link-divider">·</span>
          <a
            href={`/events/${eventId}/voting/results`}
            className="raptors-text-link"
          >
            Community results
          </a>
        </div>
      </div>

      {/* ── HEADER ── */}
      <div className="raptors-gallery-header">
        <span className="raptors-section-eyebrow">Project Showcase</span>
        <h1 className="raptors-gallery-title">Project gallery</h1>
        <p className="raptors-gallery-subtitle">
          Explore architectural designs, code repositories, and project demos
          submitted by competing builder teams.
        </p>
      </div>

      {/* ── SEARCH & FILTER BAR ── */}
      <form onSubmit={searchSubmit} className="raptors-gallery-search-bar">
        <div className="raptors-search-field">
          <label htmlFor="gallery-search-input" className="sr-only">
            Search projects
          </label>
          <input
            id="gallery-search-input"
            aria-label="Search"
            value={search}
            placeholder="Search projects by name or keyword…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="raptors-filter-field">
          <label htmlFor="gallery-track-select" className="sr-only">
            Filter by track
          </label>
          <select
            id="gallery-track-select"
            aria-label="Track"
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
        </div>

        <button
          type="submit"
          className="raptors-btn-primary btn-primary raptors-gallery-search-btn"
        >
          Search Gallery
        </button>
      </form>

      {error && (
        <p role="alert" className="raptors-alert-box">
          {error}
        </p>
      )}

      {!data && !error && (
        <div className="raptors-empty-state">
          <p>Loading gallery…</p>
        </div>
      )}

      {data && (
        <>
          <div className="raptors-gallery-meta-count">
            <span className="raptors-count-badge">
              {data.total} submitted project{data.total === 1 ? '' : 's'}
            </span>
          </div>

          {/* ── PORTFOLIO WALL CARDS ── */}
          <div className="raptors-gallery-grid feature-grid">
            {data.items.map((project) => (
              <article
                key={project.id}
                className="raptors-project-card feature-card"
                aria-label={project.projectName}
              >
                <div className="raptors-project-card-media">
                  <ProceduralScene
                    seed={project.id + project.projectName}
                    height={130}
                  />
                </div>

                <div className="raptors-project-card-body">
                  <div className="raptors-project-badge-row">
                    <span className="raptors-version-badge user-badge">
                      v{project.version}
                    </span>
                    {project.trackName && (
                      <span className="raptors-track-badge user-badge">
                        {project.trackName}
                      </span>
                    )}
                  </div>

                  <h3 className="raptors-project-card-title">
                    <a href={`/events/${eventId}/gallery/${project.id}`}>
                      {project.projectName}
                    </a>
                  </h3>

                  {project.tagline && (
                    <p className="raptors-project-tagline">{project.tagline}</p>
                  )}

                  <p className="raptors-project-team">
                    Team: <strong>{project.teamName}</strong>
                  </p>

                  <div className="raptors-project-card-footer">
                    <a
                      href={`/events/${eventId}/gallery/${project.id}`}
                      className="raptors-btn-card-primary btn-secondary btn-sm"
                    >
                      View Project →
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {!data.items.length && (
            <div className="raptors-empty-state">
              <p>No projects match your search criteria.</p>
            </div>
          )}

          {/* ── PAGINATION ── */}
          {(page > 1 || page * data.pageSize < data.total) && (
            <div className="raptors-pagination-row">
              {page > 1 && (
                <button
                  className="raptors-btn-secondary btn-secondary"
                  onClick={() => setPage(page - 1)}
                >
                  ← Previous
                </button>
              )}
              {page * data.pageSize < data.total && (
                <button
                  className="raptors-btn-secondary btn-secondary"
                  onClick={() => setPage(page + 1)}
                >
                  Next →
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
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
    <div className="raptors-gallery-detail-page">
      <p className="raptors-breadcrumb">
        <a href={`/events/${eventId}/gallery`} className="raptors-back-link">
          ← Back to gallery
        </a>
      </p>

      {error && (
        <p role="alert" className="raptors-alert-box">
          {error}
        </p>
      )}

      {project ? (
        <div className="raptors-project-detail-sheet">
          <div className="raptors-project-detail-header">
            <div className="raptors-project-badge-row">
              <span className="raptors-version-badge">
                Submitted version {project.version}
              </span>
              {project.trackName && (
                <span className="raptors-track-badge">{project.trackName}</span>
              )}
            </div>

            <h1 className="raptors-project-detail-title">
              {project.projectName}
            </h1>

            {project.tagline && (
              <p className="raptors-project-detail-tagline eyebrow">
                {project.tagline}
              </p>
            )}

            <div className="raptors-project-meta-strip">
              <span>
                Team: <strong>{project.teamName}</strong>
              </span>
              <span className="raptors-link-divider">·</span>
              <span>Submitted as: {project.title}</span>
            </div>

            <div className="raptors-project-external-links">
              {project.repositoryUrl && (
                <a
                  href={project.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="raptors-btn-secondary"
                >
                  Source Repository ↗
                </a>
              )}
              {project.demoUrl && (
                <a
                  href={project.demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="raptors-btn-primary"
                >
                  Live Demo ↗
                </a>
              )}
            </div>
          </div>

          <div className="raptors-project-detail-body">
            <section className="raptors-section-panel">
              <div className="raptors-section-header">
                <h2>Project Overview</h2>
              </div>
              <div className="raptors-rich-text">
                <p>{project.description}</p>
              </div>
            </section>

            <section className="raptors-section-panel">
              <div className="raptors-section-header">
                <h2>Community Feedback</h2>
              </div>
              <ProjectComments eventId={eventId} projectId={projectId} />
            </section>
          </div>
        </div>
      ) : (
        !error && (
          <div className="raptors-empty-state">
            <p>Loading project…</p>
          </div>
        )
      )}
    </div>
  );
}
