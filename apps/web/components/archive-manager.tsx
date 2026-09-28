'use client';
import { useState } from 'react';
import { api, message } from '../lib/client';

type Preview = {
  packageHash: string;
  source: { instanceId: string; eventId: string };
  counts: Record<string, number>;
  identityMappings: Array<{
    sourceId: string;
    placeholderId: string;
    treatment: string;
  }>;
  idRemapping: Record<string, Record<string, string>>;
  warnings: string[];
  privacyConsequences: string[];
  validationErrors: string[];
};
type ImportResult = {
  status: 'IMPORTED' | 'ALREADY_IMPORTED';
  eventId: string;
  packageHash: string;
};

export function ArchiveManager({ eventId }: { eventId?: string }) {
  const [archive, setArchive] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function download() {
    if (!eventId) return;
    setBusy(true);
    setError('');
    try {
      const data = await api<unknown>(`/events/${eventId}/archive`);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dogfood-event-${eventId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function select(file: File | undefined) {
    setArchive(null);
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    setError('');
    setFileName(file?.name ?? '');
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error('Archive exceeds the 20 MiB upload limit.');
      setArchive(JSON.parse(await file.text()) as unknown);
    } catch (cause) {
      setError(message(cause));
    }
  }

  async function dryRun() {
    if (!archive) return;
    setBusy(true);
    setError('');
    setPreview(null);
    setResult(null);
    setConfirmed(false);
    try {
      setPreview(
        await api<Preview>('/events/archives/preview', {
          method: 'POST',
          body: { archive },
        }),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function importArchive() {
    if (!archive || !preview || !confirmed) return;
    setBusy(true);
    setError('');
    try {
      const imported = await api<ImportResult>('/events/archives/confirm', {
        method: 'POST',
        body: { archive, packageHash: preview.packageHash },
      });
      setResult(imported);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Portable event archive">
      <h2>Portable event archive</h2>
      {eventId && (
        <p>
          <button type="button" disabled={busy} onClick={() => void download()}>
            Download event archive
          </button>
        </p>
      )}
      <p>
        Import always creates a new private draft event. Source accounts become
        unclaimed placeholders, ballots become aggregate totals, and webhooks
        remain disabled.
      </p>
      <label>
        Select archive JSON
        <input
          type="file"
          accept=".json,application/json"
          onChange={(event) => void select(event.target.files?.[0])}
        />
      </label>
      {fileName && <p>Selected: {fileName}</p>}
      <p>
        <button
          type="button"
          disabled={busy || !archive}
          onClick={() => void dryRun()}
        >
          Validate and preview
        </button>
      </p>
      {preview && (
        <div aria-label="Archive preview">
          <h3>Import preview</h3>
          <p>
            Package hash: <code>{preview.packageHash}</code>
          </p>
          <p>
            Source instance: <code>{preview.source.instanceId}</code>
          </p>
          <p>
            Source event: <code>{preview.source.eventId}</code>
          </p>
          <h4>Entity counts</h4>
          <ul>
            {Object.entries(preview.counts)
              .filter(([, count]) => count > 0)
              .map(([name, count]) => (
                <li key={name}>
                  {name}: {count}
                </li>
              ))}
          </ul>
          <p>
            {preview.identityMappings.length} source identities will become
            deactivated, unclaimed placeholders.
          </p>
          <details>
            <summary>Identity and ID remapping plan</summary>
            <pre>
              {JSON.stringify(
                {
                  identities: preview.identityMappings,
                  ids: preview.idRemapping,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <h4>Warnings and privacy consequences</h4>
          <ul>
            {[...preview.warnings, ...preview.privacyConsequences].map(
              (warning) => (
                <li key={warning}>{warning}</li>
              ),
            )}
          </ul>
          {preview.validationErrors.length > 0 && (
            <ul role="alert">
              {preview.validationErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed this exact package hash and want to create a new event.
          </label>
          <p>
            <button
              type="button"
              disabled={busy || !confirmed}
              onClick={() => void importArchive()}
            >
              Confirm import
            </button>
          </p>
        </div>
      )}
      {result && (
        <p role="status">
          {result.status === 'ALREADY_IMPORTED'
            ? 'This exact package was already imported.'
            : 'Event imported.'}{' '}
          <a href={`/events/${result.eventId}/manage`}>
            Open destination event
          </a>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
