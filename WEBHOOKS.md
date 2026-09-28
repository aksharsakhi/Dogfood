# Webhook operations

T4A emits version 1 webhooks for meaningful server-side domain mutations made
through the REST API. Reads, navigation, filtering, pagination, and local-only
UI state do not emit webhooks. Authentication lifecycle operations (register,
login, and logout) are intentionally excluded. This is the product's coverage
policy for this implementation, not a claim that the T4 specification explicitly
exempts those operations.

The logical event and its matching deliveries are stored in PostgreSQL in the
same transaction as the domain mutation. The payload is a compact envelope with
`schemaVersion`, `eventType`, `deliveryId`, `occurredAt`, `eventId`, and relevant
entity/context IDs. Deletion messages include a compact tombstone. Consumers can
fetch current resource details through REST where a resource still exists.
Payloads omit session tokens, passwords, webhook secrets, voting credentials,
private abuse fingerprints, and full entity snapshots.

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
the existing HttpOnly session-cookie REST authorization. This initial REST API
does not add API keys, bearer tokens, PATs, OAuth clients, or other machine
credentials. Failed destinations do not affect committed domain state or API
availability.

PostgreSQL outbox and delivery rows are retained because foreign keys use
RESTRICT and they provide audit history. T4A defines no automatic purge policy;
operators should account for table growth.
