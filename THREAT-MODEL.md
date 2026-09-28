# DogFood Security Threat Model

## 1. Executive Summary & Judge Quick Reference

DogFood is an open-source, self-hostable hackathon management, submission, judging, and community voting platform. This document provides a rigorous, repository-grounded threat model analyzing trust boundaries, abuse vectors, cryptographic protections, database invariants, and residual operational risks.

### Quick Reference: Posture on Primary Attack Classes

| Attack Class               | DogFood Posture / Status                 | Primary Defense Mechanisms                                                                                    | Residual Risk / Known Limitations                                                    |
| :------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------- |
| **Sybil Voting**           | **Partially Mitigated** (Mode-Dependent) | Per-identity uniqueness, HMAC voter tokens, `PublicWriteBucket` rate limiting, `AbuseSignal` IP/UA clustering | `OPEN` mode cannot prove 1-person-1-vote; disposable emails can evade `EMAIL_GATED`. |
| **Ballot Stuffing**        | **Mitigated Per Identity**               | DB unique constraint `(eventId, identityId)`, atomic `$transaction` locking, server-authoritative window      | An attacker possessing multiple distinct identities can cast multiple ballots.       |
| **Submission Scraping**    | **Mitigated for Non-Public Data**        | Draft isolation, unlisted/hidden gallery checks, UUIDv4 randomness, organizer-only archive exports            | Public gallery submissions are intentionally accessible to the public by design.     |
| **Judge Collusion**        | **Partially Mitigated / Post-Hoc Audit** | Peer-score blindness, blind assignments, raw score DB triggers, full audit trails                             | Normalization (`Z_SCORE_V1`) **cannot** detect or prevent coordinated score fixing.  |
| **Deadline Gaming**        | **Mitigated Server-Side**                | Authoritative server `Clock` checks, immutable snapshot triggers, state machine validation                    | System relies on server clock / NTP correctness.                                     |
| **Privilege Escalation**   | **Mitigated**                            | Event-scoped authorization guards, PostgreSQL `_event_scope` triggers                                         | Platform Administrator role has system-wide access.                                  |
| **Webhook Forgery / SSRF** | **Mitigated**                            | HMAC-SHA256 signatures, AES-256-GCM encrypted secrets, DNS resolver blocking private/loopback/metadata IPs    | Webhook receivers must validate timestamps to prevent replay attacks.                |
| **Archive Tampering**      | **Mitigated**                            | Schema v1 validation, SHA-256 `packageHash` binding, transactional rollback, placeholder user isolation       | Exported organizer comments may contain confidential internal notes.                 |
| **Judge Record Forgery**   | **Mitigated Cryptographically**          | Ed25519 signature over canonical ASCII-sorted JSON, independent key fingerprint publication                   | Offline verifiers must cross-reference key fingerprints with `JUDGE-RECORD-KEYS.md`. |
| **Cross-Origin Framing**   | **Mitigated**                            | Strict CSP `frame-ancestors 'self' <origins>` (or `'none'`), exact origin validation, stateless public fetch  | Explicitly configured malicious origins would be allowed to frame the widget.        |
| **Demo Secret Reuse**      | **Mitigated in Production**              | `config.ts` SHA-256 hash checks refusing startup in `NODE_ENV=production` if demo defaults are detected       | Developers must generate strong independent secrets for production deployment.       |

---

## 2. System Architecture & Security Objectives

DogFood is implemented as a modular monolith:

- **Core API (`apps/api`)**: NestJS on Fastify, handling identity, access control, events, submissions, judging, community voting, webhooks, archive import/export, and audit logging.
- **Web Interface (`apps/web`)**: Next.js (App Router) shell providing participant, judge, and organizer workflows.
- **Authoritative Database (`prisma`)**: PostgreSQL with 51 domain models, 30+ relational integrity and event-scoping triggers, and row-level immutability enforcement.

### Core Security Objectives

1. **Result Integrity**: Rankings, normalized scores, and judge evaluations must reflect authentic evaluations and remain tamper-evident.
2. **Submission Confidentiality**: Draft projects, unlisted events, and pre-deadline submissions must not leak to competitors or the public.
3. **Judge Privacy & Blindness**: Judges must never see peer evaluations, peer assignments, or normalized intermediate scores before formal organizer publication.
4. **Community Voting Fairness**: Ballot tallies must remain hidden until the voting window closes; duplicate voting per identity must be prevented.
5. **Cryptographic Authenticity**: Outbound webhooks and judge participation certificates must provide mathematical proof of issuance without exposing signing seeds.

---

## 3. Assets & Sensitivity Classification

