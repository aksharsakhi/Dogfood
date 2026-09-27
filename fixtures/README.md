# Development fixtures

The deterministic fixture implementation is `prisma/seed.ts`. It creates fixed UUIDs and timestamps in one transaction, with non-destructive upserts. Reruns preserve existing records; use `npm run db:reset` only on a disposable development database to restore pristine fixtures. The rubric starts in DRAFT so it can be populated without bypassing immutability guards.

Accounts: `admin`, `organizer`, `participant1`, `participant2`, `participant3`, `judge1`, `judge2`, all at `@dogfood.local`. Password: `Dogfood-dev-only!`. Seed password hashes use scrypt with a fixed development-only salt for deterministic fixtures; account registration uses per-password random salts. Production-mode seeding is rejected. The application provides its own login and server-managed session workflow without an external authentication service.
