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

---

## NORMALIZATION PROOF — Z_SCORE_V1

### 1. Problem Being Solved: Harsh vs. Generous Judge Bias

In hackathons with distributed judging, each judge evaluates only a subset of submitted projects. Raw score averaging ($\bar{x}_i = \frac{1}{|J_i|} \sum_{j \in J_i} x_{ij}$) implicitly assumes that all judges share identical baseline expectations and scoring spreads. In reality, human evaluators exhibit distinct calibration profiles:

- **Harsh Judges**: Award low scores even to outstanding work (e.g., mean $\mu = 4.0$, standard deviation $\sigma = 2.0$, ceiling score $6.0$).
- **Generous Judges**: Award high scores across the board (e.g., mean $\mu = 8.0$, standard deviation $\sigma = 1.0$, floor score $7.0$).

When projects are evaluated by different judge subsets, raw averages create severe unfairness ("judge roulette"):

- An exceptional project reviewed by a harsh judge receives a raw $6.0$.
- A mediocre project reviewed by a generous judge receives a raw $7.0$.
- Under raw scoring, the mediocre project outranks the exceptional project ($7.0 > 6.0$).

`Z_SCORE_V1` eliminates this distortion by measuring how many standard deviations each evaluation sits above or below that individual judge's personal scoring distribution.

---

### 2. Exact Mathematical Formulation

For each judge $j$ who submitted $N_j$ evaluations with weighted raw scores $X_j = \{x_{1j}, x_{2j}, \dots, x_{N_j j}\}$:

1. **Judge Population Mean ($\mu_j$)**:
   $$\mu_j = \frac{1}{N_j} \sum_{k=1}^{N_j} x_{kj}$$

2. **Judge Population Standard Deviation ($\sigma_j$)**:
   $$\sigma_j = \sqrt{\frac{1}{N_j} \sum_{k=1}^{N_j} (x_{kj} - \mu_j)^2}$$
   _Design Decision_: We use the **population** standard deviation (denominator $N_j$, not $N_j - 1$) because the evaluations submitted by judge $j$ in that scoring run represent the complete, exhaustive population of evidence from that judge for that event.

3. **Normalized Evaluation Z-Score ($z\_{ij}$)**:
   $$z_{ij} = \begin{cases} \frac{x_{ij} - \mu_j}{\sigma_j} & \text{if } \sigma_j > 0 \\ 0.00000000 & \text{if } \sigma_j = 0 \end{cases}$$

4. **Zero-Variance Policy ($\sigma_j = 0$)**:
   - Occurs when $N_j = 1$ (single evaluation submitted) or when all evaluations from judge $j$ have identical scores ($x_{1j} = x_{2j} = \dots$).
   - The engine assigns $z_{ij} = 0.00000000$ and attaches the diagnostic `INSUFFICIENT_VARIATION` to the judge's score stats.
   - Division by zero is completely prevented, avoiding crashes or `NaN` propagation.

5. **Project Aggregate Score ($\bar{z}\_i$)**:
   $$\bar{z}_i = \frac{1}{|J_i|} \sum_{j \in J_i} z_{ij}$$
   where $J_i$ is the set of judges who evaluated project $i$.

6. **Competition Ranking**:
   - Project aggregate scores are rounded to 6 decimal places (`ROUND_HALF_UP`) using arbitrary-precision arithmetic (`Prisma.Decimal`).
   - Projects are ordered descending by canonical score.
   - Standard competition ranking ("1224" / "113") is applied: projects with identical 6-decimal scores receive equal ranks, and subsequent ranks skip accordingly.

---

### 3. Hand-Worked Proof 1: Canonical 3-Project Benchmark

Consider a 3-project hackathon with 2 judges and 1 criterion (weight 1.0, range 0–10):

| Project | Evaluated By                         | Raw Scores Given               |
| :------ | :----------------------------------- | :----------------------------- |
| **P1**  | Judge H (Harsh)                      | $6.0$                          |
| **P2**  | Judge H (Harsh) & Judge G (Generous) | Judge H: $2.0$, Judge G: $9.0$ |
| **P3**  | Judge G (Generous)                   | $7.0$                          |