| Asset                       | Description                                                                   |       Confidentiality        | Integrity | Availability |
| :-------------------------- | :---------------------------------------------------------------------------- | :--------------------------: | :-------: | :----------: |
| **Participant Submissions** | Project metadata, repository URLs, descriptions, demo links.                  | High (Draft) / Low (Public)  | Critical  |     High     |
| **Rubrics & Criteria**      | Scoring criteria, scale bounds (min/max), and percentage weights.             |     Medium (Pre-publish)     | Critical  |     High     |
| **Judge Assignments**       | Mapping of judges to submissions; draft proposals in `AssignmentRunProposal`. |  High (Blind until publish)  | Critical  |    Medium    |
| **Submitted Evaluations**   | Raw scores ($x_{ij}$) and written feedback given by judges.                   |    High (Blind to peers)     | Immutable |     High     |
| **Scoring Runs & Results**  | `ScoreRun`, `NormalizedScore`, `ProjectScore`, `ResultRun` snapshots.         |    High (Organizer-only)     | Immutable |     High     |
| **Community Ballots**       | Individual votes cast by public/authenticated voters.                         |             High             | Immutable |     High     |
| **Pre-Close Tallies**       | Aggregate vote counts prior to `votingClosesAt`.                              |  Critical (Strictly Hidden)  | Critical  |     High     |
| **Webhook Secrets**         | Per-subscription HMAC signing keys.                                           | Critical (Encrypted at rest) | Critical  |     High     |
| **Judge Signing Seed**      | 32-byte Ed25519 seed (`JUDGE_RECORD_SIGNING_KEY_SEED`).                       |  Critical (Memory/Env only)  | Critical  |     High     |
| **Archive Packages**        | Exported JSON files containing full event domain state.                       |             High             | Critical  |    Medium    |
| **Audit Logs**              | Append-only `AuditEvent` records documenting all state mutations.             |             High             | Immutable |     High     |

---

## 4. Threat Actors & Capabilities

| Threat Actor                    | Capabilities & Access                                                                                 | Motivation                                                                           |
| :------------------------------ | :---------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| **Anonymous Web Visitor**       | Unauthenticated HTTP client; can access public gallery, embed iframe, and public voting endpoints.    | Scrape ideas, cast illicit community votes, inspect draft projects.                  |
| **Malicious Participant**       | Authenticated account; registered in an event; belongs to a team.                                     | Tamper with submissions post-deadline, vote for own project, access rival drafts.    |
| **Sybil Attacker**              | Automated client capable of rotating IP addresses, clearing cookies, and generating synthetic emails. | Stuff community voting ballots to manipulate public favorite prizes.                 |
| **Malicious / Colluding Judge** | Authenticated judge assigned to review submissions.                                                   | Coordinate scores with other judges, inflate favored projects, snoop on peer scores. |
| **Compromised Organizer**       | Account holding `ORGANIZER` role for an event.                                                        | Overwrite results, delete audit records, arbitrarily alter deadlines.                |
| **External Webhook Receiver**   | Server receiving HTTP POST deliveries from DogFood webhook worker.                                    | Trigger internal SSRF against cloud metadata or private microservices.               |
| **Possessor of Event Archive**  | Entity holding an exported `dogfood-event-archive` JSON package.                                      | Alter package contents to forge past results, hijack user accounts on import.        |
| **Host / Operator Attacker**    | Access to host filesystem, Docker daemon, or database server.                                         | Steal secrets, alter PostgreSQL tables directly, forge cryptographic records.        |

---

## 5. Trust Boundaries

```
[ Web Browser ]
      |
======|=== Boundary 1: Untrusted Network / Client Clock ==============================
      v
[ Next.js Web Shell (apps/web) ]
      |
======|=== Boundary 2: Session Cookie Authentication (Fastify Guard) =================
      v
[ NestJS Core API (apps/api) ]
      |
======|=== Boundary 3: Domain Authorization & SQL Queries ============================
      v
[ PostgreSQL Database (prisma) ]  <-- Boundary 3b: Immutability Triggers & Checks
      |
======|=== Boundary 4: Outbound SSRF Filter (webhook-security.ts) ====================
      v
[ External Webhook Destinations ]
```

1. **Boundary 1 (Client $\rightarrow$ Web App)**: Web clients (browsers, cURL) are untrusted. Client clocks cannot be trusted for deadlines. User input must be validated via class-validator and DTO schemas.
2. **Boundary 2 (Web App $\rightarrow$ API)**: Authenticated routes require signed `dogfood_session` cookies. `SessionAuthGuard` resolves the active `Session` and `User` in PostgreSQL. Requests without a valid session receive HTTP 401.
3. **Boundary 3 (API $\rightarrow$ Database)**: Access control checks occur in service layer (`AccessService`), but critical integrity rules are **enforced in the database engine via PostgreSQL triggers** (`ScoreRun_guard`, `dogfood_submitted_evaluation_score_guard`, `_event_scope`). The database does NOT trust the application layer to enforce immutability.
4. **Boundary 4 (Event A $\rightarrow$ Event B)**: All entities are scoped to `eventId`. Foreign keys and PostgreSQL composite triggers (`dogfood_scope_*`) prevent cross-event association. An organizer in Event A has zero authority in Event B.
5. **Boundary 5 (Organizer $\rightarrow$ Judge $\rightarrow$ Participant)**: Judges cannot inspect peer evaluations. Participants cannot see evaluations or rubrics before publication. Organizers cannot mutate submitted evaluations.
6. **Boundary 6 (API $\rightarrow$ External Webhook Receivers)**: Destination URLs are strictly validated. DNS resolution is checked against RFC1918, loopback, and cloud metadata ranges before HTTP transmission.
7. **Boundary 7 (Archive Package $\rightarrow$ Importer)**: External archive JSON is untrusted. Schemas, package hashes, and version constraints are verified before preview; user accounts are converted to inactive placeholders.

