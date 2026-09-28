'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, Event, message, Prize, Registration, Track } from '../lib/client';
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
  return (
    <main>
      {event ? (
        <>
          <h1>{event.name}</h1>
          {event.shortDescription && (
            <p className="eyebrow">{event.shortDescription}</p>
          )}
          <p>{event.description}</p>
          <p>
            Status: {event.status} · {event.visibility}
          </p>
          <p>
            {event.visibility === 'PRIVATE' ? (
              'Private events do not have a public gallery.'
            ) : event.galleryVisibility === 'HIDDEN' ? (
              'Project gallery is currently hidden.'
            ) : event.galleryVisibility === 'AFTER_SUBMISSIONS_CLOSE' &&
              (!event.submissionClosesAt ||
                Date.now() < Date.parse(event.submissionClosesAt)) ? (
              'Gallery opens after submissions close.'
            ) : (
              <a href={`/events/${eventId}/gallery`}>View public gallery</a>
            )}
          </p>
          <p>
            <a href={`/events/${eventId}/vote`}>Community ballot</a> ·{' '}
            <a href={`/events/${eventId}/voting/results`}>Community results</a>
          </p>
          <section aria-label="Event information">
            <h2>Event information</h2>
            <p>
              Timezone: {event.timezone} · Team size: {event.minTeamSize}–
              {event.maxTeamSize}
            </p>
            <p>
              Registration:{' '}
              {lifecycle(event.registrationOpensAt, event.registrationClosesAt)}
            </p>
            <p>
              Registration opens: {time(event.registrationOpensAt)} · closes:{' '}
              {time(event.registrationClosesAt)}
            </p>
            <p>Submissions: {submissionState()}</p>
            <p>
              Submission opens: {time(event.submissionOpensAt)} · deadline:{' '}
              {time(event.submissionClosesAt)}
            </p>
            <p>
              Judging:{' '}
              {lifecycle(
                event.judgingOpensAt,
                event.judgingClosesAt,
                'Not scheduled',
              )}
            </p>
            <p>
              Judging dates: {time(event.judgingOpensAt)} –{' '}
              {time(event.judgingClosesAt)}
            </p>
            <p>Results publication: {time(event.resultsPublishAt)}</p>
            {event.eligibility && (
              <>
                <h3>Eligibility</h3>
                <p>{event.eligibility}</p>
              </>
            )}
            {event.rules && (
              <>
                <h3>Rules</h3>
                <p>{event.rules}</p>
              </>
            )}
            <h3>Tracks</h3>
            {tracks.length ? (
              <ul>
                {tracks.map((track) => (
                  <li key={track.id}>
                    {track.name}
                    {track.description ? ` — ${track.description}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No tracks published.</p>
            )}
            <h3>Prizes</h3>
            {prizes.length ? (
              <ul>
                {prizes.map((prize) => (
                  <li key={prize.id}>
                    {prize.name}
                    {prize.description ? ` — ${prize.description}` : ''}
                    {prize.trackId
                      ? ` · ${tracks.find((track) => track.id === prize.trackId)?.name ?? ''}`
                      : ''}
                    {prize.amount != null
                      ? ` · ${prize.amount} ${prize.currency}`
                      : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No prizes published.</p>
            )}
          </section>
          {user ? (
            <>
              {organizer && (
                <p>
                  <a href={`/events/${eventId}/manage`}>Manage event</a> ·{' '}
                  <a href={`/events/${eventId}/judging`}>Manage judging</a>
                  {' · '}
                  <a href={`/events/${eventId}/judging/records`}>
                    Participation records
                  </a>
                  {' · '}
                  <a href={`/events/${eventId}/voting/manage`}>Manage voting</a>
                </p>
              )}
              {judge && (
                <p>
                  <a href={`/events/${eventId}/judge`}>Judge workspace</a> ·{' '}
                  <a href={`/events/${eventId}/records`}>Your records</a>
                </p>
              )}
              {registrationLoaded && registration && (
                <p>Registration status: {registration.status}</p>
              )}
              {!registrationLoaded && <p>Loading registration status…</p>}
              {organizer && !registration ? (
                <p>
                  You manage this event. Use the management link above to
                  configure it.
                </p>
              ) : registration?.status === 'APPROVED' ? (
                <>
                  <p>Registered as a participant.</p>
                  <p>
                    <a href={`/events/${eventId}/records`}>
                      View your participation records
                    </a>
                  </p>
                  <TeamPanel
                    eventId={eventId}
                    user={user}
                    submissionOpensAt={event.submissionOpensAt}
                    submissionClosesAt={event.submissionClosesAt}
                    timezone={event.timezone}
                  />
                  <button
                    onClick={() => void withdraw()}
                    disabled={!['PUBLISHED', 'ACTIVE'].includes(event.status)}
                  >
                    Withdraw registration
                  </button>
                </>
              ) : (
                <button
                  disabled={!registrationLoaded || !registrationOpen}
                  onClick={() => void register()}
                >
                  {registration?.status === 'WITHDRAWN'
                    ? 'Register again'
                    : registrationOpen
                      ? 'Register for this event'
                      : 'Registration is closed'}
                </button>
              )}
            </>
          ) : (
            <p>
              <a href="/login">Log in</a> to register.
            </p>
          )}
        </>
      ) : (
        <p>Loading event…</p>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
