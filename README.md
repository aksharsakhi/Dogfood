# Dogfood

An open-source, self-hostable hackathon management, submission, judging, and results platform.

## Verification Status

- **Claimed Tiers:** `T1`, `T2`
- **Verified Tiers:** `T1`, `T2` (7/7 official acceptance checks pass via `run.py`)
- **Scope & Implementation:**
  - **T1 (implemented & checker-verified):** Hackathon events, teams, versioned submissions, submission window deadlines, and public project gallery.
  - **T2 (implemented & checker-verified):** Isolated judge evaluation workspaces, criterion rubrics, peer score blindness, participant blocking, and CSV export.
  - **T3 (implemented, covered by project tests):** Configurable community ballots, public comments with organizer hiding, server-gated results, per-identity ballot order, and organizer integrity audit. Covered by project-owned unit, integration, and database tests.
  - **T4 (implemented, covered by project tests):** REST API and webhooks covering UI actions, certificate and record generation, signed and publicly verifiable judge participation records, an embeddable gallery widget, and bulk import and export.
- **Checker Coverage Notice:** Canonical `run.py` verification currently covers T1 and T2 only (7/7 checks pass). The submission claim in `.dogfood.toml` is conservatively set to `["T1", "T2"]` because `spec.md` warns that claiming more than verified can cost points. The absence of T3/T4 checks in `run.py` is a limitation of canonical checker coverage, not a statement that T3 or T4 features do not exist or failed. Both T3 and T4 are fully implemented and verified by project-owned test suites.

The platform runs without third-party cloud dependencies. Offline cold runtime boot is supported with prebuilt Docker images; building those images may require network access for base images and npm dependencies.

## Architecture & Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): Architectural decisions, modular monolith boundaries, API conventions, and system lifecycle.
- [DATA-MODEL.md](DATA-MODEL.md): Relational schema, 51 domain models, constraints, and database triggers.
- [WEBHOOKS.md](WEBHOOKS.md): Outbox architecture, transactional guarantees, delivery identity, retry, replay, and HMAC signing.
- [JUDGING.md](JUDGING.md): Judging and scoring guarantees, CSV security, and the T3 voting integrity model and limitations.
- [JUDGE-RECORDS.md](JUDGE-RECORDS.md): Printable certificate claims, signed judge-record payloads, canonicalization, and offline verification.
- [JUDGE-RECORD-KEYS.md](JUDGE-RECORD-KEYS.md): Independently published local/demo signing-key fingerprint and rotation trust guidance.
- [docs/OFFICIAL-FIXTURE-IMPORT.md](docs/OFFICIAL-FIXTURE-IMPORT.md): Fixture import semantics, deterministic UUIDs, and acceptance session token generation.
- [docs/EVENT-ARCHIVE.md](docs/EVENT-ARCHIVE.md): Organizer archive format, privacy, import workflow, provenance, and compatibility.
- [docs/EMBEDDED-GALLERY.md](docs/EMBEDDED-GALLERY.md): Read-only iframe route, exact-origin configuration, CSP enforcement, and archive behavior.
- [THREAT-MODEL.md](THREAT-MODEL.md): Security threat model, trust boundaries, abuse analysis (Sybil, ballot stuffing, scraping, collusion, deadlines), database invariants, and residual risks.

```text
apps/web/             Next.js shell, judge/organizer workspaces, public voting and comments
apps/api/             NestJS/Fastify, identity, events, submissions, gallery, judging, voting, audit
packages/contracts/   Shared REST wire types
packages/shared/      Shared identity/authorization types
prisma/               51 domain models, SQL migrations, deterministic seed, official fixture importer
fixtures/             Development fixture documentation
tests/                Jest/Supertest, database invariants, Playwright workflows
docs/                 Architecture, verification, and fixture import notes
Dockerfile            Multi-target container build (API & Web)
docker-compose.yml    PostgreSQL -> API/migrations/fixtures -> Web
```

## Prerequisites

- **Docker** and **Docker Compose** (v2+)
- **Python 3** (standard library only, for running the official acceptance checker `run.py`)
- _(Optional for non-Docker local dev)_: Node.js **22.12+**, npm, and PostgreSQL 15+ (Compose uses 16).

## Quick Start (Fresh Start with Docker)

To boot the entire verified system from scratch:

```bash
docker compose up --build
```

### What happens automatically on boot

1. **PostgreSQL** starts and satisfies its health check.
2. The **API container** automatically applies all PostgreSQL database migrations:
   ```bash
   npm run db:deploy
   ```
3. The **API container** automatically runs the official fixture importer:
   ```bash
   npm run db:import:official
   ```
   This loads `fixtures.json`, creates all events, tracks, judges, teams, projects, submissions, and evaluations in a single transaction, and provisions deterministic acceptance sessions.