---

## 6. Comprehensive Threat Register

| ID             | Surface      | Threat                                        | Attacker              | Existing Mitigation                                                                            | Residual Risk                                                                                  | Status                    |
| :------------- | :----------- | :-------------------------------------------- | :-------------------- | :--------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- | :------------------------ |
| **VOTE-01**    | Voting       | Sybil generation in `OPEN` mode               | Sybil Attacker        | Cookie-based HMAC token; rate limit (6/10m); `AbuseSignal` clustering                          | `OPEN` mode does not prove human identity; easily bypassed by clearing cookies.                | **ACCEPTED RISK**         |
| **VOTE-02**    | Voting       | Sybil generation in `EMAIL_GATED` mode        | Sybil Attacker        | `emailHash` unique constraint per event; email normalization                                   | Disposable email domains or multiple aliases allow multiple votes.                             | **PARTIALLY MITIGATED**   |
| **VOTE-03**    | Voting       | Sybil generation in `AUTHENTICATED` mode      | Sybil Attacker        | Unique constraint on `(eventId, userId)`; self-voting blocked                                  | If open user registration is enabled without email confirmation, multi-accounting is possible. | **PARTIALLY MITIGATED**   |
| **VOTE-04**    | Voting       | Concurrent duplicate ballot submission        | Malicious Voter       | DB unique constraint on `(eventId, identityId)`; row-level locking                             | None. Duplicate ballots are rejected with `409 ALREADY_VOTED`.                                 | **MITIGATED**             |
| **VOTE-05**    | Voting       | Voting outside configured window              | Malicious Voter       | Server `Clock.now()` checked in `$transaction` (`VOTING_NOT_OPEN` / `VOTING_CLOSED`)           | Relies on server NTP clock accuracy.                                                           | **MITIGATED**             |
| **VOTE-06**    | Voting       | Early interception of live vote tallies       | Malicious Voter       | `/voting/results` returns `403 RESULTS_HIDDEN` for non-organizers until `votingClosesAt`       | Organizers can view live tallies; compromised organizer could leak early counts.               | **MITIGATED**             |
| **VOTE-07**    | Voting       | Self-voting for own project                   | Participant           | In `AUTHENTICATED` mode, team membership check rejects with `403 SELF_VOTE_FORBIDDEN`          | Cannot be enforced in `OPEN` or `EMAIL_GATED` modes where user ID is unlinked.                 | **PARTIALLY MITIGATED**   |
| **VOTE-08**    | Voting       | Reusing voting token across different events  | Malicious Voter       | HMAC signature incorporates `eventId`: `HMAC('open-token', `${eventId}:${nonce}`)`             | Token validation fails immediately (`401 INVALID_VOTER_TOKEN`).                                | **MITIGATED**             |
| **SUB-01**     | Submissions  | Mass scraping of public gallery               | Anonymous Visitor     | Rate limiting, paginated endpoints                                                             | Public projects are intentionally public; scraping public data is an accepted property.        | **ACCEPTED PROPERTY**     |
| **SUB-02**     | Submissions  | Unauthorized read of draft/unlisted projects  | Rival Participant     | `projects.service.ts` filters non-submitted drafts; unlisted events require direct URL         | None. Drafts are inaccessible to non-team members.                                             | **MITIGATED**             |
| **SUB-03**     | Submissions  | Modifying submission after deadline           | Malicious Participant | Server-side deadline check (`now >= submissionClosesAt` $\rightarrow$ `409 SUBMISSION_CLOSED`) | None. Client clock manipulation is ineffective.                                                | **MITIGATED**             |
| **SUB-04**     | Submissions  | Modifying submitted evaluation score          | Colluding Judge       | DB trigger `dogfood_submitted_evaluation_score_guard` rejects UPDATE/DELETE                    | None. Submitted evaluations are permanently immutable in PostgreSQL.                           | **MITIGATED**             |
| **JUDGE-01**   | Judging      | Snooping on peer judge evaluations            | Malicious Judge       | Endpoint verifies `ownProfile.id === judgeId` (`403 PEER_SCORES_FORBIDDEN`)                    | Judges can only read their own submitted evaluations.                                          | **MITIGATED**             |
| **JUDGE-02**   | Judging      | Conflicted judge assigned to project          | Bias Attacker         | Explicit `JudgeConflict` table; allocator strictly filters conflicted judges                   | Undisclosed real-world conflicts cannot be detected automatically.                             | **PARTIALLY MITIGATED**   |
| **JUDGE-03**   | Judging      | Altering completed scoring runs               | Malicious Organizer   | PostgreSQL trigger `ScoreRun_guard` blocks UPDATE/DELETE on `COMPLETED` runs                   | Organizers can create a _new_ ScoreRun, but cannot rewrite historical runs.                    | **MITIGATED**             |
| **JUDGE-04**   | Judging      | Coordinated judge collusion / score fixing    | Colluding Judges      | Immutable audit trail, CSV export transparency                                                 | **Z_SCORE_V1 does NOT detect collusion.** Extreme coordinated scores persist.                  | **ACCEPTED RISK**         |
| **JUDGE-05**   | Judging      | Strategic extreme scoring (0 or 5)            | Rogue Judge           | Population $\sigma$ calculation captures variance; CSV transparency                            | Extreme variance inflates normalized distance.                                                 | **RESIDUAL RISK**         |
| **AUTH-01**    | Auth         | Horizontal privilege escalation across events | Event Organizer       | Event-scoped authorization checks (`access.organizer(p, eventId)`) + DB scope triggers         | Cross-event entity mutation is strictly rejected.                                              | **MITIGATED**             |
| **AUTH-02**    | Auth         | Participant accessing organizer endpoints     | Participant           | RBAC role check (`EventMembership.role === 'ORGANIZER'`)                                       | Unauthorized callers receive `403 FORBIDDEN`.                                                  | **MITIGATED**             |
| **WEBHOOK-01** | Webhooks     | Server-Side Request Forgery (SSRF)            | Attacker              | `webhook-security.ts` validates URLs and resolves IPs against RFC1918/cloud metadata           | DNS rebinding during socket connect is mitigated by resolving prior to connection.             | **MITIGATED**             |
| **WEBHOOK-02** | Webhooks     | Forgery of outbound webhook payloads          | External Receiver     | HMAC-SHA256 signature in `X-DogFood-Signature: v1=<hex>` using shared secret                   | Destination must implement signature verification.                                             | **MITIGATED**             |
| **WEBHOOK-03** | Webhooks     | Database disclosure of webhook secrets        | Attacker with DB read | Stored as AES-256-GCM ciphertext + IV + tag using `WEBHOOK_ENCRYPTION_KEY`                     | Compromise of both DB and `WEBHOOK_ENCRYPTION_KEY` env var exposes secrets.                    | **MITIGATED**             |
| **WEBHOOK-04** | Webhooks     | Webhook replay / duplicate delivery           | Network Attacker      | Outbox deliveries include stable `deliveryId` and ISO timestamp                                | Receiver must maintain idempotency cache; API provides at-least-once delivery.                 | **SHARED RESPONSIBILITY** |
| **ARCHIVE-01** | Archive      | Schema bomb / DoS via malicious archive       | Malicious Importer    | Package size limits (<20 MiB, <40 nesting levels, max 10k rows/collection)                     | None. Malformed or excessively deep JSON is rejected during validation.                        | **MITIGATED**             |
| **ARCHIVE-02** | Archive      | Confirming a modified archive payload         | Malicious Importer    | `confirm` requires preview token and verifies matching SHA-256 `packageHash`                   | Modified payloads fail package hash check.                                                     | **MITIGATED**             |
| **ARCHIVE-03** | Archive      | Account takeover via imported users           | Malicious Importer    | Imported users converted to deactivated placeholders (`@archive.invalid`, null password)       | Placeholder accounts are prevented from logging in or having sessions by DB triggers.          | **MITIGATED**             |
| **ARCHIVE-04** | Archive      | Unintended webhook triggers on import         | Network Attacker      | Imported webhook subscriptions are forced to `DISABLED` with secrets stripped                  | No external webhook deliveries are triggered during archive import.                            | **MITIGATED**             |
| **RECORD-01**  | Certificates | Forgery of judge participation certificates   | Unverified Judge      | Ed25519 signature over canonical ASCII-sorted JSON; offline verification                       | Forger cannot generate valid signature without `JUDGE_RECORD_SIGNING_KEY_SEED`.                | **MITIGATED**             |
| **RECORD-02**  | Certificates | Use of revoked judge certificates             | Malicious Judge       | Verification endpoint checks both cryptographic validity AND `REVOKED` DB status               | Offline verifiers who do not query revocation lists may accept revoked records.                | **SHARED RESPONSIBILITY** |
| **EMBED-01**   | Embed        | Clickjacking / unauthorized framing           | Malicious Website     | CSP `frame-ancestors 'self' <origins>` (defaults to `'none'` if unconfigured)                  | Misconfigured origin list by organizer could allow unauthorized framing.                       | **MITIGATED**             |
| **EMBED-02**   | Embed        | Credential leakage from embedded iframe       | Embed Host            | Embed route uses stateless `getPublic` (no session cookies or credentials passed)              | Embed iframe runs in isolated context without user authentication.                             | **MITIGATED**             |
| **EMBED-03**   | Embed        | Header injection via allowed origins          | Malicious Organizer   | `canonicalEmbedOrigins` validates exact HTTP(S) origin, rejects `\r\n`, wildcards, paths       | Malformed origins rejected with `400 INVALID_EMBED_ORIGIN`.                                    | **MITIGATED**             |
| **KEY-01**     | Secrets      | Accidental use of demo secrets in production  | Lazy Operator         | `config.ts` hashes secrets at startup; throws in `NODE_ENV=production` if demo defaults match  | Requires operator to set `NODE_ENV=production` in production environments.                     | **MITIGATED**             |

