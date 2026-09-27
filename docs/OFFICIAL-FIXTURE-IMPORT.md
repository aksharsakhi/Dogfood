# Official DOGFOOD 2026 fixture import

Run `npm run db:import:official` against a migrated PostgreSQL database with
`DATABASE_URL` configured. This is separate from `prisma/seed.ts` and works on
both a clean database and one containing the development seed. It reads the
root `fixtures.json` and imports in one transaction. A rerun checks existing
fixture rows and creates only missing rows; it does not update immutable
submissions, published rubrics/runs/assignments, or submitted evaluations.
Conflicting existing fixture identities fail the import rather than overwrite
data. The command verifies source-to-database identities, references, counts,
score values/comments, and the exact event deadline after commit.

IDs are deterministic UUIDs made from the SHA-256 digest of
`dogfood-2026-official-fixture:<entity-kind>:<fixture-ID>`, with UUID version
and variant bits set. Users use normalized email as their source identity;
membership, team-member, and score identities include their full composite
fixture key. Slugs use fixture IDs, not names or titles. Thus the two distinct
`Dry Harbour` records (`prj_07` and `prj_41`) remain two projects even though
they share a title and team.

The fixture has no organizer, passwords, membership dates, rubric weights or
score timestamps. The importer creates a synthetic organizer at
`fixture-organizer@dogfood.invalid` as the required event actor. Every new
account gets an unshared random password hash, with no known login password.
The importer creates four acceptance-only sessions and prints usable `Cookie:
dogfood_session=<token>` headers for organizer, judge_a, judge_b, and
participant. The identities are the synthetic organizer, `jdg_02` (Wei
Lindqvist), `jdg_16` (Nadia Rahman), and `priya1@example.org`. Both judges
have submitted evaluations, including shared projects. Tokens are stable
SHA-256-derived, 43-character base64url values scoped to the fixture role;
the database stores only their SHA-256 hashes. Session IDs are deterministic.
Sessions expire seven days after the initial import; rerunning the explicit
import command renews expired or revoked acceptance sessions without creating
duplicates. These known tokens are fixture credentials, unsafe for a public
deployment. Keep importer output and tokens private. Normal login still uses
random session tokens. Run `npm run test:official:acceptance` against an
isolated `official_clean`, `official_seeded`, or `official_acceptance_test`
database to verify the headers through `/auth/me` and repeat-import stability.
The first member listed for each team is its owner. The
earliest project submission time supplies missing creation/join times. The
fixture close time supplies snapshot lock, assignment publication, and score
submission times; each snapshot's `submittedAt` is preserved exactly from
`submitted_at`. The event is `PUBLISHED`, public, and has a public gallery.
Participant registrations are approved, teams/projects are active, and
submissions are locked. The fixture's judge track declarations become
expertise rows at the neutral level 3; unspecified judge capacity remains
unlimited. The three actual criterion keys receive weights
`0.333333333`, `0.333333333`, `0.333333334` and a 0–5 allowed score range.
The published assignment run records the minimum observed reviews per
project (2); individual fixture judge/project pairs remain authoritative.
Empty fixture comments are preserved as empty strings.

This command does not write `.dogfood.toml` or run the acceptance checker.
