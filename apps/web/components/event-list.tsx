'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, Event, message } from '../lib/client';
import { ProceduralScene } from './procedural-scene';

export function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const { user } = useAuth();
  const [mine, setMine] = useState(false);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<Event[]>('/events')
      .then(setEvents, (e) => setError(message(e)))
      .finally(() => setEventsLoaded(true));
    setMine(new URLSearchParams(window.location.search).get('mine') === '1');
  }, []);

  useEffect(() => {
    if (!user || !events.length) return;
    let cancelled = false;
    void Promise.all(
      events.map(async (event) => {
        const membership = await api<Array<{ role: string }>>(
          `/events/${event.id}/memberships/me`,
        ).catch(() => []);
        return [event.id, membership.map((item) => item.role)] as const;
      }),
    ).then((entries) => {
      if (!cancelled) {
        setRoles(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, events]);

  const isRegressionTestEvent = (e: Event) =>
    /^(Phase \d+|Browser|Judging Browser|Test) Event/i.test(e.name) ||
    /^(phase\d+|browser-event|judging-browser|test-event)/i.test(e.slug);

  const featuredEvent =
    events.find(
      (e) => e.slug === 'official-evt-01' || e.name === 'Sample Hack 2026',
    ) || null;

  const demoEvents = events
    .filter((e) => e.id !== featuredEvent?.id && !isRegressionTestEvent(e))
    .slice(0, 2);

  const myEvents = mine
    ? events.filter((event) => (roles[event.id] ?? []).length > 0)
    : [];

  const formatDate = (val: string | null) => {
    if (!val) return null;
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
      }).format(new Date(val));
    } catch {
      return null;
    }
  };

  return (
    <div className="raptors-explore-page">
      {/* ── HEADER ── */}
      <div className="raptors-explore-header">
        <div className="raptors-explore-intro">
          <span className="raptors-section-eyebrow">Hackathon Discovery</span>
          <h1 className="raptors-explore-title">
            {mine ? 'MY HACKATHONS' : 'EXPLORE HACKATHONS'}
          </h1>
          <p className="raptors-explore-subtitle">
            Discover competitive events with fair judging, verifiable records,
            and tools designed for serious builders.
          </p>
        </div>

        <div className="raptors-explore-header-actions">
          {user && (
            <div className="raptors-filter-pills" role="tablist">
              <a
                href="/events"
                className={`raptors-filter-pill ${!mine ? 'active' : ''}`}
                role="tab"
                aria-selected={!mine}
              >
                All Events
              </a>
              <a
                href="/events?mine=1"
                className={`raptors-filter-pill ${mine ? 'active' : ''}`}
                role="tab"
                aria-selected={mine}
              >
                My Events
              </a>
            </div>
          )}

          <a href="/events/new" className="raptors-btn-primary btn-primary">
            + Host a Hackathon
          </a>
        </div>
      </div>

      {error && (
        <p role="alert" className="raptors-alert-box">
          {error}
        </p>
      )}

      {/* ── CONDITIONAL CONTENT: MY EVENTS VS PUBLIC TWO-SECTION DISCOVERY ── */}
      {mine ? (
        <div className="raptors-poster-grid feature-grid">
          {myEvents.map((event) => {
            const isOrganizer = roles[event.id]?.includes('ORGANIZER');
            const regOpens = formatDate(event.registrationOpensAt);
            const regCloses = formatDate(event.registrationClosesAt);

            return (
              <article
                key={event.id}
                className="raptors-event-card feature-card"
                aria-label={event.name}
              >
                <div className="raptors-event-card-media">
                  <ProceduralScene seed={event.id + event.name} height={140} />
                </div>

                <div className="raptors-event-card-body">
                  <div className="raptors-event-badge-row">
                    <span
                      className={`raptors-status-badge status-${event.status.toLowerCase()} user-badge`}
                    >
                      {event.status}
                    </span>
                    {isOrganizer && (
                      <span className="raptors-role-badge user-badge">
                        Organizer
                      </span>
                    )}
                    {event.visibility === 'PRIVATE' && (
                      <span className="raptors-role-badge user-badge">
                        Private
                      </span>
                    )}
                  </div>

                  <h2 className="raptors-event-card-title">
                    <a href={`/events/${event.id}`}>{event.name}</a>
                  </h2>

                  {event.shortDescription ? (
                    <p className="raptors-event-card-desc">
                      {event.shortDescription}
                    </p>
                  ) : event.description ? (
                    <p className="raptors-event-card-desc">
                      {event.description}
                    </p>
                  ) : null}

                  <div className="raptors-event-card-meta">
                    <div className="raptors-meta-item">
                      <span className="raptors-meta-label">Schedule</span>
                      <span className="raptors-meta-val">
                        {regOpens && regCloses
                          ? `${regOpens} – ${regCloses}`
                          : regOpens
                            ? `Opens ${regOpens}`
                            : 'Ongoing'}
                      </span>
                    </div>
                    <div className="raptors-meta-item">
                      <span className="raptors-meta-label">Team Size</span>
                      <span className="raptors-meta-val">
                        {event.minTeamSize === event.maxTeamSize
                          ? `${event.minTeamSize} builders`
                          : `${event.minTeamSize}–${event.maxTeamSize} builders`}
                      </span>
                    </div>
                  </div>

                  <div className="raptors-event-card-footer">
                    <a
                      href={`/events/${event.id}`}
                      className="raptors-btn-card-primary btn-secondary btn-sm"
                    >
                      View Event →
                    </a>
                    {isOrganizer && (
                      <a
                        href={`/events/${event.id}/manage`}
                        className="raptors-btn-card-outline btn-secondary btn-sm"
                      >
                        Manage
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="raptors-explore-sections">
          {/* ╔══════════════════════════════════════════════════════╗
              ║  SECTION A — FEATURED / OFFICIAL FIXTURE             ║
              ╚══════════════════════════════════════════════════════╝ */}
          {featuredEvent && (
            <section
              className="raptors-featured-section"
              aria-labelledby="featured-event-heading"
            >
              <div className="raptors-section-title-wrap">
                <span className="raptors-section-eyebrow">
                  Canonical Dataset
                </span>
                <h2
                  id="featured-event-heading"
                  className="raptors-section-headline"
                >
                  FEATURED HACKATHON
                </h2>
              </div>

              <article
                className="raptors-featured-card feature-card"
                aria-label={featuredEvent.name}
              >
                <div className="raptors-featured-card-media">
                  <ProceduralScene
                    seed={featuredEvent.id + featuredEvent.name}
                    height={220}
                  />
                </div>

                <div className="raptors-featured-card-body">
                  <div className="raptors-event-badge-row">
                    <span className="raptors-role-badge user-badge">
                      OFFICIAL FIXTURE
                    </span>
                    <span
                      className={`raptors-status-badge status-${featuredEvent.status.toLowerCase()} user-badge`}
                    >
                      {featuredEvent.status}
                    </span>
                    <span className="raptors-track-badge user-badge">
                      41 Projects
                    </span>
                  </div>

                  <h3 className="raptors-featured-card-title">
                    <a href={`/events/${featuredEvent.id}`}>
                      {featuredEvent.name}
                    </a>
                  </h3>

                  <p className="raptors-featured-card-desc">
                    {featuredEvent.shortDescription ||
                      featuredEvent.description ||
                      'The canonical multi-track hackathon platform featuring immutable project snapshots, verified pairwise scoring, and automated certificate generation.'}
                  </p>

                  <div className="raptors-featured-meta-row">
                    <div className="raptors-meta-item">
                      <span className="raptors-meta-label">Schedule</span>
                      <span className="raptors-meta-val">
                        {formatDate(featuredEvent.registrationOpensAt) &&
                        formatDate(featuredEvent.registrationClosesAt)
                          ? `${formatDate(featuredEvent.registrationOpensAt)} – ${formatDate(featuredEvent.registrationClosesAt)}`
                          : 'Ongoing'}
                      </span>
                    </div>

                    <div className="raptors-meta-item">
                      <span className="raptors-meta-label">Submissions</span>
                      <span className="raptors-meta-val">
                        {featuredEvent.submissionClosesAt
                          ? `Deadline: ${formatDate(featuredEvent.submissionClosesAt)}`
                          : 'Open for evaluation'}
                      </span>
                    </div>

                    <div className="raptors-meta-item">
                      <span className="raptors-meta-label">Team Size</span>
                      <span className="raptors-meta-val">
                        {featuredEvent.minTeamSize === featuredEvent.maxTeamSize
                          ? `${featuredEvent.minTeamSize} builders`
                          : `${featuredEvent.minTeamSize}–${featuredEvent.maxTeamSize} builders`}
                      </span>
                    </div>

                    <div className="raptors-meta-item">
                      <span className="raptors-meta-label">Timezone</span>
                      <span className="raptors-meta-val">
                        {featuredEvent.timezone}
                      </span>
                    </div>
                  </div>

                  <div className="raptors-featured-card-actions">
                    <a
                      href={`/events/${featuredEvent.id}`}
                      className="raptors-btn-primary btn-primary"
                    >
                      View Event →
                    </a>
                    <a
                      href={`/events/${featuredEvent.id}/gallery`}
                      className="raptors-btn-secondary btn-secondary"
                    >
                      View Public Gallery ↗
                    </a>
                    {roles[featuredEvent.id]?.includes('ORGANIZER') && (
                      <a
                        href={`/events/${featuredEvent.id}/manage`}
                        className="raptors-btn-secondary btn-secondary"
                      >
                        Manage Event
                      </a>
                    )}
                  </div>
                </div>
              </article>
            </section>
          )}

          {/* ╔══════════════════════════════════════════════════════╗
              ║  SECTION B — RAPTORS DEMO HACKATHONS                 ║
              ╚══════════════════════════════════════════════════════╝ */}
          <section
            className="raptors-demos-section"
            aria-labelledby="demos-event-heading"
          >
            <div className="raptors-section-title-wrap">
              <span className="raptors-section-eyebrow">
                Curated Environments
              </span>
              <h2 id="demos-event-heading" className="raptors-section-headline">
                RAPTORS DEMO HACKATHONS
              </h2>
            </div>

            <div className="raptors-poster-grid raptors-demos-grid feature-grid">
              {demoEvents.map((event) => {
                const isOrganizer = roles[event.id]?.includes('ORGANIZER');
                const regOpens = formatDate(event.registrationOpensAt);
                const regCloses = formatDate(event.registrationClosesAt);

                return (
                  <article
                    key={event.id}
                    className="raptors-event-card feature-card"
                    aria-label={event.name}
                  >
                    <div className="raptors-event-card-media">
                      <ProceduralScene
                        seed={event.id + event.name}
                        height={140}
                      />
                    </div>

                    <div className="raptors-event-card-body">
                      <div className="raptors-event-badge-row">
                        <span
                          className={`raptors-status-badge status-${event.status.toLowerCase()} user-badge`}
                        >
                          {event.status}
                        </span>
                        {isOrganizer && (
                          <span className="raptors-role-badge user-badge">
                            Organizer
                          </span>
                        )}
                      </div>

                      <h3 className="raptors-event-card-title">
                        <a href={`/events/${event.id}`}>{event.name}</a>
                      </h3>

                      {event.shortDescription ? (
                        <p className="raptors-event-card-desc">
                          {event.shortDescription}
                        </p>
                      ) : event.description ? (
                        <p className="raptors-event-card-desc">
                          {event.description}
                        </p>
                      ) : null}

                      <div className="raptors-event-card-meta">
                        <div className="raptors-meta-item">
                          <span className="raptors-meta-label">Schedule</span>
                          <span className="raptors-meta-val">
                            {regOpens && regCloses
                              ? `${regOpens} – ${regCloses}`
                              : regOpens
                                ? `Opens ${regOpens}`
                                : 'Ongoing'}
                          </span>
                        </div>
                        <div className="raptors-meta-item">
                          <span className="raptors-meta-label">Team Size</span>
                          <span className="raptors-meta-val">
                            {event.minTeamSize === event.maxTeamSize
                              ? `${event.minTeamSize} builders`
                              : `${event.minTeamSize}–${event.maxTeamSize} builders`}
                          </span>
                        </div>
                      </div>

                      <div className="raptors-event-card-footer">
                        <a
                          href={`/events/${event.id}`}
                          className="raptors-btn-card-primary btn-secondary btn-sm"
                        >
                          View Event →
                        </a>
                        {isOrganizer && (
                          <a
                            href={`/events/${event.id}/manage`}
                            className="raptors-btn-card-outline btn-secondary btn-sm"
                          >
                            Manage
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {!eventsLoaded && (
        <div className="raptors-empty-state">
          <p>Loading events…</p>
        </div>
      )}

      {eventsLoaded && mine && !myEvents.length && (
        <div className="raptors-empty-state">
          <p>You have not registered for or created any hackathons yet.</p>
        </div>
      )}
    </div>
  );
}