---

## 7. In-Depth Analysis of the Five Required Attack Classes

### A. Sybil Voting

DogFood supports three distinct community voting modes, each offering different trade-offs:

1. **`OPEN` Mode**:
   - _Mechanic_: An anonymous browser receives an HTTP cookie containing a random 32-byte base64url nonce and an HMAC signature (`nonce.signature`).
   - _Identity Guarantee_: Guarantees only that a single browser cookie can submit at most one ballot (`(eventId, openTokenHash)` uniqueness).
   - _Sybil Vulnerability_: **High.** Any user can clear cookies, open incognito sessions, or script HTTP clients to generate thousands of valid voting tokens.
   - _Mitigation_: DogFood throttles requests via `PublicWriteBucket` (max 6 vote attempts per 10-minute window per identity) and flags requests sharing IP/UA fingerprints in `AbuseSignal`. However, **OPEN mode cannot and does not guarantee one-person-one-vote.** This is an accepted design limitation for casual/frictionless voting.

2. **`EMAIL_GATED` Mode**:
   - _Mechanic_: Voter provides an email address. The system computes `emailHash = HMAC('email', normalizeEmail(email))` and enforces uniqueness on `(eventId, emailHash)`.
   - _Identity Guarantee_: Guarantees that each normalized email string can vote only once per event.
   - _Sybil Vulnerability_: **Medium.** DogFood does not send email verification codes (to support zero-dependency and offline operation). An attacker with access to disposable email domains, catch-all domains, or `+tag` variants can generate multiple ballots.

