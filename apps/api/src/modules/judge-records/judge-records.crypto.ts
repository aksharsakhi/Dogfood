import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';

const ED25519_PKCS8_SEED_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);

export interface JudgeRecordPayload {
  schemaVersion: 1;
  recordId: string;
  eventId: string;
  subjectId: string;
  assignmentCount: number;
  evaluationCount: number;
  issuedAt: string;
  issuerKeyId: string;
  supersedesRecordId?: string;
}

export interface JudgeRecordRevocationPayload {
  schemaVersion: 1;
  statementType: 'judge-record-revocation';
  recordId: string;
  revokedAt: string;
  issuerKeyId: string;
}

export interface SigningKeyMaterial {
  keyId: string;
  fingerprint: string;
  publicKeyPem: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function signingKeyFromSeed(seedHex: string): SigningKeyMaterial {
  if (!/^(?!0{64}$)[a-fA-F0-9]{64}$/.test(seedHex))
    throw new Error(
      'JUDGE_RECORD_SIGNING_KEY_SEED must be an independently generated 32-byte hex seed (64 hex characters).',
    );
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      ED25519_PKCS8_SEED_PREFIX,
      Buffer.from(seedHex, 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  const fingerprint = createHash('sha256').update(rawPublicKey).digest('hex');
  return {
    keyId: `ed25519-sha256:${fingerprint}`,
    fingerprint,
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    privateKey,
    publicKey,
  };
}

/**
 * Canonical form for these deliberately flat, fixed-shape payloads: sort ASCII
 * property names in ascending code-unit order, then JSON.stringify the object.
 * Values are strings, booleans, null, or safe integers; no nested values or
 * floating-point numbers are accepted. UTF-8 bytes of this exact string sign.
 */
export function canonicalizePayload(payload: object): string {
  const entries = Object.entries(payload).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [, value] of entries) {
    if (
      value !== null &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isSafeInteger(value))
    )
      throw new Error(
        'Signed payload values must be flat canonical JSON values.',
      );
  }
  return JSON.stringify(Object.fromEntries(entries));
}

export function signCanonicalPayload(
  canonicalPayload: string,
  privateKey: KeyObject,
): string {
  return sign(null, Buffer.from(canonicalPayload, 'utf8'), privateKey).toString(
    'base64url',
  );
}

export function verifyCanonicalPayload(
  canonicalPayload: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const parsed: unknown = JSON.parse(canonicalPayload);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
      return false;
    const normalized = canonicalizePayload(parsed);
    if (normalized !== canonicalPayload) return false;
    return verify(
      null,
      Buffer.from(canonicalPayload, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}
