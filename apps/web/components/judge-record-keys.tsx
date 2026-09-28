'use client';

import { useEffect, useState } from 'react';
import { api, message } from '../lib/client';

type KeySet = {
  scheme: string;
  fingerprintAlgorithm: string;
  activeKeyId: string;
  keys: Array<{
    id: string;
    fingerprint: string;
    publicKeyPem: string;
    createdAt: string;
    retiredAt: string | null;
    active: boolean;
  }>;
  rotations: Array<{
    previousKeyId: string;
    activeKeyId: string;
    previousFingerprint: string;
    activeFingerprint: string;
    rotatedAt: string;
  }>;
};

export function JudgeRecordKeys() {
  const [keys, setKeys] = useState<KeySet | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<KeySet>('/judge-records/keys').then(setKeys, (reason) =>
      setError(message(reason)),
    );
  }, []);
  return (
    <main>
      <h1>Judge record signing keys</h1>
      {error && <p role="alert">{error}</p>}
      {!keys && !error && <p>Loading published keys…</p>}
      {keys && (
        <>
          <p>
            {keys.scheme} · {keys.fingerprintAlgorithm}
          </p>
          <p>
            The live endpoint is not an independent trust anchor. Compare the
            active fingerprint with the value published in the repository’s
            JUDGE-RECORD-KEYS.md and with fingerprints previously recorded for
            this installation.
          </p>
          <ul>
            {keys.keys.map((key) => (
              <li key={key.id}>
                <h2>{key.active ? 'Active' : 'Retired'} key</h2>
                <p>
                  Key ID: <code>{key.id}</code>
                </p>
                <p>
                  Fingerprint: <code>{key.fingerprint}</code>
                </p>
                <p>Published: {new Date(key.createdAt).toISOString()}</p>
                {key.retiredAt && (
                  <p>Retired: {new Date(key.retiredAt).toISOString()}</p>
                )}
                <pre>
                  <code>{key.publicKeyPem}</code>
                </pre>
              </li>
            ))}
          </ul>
          <section aria-label="Signing key rotations">
            <h2>Rotation history</h2>
            {keys.rotations.length ? (
              <ul>
                {keys.rotations.map((rotation) => (
                  <li
                    key={`${rotation.previousKeyId}:${rotation.activeKeyId}:${rotation.rotatedAt}`}
                  >
                    {new Date(rotation.rotatedAt).toISOString()}:{' '}
                    {rotation.previousKeyId} ({rotation.previousFingerprint}) →{' '}
                    {rotation.activeKeyId} ({rotation.activeFingerprint})
                  </li>
                ))}
              </ul>
            ) : (
              <p>No rotations recorded.</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