3. **`AUTHENTICATED` Mode**:
   - _Mechanic_: Requires a logged-in user with an active session (`SessionPrincipal`). Enforces unique constraint on `(eventId, userId)`.
   - _Identity Guarantee_: Highest available in the application. Bound directly to registered user accounts.
   - _Sybil Vulnerability_: **Low to Medium.** Depends entirely on user registration policy. If event registration is approval-gated by organizers, Sybil attacks are fully blocked. In open self-registration events, an attacker can register multiple accounts unless registration is restricted.
   - _Self-Voting Defense_: In `AUTHENTICATED` mode, the system checks `TeamMember` records and rejects votes cast for projects owned by the voter's own team (`403 SELF_VOTE_FORBIDDEN`).

---

### B. Ballot Stuffing & Duplicate Voting

Ballot stuffing refers to an identity casting repeated ballots or bypassing procedural rules:

1. **Duplicate Ballot Submission**:
   - The `CommunityVote` table enforces a database unique constraint:
     ```prisma
     @@unique([eventId, identityId])
     ```
   - When a vote is cast, `CommunityVotingService.cast()` executes inside a Prisma `$transaction` with row-level locking (`SELECT id FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`). Any concurrent attempt to insert a second vote for the same identity triggers a PostgreSQL unique violation (`P2002`), which is caught and returned as HTTP `409 ALREADY_VOTED`.
   - The ballot submission UI renders an already-voted state and disables submission controls once a ballot is recorded.

2. **Token Reuse & Cross-Event Replay**:
   - Voter tokens are cryptographically bound to a specific event:
     ```typescript
     this.hmac('open-token', `${eventId}:${nonce}`);
     ```
   - Presenting an Open token generated for Event A to Event B fails signature verification and returns HTTP `401 INVALID_VOTER_TOKEN`.

3. **Voting Window Enforcement**:
   - Checked inside the transactional boundary against the server-authoritative clock (`this.clock.now()`):
     ```typescript
     if (!event.votingOpensAt || now < event.votingOpensAt)
       fail(409, 'VOTING_NOT_OPEN');
     if (!event.votingClosesAt || now >= event.votingClosesAt)
       fail(409, 'VOTING_CLOSED');
     ```
   - Client clock adjustments cannot bypass these constraints.

4. **Early Tally Privacy**:
   - Callers querying `/events/:eventId/voting/results` prior to `votingClosesAt` receive HTTP `403 RESULTS_HIDDEN` unless they possess `ORGANIZER` or `ADMIN` roles. This prevents attackers from monitoring live margins to optimize targeted ballot stuffing.

---

### C. Submission Scraping

1. **Public vs. Non-Public Boundary**:
   - In hackathons, once projects are submitted and published, the project title, team name, tagline, repository URL, and demo link in the public gallery are **intended to be publicly viewable**.
   - Automated scraping of publicly published gallery projects is an inherent property of public web applications, not a vulnerability.

