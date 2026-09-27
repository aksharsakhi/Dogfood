# Judging, Scoring, and Results Architecture

## 1. Overview and Architecture

Judging in DogFood is partitioned into two major domains:

- **Phase 4A (Judge Management, Assignments, and Evaluations)**: Judge onboarding, conflict declarations, versioned rubrics, proposal-based algorithmic allocation (greedy with max-flow fallback), transactional assignment publishing, and isolated evaluation workspaces.
- **Phase 4B (Scoring, Normalization, Results, and CSV Exports)**: Decimal-safe weighted raw scoring, population Z-score normalization (`Z_SCORE_V1`), dynamically derived staleness, explicit `ResultRun` creation with competition ranking, and formula-injection-safe CSV exports.

The backend is authoritative. Judges are strictly isolated: they cannot view competitor assignments, drafts, submitted scores from other judges, normalized scores, or final rankings.

---

## 2. Assignment Algorithm (Greedy with Max-Flow Fallback)

The batch allocator (`apps/api/src/modules/judging/allocator.ts`) partitions assignments across eligible submissions and active judges:

1. **Eligible Inputs**: Submissions with status `SUBMITTED` or `LOCKED`, active and available judges without declared conflicts or prior published assignments.
2. **Constrained Greedy Pass**: Submissions with the fewest eligible judges are assigned first, matching judges with lowest current load and matching track expertise.
3. **Deterministic Flow Fallback**: If the greedy pass falls short of the full required review count, but bipartite maximum flow (using the Dinic / Edmonds-Karp algorithm) proves that full coverage is mathematically feasible, the algorithm deterministically adopts the augmenting paths from the max-flow solution.
4. **Proposal Isolation**: Assignment runs begin in status `PREVIEW`. Proposals are saved in `AssignmentRunProposal` and are invisible to judges until an organizer explicitly publishes the run.

---

## 3. Raw Weighted Scoring and Criterion Bounds

- **Raw Evidence Immutability**: Submitted `Evaluation` and `EvaluationScore` records are permanent and append-only. No scoring run ever mutates raw scores.
- **Weighted Raw Score Formula**:
  $$\text{RawScore} = \sum_{i} \left( w_i \times s_i \right)$$
  where weights $w_i$ sum to exactly $1.0$ (100%).
- **Criterion Bounds Normalization Decision**:
  - If all criteria within a rubric share identical bounds (e.g. all 0–10), the raw score is computed directly on that shared scale.
  - If criteria have differing bounds (e.g. Criterion 1 is 0–10 while Criterion 2 is 1–5), each criterion score is converted to a percentage-of-max on a 0–100 scale:
    $$\text{percentScore}_i = \frac{s_i - \text{min}_i}{\text{max}_i - \text{min}_i} \times 100$$
    and the weighted raw score is computed on that 0–100 scale.
- **Decimal Safety**: All score and weight arithmetic uses arbitrary-precision Decimal calculations (`Prisma.Decimal`), completely eliminating floating-point drift.

---

## 4. Normalization Method: Z_SCORE_V1

Normalization mitigates judge bias (harshness vs. generosity) by standardizing evaluations across each judge's evaluation set within the run.

### Mathematical Formulation

For each judge $j$ with evaluated raw scores $X_j = \{x_1, x_2, \dots, x_N\}$:

1. **Population Mean ($\mu$)**:
   $$\mu = \frac{1}{N} \sum_{k=1}^N x_k$$
2. **Population Standard Deviation ($\sigma$)**:
   $$\sigma = \sqrt{\frac{1}{N} \sum_{k=1}^N (x_k - \mu)^2}$$
   _Important_: The denominator is $N$ (population standard deviation), not $N - 1$ (sample standard deviation). This is because the evaluations submitted by the judge in the run constitute the entire relevant population of evaluations for that run.
3. **Z-score**:
   $$z = \frac{x - \mu}{\sigma}$$
   Normalized scores are left in standard deviations ($z$) without artificial rescaling back to rubric bounds, maintaining linear comparability.

---

## 5. Sigma = 0 Rule (Zero Variance & n = 1)

- If $\sigma = 0$ (which occurs when $N = 1$ or when all raw scores given by a judge are identical):
  - Division by zero is avoided.
  - The normalized score is set to $0.00000000$.
  - The judge diagnostic is flagged as `INSUFFICIENT_VARIATION`.
- There is no separate special-case branch for $n = 1$; the single condition $\sigma = 0$ governs both cases deterministically.

---

## 6. ScoreRun Lifecycle, Provenance, and Immutability

- **Lifecycle**: `CREATING` $\rightarrow$ `COMPLETED` (or `FAILED`).
  All derived rows (`NormalizedScore`, `ProjectScore`, `JudgeScoreStats`) are inserted within a single transactional boundary before setting status to `COMPLETED`.
