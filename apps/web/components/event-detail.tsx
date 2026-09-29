'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, Event, message, Prize, Registration, Track } from '../lib/client';
import { EventHeroScene } from './procedural-scene';
import { TeamPanel } from './team-panel';

export function EventDetail({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<Event | null>(null);
  const { user } = useAuth();
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [registrationLoaded, setRegistrationLoaded] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [organizer, setOrganizer] = useState(false);
  const [judge, setJudge] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void api<Event>(`/events/${eventId}`).then(setEvent, (e) =>
      setError(message(e)),
    );
    void api<Track[]>(`/events/${eventId}/tracks`).then(setTracks, () => {});
    void api<Prize[]>(`/events/${eventId}/prizes`).then(setPrizes, () => {});
  }, [eventId]);

  useEffect(() => {
    if (!user) {
      setOrganizer(false);
      setJudge(false);
      setRegistration(null);
      setRegistrationLoaded(true);
      return;
    }
    void api<Array<{ role: string }>>(`/events/${eventId}/memberships/me`).then(
      (roles) => {
        setOrganizer(roles.some((role) => role.role === 'ORGANIZER'));
        setJudge(roles.some((role) => role.role === 'JUDGE'));
      },
      () => {},
    );
    void api<Registration | null>(`/events/${eventId}/registrations/me`)
      .then(setRegistration, () => {})
      .finally(() => setRegistrationLoaded(true));
  }, [eventId, user]);

  async function register() {
    try {
      const result = await api<Registration>(
        `/events/${eventId}/registrations`,
        { method: 'POST' },
      );
      setRegistration(result);
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }

  async function withdraw() {
    try {
      const result = await api<Registration>(
        `/events/${eventId}/registrations/withdraw`,
        { method: 'POST' },
      );
      setRegistration(result);
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }

  const time = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: event?.timezone ?? 'UTC',
        }).format(new Date(value))
      : 'Not set';

  const lifecycle = (
    opens: string | null,
    closes: string | null,
    unscheduled = 'Open now',
  ) => {
    if (!event || !['PUBLISHED', 'ACTIVE'].includes(event.status))
      return 'Not open';
    if (!opens && !closes) return unscheduled;
    const now = Date.now();
    if (opens && now < Date.parse(opens)) return `Opens ${time(opens)}`;
    if (closes && now >= Date.parse(closes)) return `Closed ${time(closes)}`;
    return 'Open now';
  };

  const registrationOpen =
    !!event &&
    ['PUBLISHED', 'ACTIVE'].includes(event.status) &&
    (!event.registrationOpensAt ||
      Date.now() >= Date.parse(event.registrationOpensAt)) &&
    (!event.registrationClosesAt ||
      Date.now() < Date.parse(event.registrationClosesAt));

  const submissionState = () => {
    if (!event) return '';
    if (event.status === 'COMPLETED') return 'Event completed';
    return lifecycle(event.submissionOpensAt, event.submissionClosesAt).replace(
      'Open now',
      'Submissions open',
    );
  };

  if (!event && !error) {
    return (
      <div className="raptors-detail-page">
        <div className="raptors-empty-state">
          <p>Loading event…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="raptors-detail-page">
      {event && (
        <>
          {/* ── HERO BANNER & HEADER ── */}
          <div className="raptors-detail-hero">
            <EventHeroScene seed={event.id + event.name} />

            <div className="raptors-detail-hero-content">
              <div className="raptors-detail-badges">
                <span
                  className={`raptors-status-badge status-${event.status.toLowerCase()}`}
                >
                  {event.status}
                </span>
                <span className="raptors-visibility-badge">
                  {event.visibility}
                </span>
                {organizer && (
                  <span className="raptors-role-badge">Organizer</span>
                )}
                {judge && <span className="raptors-role-badge">Judge</span>}
              </div>

              <h1 className="raptors-detail-title">{event.name}</h1>

              {event.shortDescription && (
                <p className="raptors-detail-tagline eyebrow">
                  {event.shortDescription}
                </p>
              )}

              {/* Quick stats ribbon */}
              <div className="raptors-detail-stats-bar">
                <div className="raptors-stat-box">
                  <span className="raptors-stat-label">Registration</span>
                  <span className="raptors-stat-val">
                    {lifecycle(
                      event.registrationOpensAt,
                      event.registrationClosesAt,
                    )}
                  </span>
                </div>
                <div className="raptors-stat-box">
                  <span className="raptors-stat-label">Submissions</span>
                  <span className="raptors-stat-val">{submissionState()}</span>
                </div>
                <div className="raptors-stat-box">
                  <span className="raptors-stat-label">Team Size</span>
                  <span className="raptors-stat-val">
                    {event.minTeamSize === event.maxTeamSize
                      ? `${event.minTeamSize} builders`
                      : `${event.minTeamSize}–${event.maxTeamSize} builders`}
                  </span>
                </div>
                <div className="raptors-stat-box">
                  <span className="raptors-stat-label">Timezone</span>
                  <span className="raptors-stat-val">{event.timezone}</span>
                </div>
              </div>

              {/* Primary hero action bar */}
              <div className="raptors-detail-hero-actions">
                {user ? (
                  registration?.status === 'APPROVED' ? (
                    <div className="raptors-reg-status-bar">
                      <span className="raptors-reg-confirmed">
                        ✓ Registered as a participant.
                      </span>
                      <a
                        href={`/events/${eventId}/records`}
                        className="raptors-btn-secondary"
                      >
                        View your participation records →
                      </a>
                    </div>
                  ) : (
                    <button
                      className="raptors-btn-primary"
                      disabled={!registrationLoaded || !registrationOpen}
                      onClick={() => void register()}
                    >
                      {registration?.status === 'WITHDRAWN'
                        ? 'Register again'
                        : registrationOpen
                          ? 'Register for this event'
                          : 'Registration is closed'}
                    </button>
                  )
                ) : (
                  <a
                    href={`/login?next=${encodeURIComponent(`/events/${eventId}`)}`}
                    className="raptors-btn-primary"
                  >
                    Log in to register →
                  </a>
                )}

                {/* Organizer quick links */}
                {organizer && (
                  <div className="raptors-organizer-pills">
                    <a
                      href={`/events/${eventId}/manage`}
                      className="raptors-btn-outline-sm"
                    >
                      Manage event →
                    </a>
                    <a
                      href={`/events/${eventId}/judging`}
                      className="raptors-btn-outline-sm"
                    >
                      Manage judging
                    </a>
                    <a
                      href={`/events/${eventId}/judging/records`}
                      className="raptors-btn-outline-sm"
                    >
                      Participation records
                    </a>
                    <a
                      href={`/events/${eventId}/voting/manage`}
                      className="raptors-btn-outline-sm"
                    >
                      Manage voting
                    </a>
                  </div>
                )}

                {/* Judge quick links */}
                {judge && (
                  <div className="raptors-organizer-pills">
                    <a
                      href={`/events/${eventId}/judge`}
                      className="raptors-btn-outline-sm"
                    >
                      Judge workspace →
                    </a>
                    <a
                      href={`/events/${eventId}/records`}
                      className="raptors-btn-outline-sm"
                    >
                      Your records
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="raptors-alert-box">
              {error}
            </p>
          )}

          {/* ── EDITORIAL SECTIONS ── */}
          <div className="raptors-detail-body">
            {/* 01 ABOUT */}
            <section
              className="raptors-section-panel"
              aria-label="Event information"
            >
              <div className="raptors-section-header">
                <span className="raptors-section-num">01</span>
                <h2>Event information</h2>
              </div>

              {event.description && (
                <div className="raptors-rich-text">
                  <p>{event.description}</p>
                </div>
              )}

              <div className="raptors-info-grid">
                <div className="raptors-info-item">
                  <span className="raptors-info-label">Timezone</span>
                  <span className="raptors-info-value">{event.timezone}</span>
                </div>
                <div className="raptors-info-item">
                  <span className="raptors-info-label">Team Size</span>
                  <span className="raptors-info-value">
                    {event.minTeamSize}–{event.maxTeamSize} members
                  </span>
                </div>
                <div className="raptors-info-item">
                  <span className="raptors-info-label">Registration</span>
                  <span className="raptors-info-value">
                    {lifecycle(
                      event.registrationOpensAt,
                      event.registrationClosesAt,
                    )}
                  </span>
                </div>
                <div className="raptors-info-item">
                  <span className="raptors-info-label">Submissions</span>
                  <span className="raptors-info-value">
                    {submissionState()}
                  </span>
                </div>
              </div>

              {event.eligibility && (
                <div className="raptors-sub-block">
                  <h3>Eligibility</h3>
                  <p>{event.eligibility}</p>
                </div>
              )}

              {event.rules && (
                <div className="raptors-sub-block">
                  <h3>Rules</h3>
                  <p>{event.rules}</p>
                </div>
              )}
            </section>

            {/* 02 TRACKS (only if available) */}
            {tracks.length > 0 && (
              <section className="raptors-section-panel" aria-label="Tracks">
                <div className="raptors-section-header">
                  <span className="raptors-section-num">02</span>
                  <h2>Tracks</h2>
                </div>
                <div className="raptors-card-grid">
                  {tracks.map((track) => (
                    <div key={track.id} className="raptors-track-card">
                      <h3>{track.name}</h3>
                      {track.description && <p>{track.description}</p>}
                      {track.maxSubmissions && (
                        <span className="raptors-track-cap">
                          Max submissions: {track.maxSubmissions}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 03 PRIZES (only if available) */}
            {prizes.length > 0 && (
              <section className="raptors-section-panel" aria-label="Prizes">
                <div className="raptors-section-header">
                  <span className="raptors-section-num">03</span>
                  <h2>Prizes</h2>
                </div>
                <div className="raptors-card-grid">
                  {prizes.map((prize) => {
                    const track = tracks.find((t) => t.id === prize.trackId);
                    return (
                      <div key={prize.id} className="raptors-prize-card">
                        <div className="raptors-prize-top">
                          <h3>{prize.name}</h3>
                          {prize.amount != null && (
                            <span className="raptors-prize-amount">
                              {prize.amount} {prize.currency ?? 'USD'}
                            </span>
                          )}
                        </div>
                        {track && (
                          <span className="raptors-prize-track">
                            Track: {track.name}
                          </span>
                        )}
                        {prize.description && <p>{prize.description}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 04 TIMELINE & DEADLINES */}
            <section className="raptors-section-panel" aria-label="Timeline">
              <div className="raptors-section-header">
                <span className="raptors-section-num">04</span>
                <h2>Timeline & Deadlines</h2>
              </div>
              <div className="raptors-timeline-list">
                <div className="raptors-timeline-step">
                  <div className="raptors-timeline-dot" />
                  <div className="raptors-timeline-content">
                    <h4>Registration Window</h4>
                    <p>
                      Opens: {time(event.registrationOpensAt)} · Closes:{' '}
                      {time(event.registrationClosesAt)}
                    </p>
                    <span className="raptors-timeline-badge">
                      {lifecycle(
                        event.registrationOpensAt,
                        event.registrationClosesAt,
                      )}
                    </span>
                  </div>
                </div>

                <div className="raptors-timeline-step">
                  <div className="raptors-timeline-dot" />
                  <div className="raptors-timeline-content">
                    <h4>Submission Window</h4>
                    <p>
                      Opens: {time(event.submissionOpensAt)} · Deadline:{' '}
                      {time(event.submissionClosesAt)}
                    </p>
                    <span className="raptors-timeline-badge">
                      {submissionState()}
                    </span>
                  </div>
                </div>

                <div className="raptors-timeline-step">
                  <div className="raptors-timeline-dot" />
                  <div className="raptors-timeline-content">
                    <h4>Judging Period</h4>
                    <p>
                      Dates: {time(event.judgingOpensAt)} –{' '}
                      {time(event.judgingClosesAt)}
                    </p>
                    <span className="raptors-timeline-badge">
                      {lifecycle(
                        event.judgingOpensAt,
                        event.judgingClosesAt,
                        'Not scheduled',
                      )}
                    </span>
                  </div>
                </div>

                <div className="raptors-timeline-step">
                  <div className="raptors-timeline-dot" />
                  <div className="raptors-timeline-content">
                    <h4>Results Publication</h4>
                    <p>Published at: {time(event.resultsPublishAt)}</p>
                  </div>
                </div>
              </div>
            </section>

            {/* 05 PROJECTS / GALLERY / VOTING */}
            <section
              className="raptors-section-panel"
              aria-label="Projects and Gallery"
            >
              <div className="raptors-section-header">
                <span className="raptors-section-num">05</span>
                <h2>Projects & Showcase</h2>
              </div>
              <div className="raptors-showcase-box">
                {event.visibility === 'PRIVATE' ? (
                  <p>Private events do not have a public gallery.</p>
                ) : event.galleryVisibility === 'HIDDEN' ? (
                  <p>Project gallery is currently hidden.</p>
                ) : event.galleryVisibility === 'AFTER_SUBMISSIONS_CLOSE' &&
                  (!event.submissionClosesAt ||
                    Date.now() < Date.parse(event.submissionClosesAt)) ? (
                  <p>Gallery opens after submissions close.</p>
                ) : (
                  <div className="raptors-gallery-callout">
                    <p>
                      Explore project submissions, architecture notes, and team
                      demos.
                    </p>
                    <a
                      href={`/events/${eventId}/gallery`}
                      className="raptors-btn-primary"
                    >
                      View public gallery →
                    </a>
                  </div>
                )}

                <div className="raptors-ballot-links">
                  <a
                    href={`/events/${eventId}/vote`}
                    className="raptors-text-link"
                  >
                    Community ballot →
                  </a>
                  <span className="raptors-link-divider">·</span>
                  <a
                    href={`/events/${eventId}/voting/results`}
                    className="raptors-text-link"
                  >
                    Community results →
                  </a>
                </div>
              </div>
            </section>

            {/* 06 TEAM & SUBMISSION WORKSPACE (if registered participant) */}
            {user && registration?.status === 'APPROVED' && (
              <section
                className="raptors-section-panel"
                aria-label="Team Workspace"
              >
                <div className="raptors-section-header">
                  <span className="raptors-section-num">06</span>
                  <h2>Participant Workspace</h2>
                </div>

                <TeamPanel
                  eventId={eventId}
                  user={user}
                  submissionOpensAt={event.submissionOpensAt}
                  submissionClosesAt={event.submissionClosesAt}
                  timezone={event.timezone}
                />

                <div className="raptors-withdraw-wrap">
                  <button
                    className="raptors-btn-withdraw"
                    onClick={() => void withdraw()}
                    disabled={!['PUBLISHED', 'ACTIVE'].includes(event.status)}
                  >
                    Withdraw registration
                  </button>
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