2. **Protection of Non-Public Data**:
   - **Draft Submissions**: Submissions with status `DRAFT` are filtered out of public queries. Only authenticated team members belonging to that project's team or event organizers can view drafts.
   - **Pre-Deadline Submissions**: If an event's `galleryVisibility` is configured as `AFTER_SUBMISSIONS_CLOSE`, the public gallery query checks `Clock.now() < event.submissionClosesAt` and returns `404 GALLERY_HIDDEN`.
   - **ID Enumeration**: All entity IDs (`Project`, `Submission`, `Team`, `User`) are 128-bit random UUIDv4 values. Sequential enumeration attacks are impossible.
   - **Cross-Event Leakage**: Event endpoints verify that projects belong to the requested `eventId`. Queries matching foreign event IDs return HTTP `404 PROJECT_NOT_FOUND`.
   - **Embed Widget Data Minimization**: The embedded gallery route (`/embed/events/:eventId`) uses `getPublic()` to fetch only public display fields (`projectName`, `tagline`, `teamName`, `trackName`). It transmits zero session cookies, user emails, or internal evaluation notes.

---

### D. Judge Collusion

1. **What DogFood Mitigates**:
   - **Peer-Score Blindness**: Judges cannot view what scores other judges awarded to any project. The endpoint `GET /events/:eventId/judging/judges/:judgeId/scores` strictly enforces that `ownProfile.id === judgeId`; querying any other judge ID returns `403 PEER_SCORES_FORBIDDEN`.
   - **Assignment Blindness**: Judges can only see their own assigned projects. They cannot view the complete assignment graph or competitor review queues.
   - **Proposal Isolation**: Algorithmic allocations remain in `AssignmentRunProposal` with status `PREVIEW` and are completely invisible to judges until an organizer explicitly publishes them.
   - **Conflict Exclusion**: Declared conflicts in `JudgeConflict` strictly block the assignment allocator from pairing a judge with a conflicted project.
   - **Immutable Evaluation Records**: Once a judge submits an evaluation, PostgreSQL trigger `dogfood_submitted_evaluation_score_guard` prevents updates or deletions. A colluding judge cannot retroactively adjust scores after seeing early results.
   - **Post-Hoc Auditability**: Every evaluation submission records an immutable `AuditEvent`. Organizers can export `raw-evaluations` and `normalized-scores` CSVs to perform statistical anomaly detection.

2. **What Normalization (`Z_SCORE_V1`) CANNOT Do**:
   - **Collusion Resistance**: Normalization **does NOT detect or prevent collusion**. If two or more colluding judges coordinate out-of-band to assign maximum scores ($5.0$) to Project X and minimum scores ($0.0$) to rival projects, `Z_SCORE_V1` standardizes their scores but preserves their relative preference. Project X will receive $+1.0$ or higher standard deviations from each colluding judge.
   - **Strategic Extremes**: A rogue judge who strategically alternates between giving $0.0$ and $5.0$ inflates their standard deviation $\sigma$. This remains an inherent limitation of linear standard score normalization.
   - **Collusion is an accepted residual risk** that must be managed through organizer oversight, multi-judge assignment density, and forensic review of CSV exports.

---

### E. Deadline Gaming

1. **Client Clock Independence**:
   - All deadline checks compare against the server-authoritative clock (`Clock.now()`). Modifying the client computer's local time or HTTP headers has zero effect.

2. **Project Submission Deadlines**:
   - When submitting or editing a project, `ProjectsService.eventWindow()` evaluates:
     ```typescript
     if (event.submissionClosesAt && now >= event.submissionClosesAt) {
       fail(409, 'SUBMISSION_CLOSED', 'The submission deadline has passed.');
     }
     ```
   - Attempting to submit at or after `submissionClosesAt` is rejected with HTTP `409 SUBMISSION_CLOSED`.

3. **Post-Deadline Version Freezing**:
   - Submissions are immutable once marked `SUBMITTED`. Creating a new submission version is blocked after `submissionClosesAt`.
   - PostgreSQL trigger `dogfood_submission_snapshot` prevents direct updates to submission records once linked to published assignments.

4. **Judging and Voting Windows**:
   - `EvaluationsService.window()` enforces `now >= judgingOpensAt` and `now < judgingClosesAt`.
   - `CommunityVotingService.window()` enforces `now >= votingOpensAt` and `now < votingClosesAt`.

5. **Operational Assumption**:
   - Deadline integrity relies on the host operating system running network time synchronization (NTP/chrony) to maintain an accurate system clock.

---

## 8. Webhook, Archive, and Cryptographic Subsystem Threats

### Webhooks & SSRF Defense