- **Recorded Provenance**:
  - `eventId`: Scoped to hackathon event.
  - `method` / `methodVersion`: Explicitly `Z_SCORE` / `V1`.
  - `rubricVersionId`: Exactly one published rubric version. Never mixed.
  - `inputEvaluationIds`: Sorted array of UUIDs of all evaluations entering the run.
  - `inputSetHash`: SHA-256 hash of sorted input evaluation IDs.
  - `normalizationDiagnostics`: Diagnostic record per judge.
  - `coverageDiagnostics`: Coverage status and warnings.
- **Suspended Judges**: Submitted evaluations from judges suspended after submission remain valid evidence and enter the run, accompanied by diagnostic `SUSPENDED_JUDGE_INCLUDED`.
- **Idempotency**: Creating a ScoreRun with the exact same event, method, version, and input set hash returns the existing `COMPLETED` run without recomputation.

---

## 7. Staleness Behavior

- **Derived on Read**: Staleness is not stored as a mutable database column.
- When querying a ScoreRun, the current set of eligible submitted evaluations matching the rubric and event is compared to the stored `inputEvaluationIds`.
- If new evaluations have been submitted (or eligible evaluations changed), the run reports `freshness: STALE`.
- A stale run remains completely valid and reproducible; historical `ResultRun` records referencing it remain intact.

---

## 8. Project Score Aggregation and Coverage

- **Raw Average**: Arithmetic mean of raw weighted scores across all submitted evaluations for that project.
- **Normalized Aggregate**: Arithmetic mean of normalized Z-scores across all submitted evaluations for that project.
- **Coverage Tracking**:
  - `evaluationCount`: Total submitted evaluations.
  - `requiredCount`: Required reviews per submission determined by published assignment runs covering that project.
  - `coverageComplete`: Boolean indicating whether `evaluationCount >= requiredCount`.
  - Projects with zero evaluations receive no fabricated score; they appear in coverage diagnostics.

---

## 9. Coverage Policy and Override Flow

- An organizer can create a `ResultRun` only from a `COMPLETED` ScoreRun.
- **Default Incomplete Coverage Block**: If any project in the ScoreRun has `coverageComplete === false`, `ResultRun` creation is rejected with `409 INCOMPLETE_COVERAGE` and a structured list of affected projects.
- **Confirmed Override**: To proceed with undercoverage, the organizer must explicitly provide:
  - `confirmIncomplete: true`
  - A non-empty `overrideReason` (e.g., "Judge unavailable due to emergency").
- The override persists `coverageIncomplete: true`, `overrideReason`, the actor UUID, and a snapshot of affected projects.
- The action is recorded in the audit log as `RESULT_RUN_COVERAGE_OVERRIDE`.

### Repeated Override Attempts & Idempotency

- **Database Unique Constraint**: Uniqueness is enforced on `(scoreRunId, coverageIncomplete)`. Consequently, at most one non-overridden result run (`coverageIncomplete: false`) and at most one overridden result run (`coverageIncomplete: true`) may exist for a single `ScoreRun`.
- **Second Override with Different Reason**: If an organizer attempts a second coverage-override `ResultRun` on the same `ScoreRun` providing a different `overrideReason`:
  - The API **returns the existing `ResultRun` row** (`201` idempotent return), rather than throwing an error or creating a duplicate.
  - The original `overrideReason` and `coverageSnapshot` remain untouched because `ResultRun` is immutable post-creation (enforced by the `ResultRun_guard` PostgreSQL trigger).
  - To establish a result set with a distinct override rationale or updated evaluation evidence, the organizer must generate a new `ScoreRun`.

---

## 10. ResultRun and Competition Ranking

- **Single ScoreRun Reference**: A `ResultRun` references exactly one explicit `scoreRunId` (enforced as a non-null foreign key). There is never an implicit "latest" run.
- **6-Decimal Canonicalization**: Before equality comparison and ranking, normalized aggregate scores are rounded to exactly 6 decimal places (`ROUND_HALF_UP`) using Decimal arithmetic:
  $$\text{canonicalScore} = \text{score.toDecimalPlaces}(6, \text{ROUND\_HALF\_UP})$$
- **Competition Ranking ("1224" / "113")**:
  - Sorted by canonical score descending.
  - Tied canonical scores receive the exact same rank.
  - The subsequent rank skips accordingly (e.g. scores `1.5, 1.5, 0.8` receive ranks `1, 1, 3`).
  - Stable project IDs are used for deterministic display order, but **never** break ties.
- **Idempotency**: Creating a `ResultRun` for the same `scoreRunId` and coverage state returns the existing `ResultRun`.

---

