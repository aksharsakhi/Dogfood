'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-context';
import { api, Event, message } from '../lib/client';
export function EventList() {
  const [events, setEvents] = useState<Event[]>([]);
  const { user } = useAuth();
  const [mine, setMine] = useState(false);
  const [roles, setRoles] = useState<Record<string, string[]>>({});
  const [rolesLoaded, setRolesLoaded] = useState(false);
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
        setRolesLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user, events]);
  const shown = mine
    ? events.filter((event) => (roles[event.id] ?? []).length > 0)
    : events;
  return (
    <main>
      <h1>{mine ? 'My events' : 'Hackathons'}</h1>
      {user && (
        <p>
          <a href="/events/new">Create an event</a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <ul>
        {shown.map((event) => (
          <li key={event.id}>
            <a href={`/events/${event.id}`}>{event.name}</a> · {event.status}
            {roles[event.id]?.includes('ORGANIZER') && (
              <>
                {' · '}
                <a href={`/events/${event.id}/manage`}>Manage</a>
              </>
            )}
          </li>
        ))}
      </ul>
      {!shown.length && !error && (
        <p>
          {!eventsLoaded || (mine && user && !rolesLoaded)
            ? 'Loading events…'
            : 'No visible events yet.'}
        </p>
      )}
    </main>
  );
}