- **SSRF Prevention**: Before dispatching an outbound webhook, `webhook-security.ts` parses the URL and resolves its hostname using `lookup()`. It inspects the resolved IP address and rejects private RFC1918 networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), link-local / cloud metadata endpoints (`169.254.0.0/16`, `metadata.google.internal`), carrier-grade NAT (`100.64.0.0/10`), documentation IPs, and multicast ranges.
- **Payload Authentication**: Deliveries include header `X-DogFood-Signature: v1=<hmac>` computed as `HMAC-SHA256(secret, `${timestamp}.${deliveryId}.${eventType}.${body}`)`. Receivers can verify authenticity and integrity using their shared secret.
- **Secret Encryption at Rest**: Webhook signing secrets are encrypted with AES-256-GCM using `WEBHOOK_ENCRYPTION_KEY`. Secrets are revealed to the organizer once at creation time and are never displayed again.

### Event Archive Security

- **Schema & Size Bombs**: Archive imports (`POST /events/archives/preview`) enforce strict limits: maximum package size 20 MiB, maximum JSON nesting depth 40 levels, maximum 10,000 rows per collection, maximum 50,000 total rows. Unknown properties or prototype pollution attempts are rejected.
- **Preview / Confirm Binding**: Preview computes SHA-256 `packageHash`. The confirmation endpoint requires the preview token and matching package hash. Any modification to the archive payload invalidates confirmation.
- **Account Isolation**: Imported user accounts are converted to inactive placeholder accounts (`@archive.invalid`, null password hash). PostgreSQL triggers `Session_no_imported_placeholder` and `PlatformRole_no_imported_placeholder` guarantee imported users cannot log in or hold system roles.
- **Webhook Safety on Import**: Imported webhook subscriptions are set to `status: 'DISABLED'` and their secrets are stripped. No webhooks can be dispatched from an imported event until an organizer explicitly configures a new secret.

### Signed Judge Records & Ed25519 Certificates

- **Cryptographic Signing**: Judge participation certificates are signed using Ed25519 over a canonical ASCII-sorted JSON string of specified claims.
- **Independent Verification**: Anyone can verify certificates offline using the public key and canonical payload. To verify key legitimacy, the public key's SHA-256 fingerprint must be matched against the out-of-band published trust anchor in `JUDGE-RECORD-KEYS.md`.
- **Append-Only Revocation**: Revocations append an immutable `JudgeRecordRevocation` statement signed with the active key. Verification returns both signature validity and lifecycle status (`ACTIVE`, `SUPERSEDED`, `REVOKED`).

---

## 9. Database-Enforced Security Invariants

The DogFood database enforces critical security boundaries at the SQL level, independent of application code:

| Invariant / Guard                   | Mechanism                                                                                                | File / Location                                                         |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| **Submitted Score Immutability**    | Trigger `dogfood_submitted_evaluation_score_guard` prevents UPDATE/DELETE on submitted `EvaluationScore` | `prisma/migrations/202609230002_invariants/migration.sql`               |
| **ScoreRun Immutability**           | Trigger `ScoreRun_guard` prevents UPDATE/DELETE on `ScoreRun` once `status = 'COMPLETED'`                | `prisma/migrations/202609240002_scoring_results/migration.sql`          |
| **ResultRun Immutability**          | Trigger `ResultRun_guard` prevents UPDATE/DELETE on `ResultRun`                                          | `prisma/migrations/202609240002_scoring_results/migration.sql`          |
| **Normalized Score Immutability**   | Trigger `NormalizedScore_guard` prevents UPDATE/DELETE on `NormalizedScore`                              | `prisma/migrations/202609240002_scoring_results/migration.sql`          |
| **Audit Log Append-Only**           | Trigger `AuditEvent_append_only` rejects any UPDATE or DELETE on `AuditEvent`                            | `prisma/migrations/202609230003_judging_inputs/migration.sql`           |
| **Cross-Event Entity Isolation**    | Triggers `*_event_scope` reject foreign keys referencing mismatched `eventId`                            | `prisma/migrations/202609230002_invariants/migration.sql`               |
| **Primary Key Stability**           | Triggers `*_stable_keys` reject updates to primary keys and immutable foreign keys                       | `prisma/migrations/202609230002_invariants/migration.sql`               |
| **Duplicate Vote Prevention**       | Unique constraint `(eventId, identityId)` on `CommunityVote` table                                       | `prisma/schema.prisma`                                                  |
| **Duplicate Open Token Prevention** | Unique constraint `(eventId, openTokenHash)` on `VotingIdentity` table                                   | `prisma/schema.prisma`                                                  |
| **Placeholder Session Rejection**   | Trigger `Session_no_imported_placeholder` rejects sessions for `@archive.invalid` users                  | `prisma/migrations/202609280001_t4c_event_archive/migration.sql`        |
| **Signed Record Append-Only**       | Triggers `JudgeParticipationRecord_append_only`, `JudgeRecordRevocation_append_only`                     | `prisma/migrations/202609270002_t4b_signed_judge_records/migration.sql` |
| **Webhook Outbox Immutability**     | Trigger `webhook_outbox_event_immutable` rejects mutations to outbox records                             | `prisma/migrations/202609270001_t4a_webhooks/migration.sql`             |

---

## 10. Candid Residual and Accepted Risks

