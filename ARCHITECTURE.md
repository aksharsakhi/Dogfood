# Foundation decisions

Dogfood is one NestJS modular monolith, a Next.js App Router frontend, and one PostgreSQL database. npm workspaces share wire contracts and authorization types. Identity, event, participation, project, submission, gallery, and judging APIs live in `apps/api/src/modules`.

## Identity and authorization

A User has no event role. EventMembership is unique by `(eventId, userId, role)`, intentionally permitting multiple roles within an event. PlatformRole currently supports ADMIN. Session stores unique token hashes, expiry, revocation, optional hashed IP, and user agent. Phase 2 provides normalized-email registration/login, random scrypt salts, hashed session tokens and HttpOnly SameSite=Lax cookies. Active status, expiry and revocation are checked on authenticated requests. Browser mutation requests are limited to the configured web origin.

Contextual policies combine active event membership and team ownership. ADMIN bypasses event organizer checks as an explicit platform policy. Never trust a request-supplied role. Submission snapshots and judging evaluation workspaces enforce strict role and assignment isolation.

## Community voting boundary (T3)

The API owns identity resolution, window and project eligibility, rate limits, vote insertion, result visibility, moderation, and audit records. The Next.js UI presents those decisions. OPEN issues a signed, HttpOnly, event-scoped browser credential; the database stores only its random token hash. EMAIL_GATED keys an identity by a keyed hash of the submitted normalized email string and does not verify inbox ownership. AUTHENTICATED reuses the active T1 session. A composite foreign key from `VotingIdentity(eventId, mode)` to `Event(id, votingAccessMode)` prevents changing mode after an identity exists, including a race at first creation. The organizer config read reports the lock without creating an identity.

Vote casting locks the event and project, checks the server-clock interval `[votingOpensAt, votingClosesAt)`, current event mode and eligible submitted snapshot, and writes one `CommunityVote` with an audit record transactionally. The `(eventId, identityId)` unique key resolves concurrent duplicates. AUTHENTICATED mode also rejects a project whose team includes that account. OPEN and EMAIL_GATED cannot reliably determine the person and cannot reliably prevent self-voting. The API denies public results before close while organizers can read live tallies. A keyed per-identity permutation orders ballots without counts. Visible comments are cursor-paged by `(createdAt, id)`; hiding is organizer-only and audited. Durable `PublicWriteBucket` counters limit writes across API processes, while shared request fingerprints produce organizer-only review flags, never automatic vote rejection. `VotingEmailChallenge` remains unused.

The web proxy forwards the event-scoped OPEN cookie with a `/api/events/.../voting` browser path and the API retry header. In production, cookie `Secure` requires HTTPS at the user-facing origin. `VOTING_TOKEN_SECRET` is required at API boot; Compose supplies a stable, publicly known local/offline demo default only. Production needs an independent secret. Changing it invalidates OPEN credentials and changes EMAIL_GATED identity hashes.

## Relational boundaries

All 45 models are in `prisma/schema.prisma`. UUIDs identify entities; natural join keys identify PlatformRole and JudgeExpertise. Decimal fields store scores, weights and money. Dates use PostgreSQL timestamptz; the event timezone is an IANA name that future event DTOs must validate. JSONB is limited to flexible registration metadata, score-run parameters, audit snapshots, and versioned webhook payloads.

EventMembership supports multiple event roles. TeamMember carries eventId solely to enforce the partial unique index on `(eventId,userId) WHERE leftAt IS NULL`. Its composite FK guarantees that eventId matches Team. A departed member retains their row; rejoining the same team updates that membership. Full membership interval history belongs in audit events later.

Default deletion is RESTRICT to preserve history; only ephemeral sessions and global-role links cascade with a user. Deactivate users and archive events instead of deleting historical records. Audit actor/event references are retained with RESTRICT. There is no automatic destructive purge.

## SQL beyond Prisma

The second and third migrations contain required PostgreSQL checks, a case-insensitive email index, the active-team partial index, stable-parent-key triggers, cross-event validation triggers, and snapshot guards. These are authoritative and must remain in migrations; do not replace migration deployment with `prisma db push`. Stable parent identities/event links prevent later reparenting from invalidating dependent rows. Test changes with `npm run test:db` against a seeded development database.

Database checks enforce positive versions/ranks, score bounds, expertise 1–5, valid team sizes and date windows, invitation recipients, paired prize money/currency, and required lifecycle timestamps. JudgeProfile requires JUDGE membership. Cross-event checks cover projects, prizes, expertise, conflicts, assignments, evaluations, score aggregates, and results.

Project is editable context. Submission is a versioned snapshot. Phase 3 serializes version creation and submission with team and project row locks, and checks the configured submission window through the shared Clock. The current submitted version is the highest submitted/locked version; a later draft never replaces it. Public gallery rows use only the latest submitted snapshot from public or unlisted events. Assignments reference exact submitted/locked submission IDs. Evaluations require a published rubric. AuditEvent rows are append-only. Once a submission leaves DRAFT its content cannot change or be deleted. Submitted/locked evaluations and their raw criterion scores are protected; score writes lock the parent evaluation to serialize against finalization. Published rubric content and criteria are protected; criterion writes lock the parent rubric.

## Judging, scoring, and results pipeline (Phase 4A & 4B)

