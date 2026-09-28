'use client';

import { useEffect, useState } from 'react';
import { api, message } from '../lib/client';

type Verification = {
  signatureValid: boolean;
  status: 'ACTIVE' | 'SUPERSEDED' | 'REVOKED';
  payload: Record<string, string | number>;
  signature: string;
  publicKey: { keyId: string; fingerprint: string; publicKeyPem: string };
  supersededByRecordId: string | null;
  revocation: {
    payload: Record<string, string | number>;
    signature: string;
    signatureValid: boolean;
  } | null;
};

export function JudgeRecordVerifier({ recordId }: { recordId: string }) {
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<Verification>(`/judge-records/${recordId}/verify`).then(
      setResult,
      (reason) => setError(message(reason)),
    );
  }, [recordId]);

  return (
    <main>
      <h1>Judge record verification</h1>
      {error && <p role="alert">{error}</p>}
      {!result && !error && <p>Checking the signed record…</p>}
      {result && (
        <>
          <p>
            Signature math:{' '}
            <strong>{result.signatureValid ? 'valid' : 'invalid'}</strong> ·
            Record status: <strong>{result.status.toLowerCase()}</strong>
          </p>
          {result.supersededByRecordId && (
            <p>Superseded by record {result.supersededByRecordId}.</p>
          )}
          {result.revocation && (
            <p>
              Revocation statement signature:{' '}
              {result.revocation.signatureValid ? 'valid' : 'invalid'}.
            </p>
          )}
          <section aria-label="Signed claims">
            <h2>Signed claims</h2>
            <dl>
              {Object.entries(result.payload).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>
                    <code>{String(value)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-label="Published verification key">
            <h2>Verification key</h2>
            <p>
              Key ID: <code>{result.publicKey.keyId}</code>
            </p>
            <p>
              SHA-256 fingerprint: <code>{result.publicKey.fingerprint}</code>
            </p>
            <p>
              <a href="/judge-records/keys">
                View published keys and rotation history
              </a>
            </p>
            <p>
              A valid signature proves consistency with this public key. Compare
              its fingerprint with the independently published fingerprint in
              the repository and with fingerprints recorded for this issuer.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