| Residual Risk                          | Why It Remains                                                                                                          | Current Impact                                                          | Possible Future Mitigation                                                             | Why Not Claimed Today                                                                 |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **Sybil Voting in `OPEN` Mode**        | DogFood supports frictionless anonymous voting without mandatory account creation or phone/CAPTCHA verification.        | An attacker can script multiple HTTP requests to cast multiple votes.   | Integrate third-party CAPTCHA (e.g. Cloudflare Turnstile) or SMS/passkey verification. | DogFood is designed for zero external cloud dependencies and offline-first operation. |
| **Disposable Emails in `EMAIL_GATED`** | Platform does not send email verification tokens to maintain offline compatibility.                                     | Attackers with multiple mailboxes can vote multiple times.              | Outbound SMTP challenge verification (`VotingEmailChallenge`).                         | SMTP requires external network services, violating offline cold boot requirements.    |
| **Coordinated Judge Collusion**        | Mathematical normalization (`Z_SCORE_V1`) standardizes individual distributions but cannot detect colluding agreements. | Colluding judges can artificially elevate a favored project.            | Pairwise comparison (B4), judge bias parameter fitting, Bayesian rating models.        | Phase B1 is restricted to `Z_SCORE_V1`; advanced rating engines are future work.      |
| **Strategic Extreme Scoring**          | Judges who give only $0$ and $5$ inflate their standard deviation.                                                      | Extreme scores carry higher normalized weight.                          | Trimmed means, Winsorization, or median-based normalization.                           | Current scoring standard is population Z-score as specified.                          |
| **Compromised Organizer Account**      | Organizers have legitimate authority to publish rubrics, invite judges, and configure voting windows.                   | A compromised organizer can disrupt an event or view pre-close tallies. | Multi-party organizer approval (M-of-N signatures) for critical actions.               | Single-organizer administration is standard for typical hackathons.                   |
| **Webhook Receiver Replay Attacks**    | DogFood signs payloads with timestamp and delivery ID, but cannot control receiver logic.                               | A compromised network could replay webhook deliveries to an endpoint.   | Receiver-side timestamp and delivery ID deduplication cache.                           | Replay handling is a shared responsibility on the webhook receiver.                   |
| **Host / Database Admin Access**       | An attacker with direct PostgreSQL or filesystem access can bypass SQL triggers and read encrypted secrets.             | Complete system compromise.                                             | Database encryption at rest (pgaudit, column-level KMS hardware modules).              | Enterprise KMS hardware integration is out of scope for self-hosted hackathons.       |

---

## 11. Operational Assumptions

DogFood relies on the following operational assumptions:

1. **Server Clock Accuracy**: The host operating system synchronizes its clock via NTP. Deadline and voting window enforcement assume system time is monotonically accurate.
2. **PostgreSQL Security**: Access to PostgreSQL is restricted to the DogFood API service container via secure Docker networking. Direct unauthorized database connections are blocked.
3. **Environment Secret Confidentiality**: Deployment secrets (`VOTING_TOKEN_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, `JUDGE_RECORD_SIGNING_KEY_SEED`, `DATABASE_URL`) are kept private and never committed to source control.
4. **Production Configuration**: When running in production, operators set `NODE_ENV=production` and generate cryptographically random secrets (at least 32 characters / 64 hex characters) as required by `config.ts`.

---

## 12. Out of Scope

The following threats are outside the design scope of the DogFood platform:

- Distributed Denial of Service (DDoS) network-layer volumetric attacks (expected to be mitigated by upstream reverse proxies or load balancers).
- Physical device theft or host kernel compromise.
- Compromise of client web browsers via local malware or malicious browser extensions.
- Verified legal identity of participants or judges (participation records certify platform evidence, not legal identity).

---

## 13. Verification References

The security properties documented in this threat model are verified by deterministic automated tests in the repository:

- `apps/api/test/b1.normalization-proof.int.ts`: Proves normalization mechanics, zero-variance handling, and immutability triggers.
- `apps/api/test/phase4b.int.ts`: Proves evaluation immutability, judge privacy, peer blindness, and CSV formula injection defenses.
- `apps/api/test/t3b.int.ts`: Proves voting modes, rate limits (`PublicWriteBucket`), duplicate vote rejection, tally secrecy, and abuse signaling.
- `apps/api/test/t4a.webhooks.int.ts`: Proves webhook HMAC signing, outbox transactions, and retry logic.
- `apps/api/test/t4a.webhook-security.spec.ts`: Proves SSRF blocking of private, loopback, and cloud metadata IP ranges.
- `apps/api/test/t4b.judge-records.int.ts`: Proves Ed25519 judge record signing, public verification, and append-only revocations.
- `apps/api/test/t4c.archive.int.ts`: Proves archive schema validation, package hash binding, and placeholder user isolation.
- `apps/api/test/t4d.embed.int.ts`: Proves embed CSP `frame-ancestors` enforcement and stateless public data retrieval.
- `tests/database.integration.ts`: Proves PostgreSQL triggers, foreign key constraints, and cross-event isolation.
