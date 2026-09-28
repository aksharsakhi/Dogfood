# Judge-record signing key trust anchor

This repository's initial local/demo Ed25519 judge-record key has the following independently published public fingerprint:

```text
SHA-256(raw Ed25519 public key): 5f21e7af60c437239783231e6656a86f482399ca91e309be3b02f90e14e58830
Key ID: ed25519-sha256:5f21e7af60c437239783231e6656a86f482399ca91e309be3b02f90e14e58830
```

This fingerprint corresponds to the documented Compose local/demo seed. That seed is intentionally public and MUST NOT be used for production. Production operators must provide a separately generated, independently protected `JUDGE_RECORD_SIGNING_KEY_SEED` and publish its fingerprint through a version-controlled or otherwise independent channel before relying on its signatures.

The anonymous `/judge-records/keys` endpoint serves the current and historical public keys. A signature that verifies with a key returned by the same server proves internal consistency with that key; it does not independently prove which installation controls the key. Compare the served fingerprint with this repository record and with fingerprints previously observed for the installation.

On key rotation, the API retires the former public key and records an append-only rotation containing both key IDs and fingerprints. Existing records retain their original key ID and remain verifiable. Operators must independently publish the new key fingerprint as part of the rotation process.
