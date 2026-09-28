import {
  canonicalizePayload,
  signCanonicalPayload,
  signingKeyFromSeed,
  verifyCanonicalPayload,
} from '../src/modules/judge-records/judge-records.crypto';

const firstSeed =
  '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
const secondSeed =
  'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

describe('T4B Ed25519 judge records', () => {
  it('canonicalizes the same flat logical payload deterministically', () => {
    const left = canonicalizePayload({ z: 'last', count: 2, first: 'a' });
    const right = canonicalizePayload({ first: 'a', z: 'last', count: 2 });
    expect(left).toBe('{"count":2,"first":"a","z":"last"}');
    expect(left).toBe(right);
  });

  it('verifies correct signatures and rejects payload tampering or another key', () => {
    const key = signingKeyFromSeed(firstSeed);
    const otherKey = signingKeyFromSeed(secondSeed);
    const payload = canonicalizePayload({
      schemaVersion: 1,
      recordId: 'a-record',
      assignmentCount: 4,
      evaluationCount: 3,
    });
    const signature = signCanonicalPayload(payload, key.privateKey);
    expect(verifyCanonicalPayload(payload, signature, key.publicKeyPem)).toBe(
      true,
    );
    expect(
      verifyCanonicalPayload(
        canonicalizePayload({
          schemaVersion: 1,
          recordId: 'a-record',
          assignmentCount: 5,
          evaluationCount: 3,
        }),
        signature,
        key.publicKeyPem,
      ),
    ).toBe(false);
    expect(
      verifyCanonicalPayload(payload, signature, otherKey.publicKeyPem),
    ).toBe(false);
  });

  it('matches the independently documented Compose demo-key fingerprint', () => {
    const key = signingKeyFromSeed(
      '02940e92f45afb8024a031d0b91d0587c6191102468df2eb65a9f27d41e785e6',
    );
    expect(key.fingerprint).toBe(
      '5f21e7af60c437239783231e6656a86f482399ca91e309be3b02f90e14e58830',
    );
    expect(key.keyId).toBe(`ed25519-sha256:${key.fingerprint}`);
  });

  it('rejects nested values and non-integer numeric values from signed payloads', () => {
    expect(() => canonicalizePayload({ nested: { value: true } })).toThrow(
      'Signed payload values must be flat canonical JSON values.',
    );
    expect(() => canonicalizePayload({ score: 0.5 })).toThrow(
      'Signed payload values must be flat canonical JSON values.',
    );
  });
});
