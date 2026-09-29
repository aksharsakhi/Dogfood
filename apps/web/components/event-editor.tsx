'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Event, message, Prize, Registration, Track } from '../lib/client';
import { ArchiveManager } from './archive-manager';
import { EmbedSettings } from './embed-settings';

function dateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function localDateTime(value: string | null | undefined, timeZone: string) {
  if (!value) return '';
  const parts = dateParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function zonedDateTime(value: string, timeZone: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('Enter a valid date and time.');
  const wanted = match.slice(1).map(Number);
  const target = Date.UTC(
    wanted[0]!,
    wanted[1]! - 1,
    wanted[2]!,
    wanted[3]!,
    wanted[4]!,
  );
  let candidate = target;
  for (let i = 0; i < 3; i++) {
    const parts = dateParts(new Date(candidate), timeZone);
    const observed = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    candidate += target - observed;
  }
  const verified = dateParts(new Date(candidate), timeZone);
  if (
    [
      verified.year,
      verified.month,
      verified.day,
      verified.hour,
      verified.minute,
    ]
      .map(Number)
      .some((part, index) => part !== wanted[index])
  )
    throw new Error('This local time does not exist in the selected timezone.');
  return new Date(candidate).toISOString();
}
export function EventEditor({ eventId }: { eventId?: string }) {
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!eventId) return;
    void api<Event>(`/events/${eventId}`).then(setEvent, (e) =>
      setError(message(e)),
    );
    void api<Track[]>(`/events/${eventId}/tracks`).then(setTracks, () => {});
    void api<Prize[]>(`/events/${eventId}/prizes`).then(setPrizes, () => {});
    void api<Registration[]>(`/events/${eventId}/registrations`).then(
      setRegistrations,
      (e) => setError(message(e)),
    );
  }, [eventId]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const timezone = String(f.get('timezone'));
      const date = (name: string) =>
        zonedDateTime(String(f.get(name) || ''), timezone);
      const body = {
        name: String(f.get('name')),
        shortDescription: String(f.get('shortDescription')),
        description: String(f.get('description')),
        rules: String(f.get('rules')),
        eligibility: String(f.get('eligibility')),
        visibility: String(f.get('visibility')),
        galleryVisibility: String(f.get('galleryVisibility')),
        timezone,
        minTeamSize: Number(f.get('minTeamSize')),
        maxTeamSize: Number(f.get('maxTeamSize')),
        registrationOpensAt: date('registrationOpensAt'),
        registrationClosesAt: date('registrationClosesAt'),
        submissionOpensAt: date('submissionOpensAt'),
        submissionClosesAt: date('submissionClosesAt'),
        judgingOpensAt: date('judgingOpensAt'),
        judgingClosesAt: date('judgingClosesAt'),
        resultsPublishAt: date('resultsPublishAt'),
      };
      const saved = await api<Event>(
        eventId ? `/events/${eventId}` : '/events',
        {
          method: eventId ? 'PATCH' : 'POST',
          body: eventId ? body : { ...body, slug: String(f.get('slug')) },
        },
      );
      setEvent(saved);
      setError('');
      setNotice('Saved.');
      if (!eventId) router.push(`/events/${saved.id}/manage`);
    } catch (err) {
      setError(message(err));
    }
  }
  async function createTrack(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!eventId) return;
    const f = new FormData(e.currentTarget);
    try {
      const track = await api<Track>(`/events/${eventId}/tracks`, {
        method: 'POST',
        body: {
          name: String(f.get('name')),
          slug: String(f.get('slug')),
          description: String(f.get('description')) || undefined,
          maxSubmissions: String(f.get('maxSubmissions'))
            ? Number(f.get('maxSubmissions'))
            : undefined,
        },
      });
      setTracks([...tracks, track]);
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function createPrize(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!eventId) return;
    const f = new FormData(e.currentTarget);
    try {
      const prize = await api<Prize>(`/events/${eventId}/prizes`, {
        method: 'POST',
        body: {
          name: String(f.get('name')),
          description: String(f.get('description')) || undefined,
          position: String(f.get('position'))
            ? Number(f.get('position'))
            : undefined,
          trackId: String(f.get('trackId')) || undefined,
          amount: String(f.get('amount')) || undefined,
          currency: String(f.get('currency')) || undefined,
        },
      });
      setPrizes([...prizes, prize]);
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function renameTrack(id: string, body: object) {
    if (!eventId) return;
    try {
      const updated = await api<Track>(`/events/${eventId}/tracks/${id}`, {
        method: 'PATCH',
        body,
      });
      setTracks(tracks.map((track) => (track.id === id ? updated : track)));
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function deleteTrack(id: string) {
    if (!eventId) return;
    try {
      await api<void>(`/events/${eventId}/tracks/${id}`, { method: 'DELETE' });
      setTracks(tracks.filter((track) => track.id !== id));
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function renamePrize(id: string, body: object) {
    if (!eventId) return;
    try {
      const updated = await api<Prize>(`/events/${eventId}/prizes/${id}`, {
        method: 'PATCH',
        body,
      });
      setPrizes(prizes.map((prize) => (prize.id === id ? updated : prize)));
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function deletePrize(id: string) {
    if (!eventId) return;
    try {
      await api<void>(`/events/${eventId}/prizes/${id}`, { method: 'DELETE' });
      setPrizes(prizes.filter((prize) => prize.id !== id));
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  async function publish() {
    if (!eventId) return;
    try {
      setEvent(
        await api<Event>(`/events/${eventId}/publish`, { method: 'POST' }),
      );
      setNotice('Published.');
      setError('');
    } catch (err) {
      setError(message(err));
    }
  }
  const localDate = (value: string | null | undefined) => {
    try {
      return localDateTime(value, event?.timezone ?? 'UTC');
    } catch {
      return '';
    }
  };
  return (
    <main className="raptors-workspace-container">
      <div className="raptors-workspace-header">
        <span className="raptors-workspace-eyebrow">
          Organizer Control Center
        </span>
        <div className="raptors-workspace-title-row">
          <h1 className="raptors-workspace-title">
            {eventId ? 'Manage event' : 'Create event'}
          </h1>
        </div>
        <p className="raptors-workspace-desc">
          {eventId
            ? 'Configure hackathon parameters, participation limits, tracks, prizes, and event timeline.'
            : 'Initialize a new hackathon with tracks, schedules, and custom judging configurations.'}
        </p>
      </div>

      {eventId && (
        <nav
          className="raptors-workspace-tabs"
          aria-label="Organizer navigation"
        >
          <a href={`/events/${eventId}`} className="raptors-tab-item">
            Overview
          </a>
          <a
            href={`/events/${eventId}/manage`}
            className="raptors-tab-item active"
          >
            Settings
          </a>
          <a href={`/events/${eventId}/judging`} className="raptors-tab-item">
            Judging setup and progress
          </a>
          <a
            href={`/events/${eventId}/judging/records`}
            className="raptors-tab-item"
          >
            Signed Records
          </a>
          <a
            href={`/events/${eventId}/voting/manage`}
            className="raptors-tab-item"
          >
            Voting setup and audit
          </a>
          <a href={`/events/${eventId}/gallery`} className="raptors-tab-item">
            Gallery
          </a>
        </nav>
      )}
      <form onSubmit={save} key={event?.id ?? 'new'}>
        <fieldset>
          <legend>Basic information</legend>
          <label>
            Name
            <input name="name" defaultValue={event?.name} required />
          </label>
          <label>
            Short description
            <input
              name="shortDescription"
              maxLength={300}
              defaultValue={event?.shortDescription ?? ''}
            />
          </label>
          <label>
            Detailed description
            <textarea
              name="description"
              maxLength={10000}
              defaultValue={event?.description ?? ''}
            />
          </label>
          <label>
            Rules
            <textarea
              name="rules"
              maxLength={10000}
              defaultValue={event?.rules ?? ''}
            />
          </label>
          <label>
            Eligibility
            <textarea
              name="eligibility"
              maxLength={10000}
              defaultValue={event?.eligibility ?? ''}
            />
          </label>
          {!eventId && (
            <label>
              Slug
              <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
            </label>
          )}
        </fieldset>
        <fieldset>
          <legend>Visibility</legend>
          <label>
            Visibility
            <select
              name="visibility"
              defaultValue={event?.visibility ?? 'PUBLIC'}
            >
              <option>PUBLIC</option>
              <option>UNLISTED</option>
              <option>PRIVATE</option>
            </select>
          </label>
          <p>
            Event visibility controls who can find the hackathon. Gallery
            visibility controls when submitted projects are public.
          </p>
          <label>
            Gallery visibility
            <select
              name="galleryVisibility"
              defaultValue={event?.galleryVisibility ?? 'HIDDEN'}
            >
              <option value="HIDDEN">Hidden</option>
              <option value="AFTER_SUBMISSIONS_CLOSE">
                After submissions close
              </option>
              <option value="PUBLIC">Public immediately</option>
            </select>
          </label>
          <label>
            Timezone
            <input
              name="timezone"
              defaultValue={event?.timezone ?? 'UTC'}
              required
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Registration</legend>
          <label>
            Registration opens
            <input
              type="datetime-local"
              name="registrationOpensAt"
              defaultValue={localDate(event?.registrationOpensAt)}
            />
          </label>
          <label>
            Registration closes
            <input
              type="datetime-local"
              name="registrationClosesAt"
              defaultValue={localDate(event?.registrationClosesAt)}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Submission</legend>
          <label>
            Submission opens
            <input
              type="datetime-local"
              name="submissionOpensAt"
              defaultValue={localDate(event?.submissionOpensAt)}
            />
          </label>
          <label>
            Submission closes
            <input
              type="datetime-local"
              name="submissionClosesAt"
              defaultValue={localDate(event?.submissionClosesAt)}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Judging and results</legend>
          <label>
            Judging opens
            <input
              type="datetime-local"
              name="judgingOpensAt"
              defaultValue={localDate(event?.judgingOpensAt)}
            />
          </label>
          <label>
            Judging closes
            <input
              type="datetime-local"
              name="judgingClosesAt"
              defaultValue={localDate(event?.judgingClosesAt)}
            />
          </label>
          <label>
            Results publication date
            <input
              type="datetime-local"
              name="resultsPublishAt"
              defaultValue={localDate(event?.resultsPublishAt)}
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Team settings</legend>
          <label>
            Minimum team size
            <input
              type="number"
              name="minTeamSize"
              min="1"
              defaultValue={event?.minTeamSize ?? 1}
              required
            />
          </label>
          <label>
            Maximum team size
            <input
              type="number"
              name="maxTeamSize"
              min="1"
              defaultValue={event?.maxTeamSize ?? 5}
              required
            />
          </label>
        </fieldset>
        <button>Save event</button>
      </form>
      {eventId && (
        <>
          <p>State: {event?.status}</p>
          <button
            onClick={() => void publish()}
            disabled={event?.status !== 'DRAFT'}
          >
            Publish event
          </button>
          <section className="raptors-card-panel">
            <h2>Tracks</h2>
            <ul>
              {tracks.map((t) => (
                <li key={t.id}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void renameTrack(t.id, {
                        name: String(f.get('name')),
                        description: String(f.get('description')),
                        maxSubmissions: String(f.get('maxSubmissions'))
                          ? Number(f.get('maxSubmissions'))
                          : null,
                      });
                    }}
                  >
                    <label>
                      Track name
                      <input name="name" defaultValue={t.name} required />
                    </label>
                    <label>
                      Description
                      <input
                        name="description"
                        defaultValue={t.description ?? ''}
                      />
                    </label>
                    <label>
                      Maximum submissions
                      <input
                        name="maxSubmissions"
                        type="number"
                        min="1"
                        defaultValue={t.maxSubmissions ?? ''}
                      />
                    </label>
                    <button>Rename</button>
                    <button
                      type="button"
                      onClick={() => void deleteTrack(t.id)}
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form onSubmit={createTrack}>
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Slug
                <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required />
              </label>
              <button>Add track</button>
            </form>
          </section>
          <section className="raptors-card-panel">
            <h2>Prizes</h2>
            <ul>
              {prizes.map((p) => (
                <li key={p.id}>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void renamePrize(p.id, {
                        name: String(f.get('name')),
                        description: String(f.get('description')),
                        position: String(f.get('position'))
                          ? Number(f.get('position'))
                          : null,
                        trackId: String(f.get('trackId')) || null,
                        amount: String(f.get('amount')) || null,
                        currency: String(f.get('currency')) || null,
                      });
                    }}
                  >
                    <label>
                      Prize name
                      <input name="name" defaultValue={p.name} required />
                    </label>
                    <label>
                      Description
                      <input
                        name="description"
                        defaultValue={p.description ?? ''}
                      />
                    </label>
                    <label>
                      Track
                      <select name="trackId" defaultValue={p.trackId ?? ''}>
                        <option value="">All tracks</option>
                        {tracks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Position
                      <input
                        name="position"
                        type="number"
                        min="1"
                        defaultValue={p.position ?? ''}
                      />
                    </label>
                    <label>
                      Amount
                      <input name="amount" defaultValue={p.amount ?? ''} />
                    </label>
                    <label>
                      Currency
                      <input
                        name="currency"
                        maxLength={3}
                        defaultValue={p.currency ?? ''}
                      />
                    </label>
                    <button>Rename</button>
                    <button
                      type="button"
                      onClick={() => void deletePrize(p.id)}
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <form onSubmit={createPrize}>
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Description
                <input name="description" />
              </label>
              <label>
                Position
                <input name="position" type="number" min="1" />
              </label>
              <label>
                Track
                <select name="trackId">
                  <option value="">All tracks</option>
                  {tracks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  name="amount"
                  inputMode="decimal"
                  placeholder="1000.00"
                />
              </label>
              <label>
                Currency
                <input name="currency" maxLength={3} placeholder="USD" />
              </label>
              <button>Add prize</button>
            </form>
          </section>
          <section className="raptors-card-panel">
            <h2>Registrations</h2>
            <ul>
              {registrations.map((r) => (
                <li key={r.id}>
                  {r.user?.displayName ?? r.id} · {r.status}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {eventId && <ArchiveManager eventId={eventId} />}
      {eventId && event && (
        <EmbedSettings eventId={eventId} eventName={event.name} />
      )}
    </main>
  );
}