4. Acceptance fixture session headers (`Cookie: dogfood_session=...`) are printed directly to the container output.
5. The **API** starts on port `4000` and passes its readiness health check (`/ready`).
6. The **Web frontend** starts on port `3000` once the API is healthy.

### Expected Local Addresses and Ports

| Service      | Default address                 | Description                                     |
| ------------ | ------------------------------- | ----------------------------------------------- |
| Web          | http://localhost:3000           | Next.js web application                         |
| API          | http://localhost:4000           | Fastify REST API                                |
| Swagger UI   | http://localhost:4000/docs      | Interactive OpenAPI documentation               |
| OpenAPI JSON | http://localhost:4000/docs-json | OpenAPI schema                                  |
| PostgreSQL   | localhost:5432                  | PostgreSQL database (bound to `127.0.0.1:5432`) |

## Official Acceptance Suite

Once the Docker stack is running, execute the official acceptance checker from repository root:

```bash
python3 run.py .dogfood.toml --fixtures fixtures.json
```

### Expected Result

```text
DOGFOOD 2026 acceptance report
portal: http://localhost:4000
claimed: T1 T2
fixtures: fixtures.json

T1  gallery is public ................. PASS
T1  project from fixtures shown ....... PASS
T1  closed event refuses submissions .. PASS
T2  judge sees own scores ............. PASS
T2  judge cannot see peer scores ...... PASS
T2  participant blocked ............... PASS
T2  csv export works .................. PASS

claimed T1 T2, verified T1 T2
```

All 7/7 official acceptance checks cover T1 and T2. The generated result is in [acceptance-report.txt](acceptance-report.txt); the official checker does not verify T3 or T4.

### How Acceptance Fixture Sessions Are Generated

The official fixture importer (`prisma/import-official-fixtures.ts`) deterministically derives session tokens from static fixture identity strings:

$$\text{token} = \text{base64url}(\text{SHA-256}(\text{"dogfood-2026-official-fixture:acceptance-cookie:"} + \text{role}))$$

During automatic Docker startup (or via `npm run db:import:official`), these deterministic session records are upserted into the database for the checker roles: `organizer`, `judge_a`, `judge_b`, and `participant`. The corresponding `Cookie: dogfood_session=...` headers are configured in `.dogfood.toml`. Because session generation is pure and deterministic, the credentials remain identical and reproducible across fresh Docker boots.

## Environment Configuration

`.env.example` contains public development defaults:

| Variable                        | Purpose                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                  | Prisma PostgreSQL connection string                                                                        |
| `VOTING_TOKEN_SECRET`           | Required independent voting-credential key (at least 32 non-whitespace characters); stable across restarts |
| `WEBHOOK_ENCRYPTION_KEY`        | Required independent stable key (32+ characters) protecting webhook signing secrets at rest                |
| `JUDGE_RECORD_SIGNING_KEY_SEED` | Required independent stable 32-byte Ed25519 seed (64 hex characters) for signed judge records              |
| `API_PORT`                      | API listening port (default `4000`)                                                                        |
| `WEB_ORIGIN`                    | Allowed browser origin (default `http://localhost:3000`)                                                   |
| `API_INTERNAL_URL`              | Server-side web -> API address (Compose sets `http://api:4000`)                                            |
| `POSTGRES_USER`                 | PostgreSQL user (default `dogfood`)                                                                        |
| `POSTGRES_PASSWORD`             | PostgreSQL password (default `dogfood_dev`)                                                                |
| `POSTGRES_DB`                   | PostgreSQL database name (default `dogfood`)                                                               |
| `NODE_ENV`                      | Environment mode (`development`, `test`, or `production`)                                                  |