#### Step A: Judge Statistics

- **Judge H (Harsh)**:
  - Evaluations: $\{6.0, 2.0\}$, $N_H = 2$
  - $\mu_H = \frac{6.0 + 2.0}{2} = 4.0$
  - Variance: $\frac{(6.0 - 4.0)^2 + (2.0 - 4.0)^2}{2} = \frac{4 + 4}{2} = 4.0$
  - $\sigma_H = \sqrt{4.0} = 2.0$
- **Judge G (Generous)**:
  - Evaluations: $\{9.0, 7.0\}$, $N_G = 2$
  - $\mu_G = \frac{9.0 + 7.0}{2} = 8.0$
  - Variance: $\frac{(9.0 - 8.0)^2 + (7.0 - 8.0)^2}{2} = \frac{1 + 1}{2} = 1.0$
  - $\sigma_G = \sqrt{1.0} = 1.0$

#### Step B: Normalized Evaluation Scores ($z_{ij}$)

- For **P1**:
  - Judge H: $z = \frac{6.0 - 4.0}{2.0} = \mathbf{+1.000000}$
- For **P2**:
  - Judge H: $z = \frac{2.0 - 4.0}{2.0} = -1.000000$
  - Judge G: $z = \frac{9.0 - 8.0}{1.0} = +1.000000$
- For **P3**:
  - Judge G: $z = \frac{7.0 - 8.0}{1.0} = \mathbf{-1.000000}$

#### Step C: Project Aggregation & Final Ranking Comparison

| Project | Raw Average                      | Raw Rank | Normalized Score Calculation | Normalized Score | Normalized Rank | Rank Delta           |
| :------ | :------------------------------- | :------- | :--------------------------- | :--------------- | :-------------- | :------------------- |
| **P1**  | $6.000000$                       | **2**    | $\frac{+1.0}{1}$             | **+1.000000**    | **1**           | **+1 (Rose to 1st)** |
| **P2**  | $\frac{2.0 + 9.0}{2} = 5.500000$ | **3**    | $\frac{-1.0 + 1.0}{2}$       | **0.000000**     | **2**           | **+1 (Rose to 2nd)** |
| **P3**  | $7.000000$                       | **1**    | $\frac{-1.0}{1}$             | **-1.000000**    | **3**           | **-2 (Fell to 3rd)** |

**Conclusion**: Under raw scoring, P3 won 1st place simply because it drew the generous judge, while P1 was demoted to 2nd place. Under `Z_SCORE_V1`, P1 correctly claims 1st place (+1.0 std dev above mean) and P3 drops to 3rd place (-1.0 std dev below mean).

---

### 4. Official Acceptance Fixture Evidence

The official acceptance fixture (`fixtures.json`, event `8727a75d-bbe8-584a-9c95-d5c1a916e38c`, "Sample Hack 2026") contains:

- **41** evaluated projects
- **30** active judges
- **126** submitted evaluations
- Rubric: 3 criteria (`functionality`: 40%, `quality`: 30%, `innovation`: 30%), all scored 0–5.

#### A. Zero-Variance Judges Identified

The scoring engine deterministically processes all 30 judges and correctly isolates exactly **3 zero-variance judges**:

1. `Tomas Varga` (`jdg_01`): 1 evaluation submitted ($N = 1$). $\sigma = 0$. Diagnostic: `INSUFFICIENT_VARIATION`.
2. `Anya Sokolova` (`jdg_05`): 1 evaluation submitted ($N = 1$). $\sigma = 0$. Diagnostic: `INSUFFICIENT_VARIATION`.
3. `Iva Petrova` (`jdg_28`): 3 evaluations submitted, all awarded raw score $4.000000$. $\sigma = 0$. Diagnostic: `INSUFFICIENT_VARIATION`.

All evaluations from these three judges were assigned $z = 0.00000000$ without error or numeric divergence.

#### B. Global Ranking Movement

Running `Z_SCORE_V1` against the official acceptance fixture causes rank changes for **36 out of 41 projects (87.8%)**.

#### C. Concrete Rank Inversion: Slow Trail vs. Salt Ledger