Phase 4A provides judge onboarding with single-use hashed tokens, track expertise, declared conflict checks, versioned rubrics with exact decimal weights summing to 1.0, proposal-based algorithmic allocation (constrained greedy with bipartite max-flow fallback), transactional assignment publishing, and isolated judge evaluation workspaces.

Phase 4B implements the scoring, normalization, competition results, and CSV export pipeline:

- **ScoreRun & Normalization**: Scoring runs are immutable batch records (`ScoreRunStatus` CREATING -> COMPLETED/FAILED) bound to exactly one published rubric version. Normalization employs `Z_SCORE_V1`, calculating population mean $\mu$ and population standard deviation $\sigma$ ($N$ denominator) per judge. When $\sigma = 0$ (including $n = 1$ and identical score sets), normalized scores default to $0.00000000$ with diagnostic `INSUFFICIENT_VARIATION`. Normalized scores are preserved directly in standard deviations ($z$) without arbitrary rescaling. Raw evidence (`Evaluation`, `EvaluationScore`) remains untouched.
- **Idempotency & Staleness**: ScoreRuns are deduplicated by `(eventId, method, methodVersion, inputSetHash)`. Staleness is derived dynamically on read by comparing stored `inputEvaluationIds` against current eligible submitted evaluations matching the rubric.
- **ResultRun & Competition Ranking**: An organizer explicitly creates a `ResultRun` bound to a specific completed `ScoreRun` (NOT NULL FK). Undercoverage is blocked by default; an explicit confirmed override requires a non-empty reason and persists affected project snapshots and audit logs. Normalized aggregate scores are canonicalized to 6 decimal places (`ROUND_HALF_UP`) using Decimal arithmetic. Ranks use standard competition ranking (1, 1, 3); stable project IDs order tied rows for display but never break ties.
- **CSV Exports & Formula Injection Defense**: 7 standardized CSV exports (`judges`, `assignments`, `progress`, `raw-evaluations`, `normalized-scores`, `project-scores`, `results`) provide RFC 4180 escaping and formula injection defense (prefixing user text starting with `=`, `+`, `-`, `@`, `\t`, `\r` with `'`), while preserving legitimate negative numeric scores. Exports are contextually authorized (organizers event-wide, judges own evaluations only) and audited with `CSV_EXPORTED`.
- **Database Immutability**: Dedicated PostgreSQL triggers enforce immutability on `ScoreRun`, `JudgeScoreStats`, `NormalizedScore`, `ProjectScore`, `ResultRun`, and `ProjectResult`. Parent-child event matching is enforced by database triggers.

## API conventions

Success responses are typed resource JSON (no redundant envelope). Errors are `{code,message,details,requestId}`. The global filter sanitizes unexpected errors; request IDs are generated server-side and returned as `x-request-id`. Global DTO validation rejects unknown properties. Browser CORS uses one configured origin with credentials enabled for future sessions. Logging intentionally omits request payloads and tokens.

`GET /health` is liveness and needs no database. `GET /ready` queries PostgreSQL with a two-second response deadline; failed readiness returns 503. Prisma connections are lazy, so database failure does not prevent liveness. Set PostgreSQL connection/pool timeouts in DATABASE_URL for deployment-specific bounds; the response deadline does not cancel the underlying query. Swagger lives at `/docs`, JSON at `/docs-json`.

## REST mutation webhooks (T4A)

Webhook scope is meaningful server-side/domain mutations exposed through the
product REST API. Navigation, filters, searches, pagination, ordinary reads,
and local-only UI state are excluded. Authentication lifecycle operations
(register, login, logout) are also excluded by deliberate policy
interpretation; this exclusion is not wording directly guaranteed by the T4
specification. Mutations and compact versioned outbox events commit atomically.
Delivery is asynchronous, durable in PostgreSQL, at-least-once, finite-retry,
and does not alter committed domain state when a receiver fails.

Organizer webhook REST routes use the existing session-cookie authorization;
this initial REST API does not introduce API keys, bearer tokens, PATs, OAuth,
or other machine credentials. Subscription secrets are independently random,
encrypted at rest with `WEBHOOK_ENCRYPTION_KEY`, and revealed only at creation.
Payloads omit credentials and private T3 abuse fingerprints. Public HTTPS
destinations are DNS-checked when configured and before each send, pinned to the
validated address, and never followed through redirects. Loopback, link-local,
private, localhost/local/internal, reserved, multicast, and metadata targets
are rejected. LAN-only integrations are intentionally unsupported in T4A.
Consumers must deduplicate stable delivery IDs; replay reuses the original ID,
and event types have no global ordering guarantee. See `WEBHOOKS.md` for the
payload and signature contract.

## Dependencies and deployment

Node 22+, Next.js 16, NestJS 11 and Prisma 6 are pinned by the npm lockfile. Prisma 6 deliberately keeps the mature schema/client migration workflow; upgrading majors is a separate change. Docker uses Debian images with OpenSSL, a non-root application user, persistent PostgreSQL 16 storage, automatic migrations and official fixture import before API startup, readiness-based service ordering, and full self-hosted offline operation. Images retain workspace tooling to allow migrations and explicit development seeding; pruning production images can follow once CI verifies all runtime assets. Development secrets in `.env.example` are public defaults only.
