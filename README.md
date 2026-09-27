# Dogfood

An open-source, self-hostable hackathon management, submission, judging, and results platform.

## Verification Status

- **Claimed Tiers:** `T1`, `T2`
- **Verified Tiers:** `T1`, `T2` (7/7 official acceptance checks pass)
- **Scope:**
  - **T1:** Hackathon events, teams, versioned submissions, submission window deadlines, and public project gallery.
  - **T2:** Isolated judge evaluation workspaces, criterion rubrics, peer score blindness, participant blocking, and CSV export.
- **T3 / T4:** Not claimed.

The platform is designed for completely self-hosted, offline operation without third-party cloud dependencies.

## Architecture & Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): Architectural decisions, modular monolith boundaries, API conventions, and system lifecycle.
- [DATA-MODEL.md](DATA-MODEL.md): Complete relational schema, 27 domain entities, constraints, and database triggers.
- [JUDGING.md](JUDGING.md): Judging, scoring pipeline, Z-score normalization (`Z_SCORE_V1`), sigma=0 handling, ScoreRun/ResultRun immutability, undercoverage policy, and CSV export security.
- [docs/OFFICIAL-FIXTURE-IMPORT.md](docs/OFFICIAL-FIXTURE-IMPORT.md): Fixture import semantics, deterministic UUIDs, and acceptance session token generation.

```text
apps/web/             Next.js shell, landing page, judge & organizer workspaces
apps/api/             NestJS/Fastify, identity, events, teams, projects, submissions, gallery, judging, audit
packages/contracts/   Shared REST wire types
packages/shared/      Shared identity/authorization types
prisma/               27 domain models, SQL migrations, deterministic seed, official fixture importer
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

All 7/7 acceptance checks pass. The verified result is committed in [acceptance-report.txt](acceptance-report.txt).

### How Acceptance Fixture Sessions Are Generated

The official fixture importer (`prisma/import-official-fixtures.ts`) deterministically derives session tokens from static fixture identity strings:

$$\text{token} = \text{base64url}(\text{SHA-256}(\text{"dogfood-2026-official-fixture:acceptance-cookie:"} + \text{role}))$$

During automatic Docker startup (or via `npm run db:import:official`), these deterministic session records are upserted into the database for the checker roles: `organizer`, `judge_a`, `judge_b`, and `participant`. The corresponding `Cookie: dogfood_session=...` headers are configured in `.dogfood.toml`. Because session generation is pure and deterministic, the credentials remain identical and reproducible across fresh Docker boots.

## Environment Configuration

`.env.example` contains public development defaults:

| Variable            | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`      | Prisma PostgreSQL connection string                             |
| `API_PORT`          | API listening port (default `4000`)                             |
| `WEB_ORIGIN`        | Allowed browser origin (default `http://localhost:3000`)        |
| `API_INTERNAL_URL`  | Server-side web -> API address (Compose sets `http://api:4000`) |
| `POSTGRES_USER`     | PostgreSQL user (default `dogfood`)                             |
| `POSTGRES_PASSWORD` | PostgreSQL password (default `dogfood_dev`)                     |
| `POSTGRES_DB`       | PostgreSQL database name (default `dogfood`)                    |
| `NODE_ENV`          | Environment mode (`development`, `test`, or `production`)       |

`docker-compose.yml` provides inline dev-safe fallbacks for all environment variables, allowing zero-configuration startup. For custom configurations, copy `.env.example` to `.env` (which is gitignored).

## Local Development (Non-Docker)

To run the application locally without Docker:

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run db:deploy
npm run db:import:official
npm run dev
```

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