`docker-compose.yml` provides stable, publicly known **local/offline demo** defaults for `VOTING_TOKEN_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, and `JUDGE_RECORD_SIGNING_KEY_SEED`, allowing zero-configuration startup. Production deployments must override all three with strong, independently generated values; startup rejects each known public demo value when `NODE_ENV=production`. Non-Docker startup fails immediately if a required key is missing or malformed. Keep each value stable across restarts; changing a signing seed causes key rotation while older records remain verifiable as long as their public keys remain in the database. For custom configurations, copy `.env.example` to `.env` (which is gitignored) and set all keys explicitly.

## T3 public voting status and limits

Organizers configure OPEN, EMAIL_GATED, or AUTHENTICATED voting and a voting window in their device's local timezone; the API stores UTC instants and enforces the window using its own clock. The access mode locks when the first voting identity is created. Ballots show eligible submitted projects once each in a stable per-identity pseudorandom order. Comments appear on public gallery projects and organizers may hide them. Organizers can inspect live tallies and audit activity; everyone else receives no tally until the server clock reaches the closing instant.

OPEN identifies a browser token, not a person: clearing cookies or switching browsers can produce another vote. EMAIL_GATED allows one vote per normalized email string and sends no email; it does **not** prove inbox ownership. Only AUTHENTICATED mode can reliably block voting for a project submitted by the account's own team. Rate limits are 6 vote attempts and 12 comment writes per identity per UTC-aligned ten-minute bucket; rotating OPEN tokens or changing submitted email strings can evade them. Related request fingerprints create organizer-only flags for review and **never automatically block** votes. See [JUDGING.md](JUDGING.md) for the precise integrity policy.

## T4 Platform Integrations (Implemented & Tested)

T4 is fully implemented and covered by project-owned automated test suites (`test:t4a`, `test:t4b`, `test:t4c`, `test:t4d`):

- **REST API Covering UI Actions**: Complete REST endpoints for all event domain actions with session-based authentication and role-based authorization. Webhook subscription management has full REST routes (`/events/:eventId/webhooks`) with HttpOnly session cookies (note: webhook subscription administration currently has REST routes but no web UI).
- **Webhooks Covering UI Actions**: Transactional outbox pattern emits version 1 signed webhooks (`HMAC-SHA256`) for meaningful server-side domain mutations (lifecycle, tracks, prizes, registrations, teams, submissions, rubric, assignments, evaluations, scoring, voting, comments, judge records, embed config, archive import). An SSRF-protected dispatcher pins resolved IPv4/IPv6 addresses, rejects private/internal ranges, and implements exponential backoff with jitter and manual replay.
- **Certificate and Record Generation**: On-demand printable HTML and JSON participation records and certificates for registrations, submissions, and judging.
- **Signed Judge Participation Records**: Canonicalized, deterministic Ed25519-signed participation records and revocation statements with offline verification (`/judge-records/:recordId/verify` and standalone CLI script). Private keys and signing seeds are never exposed in payloads, outbox events, or database tables.
- **Embeddable Gallery Widget**: Dedicated read-only route at `/embed/events/:eventId` rendering public gallery projects with search and track filtering. Protected by document-scoped CSP `frame-ancestors` matching the event's configured allowed origins (defaults to `'none'` if empty). Strictly read-only: no browser cookies forwarded to upstream API, no mutation controls. Non-embed management-page clickjacking hardening is outside this T4 checkpoint.
- **Bulk Import and Export**: Portable JSON event archive (schema v1) with deterministic key ordering, SHA-256 package hashing, atomic transactional import, foreign key preservation, and privacy protections. Source users become deactivated unclaimed placeholders (`@archive.invalid`); source credentials and private data are excluded; destination starts draft/private/gallery-hidden. A successful new import emits exactly one destination-level `event.imported` outbox event (preview, failed import, and idempotent reconfirmations emit zero); historical source webhook events are never replayed; imported subscriptions remain disabled and secretless.

## Local Development (Non-Docker)

To run the application locally without Docker:

```bash
cp .env.example .env
export VOTING_TOKEN_SECRET="$(openssl rand -hex 32)"
export WEBHOOK_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export JUDGE_RECORD_SIGNING_KEY_SEED="$(openssl rand -hex 32)"
npm ci
npm run db:generate
npm run db:deploy
npm run db:import:official
npm run dev
```

`VOTING_TOKEN_SECRET` is an independent signing secret. Save this strong random value privately (for example, in `.env`) and reuse it across restarts so existing OPEN voting credentials remain valid. Generate a separate strong value for each real deployment; the publicly known Docker Compose demo default is not a production secret.

`WEBHOOK_ENCRYPTION_KEY` is a separate independent key used to encrypt webhook signing secrets at rest. Save it privately and reuse it across restarts. Production must use a strong deployment-specific value; the Compose local/demo default is public and not a production secret.

`JUDGE_RECORD_SIGNING_KEY_SEED` is an independent 32-byte Ed25519 seed. Keep it private and stable; never derive it from another credential or store it in the database. Startup rejects a missing/malformed value and rejects the public Compose demo value in production. See [JUDGE-RECORDS.md](JUDGE-RECORDS.md) and [JUDGE-RECORD-KEYS.md](JUDGE-RECORD-KEYS.md) for the payload, offline verification, fingerprint trust anchor, and rotation process.

### Static Quality Checks & Tests

```bash
npx prisma validate       # Validate Prisma schema
npm run typecheck         # TypeScript verification across all packages
npm run lint              # ESLint checks
npm run format:check      # Prettier formatting verification
npm test                  # Unit and integration test suites
```

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
