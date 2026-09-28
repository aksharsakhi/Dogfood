# Verification history

The Phase 1–3 notes below describe their original execution environment, not the current Docker status. Prior T4D verification completed fresh no-`.env` Docker Compose boots with PostgreSQL 16, API and web healthy, 14 migrations applied, official fixture bootstrap, and 7/7 canonical acceptance checks. The T4 final local checkpoint repeats the non-Docker test suites, official fixture acceptance, config/security suites, and 7/7 canonical acceptance checks locally; Docker cold-boot verification is reserved for human verification.

## Phase 1 verification

## Phase 3 verification (2026-09-23)

- `npm run test:phase3`: 13 integration tests passed against an isolated test database. They cover project ownership and IDOR, draft/submitted history, exact deadline boundaries, departed members, concurrent version creation/submission, a submission waiting on a lock until closing, and public gallery filtering/privacy.
- Phase 1 regressions: 5 API tests and 15 database invariant checks passed. Phase 2 regressions: 23 integration tests passed.
- `npm run test:e2e`: 3 Playwright tests passed with one worker, including the complete submission/version/gallery browser flow.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, `npx prisma validate`, and `npm audit` passed; audit reported zero vulnerabilities.
- Phase 3 required no Prisma schema change or migration. Docker runtime was unavailable during this historical Phase 3 run; later verification is recorded above.

## Phase 2 verification (2026-09-23)

- `npm run test:phase2`: 23 integration tests passed against an isolated `dogfood_phase2_test` database, including session expiry/suspension, origin rejection, event-role boundaries, registration windows, invitation recipient/expiry/replay checks, owner behavior, and concurrent acceptance for the last team slot.
- `npm test`: 5 API tests passed.
- `npm run test:db`: 15 Phase 1 database invariant checks passed against the configured seeded database.
- `npm run test:e2e`: 2 Playwright tests passed, including registration/login, event browse/register, team creation/invitation acceptance, and organizer event configuration/publishing/registration listing.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `npx prisma validate` passed. `npm audit` reported zero vulnerabilities.
- No Prisma schema or migration changes were needed for Phase 2.
- Docker was unavailable during this historical Phase 2 run (`docker: command not found`); later verification is recorded above.

Implementation environment: macOS arm64, Node 24.10.0, npm 11.6.0, PostgreSQL 15.18. An isolated local database listens at `127.0.0.1:55432`; `.env` points to it. Committed examples use PostgreSQL port 5432 and Docker uses PostgreSQL 16.

## Executed checks

- Clean lockfile installation with `npm ci`; patched transitive dependencies resolved with explicit overrides. Final `npm audit --audit-level=low`: zero reported vulnerabilities.
- Prisma schema formatting/validation and client generation.
- Three committed migrations applied successfully to the isolated PostgreSQL database.
- Development seed executed repeatedly without duplicate fixtures.
- Strict TypeScript checks for both apps, shared packages, seed and tests.
- ESLint and Prettier checks.
- Five Jest/Supertest API tests: independent liveness, database readiness, sanitized database failure, consistent 404 errors and OpenAPI generation.
- Fifteen transaction-isolated database checks: active team uniqueness, team/event consistency, judge membership, frozen submissions, version uniqueness, cross-event project/assignment rejection, published rubric protection, draft input rejection, append-only auditing, score bounds, immutable raw scores, and legal team departure/multiple roles.
- Production builds for NestJS and Next.js.
- Built services: HTTP 200 from web, `/health`, `/ready`, `/docs` and `/docs-json`; readiness confirms a live PostgreSQL query.
- Chromium Playwright smoke test: rendered application heading and API status.

## Limitations and resolved failures

During the original Phase 1 run Docker was unavailable (`docker: command not found`), so that run had no container or PostgreSQL 16 result. Later T4D verification completed fresh Compose boots as noted above.

The sandbox initially blocked registry DNS, PostgreSQL shared memory, and local HTTP binding. Authorized runs outside the sandbox enabled installation and runtime tests. Initial lint/dependency issues were fixed. Jest transforms the ESM `content-disposition` dependency used by Fastify static; production uses Node's native loading. The NestJS 12 experiment was reverted to the tested NestJS 11 configuration. These were implementation-time failures, not outstanding failing checks.

Dependency versions are locked. The `deepmerge-ts` override addresses a Prisma configuration dependency advisory; the nested Fastify override selects the patched release without requiring the NestJS 12 ESM migration. Keep both overrides until upstream dependencies include the fixes, and rerun installation, migration and HTTP checks when removing them.

`npm ls fastify` on npm 11.6.0 reports ELSPROBLEMS because NestJS declares Fastify 5.11.3 while the security override intentionally installs 5.12.5. The committed lockfile installs successfully with `npm ci`; runtime tests and the security audit pass with 5.12.5. This dependency-tree diagnostic remains a known tooling limitation until the upstream pin or npm override reporting is updated.