| Project Name                    | Raw Score  | Raw Rank       | Normalized Score | Normalized Rank | Rank Delta |
| :------------------------------ | :--------- | :------------- | :--------------- | :-------------- | :--------- |
| **Salt Ledger** (`169e0c81...`) | $4.333333$ | **1 (Leader)** | $0.866998$       | **3**           | **-2**     |
| **Slow Trail** (`c5934fa0...`)  | $4.000000$ | **6**          | $0.931783$       | **2**           | **+4**     |

#### Hand-Worked Verification of the Inversion:

1. **Slow Trail** (Raw: $4.000000$, Raw Rank: 6) was reviewed by 3 relatively harsh judges:
   - `Judge 06` ($\mu = 3.000000, \sigma = 0.816497$): Raw score $4.0 \implies z = \frac{4.0 - 3.0}{0.816497} = \mathbf{+1.224745}$
   - `Judge 12` ($\mu = 3.166667, \sigma = 0.897527$): Raw score $4.0 \implies z = \frac{4.0 - 3.166667}{0.897527} = \mathbf{+0.928477}$
   - `Judge 22` ($\mu = 3.666667, \sigma = 0.516398$): Raw score $4.0 \implies z = \frac{4.0 - 3.666667}{0.516398} = \mathbf{+0.645497}$
   - **Normalized Average**:
     $$\bar{z} = \frac{1.224745 + 0.928477 + 0.645497}{3} = \frac{2.798719}{3} \approx \mathbf{0.931783}$$
   - **Result**: Slow Trail advances from **Rank 6 to Rank 2**.

2. **Salt Ledger** (Raw: $4.333333$, Raw Rank: 1) was reviewed by 3 judges with higher raw distributions:
   - `Judge 08` ($\mu = 3.833333, \sigma = 0.687184$): Raw score $4.0 \implies z = \frac{4.0 - 3.833333}{0.687184} = \mathbf{+0.242536}$
   - `Judge 13` ($\mu = 3.500000, \sigma = 0.500000$): Raw score $4.0 \implies z = \frac{4.0 - 3.5}{0.5} = \mathbf{+1.000000}$
   - `Judge 24` ($\mu = 3.500000, \sigma = 1.118034$): Raw score $5.0 \implies z = \frac{5.0 - 3.5}{1.118034} = \mathbf{+1.341641}$
   - **Normalized Average**:
     $$\bar{z} = \frac{0.242536 + 1.000000 + 1.341641}{3} = \frac{2.584177}{3} \approx \mathbf{0.866998}$$
   - **Result**: Salt Ledger falls from **Rank 1 to Rank 3**.

Because `Slow Trail`'s scores came from judges who rarely gave out high marks, its performance was actually superior relative to the judge pool than `Salt Ledger`'s high raw score. Normalization correctly surfaced this reality.

---

### 5. Official Fixture Top-10 Comparison Table

| Project          | Raw Average | Raw Rank | Normalized Score | Normalized Rank | Rank Movement            |
| :--------------- | :---------- | :------- | :--------------- | :-------------- | :----------------------- |
| **Iron Switch**  | $4.222222$  | 2        | **1.295287**     | **1**           | +1 (Champion)            |
| **Slow Trail**   | $4.000000$  | 6        | **0.931783**     | **2**           | **+4 (Major Inversion)** |
| **Salt Ledger**  | $4.333333$  | 1        | **0.866998**     | **3**           | **-2 (Fell from 1st)**   |
| **Amber Frame**  | $3.916667$  | 8        | **0.840698**     | **4**           | +4                       |
| **Sharp Echo**   | $3.888889$  | 9        | **0.781846**     | **5**           | +4                       |
| **Dry Relay**    | $4.111111$  | 4        | **0.767420**     | **6**           | -2                       |
| **Still Beacon** | $4.166667$  | 3        | **0.741088**     | **7**           | -4                       |
| **Quiet Core**   | $3.833333$  | 11       | **0.718873**     | **8**           | +3                       |
| **Salt Loom**    | $4.083333$  | 5        | **0.702280**     | **9**           | -4                       |
| **Clear Signal** | $3.833333$  | 11       | **0.627254**     | **10**          | +1                       |

