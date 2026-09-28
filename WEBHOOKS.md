# Webhook operations

T4A emits version 1 webhooks for meaningful server-side domain mutations made
through the REST API. Reads, navigation, filtering, pagination, and local-only
UI state do not emit webhooks. Authentication lifecycle operations (register,
login, and logout) are intentionally excluded because they are global identity/session operations rather than event-domain changes and would disclose authentication activity. Webhook subscription administration, delivery, retry, and replay are intentionally excluded to avoid recursive notifications about the transport itself. Archive export and preview, CSV export, certificate reads, and key rotation are read-only or internal operations rather than completed event-domain mutations. This is the product's coverage
policy for this implementation, not a claim that the T4 specification explicitly
exempts those operations.

Public event types (existing subscriptions keep their selected types; `*` continues to match all):

- `event.created`
- `event.updated`
- `event.published`
- `event.embed.config.changed`
- `event.imported`
- `track.created`
- `track.updated`
- `track.deleted`
- `prize.created`
- `prize.updated`
- `prize.deleted`
- `registration.created`
- `registration.withdrawn`
- `team.created`
- `team.updated`
- `team.member.left`
- `team.member.removed`
- `team.disbanded`
- `team.invitation.created`
- `team.invitation.revoked`
- `team.invitation.accepted`
- `team.invitation.rejected`
- `project.created`
- `project.updated`
- `submission.draft.created`
- `submission.draft.updated`
- `submission.submitted`
- `judge.invited`
- `judge.invite.revoked`
- `judge.accepted`
- `judge.profile.updated`
- `judge.conflict.declared`
- `judge.conflict.removed`
- `rubric.created`
- `rubric.updated`
- `rubric.published`
- `assignment.run.created`
- `assignment.run.published`
- `judge.assignment.created`
- `evaluation.draft.saved`
- `evaluation.submitted`
- `scoring.run.created`
- `results.run.created`
- `results.coverage.override`
- `voting.identity.created`
- `voting.config.changed`
- `community.vote.cast`
- `community.vote.flagged`
- `project.comment.posted`
- `project.comment.hidden`
- `judge.participation.record.issued`
- `judge.participation.record.revoked`

The logical event and its matching deliveries are stored in PostgreSQL in the
same transaction as the domain mutation. The payload is a compact envelope with
`schemaVersion`, `eventType`, `deliveryId`, `occurredAt`, `eventId`, and relevant
entity/context IDs. Deletion messages include a compact tombstone. Consumers can
fetch current resource details through REST where a resource still exists.
Payloads omit session tokens, passwords, webhook secrets, signing seeds/private keys, voting credentials, private abuse fingerprints, and full entity snapshots. Judge record events contain public record/revocation IDs and judge-profile ID only; they carry no signature or private signing material. Embed configuration events identify the event but do not reproduce the origin allowlist. A successful archive import emits one `event.imported` outbox event for the newly created destination event, never one event per imported historical row. Preview, failed import, and idempotent reconfirmation emit none. Imported subscriptions are disabled and secretless, so no import delivery is sent to them; source webhook history is never replayed. The destination is new and has no previously active subscriptions, so the completion outbox event initially has no deliveries.

Delivery is at least once. A receiver may see a duplicate, including when the
receiver accepted a message but its response was lost. Consumers must deduplicate
using `deliveryId`. A delivery keeps the same ID across automatic retries and
manual replay. There is no global ordering guarantee across event types.
Automatic delivery allows at most eight attempts per retry cycle, with
exponential delays starting at five seconds, capped at one hour, and up to 20%
jitter. Exhausted deliveries remain visible in organizer history. Manual replay
begins a new retry cycle and retains the same delivery ID and prior attempt
history. Only status and compact error codes are retained; response bodies are
not stored.

Each subscription receives a separate random 256-bit signing secret. The raw
secret is returned only in the create response. PostgreSQL stores AES-256-GCM
ciphertext, nonce, and tag; `WEBHOOK_ENCRYPTION_KEY` is a stable deployment key
independent of all application credentials. Ordinary subscription reads,
delivery history, audit logs, and application logs never return it. Compose
includes a stable, public local/demo value for offline development; production
must replace it with a strong independently generated value and keep it stable
across API restarts.

Each POST includes these headers:

```text
X-DogFood-Delivery: <stable delivery UUID>
X-DogFood-Event: <event type>
X-DogFood-Timestamp: <UTC ISO-8601 timestamp>
X-DogFood-Signature: v1=<lowercase hexadecimal HMAC-SHA256>
```

The signature is computed over the exact UTF-8 request body and metadata:
`HMAC-SHA256(secret, timestamp + "." + deliveryId + "." + eventType + "." +
rawBody)`. Consumers should compare signatures in constant time, validate the
timestamp against their replay window, and use `deliveryId` for idempotency.

Destinations must be HTTPS and resolve only to public unicast addresses. The
API rejects loopback, link-local, private, shared-address, reserved, multicast,
documentation, localhost/local/internal aliases, and known cloud metadata hosts.
Every resolved address is checked both when a URL is saved and immediately
before sending; the sender pins the connection to the checked address and does
not follow redirects. Private-network and LAN-only webhook destinations are
intentionally unsupported in this phase to reduce SSRF risk. A DNS change to a
blocked address causes delivery to fail safely and enter the retry policy.

Webhook management, delivery inspection, and replay are organizer-only and use
the existing HttpOnly session-cookie REST authorization. Webhook subscription
administration currently provides REST routes but no web management UI. This initial
REST API does not add API keys, bearer tokens, PATs, OAuth clients, or other machine
credentials. Failed destinations do not affect committed domain state or API
availability.

PostgreSQL outbox and delivery rows are retained because foreign keys use
RESTRICT and they provide audit history. T4A defines no automatic purge policy;
operators should account for table growth.
