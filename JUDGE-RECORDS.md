# Judge participation records and certificates

DogFood offers printable HTML records for event registration, team/project participation from a stored team membership and submitted snapshot, and signed judge participation counts. DogFood does not generate PDF files; use the browser's Print / Save as PDF action. These records do not certify physical attendance, winner status, placement, ranking, or verified real-world identity.

## Signed judge record

Only these claims are signed: event ID, event-specific pseudonymous subject ID, assignment count, submitted-evaluation count, issuance timestamp, schema version, record ID, issuer key ID, and an optional superseded record ID. Scores, review text, rubric details, project names, display names, email addresses, and community-voting data are excluded. Issuance persists an immutable record; corrections append a new signed record that references the prior ID. Revocation appends a separate signed statement. Verification reports mathematical signature validity separately from `ACTIVE`, `SUPERSEDED`, or `REVOKED` status.

The canonical payload is a flat JSON object. Property names are sorted in ascending ASCII/code-unit order, then serialized with JavaScript `JSON.stringify`; values must be strings, booleans, null, or safe integers. The UTF-8 bytes of that exact serialized JSON are signed with Ed25519. The verification response and printable record include the exact canonical JSON, signature, key ID, and public key so an issued record can be checked offline with Node's built-in `crypto` module:

```js
const { createPublicKey, verify } = require('node:crypto');
const payload = Buffer.from(canonicalPayload, 'utf8');
const valid = verify(
  null,
  payload,
  createPublicKey(publicKeyPem),
  Buffer.from(signature, 'base64url'),
);
```

Offline cryptographic verification establishes only that the payload matches the signature under the supplied public key. To establish trust in that key, compare its SHA-256 fingerprint with the independent publication in [JUDGE-RECORD-KEYS.md](./JUDGE-RECORD-KEYS.md) and with previously observed fingerprints. A live key endpoint alone is not an independent trust anchor.

`JUDGE_RECORD_SIGNING_KEY_SEED` is an independently generated 32-byte Ed25519 seed encoded as 64 hex characters. Generate a production value with `openssl rand -hex 32`; keep it stable across restarts and outside the database, never reuse `DATABASE_URL`, `VOTING_TOKEN_SECRET`, or `WEBHOOK_ENCRYPTION_KEY`. The API fails during startup if it is missing or malformed. Compose's stable seed is for local/demo use only; production must override it with a strong secret and publish its fingerprint independently. Rotation retains historical public keys and signed rotation records so older signatures remain verifiable.
