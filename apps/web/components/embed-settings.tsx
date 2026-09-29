'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, message } from '../lib/client';

const escapeAttribute = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );

export function EmbedSettings({
  eventId,
  eventName,
}: {
  eventId: string;
  eventName: string;
}) {
  const [origins, setOrigins] = useState<string[]>([]);
  const [candidate, setCandidate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
    void api<{ allowedOrigins: string[] }>(
      `/events/${eventId}/embed-config`,
    ).then(
      (result) => setOrigins(result.allowedOrigins),
      (err) => setError(message(err)),
    );
  }, [eventId]);
  const url = origin ? `${origin}/embed/events/${eventId}` : '';
  const snippet = url
    ? `<iframe src="${escapeAttribute(url)}" title="${escapeAttribute(eventName)} gallery" loading="lazy" width="100%" height="600"></iframe>`
    : '';
  function add(e: FormEvent) {
    e.preventDefault();
    try {
      if (
        candidate !== candidate.trim() ||
        candidate.includes('\\') ||
        /\s/.test(candidate) ||
        [...candidate].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        !/^https?:\/\//i.test(candidate)
      )
        throw new Error('Enter an exact HTTP(S) origin without whitespace.');
      const parsed = new URL(candidate);
      if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        parsed.hostname.includes('*') ||
        !/^[^/?#]+\/?$/.test(candidate.slice(candidate.indexOf('//') + 2))
      )
        throw new Error('Enter only scheme, host, and optional port.');
      setOrigins([...new Set([...origins, parsed.origin])].sort());
      setCandidate('');
      setError('');
      setNotice('Save changes to apply.');
    } catch (err) {
      setError(message(err));
    }
  }
  async function save() {
    try {
      const result = await api<{ allowedOrigins: string[] }>(
        `/events/${eventId}/embed-config`,
        { method: 'PATCH', body: { allowedOrigins: origins } },
      );
      setOrigins(result.allowedOrigins);
      setError('');
      setNotice('Embed settings saved.');
    } catch (err) {
      setError(message(err));
    }
  }
  return (
    <section aria-label="Embed settings" className="raptors-card-panel">
      <h2>Embeddable gallery</h2>
      <p>
        The gallery embed is read-only and shows only publicly visible projects.
        An empty allowlist disables framing. Add exact website origins;
        wildcards are not supported.
      </p>
      <p>
        Embedding: {origins.length ? 'enabled for listed origins' : 'disabled'}
      </p>
      <ul>
        {origins.map((item) => (
          <li key={item}>
            {item}{' '}
            <button
              type="button"
              onClick={() => {
                setOrigins(origins.filter((value) => value !== item));
                setNotice('Save changes to apply.');
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add}>
        <label>
          Allowed origin{' '}
          <input
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            placeholder="https://example.com"
          />
        </label>
        <button>Add origin</button>
      </form>
      <button type="button" onClick={() => void save()}>
        Save embed settings
      </button>
      {url && (
        <>
          <p>
            Embed URL:{' '}
            <a href={url} style={{ wordBreak: 'break-all' }}>
              {url}
            </a>
          </p>
          <label>
            Iframe snippet
            <textarea readOnly value={snippet} rows={3} />
          </label>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(snippet)}
          >
            Copy iframe snippet
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
