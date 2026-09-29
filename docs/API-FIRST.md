# DogFood API-First Architecture

DogFood is designed from the ground up as an API-first hackathon platform. The Next.js web application (`apps/web`) acts as a client layer consuming the authoritative NestJS/Fastify REST API (`apps/api`). Every user action that queries or mutates server-managed state maps directly to an authenticated or public REST operation.

---

## 1. OpenAPI Discovery

DogFood serves both machine-readable and interactive API specifications directly from the running API service:

- **Machine-Readable OpenAPI 3.0 Specification**:
  `GET /openapi.json`
  Returns the complete, authoritative OpenAPI 3.0 JSON specification containing all 108 paths, 131 operations, schemas, parameters, and security requirements.
- **Interactive Swagger Documentation**:
  `GET /docs` (and alias `GET /api-docs`)
  Renders the interactive Swagger UI interface enabling developers and judges to browse, inspect, and test API operations directly in the browser.

---

## 2. Authentication Model

DogFood uses a unified, secure cookie-based session authentication model:

- **Session Cookie (`dogfood_session`)**:
  - Transported via HTTPOnly, SameSite=Lax cookie (`Path=/`).
  - Represented in OpenAPI under `components.securitySchemes.cookie`:
    ```json
    "cookie": {
      "type": "apiKey",
      "in": "cookie",
      "name": "dogfood_session",
      "description": "Session authentication cookie for organizers, judges, and participants"
    }
    ```
- **Contextual Scoping**:
  - Protected endpoints require an active `dogfood_session` cookie and are marked with `security: [{ "cookie": [] }]`.
  - Roles (`ORGANIZER`, `JUDGE`, `PARTICIPANT`) are evaluated contextually per hackathon event (`EventMembership`).
  - Public operations (e.g. public gallery, public judge record verification, voting ballot retrieval in OPEN mode) require zero session cookies.
- **Community Voter Tokens (`dogfood_voter_<eventId>`)**:
  - In `OPEN` community voting mode, anonymous browser sessions receive a scoped HTTPOnly cookie containing a signed cryptographic token (`nonce.signature`) ensuring single-ballot limits.

---

## 3. UI $\rightarrow$ API Coverage Inventory

The following audit maps every user action across the web application interface (`apps/web`) to its underlying REST API endpoint:

| UI Surface            | User Action                                | HTTP Method | API Path                                                                | Controller                       | Auth / Role         | OpenAPI Status |
| :-------------------- | :----------------------------------------- | :---------: | :---------------------------------------------------------------------- | :------------------------------- | :------------------ | :------------: |
| **Auth**              | Register new account                       |   `POST`    | `/auth/register`                                                        | `AuthController`                 | Public              |  **COVERED**   |
| **Auth**              | Log in with credentials                    |   `POST`    | `/auth/login`                                                           | `AuthController`                 | Public              |  **COVERED**   |
| **Auth**              | Log out of active session                  |   `POST`    | `/auth/logout`                                                          | `AuthController`                 | Public / Session    |  **COVERED**   |
| **Auth**              | Check current session user                 |    `GET`    | `/auth/me`                                                              | `AuthController`                 | Session (`cookie`)  |  **COVERED**   |
| **Events**            | List published/visible events              |    `GET`    | `/events`                                                               | `EventsController`               | Public / Session    |  **COVERED**   |
| **Events**            | Create new hackathon event                 |   `POST`    | `/events`                                                               | `EventsController`               | Session (`cookie`)  |  **COVERED**   |
| **Events**            | View event details                         |    `GET`    | `/events/:eventId`                                                      | `EventsController`               | Public / Session    |  **COVERED**   |
| **Events**            | Edit event configuration/schedule          |   `PATCH`   | `/events/:eventId`                                                      | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | Publish draft event                        |   `POST`    | `/events/:eventId/publish`                                              | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | List tracks in event                       |    `GET`    | `/events/:eventId/tracks`                                               | `EventsController`               | Public / Session    |  **COVERED**   |
| **Events**            | Create track in event                      |   `POST`    | `/events/:eventId/tracks`                                               | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | Update track in event                      |   `PATCH`   | `/events/:eventId/tracks/:trackId`                                      | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | Delete track from event                    |  `DELETE`   | `/events/:eventId/tracks/:trackId`                                      | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | List prizes in event                       |    `GET`    | `/events/:eventId/prizes`                                               | `EventsController`               | Public / Session    |  **COVERED**   |
| **Events**            | Create prize in event                      |   `POST`    | `/events/:eventId/prizes`                                               | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | Update prize in event                      |   `PATCH`   | `/events/:eventId/prizes/:prizeId`                                      | `EventsController`               | Organizer           |  **COVERED**   |
| **Events**            | Delete prize from event                    |  `DELETE`   | `/events/:eventId/prizes/:prizeId`                                      | `EventsController`               | Organizer           |  **COVERED**   |
| **Registrations**     | Register for event                         |   `POST`    | `/events/:eventId/registrations`                                        | `RegistrationController`         | Session (`cookie`)  |  **COVERED**   |
| **Registrations**     | View my registration status                |    `GET`    | `/events/:eventId/registrations/me`                                     | `RegistrationController`         | Participant         |  **COVERED**   |
| **Registrations**     | Organizer list registrations               |    `GET`    | `/events/:eventId/registrations`                                        | `RegistrationController`         | Organizer           |  **COVERED**   |
| **Registrations**     | Withdraw registration from event           |   `POST`    | `/events/:eventId/registrations/withdraw`                               | `RegistrationController`         | Participant         |  **COVERED**   |
| **Teams**             | Create team                                |   `POST`    | `/events/:eventId/teams`                                                | `TeamController`                 | Participant         |  **COVERED**   |
| **Teams**             | View my team in event                      |    `GET`    | `/events/:eventId/teams/me`                                             | `TeamController`                 | Participant         |  **COVERED**   |
| **Teams**             | Update team details                        |   `PATCH`   | `/events/:eventId/teams/:teamId`                                        | `TeamController`                 | Team Admin          |  **COVERED**   |
| **Teams**             | Invite member to team                      |   `POST`    | `/events/:eventId/teams/:teamId/invitations`                            | `TeamController`                 | Team Admin          |  **COVERED**   |
| **Teams**             | View pending team invitations              |    `GET`    | `/events/:eventId/teams/:teamId/invitations`                            | `TeamController`                 | Team Admin          |  **COVERED**   |
| **Teams**             | Remove member from team                    |   `POST`    | `/events/:eventId/teams/:teamId/members/:userId/remove`                 | `TeamController`                 | Team Admin          |  **COVERED**   |
| **Teams**             | Leave active team                          |   `POST`    | `/events/:eventId/teams/:teamId/leave`                                  | `TeamController`                 | Participant         |  **COVERED**   |
| **Teams**             | Revoke team invitation                     |   `POST`    | `/events/:eventId/teams/:teamId/invitations/:invitationId/revoke`       | `TeamController`                 | Team Admin          |  **COVERED**   |
| **Team Invites**      | Preview team invite token                  |    `GET`    | `/team-invitations/:token`                                              | `InvitationController`           | Session (`cookie`)  |  **COVERED**   |
| **Team Invites**      | Accept team invitation                     |   `POST`    | `/team-invitations/accept`                                              | `InvitationController`           | Session (`cookie`)  |  **COVERED**   |
| **Team Invites**      | Reject team invitation                     |   `POST`    | `/team-invitations/reject`                                              | `InvitationController`           | Session (`cookie`)  |  **COVERED**   |
| **Projects**          | Create project for team                    |   `POST`    | `/events/:eventId/projects`                                             | `ProjectsController`             | Participant         |  **COVERED**   |
| **Projects**          | View my project in event                   |    `GET`    | `/events/:eventId/projects/me`                                          | `ProjectsController`             | Participant         |  **COVERED**   |
| **Projects**          | View project details                       |    `GET`    | `/events/:eventId/projects/:projectId`                                  | `ProjectsController`             | Participant / Org   |  **COVERED**   |
| **Projects**          | Update project metadata                    |   `PATCH`   | `/events/:eventId/projects/:projectId`                                  | `ProjectsController`             | Team Member         |  **COVERED**   |
| **Submissions**       | Save draft submission                      |   `POST`    | `/events/:eventId/projects/:projectId/submissions`                      | `ProjectsController`             | Team Member         |  **COVERED**   |
| **Submissions**       | Submit final submission version            |   `POST`    | `/events/:eventId/projects/:projectId/submissions/:submissionId/submit` | `ProjectsController`             | Team Member         |  **COVERED**   |
| **Public Gallery**    | Browse project gallery                     |    `GET`    | `/events/:eventId/gallery`                                              | `GalleryController`              | Public              |  **COVERED**   |
| **Public Gallery**    | View public project page                   |    `GET`    | `/events/:eventId/gallery/:projectId`                                   | `GalleryController`              | Public              |  **COVERED**   |
| **Judging Setup**     | Create rubric                              |   `POST`    | `/events/:eventId/judging/rubrics`                                      | `JudgingController`              | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Run Bradley–Terry ranking                  |   `POST`    | `/events/:eventId/judging/pairwise/runs/:runId/rankings`                | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | List historical rankings and staleness     |    `GET`    | `/events/:eventId/judging/pairwise/runs/:runId/rankings`                | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Inspect ranking results and diagnostics    |    `GET`    | `/events/:eventId/judging/pairwise/rankings/:rankingRunId`              | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Create draft run                           |   `POST`    | `/events/:eventId/judging/pairwise/runs`                                | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | List runs                                  |    `GET`    | `/events/:eventId/judging/pairwise/runs`                                | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Inspect run                                |    `GET`    | `/events/:eventId/judging/pairwise/runs/:runId`                         | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Preview assignments and pinned submissions |   `POST`    | `/events/:eventId/judging/pairwise/runs/:runId/assignments/preview`     | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Publish hashed proposal                    |   `POST`    | `/events/:eventId/judging/pairwise/runs/:runId/publish`                 | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Close run                                  |   `POST`    | `/events/:eventId/judging/pairwise/runs/:runId/close`                   | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | Inspect run progress                       |    `GET`    | `/events/:eventId/judging/pairwise/runs/:runId/progress`                | `PairwiseController`             | Organizer           |  **COVERED**   |
| **Pairwise Judging**  | View assigned pinned comparisons           |    `GET`    | `/events/:eventId/judging/pairwise/workspace`                           | `PairwiseController`             | Judge               |  **COVERED**   |
| **Pairwise Judging**  | Submit assigned comparison                 |   `POST`    | `/events/:eventId/judging/pairwise/assignments/:assignmentId/submit`    | `PairwiseController`             | Judge               |  **COVERED**   |
| **Judging Setup**     | Publish rubric                             |   `POST`    | `/events/:eventId/judging/rubrics/:rubricId/publish`                    | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | List event rubrics                         |    `GET`    | `/events/:eventId/judging/rubrics`                                      | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | Invite judge to event                      |   `POST`    | `/events/:eventId/judging/invitations`                                  | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | Accept judge invitation                    |   `POST`    | `/judge-invitations/accept`                                             | `JudgeInvitationController`      | Session (`cookie`)  |  **COVERED**   |
| **Judging Setup**     | Declare judge conflict                     |   `POST`    | `/events/:eventId/judging/conflicts`                                    | `JudgingController`              | Judge / Organizer   |  **COVERED**   |
| **Judging Setup**     | Preflight batch assignments                |   `POST`    | `/events/:eventId/judging/assignments/preflight`                        | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | Preview batch assignments                  |   `POST`    | `/events/:eventId/judging/assignments/preview`                          | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | Publish assignment run                     |   `POST`    | `/events/:eventId/judging/assignments/runs/:runId/publish`              | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | Manual judge assignment                    |   `POST`    | `/events/:eventId/judging/assignments/manual`                           | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judging Setup**     | Inspect review progress                    |    `GET`    | `/events/:eventId/judging/progress`                                     | `JudgingController`              | Organizer           |  **COVERED**   |
| **Judge Workspace**   | View assigned reviews queue                |    `GET`    | `/events/:eventId/judging/workspace`                                    | `JudgingController`              | Judge               |  **COVERED**   |
| **Judge Workspace**   | Save draft evaluation                      |   `PATCH`   | `/events/:eventId/judging/assignments/:assignmentId/evaluation`         | `JudgingController`              | Judge               |  **COVERED**   |
| **Judge Workspace**   | Submit evaluation                          |   `POST`    | `/events/:eventId/judging/assignments/:assignmentId/evaluation/submit`  | `JudgingController`              | Judge               |  **COVERED**   |
| **Scoring & Results** | Run Z-score normalization                  |   `POST`    | `/events/:eventId/judging/scoring/runs`                                 | `JudgingController`              | Organizer           |  **COVERED**   |
| **Scoring & Results** | View score run details                     |    `GET`    | `/events/:eventId/judging/scoring/runs/:runId`                          | `JudgingController`              | Organizer           |  **COVERED**   |
| **Scoring & Results** | Create result run / ranking                |   `POST`    | `/events/:eventId/judging/results/runs`                                 | `JudgingController`              | Organizer           |  **COVERED**   |
| **Scoring & Results** | View result run details                    |    `GET`    | `/events/:eventId/judging/results/runs/:runId`                          | `JudgingController`              | Organizer           |  **COVERED**   |
| **Scoring & Results** | Export results CSV                         |    `GET`    | `/events/:eventId/judging/exports/results`                              | `JudgingController`              | Organizer           |  **COVERED**   |
| **Scoring & Results** | Export normalized scores CSV               |    `GET`    | `/events/:eventId/judging/exports/normalized-scores`                    | `JudgingController`              | Organizer           |  **COVERED**   |
| **Scoring & Results** | Export project scores CSV                  |    `GET`    | `/events/:eventId/judging/exports/project-scores`                       | `JudgingController`              | Organizer           |  **COVERED**   |
| **Community Voting**  | Request ballot                             |   `POST`    | `/events/:eventId/voting/ballot`                                        | `CommunityVotingController`      | Public / Voter      |  **COVERED**   |
| **Community Voting**  | Cast community vote                        |   `POST`    | `/events/:eventId/voting/votes`                                         | `CommunityVotingController`      | Public / Voter      |  **COVERED**   |
| **Community Voting**  | View results / tallies                     |    `GET`    | `/events/:eventId/voting/results`                                       | `CommunityVotingController`      | Public (post-close) |  **COVERED**   |
| **Community Voting**  | Configure voting window/mode               |   `PATCH`   | `/events/:eventId/voting/config`                                        | `CommunityVotingController`      | Organizer           |  **COVERED**   |
| **Community Voting**  | Organizer view voting audit                |    `GET`    | `/events/:eventId/voting/audit`                                         | `CommunityVotingController`      | Organizer           |  **COVERED**   |
| **Comments**          | Read project comments                      |    `GET`    | `/events/:eventId/voting/projects/:projectId/comments`                  | `CommunityVotingController`      | Public              |  **COVERED**   |
| **Comments**          | Post comment on project                    |   `POST`    | `/events/:eventId/voting/projects/:projectId/comments`                  | `CommunityVotingController`      | Public / Voter      |  **COVERED**   |
| **Comments**          | Organizer hide comment                     |   `PATCH`   | `/events/:eventId/voting/projects/:projectId/comments/:commentId/hide`  | `CommunityVotingController`      | Organizer           |  **COVERED**   |
| **Webhooks**          | Create webhook subscription                |   `POST`    | `/events/:eventId/webhooks`                                             | `WebhooksController`             | Organizer           |  **COVERED**   |
| **Webhooks**          | List webhook subscriptions                 |    `GET`    | `/events/:eventId/webhooks`                                             | `WebhooksController`             | Organizer           |  **COVERED**   |
| **Webhooks**          | Update webhook subscription                |   `PATCH`   | `/events/:eventId/webhooks/:subscriptionId`                             | `WebhooksController`             | Organizer           |  **COVERED**   |
| **Webhooks**          | Disable webhook subscription               |  `DELETE`   | `/events/:eventId/webhooks/:subscriptionId`                             | `WebhooksController`             | Organizer           |  **COVERED**   |
| **Webhooks**          | View webhook delivery log                  |    `GET`    | `/events/:eventId/webhook-deliveries`                                   | `WebhooksController`             | Organizer           |  **COVERED**   |
| **Webhooks**          | Replay failed delivery                     |   `POST`    | `/events/:eventId/webhook-deliveries/:deliveryId/replay`                | `WebhooksController`             | Organizer           |  **COVERED**   |
| **Judge Records**     | List public signing keys                   |    `GET`    | `/judge-records/keys`                                                   | `PublicJudgeRecordsController`   | Public              |  **COVERED**   |
| **Judge Records**     | Verify signed judge record                 |    `GET`    | `/judge-records/:recordId/verify`                                       | `PublicJudgeRecordsController`   | Public              |  **COVERED**   |
| **Judge Records**     | Issue signed judge record                  |   `POST`    | `/events/:eventId/judge-records/:judgeProfileId`                        | `EventRecordsController`         | Organizer           |  **COVERED**   |
| **Judge Records**     | Revoke signed judge record                 |   `POST`    | `/events/:eventId/judge-records/:recordId/revoke`                       | `EventRecordsController`         | Organizer           |  **COVERED**   |
| **Certificates**      | View participant certificate               |    `GET`    | `/events/:eventId/certificates/registration/me`                         | `EventRecordsController`         | Participant         |  **COVERED**   |
| **Certificates**      | View project certificate                   |    `GET`    | `/events/:eventId/certificates/projects/me`                             | `EventRecordsController`         | Team Member         |  **COVERED**   |
| **Certificates**      | View judge certificate HTML                |    `GET`    | `/events/:eventId/judge-records/:recordId/certificate`                  | `EventRecordsController`         | Judge / Org         |  **COVERED**   |
| **Event Archives**    | Export portable archive                    |    `GET`    | `/events/:eventId/archive`                                              | `EventArchiveController`         | Organizer           |  **COVERED**   |
| **Event Archives**    | Preview archive package                    |   `POST`    | `/events/archives/preview`                                              | `EventArchiveController`         | Session (`cookie`)  |  **COVERED**   |
| **Event Archives**    | Confirm archive import                     |   `POST`    | `/events/archives/confirm`                                              | `EventArchiveController`         | Session (`cookie`)  |  **COVERED**   |
| **Embed**             | View allowed origins config                |    `GET`    | `/events/:eventId/embed-config`                                         | `EventsController`               | Organizer           |  **COVERED**   |
| **Embed**             | Update allowed origins                     |   `PATCH`   | `/events/:eventId/embed-config`                                         | `EventsController`               | Organizer           |  **COVERED**   |
| **Embed**             | Embed iframe public route                  |    `GET`    | `/embed/events/:eventId`                                                | Next.js Server Route (stateless) | Public              |  **COVERED**   |
| **Health**            | Health liveness check                      |    `GET`    | `/health`                                                               | `HealthController`               | Public              |  **COVERED**   |
| **Health**            | Database readiness check                   |    `GET`    | `/ready`                                                                | `HealthController`               | Public              |  **COVERED**   |