## 11. CSV Exports and Formula Injection Defense

The platform provides 7 standardized CSV exports:

1. `judges`: Judge profile, availability, capacity, and completed review counts.
2. `assignments`: Published assignments with project and judge details.
3. `progress`: Submission progress, required reviews, assigned, completed, and shortfall.
4. `raw-evaluations`: Granular evaluation criterion scores and raw weighted totals.
5. `normalized-scores`: Granular normalized evaluations with run provenance and diagnostics.
6. `project-scores`: Aggregated project scores, raw averages, and coverage state.
7. `results`: Final competitive rankings, canonical scores, and ResultRun provenance.

### Safety and Security Conventions

- **RFC 4180 Quoting**: Cells containing commas, double quotes, or newlines are wrapped in quotes; double quotes are escaped as `""`. Consistent CRLF line endings.
- **Formula Injection Defense (CSV Injection / DDE)**:
  - Any user-controlled text cell beginning with `=`, `+`, `-`, `@`, tab (`\t`), or carriage return (`\r`) is neutralized with a leading single quote (`'`).
  - **Numeric Exception**: Legitimate numeric fields (such as negative Z-scores, e.g. `-1.341641`) are explicitly marked `isNumeric: true` and are **not** prefixed with an apostrophe, preserving spreadsheet numeric parsing.
- **Contextual Authorization**:
  - Organizers and Admins can export event-wide data across all 7 types.
  - Judges may export only their own submitted evaluations (`raw-evaluations` filtered to their `judgeProfileId`). All event-wide exports return `403 FORBIDDEN`.
  - Participants and unrelated judges receive `403 FORBIDDEN`.
  - All export queries are scoped to `eventId` preventing cross-event leakage.
- **Audit Logging**: Every export records a `CSV_EXPORTED` audit event with actor, event, export type, and relevant run IDs.

---

## 12. Database-Enforced vs. Service-Enforced Guarantees

| Invariant / Rule                         | Enforced By | Mechanism                                                                                                         |
| :--------------------------------------- | :---------- | :---------------------------------------------------------------------------------------------------------------- |
| Raw evaluation immutability              | Database    | PostgreSQL BEFORE UPDATE/DELETE triggers (`dogfood_submitted_evaluation_score_guard`, `dogfood_evaluation_guard`) |
| ScoreRun immutability                    | Database    | PostgreSQL trigger `ScoreRun_guard` rejecting UPDATE/DELETE on `COMPLETED`/`FAILED`                               |
| NormalizedScore immutability             | Database    | PostgreSQL trigger `NormalizedScore_guard`                                                                        |
| ProjectScore immutability                | Database    | PostgreSQL trigger `ProjectScore_guard`                                                                           |
| ResultRun immutability                   | Database    | PostgreSQL trigger `ResultRun_guard`                                                                              |
| ProjectResult immutability               | Database    | PostgreSQL trigger `ProjectResult_guard`                                                                          |
| JudgeScoreStats immutability             | Database    | PostgreSQL trigger `JudgeScoreStats_guard`                                                                        |
| ResultRun $\rightarrow$ ScoreRun binding | Database    | NOT NULL + foreign key constraint `ResultRun_scoreRunId_fkey`                                                     |
| Single event isolation                   | Database    | Triggers ensuring parent-child event IDs match across all judging entities                                        |
| Unique ScoreRun idempotency              | Database    | Partial unique index on `(eventId, method, methodVersion, inputSetHash) WHERE status = 'COMPLETED'`               |
| Unique ResultRun idempotency             | Database    | Unique index on `(scoreRunId, coverageIncomplete)`                                                                |
| Staleness derivation                     | Service     | Derived dynamically on read by comparing current submitted eval IDs to input IDs                                  |
| Z-score arithmetic & sigma=0 rule        | Service     | `ScoringService` using arbitrary precision `Prisma.Decimal`                                                       |
| Coverage policy & override audit         | Service     | `ScoringService` checking required review counts and recording `RESULT_RUN_COVERAGE_OVERRIDE`                     |
| Formula injection defense                | Service     | `csv.util.ts` cell sanitizer                                                                                      |

---

## 13. Known Limitations

- Normalization requires at least one judge with evaluation variance ($\sigma > 0$) to distinguish relative quality. If every judge reviews only one project ($n = 1$), all normalized scores evaluate to 0 with `INSUFFICIENT_VARIATION`.
- Cross-judge calibration assumes an overlapping bipartite assignment graph. Disconnected components can create scale disparities between non-overlapping judge pools.
- Phase 4B implements `Z_SCORE_V1` and competition ranking. Complex multi-stage models (e.g. Bradley-Terry paired comparison, judge bias parameter fitting, Bayesian rating) are deferred to future phases.