---

### 6. Immutability, Provenance, and Determinism

- **Provenance Integrity**: Each `ScoreRun` calculates a deterministic `inputSetHash`:
  $$\text{inputSetHash} = \text{SHA256}(\text{sortedEvaluationIds}).\text{slice}(0, 32)$$
- **Database Immutability**: All score run and result records are locked via PostgreSQL triggers:
  - `ScoreRun_guard`: Rejects updates/deletes once `status = 'COMPLETED'`.
  - `NormalizedScore_guard` & `ProjectScore_guard`: Append-only, reject any modification.
  - `ResultRun_guard` & `ProjectResult_guard`: Locked permanently upon creation.
  - `dogfood_submitted_evaluation_score_guard`: Submitted raw evaluations cannot be mutated.
- **Idempotency**: Triggering a scoring run with the exact same evaluations returns the existing `ScoreRun` (`id` identical) rather than re-creating or modifying historical data.

---

### 7. Honest Limitations of Z-Score Normalization

While `Z_SCORE_V1` successfully corrects linear judge scale disparities, organizers and evaluators must understand its theoretical boundaries:

1. **Collusion & Malicious Voting**: Normalization does **not** detect or prevent deliberate judge collusion, bribery, or coordinated bad-faith scoring.
2. **Poor Rubric Design**: If rubric criteria are ambiguous or poorly defined, normalization standardizes noise; it cannot restore semantic clarity.
3. **Graph Disconnectedness**: Cross-judge calibration requires an overlapping bipartite evaluation graph. If Judge Group A reviews Project Set 1 and Judge Group B reviews Project Set 2 with zero project overlap, their relative standard deviations cannot be cross-calibrated.
4. **Strategic Extreme Scoring**: A judge who intentionally alternates between giving $0$ and $5$ inflates their standard deviation, potentially skewing normalized contributions.
5. **Zero-Variance Loss of Signal**: When a judge awards identical scores to all projects ($n = 1$ or $\sigma = 0$), the engine assigns $z = 0$. This correctly prevents division by zero, but provides zero differential signal regarding those projects.

---

### 8. Reproducibility Instructions for Judges

To verify the entire normalization proof independently:

```bash
# 1. Run the dedicated B1 automated proof test
DATABASE_URL="postgresql://dogfood:dogfood_dev@localhost:5432/official_acceptance_test?schema=public" npm run test:b1

# 2. Inspect official fixture scoring via the API
# Import fixture
npm run db:import:official

# Run Z_SCORE_V1 scoring run (using organizer session cookie)
curl -s -X POST http://localhost:3000/events/8727a75d-bbe8-584a-9c95-d5c1a916e38c/judging/scoring/runs \
  -H "Content-Type: application/json" \
  -H "Cookie: dogfood_session=..." \
  -d '{}'

# Export authoritative results CSV
curl -s http://localhost:3000/events/8727a75d-bbe8-584a-9c95-d5c1a916e38c/judging/exports/results \
  -H "Cookie: dogfood_session=..."
```

---

## T3 Community Voting: Identity, Abuse, and Visibility

The official `spec.md` describes T3 as community voting, comments, results hidden until the window closes, random ballot order, and an answer to cheating. The official `run.py` verifies only T1/T2; T3 assurance comes from the database, adversarial integration and browser tests, plus the limitations below. The organizer UI sets a local-time window, reads the access-mode lock, shows live tallies, and presents a paginated audit. The voter UI presents the API's per-identity order and already-voted state. Public project pages show only visible, cursor-paged comments; the organizer can hide a comment. The public results page shows no counts or ranking before the server's closing instant. The UI is explanatory; the API and database enforce the policy even when clients bypass the UI.