---

## 4. Deliberate Exclusions

The following UI behaviors are client-side only and are deliberately excluded from the REST API surface:

1. **Local Dialog and Modal Toggling**:
   - Opening and closing modals (e.g. "Add Criterion", "Invite Judge", "Confirm Override").
   - _Rationale_: Ephemeral UI state; does not read or mutate server-managed data.
2. **Local Table Sorting and Filtering**:
   - Re-sorting client-rendered tables (e.g. sorting projects alphabetically or by raw score in the browser table).
   - _Rationale_: Client-side display convenience; raw data is retrieved via existing paginated REST endpoints.
3. **Browser Navigation & Tab Switching**:
   - Switching between tabs ("Overview", "Submissions", "Judging", "Results", "Settings") in the organizer dashboard.
   - _Rationale_: Pure Next.js client-side routing.
4. **Copying Tokens or URLs to Clipboard**:
   - Copying team invite tokens, embed iframe codes, or webhook signing secrets.
   - _Rationale_: Browser Clipboard API action.

---

## 5. Security & Sensitive Data Protections

The OpenAPI document was subjected to a comprehensive sensitive-data audit:

1. **Zero Secret Leakage**:
   - The generated document contains **zero** runtime secret values.
   - Environment secrets (`VOTING_TOKEN_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, `JUDGE_RECORD_SIGNING_KEY_SEED`, `DATABASE_URL`) never appear in schemas, parameters, responses, or examples.
2. **One-Time Secret Revelation**:
   - Webhook signing secrets are returned only in the response body of `POST /events/:eventId/webhooks` upon initial creation.
   - Subsequent `GET` operations omit the secret.
3. **Cookie Security**:
   - The OpenAPI specification accurately describes session authentication as an HTTP cookie (`dogfood_session`) rather than a fictional Bearer token header.

---

## 6. Verification and Automated Testing

DogFood's API First architecture is machine-verified by the dedicated test suite:

```bash
# Run the automated OpenAPI proof suite
npm run test:b3
```

The automated test verifies:

- Machine-readable specification served at `/openapi.json` (200 OK, JSON content-type).
- Interactive documentation served at `/docs` and `/api-docs` (200 OK, HTML).
- Accurate representation of the cookie-based session security scheme.
- Complete coverage of all capability domains across 108 paths and 131 operations.
- Verification that no sensitive environment secrets or credentials appear in output.
- Unaltered behavior of core business and health endpoints.