- **OPEN-mode limitation:** An OPEN credential identifies a browser token, not a person. Clearing cookies or using another browser can obtain another token and another vote. The token is random, signed, HttpOnly, and stored only as a hash in the database, but this does not make it one-person/one-vote.
- **EMAIL_GATED ownership limitation:** EMAIL_GATED enforces one vote per normalized email string per event. The platform does not send mail and does not prove that the voter controls the inbox. `VotingIdentity.emailAcceptedAt` records when the email string was accepted, not inbox verification. `VotingEmailChallenge` is unused.
- **Self-voting limitation:** AUTHENTICATED mode blocks voting for a project submitted by a team the account belongs or belonged to. OPEN and EMAIL_GATED cannot reliably identify the person behind a token or email string, so self-voting cannot be reliably prevented in those modes.
- **Rate limits:** Each voting identity has 6 vote write attempts and 12 comment write attempts per 10-minute UTC-aligned bucket, persisted in `PublicWriteBucket`. Six vote attempts allow ordinary retries while limiting repeated scripted submissions; twelve comment writes allow discussion while slowing spam. An exceeded bucket returns HTTP 429 with a retry-after interval in the response message. The limit is per identity, so OPEN token rotation and submitted-email changes can evade it.
- **Abuse signals:** Votes from different identities with the same keyed request fingerprint within an hour are flagged when they arrive within ten seconds, or when at least three such identities appear in the hour. Fingerprints are derived from the request IP and user agent; shared networks can produce false positives and proxies can weaken attribution. Signals create organizer-only audit entries for review. They never automatically block or reject votes, and voters are not told whether a signal was recorded.
- **Ordering and results:** The ballot uses a stable keyed per-identity permutation of eligible submitted projects. No ballot or public comment response includes vote counts or turnout. Organizers can read live tallies; every other caller receives an explicit denial until the server clock reaches `votingClosesAt`, when tallies become public. Audit records cover votes, comments, hides, and configuration changes. The organizer audit endpoint is readable without a database client.
- **Offline keying:** `VOTING_TOKEN_SECRET` is required at API startup and must be a stable, independent secret of at least 32 characters. It is never derived from `DATABASE_URL`. Compose supplies a stable, publicly known local/offline demo default so one-command boot works; production deployments must override it with a strong independently generated secret. Changing the secret invalidates OPEN tokens and changes EMAIL_GATED identity hashes.

## T4B Judge Participation Records

Printable certificates are generated as HTML from authoritative registration data and submitted team/project snapshots. DogFood does not create PDF files; browser print-to-PDF is available. A certificate describes stored participation only and does not claim attendance, winner status, placement, ranking, or verified real-world identity. Signed judge records contain an event ID, an event-specific pseudonymous subject ID, assignment and submitted-evaluation counts, issuance time, schema version, record ID, issuer key ID, and optional superseded record ID. They contain no score, review text, rubric detail, project name, display name, email, or community-voting data.

The signing seed is the independent `JUDGE_RECORD_SIGNING_KEY_SEED`, a stable 32-byte Ed25519 seed encoded as 64 hexadecimal characters. Generate production material with `openssl rand -hex 32`; keep it outside the database and independent of `DATABASE_URL`, `VOTING_TOKEN_SECRET`, and `WEBHOOK_ENCRYPTION_KEY`. Startup fails when the setting is missing or malformed. Compose's stable public local/demo seed is not a production secret. See [JUDGE-RECORDS.md](JUDGE-RECORDS.md) for exact canonicalization and offline verification and [JUDGE-RECORD-KEYS.md](JUDGE-RECORD-KEYS.md) for the independent fingerprint trust anchor and rotation guidance. A signature verified against a live-served key proves consistency with that key, not which installation controls it.

Judge records are persisted and append-only. Corrections add a newly signed record linked by `supersedesRecordId`; revocation adds a separately signed statement. Verification reports signature validity independently from ACTIVE, SUPERSEDED, or REVOKED lifecycle status. Previous public keys remain available after rotation so existing records remain verifiable.

## T4A REST and Webhook Coverage

Webhook coverage means every meaningful server-side/domain mutation exposed by
the product REST API. Navigation, filtering, pagination, searches, ordinary
reads, and local-only UI state do not emit webhooks. Authentication lifecycle
operations (register, login, logout) are deliberately excluded. This is a
documented T4A policy interpretation, not wording directly guaranteed by the
official T4 specification. Covered mutations write a versioned outbox event in
the same database transaction; delivery occurs only after commit. Webhook
management and history use the existing session-cookie authorization. This
initial REST API adds no machine-token credentials.

Delivery is at least once: a receiver may see duplicates and must deduplicate by
the stable delivery ID. Automatic retries use exponential backoff, a finite
eight-attempt cycle, and jitter. Organizer replay starts a new retry cycle but
reuses the same delivery ID and preserves attempt history. There is no global
ordering guarantee across event types. See `WEBHOOKS.md` for the versioned
payload and signature-verification contract.

Webhook destinations must be public HTTPS addresses. Loopback, link-local,
private, metadata, localhost/local/internal, reserved, and multicast targets are
rejected at configuration time and again immediately before delivery. Redirects
are not followed. LAN/private destinations are deliberately unsupported in
T4A; this is an SSRF/security trade-off, not a development bypass.

## Pairwise Mode

Judges open **Judge workspace → Open Pairwise Mode**, compare two projects,
choose the stronger one, and confirm their final choice. The cards show the
exact immutable submission versions pinned when the organizer published the
run. Later project edits or submissions cannot replace those cards. Submitted
winner/loser comparisons are immutable and become read-only. Judges cannot
view other judges' choices or organizer rankings.

Organizers open **Judging → Pairwise Mode**, create a draft, preview feasibility
and assignments, then publish. Refresh progress to see completion, judge
workload, and connectivity of **submitted evidence**. A connected assignment
plan alone is not enough to rank. Published and closed runs can be ranked;
closing prevents further comparisons. This path is independent of rubric and
Z-score judging.

Global ranking uses only **BRADLEY_TERRY_RIDGE_V1**:

- `P(i > j) = sigmoid(beta_i - beta_j)`.
- Fixed ridge regularization `lambda = 0.01` prevents separated evidence from
  diverging. Tolerance is `1e-8`, with at most 200 iterations.
- Disconnected undirected evidence blocks global ranking, with component and
  isolated-project diagnostics. No ordering is invented between components.
- A directed win graph that is not strongly connected raises a separation and
  regularization-sensitivity diagnostic; connected evidence can still produce
  finite estimates using ridge.
- Strengths are canonicalized to six decimal places. Equal canonical strengths
  have equal competition ranks, such as **1, 1, 3**. Project-ID display ordering
  never changes tied ranks. Stored noncanonical strengths have eight decimals.

For example, **A beats B, B beats C, A beats C** yields **A > B > C**. The evidence
is connected but separated: C never wins, so ridge keeps the estimates finite.
With only **A beats B** and **C beats D**, there are two components and no global
ranking is available. With **A beats C** and **B beats C**, A and B share rank 1
and C has rank 3.

Ranking runs and project results are immutable historical snapshots. Reads
compare the current evidence hash with the stored hash to expose `stale` and
`currentComparisonCount`. New evidence creates a new ranking; old results never
change. Identical evidence reuses the existing ranking, following ScoreRun's
idempotency policy, including concurrent requests, and emits no duplicate
logical webhook.

The B4.1 hash utility commits to the run ID, frozen algorithm/version/lambda,
and sorted immutable comparison IDs with winner/loser IDs. The run ID identifies
its permanently frozen project/submission mapping. Solver projects come only
from `PairwiseRunProjectSnapshot`, never live project fields or latest
submissions. The append-only `PAIRWISE_RANKING_CREATED` audit stores the exact
comparison and project IDs for historical replay. Ranking state, project
results, audit, `pairwise.ranking.created` outbox event, and subscription deliveries
commit atomically under the same run lock used by submission and closure.
Webhook schema version 1 uses the existing outbox worker, stable delivery IDs,
retry and replay semantics. The existing migrations provide all required tables
and immutability constraints; B4.3 adds no schema migration.

Ranking API operations (organizer cookie authentication):

- `POST /events/:eventId/judging/pairwise/runs/:runId/rankings`
- `GET /events/:eventId/judging/pairwise/runs/:runId/rankings`
- `GET /events/:eventId/judging/pairwise/rankings/:rankingRunId`

All are documented in `/openapi.json`; judge submission and lifecycle actions
reuse the B4.2 API. No solver tuning controls are exposed.
