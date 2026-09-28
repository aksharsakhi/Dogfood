-- CreateEnum
CREATE TYPE "PairwiseRunStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PairwiseAssignmentStatus" AS ENUM ('PENDING', 'SUBMITTED');

-- CreateTable
CREATE TABLE "PairwiseRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "status" "PairwiseRunStatus" NOT NULL DEFAULT 'DRAFT',
    "algorithm" TEXT NOT NULL DEFAULT 'BRADLEY_TERRY_RIDGE',
    "algorithmVersion" TEXT NOT NULL DEFAULT 'V1',
    "lambda" DECIMAL(12,6) NOT NULL DEFAULT 0.01,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),

    CONSTRAINT "PairwiseRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairwiseAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "runId" UUID NOT NULL,
    "judgeProfileId" UUID NOT NULL,
    "projectAId" UUID NOT NULL,
    "projectBId" UUID NOT NULL,
    "status" "PairwiseAssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairwiseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairwiseComparison" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignmentId" UUID NOT NULL,
    "winnerProjectId" UUID NOT NULL,
    "loserProjectId" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairwiseComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairwiseRankingRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pairwiseRunId" UUID NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'BRADLEY_TERRY_RIDGE',
    "algorithmVersion" TEXT NOT NULL DEFAULT 'V1',
    "lambda" DECIMAL(12,6) NOT NULL DEFAULT 0.01,
    "inputSetHash" VARCHAR(64) NOT NULL,
    "comparisonCount" INTEGER NOT NULL,
    "projectCount" INTEGER NOT NULL,
    "componentCount" INTEGER NOT NULL,
    "converged" BOOLEAN NOT NULL,
    "iterations" INTEGER NOT NULL,
    "finalDelta" DECIMAL(20,10) NOT NULL,
    "stronglyConnectedWinGraph" BOOLEAN NOT NULL DEFAULT true,
    "separationRisk" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairwiseRankingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairwiseProjectResult" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rankingRunId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "strength" DECIMAL(20,8) NOT NULL,
    "canonicalStrength" DECIMAL(20,6) NOT NULL,
    "rank" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "losses" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairwiseProjectResult_pkey" PRIMARY KEY ("id")
);

-- Indexes for PairwiseRun
CREATE INDEX "PairwiseRun_eventId_createdAt_idx" ON "PairwiseRun"("eventId", "createdAt");
CREATE INDEX "PairwiseRun_createdById_idx" ON "PairwiseRun"("createdById");

-- Indexes and Unique Constraints for PairwiseAssignment
CREATE INDEX "PairwiseAssignment_judgeProfileId_idx" ON "PairwiseAssignment"("judgeProfileId");
CREATE INDEX "PairwiseAssignment_projectAId_idx" ON "PairwiseAssignment"("projectAId");
CREATE INDEX "PairwiseAssignment_projectBId_idx" ON "PairwiseAssignment"("projectBId");
CREATE INDEX "PairwiseAssignment_runId_status_idx" ON "PairwiseAssignment"("runId", "status");
CREATE UNIQUE INDEX "PairwiseAssignment_runId_judgeProfileId_projectAId_projectBId_key" ON "PairwiseAssignment"("runId", "judgeProfileId", "projectAId", "projectBId");

-- Indexes and Unique Constraints for PairwiseComparison
CREATE UNIQUE INDEX "PairwiseComparison_assignmentId_key" ON "PairwiseComparison"("assignmentId");
CREATE INDEX "PairwiseComparison_winnerProjectId_idx" ON "PairwiseComparison"("winnerProjectId");
CREATE INDEX "PairwiseComparison_loserProjectId_idx" ON "PairwiseComparison"("loserProjectId");
CREATE INDEX "PairwiseComparison_assignmentId_idx" ON "PairwiseComparison"("assignmentId");

-- Indexes and Unique Constraints for PairwiseRankingRun
CREATE INDEX "PairwiseRankingRun_pairwiseRunId_createdAt_idx" ON "PairwiseRankingRun"("pairwiseRunId", "createdAt");
CREATE UNIQUE INDEX "PairwiseRankingRun_run_algo_ver_lambda_hash_key" ON "PairwiseRankingRun"("pairwiseRunId", "algorithm", "algorithmVersion", "lambda", "inputSetHash");

-- Indexes and Unique Constraints for PairwiseProjectResult
CREATE INDEX "PairwiseProjectResult_projectId_idx" ON "PairwiseProjectResult"("projectId");
CREATE UNIQUE INDEX "PairwiseProjectResult_rankingRunId_projectId_key" ON "PairwiseProjectResult"("rankingRunId", "projectId");

-- Foreign Keys
ALTER TABLE "PairwiseRun" ADD CONSTRAINT "PairwiseRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseRun" ADD CONSTRAINT "PairwiseRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairwiseAssignment" ADD CONSTRAINT "PairwiseAssignment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PairwiseRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseAssignment" ADD CONSTRAINT "PairwiseAssignment_judgeProfileId_fkey" FOREIGN KEY ("judgeProfileId") REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseAssignment" ADD CONSTRAINT "PairwiseAssignment_projectAId_fkey" FOREIGN KEY ("projectAId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseAssignment" ADD CONSTRAINT "PairwiseAssignment_projectBId_fkey" FOREIGN KEY ("projectBId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "PairwiseAssignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_winnerProjectId_fkey" FOREIGN KEY ("winnerProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_loserProjectId_fkey" FOREIGN KEY ("loserProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairwiseRankingRun" ADD CONSTRAINT "PairwiseRankingRun_pairwiseRunId_fkey" FOREIGN KEY ("pairwiseRunId") REFERENCES "PairwiseRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PairwiseProjectResult" ADD CONSTRAINT "PairwiseProjectResult_rankingRunId_fkey" FOREIGN KEY ("rankingRunId") REFERENCES "PairwiseRankingRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PairwiseProjectResult" ADD CONSTRAINT "PairwiseProjectResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Invariant 1 & 2: No self pairs and canonical pair order (projectAId < projectBId)
ALTER TABLE "PairwiseAssignment" ADD CONSTRAINT "PairwiseAssignment_no_self_pair" CHECK ("projectAId" <> "projectBId");
ALTER TABLE "PairwiseAssignment" ADD CONSTRAINT "PairwiseAssignment_canonical_order" CHECK ("projectAId" < "projectBId");

-- Invariant 5: Winner and Loser cannot be the same
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_no_self_comparison" CHECK ("winnerProjectId" <> "loserProjectId");

-- Additional Invariant 3: CHECK constraints on counts and metrics
ALTER TABLE "PairwiseRankingRun" ADD CONSTRAINT "PairwiseRankingRun_comparisonCount_non_negative" CHECK ("comparisonCount" >= 0);
ALTER TABLE "PairwiseRankingRun" ADD CONSTRAINT "PairwiseRankingRun_projectCount_non_negative" CHECK ("projectCount" >= 0);
ALTER TABLE "PairwiseRankingRun" ADD CONSTRAINT "PairwiseRankingRun_componentCount_positive" CHECK ("componentCount" >= 1);
ALTER TABLE "PairwiseRankingRun" ADD CONSTRAINT "PairwiseRankingRun_iterations_non_negative" CHECK ("iterations" >= 0);

ALTER TABLE "PairwiseProjectResult" ADD CONSTRAINT "PairwiseProjectResult_rank_positive" CHECK ("rank" >= 1);
ALTER TABLE "PairwiseProjectResult" ADD CONSTRAINT "PairwiseProjectResult_wins_non_negative" CHECK ("wins" >= 0);
ALTER TABLE "PairwiseProjectResult" ADD CONSTRAINT "PairwiseProjectResult_losses_non_negative" CHECK ("losses" >= 0);

-- Trigger 1: PairwiseRun Lifecycle Immutability Guard
CREATE OR REPLACE FUNCTION dogfood_pairwise_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('PUBLISHED', 'CLOSED')
       OR EXISTS (SELECT 1 FROM "PairwiseAssignment" WHERE "runId" = OLD.id)
       OR EXISTS (SELECT 1 FROM "PairwiseRankingRun" WHERE "pairwiseRunId" = OLD.id) THEN
      RAISE EXCEPTION 'PairwiseRun with downstream state or published/closed status cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- If semantic identity fields changed:
    IF (OLD."eventId" IS DISTINCT FROM NEW."eventId"
        OR OLD."algorithm" IS DISTINCT FROM NEW."algorithm"
        OR OLD."algorithmVersion" IS DISTINCT FROM NEW."algorithmVersion"
        OR OLD."lambda" IS DISTINCT FROM NEW."lambda"
        OR OLD."createdById" IS DISTINCT FROM NEW."createdById") THEN
      IF OLD.status IN ('PUBLISHED', 'CLOSED')
         OR EXISTS (SELECT 1 FROM "PairwiseAssignment" WHERE "runId" = OLD.id)
         OR EXISTS (SELECT 1 FROM "PairwiseRankingRun" WHERE "pairwiseRunId" = OLD.id) THEN
        RAISE EXCEPTION 'PairwiseRun semantic identity is immutable once published or once downstream state exists' USING ERRCODE = '23514';
      END IF;
    END IF;

    -- Valid status transitions: closed runs cannot be reopened
    IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'Closed PairwiseRun cannot be reopened' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "PairwiseRun_guard"
  BEFORE UPDATE OR DELETE ON "PairwiseRun"
  FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_run_guard();

-- Invariant 4: Same-Event Scope Trigger on PairwiseAssignment
CREATE OR REPLACE FUNCTION dogfood_scope_pairwise_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_run_event_id UUID;
  v_judge_event_id UUID;
  v_proj_a_event_id UUID;
  v_proj_b_event_id UUID;
BEGIN
  SELECT "eventId" INTO v_run_event_id FROM "PairwiseRun" WHERE id = NEW."runId";
  SELECT m."eventId" INTO v_judge_event_id FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id = j."eventMembershipId" WHERE j.id = NEW."judgeProfileId";
  SELECT "eventId" INTO v_proj_a_event_id FROM "Project" WHERE id = NEW."projectAId";
  SELECT "eventId" INTO v_proj_b_event_id FROM "Project" WHERE id = NEW."projectBId";

  IF v_run_event_id IS NULL THEN
    RAISE EXCEPTION 'PairwiseRun does not exist' USING ERRCODE = '23514';
  END IF;
  IF v_judge_event_id IS NULL THEN
    RAISE EXCEPTION 'JudgeProfile does not exist' USING ERRCODE = '23514';
  END IF;
  IF v_proj_a_event_id IS NULL THEN
    RAISE EXCEPTION 'ProjectA does not exist' USING ERRCODE = '23514';
  END IF;
  IF v_proj_b_event_id IS NULL THEN
    RAISE EXCEPTION 'ProjectB does not exist' USING ERRCODE = '23514';
  END IF;

  IF v_run_event_id IS DISTINCT FROM v_judge_event_id
     OR v_run_event_id IS DISTINCT FROM v_proj_a_event_id
     OR v_run_event_id IS DISTINCT FROM v_proj_b_event_id THEN
    RAISE EXCEPTION 'PairwiseAssignment references must belong to the same event' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "PairwiseAssignment_event_scope"
  BEFORE INSERT OR UPDATE ON "PairwiseAssignment"
  FOR EACH ROW EXECUTE FUNCTION dogfood_scope_pairwise_assignment();

-- Invariant 6: PairwiseAssignment guard preventing modifying core fields if comparison submitted
-- and enforcing status consistency
CREATE OR REPLACE FUNCTION dogfood_pairwise_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'SUBMITTED' THEN
      RAISE EXCEPTION 'PairwiseAssignment cannot be created with status SUBMITTED without a submitted comparison' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD."projectAId" IS DISTINCT FROM NEW."projectAId"
        OR OLD."projectBId" IS DISTINCT FROM NEW."projectBId"
        OR OLD."judgeProfileId" IS DISTINCT FROM NEW."judgeProfileId"
        OR OLD."runId" IS DISTINCT FROM NEW."runId")
       AND EXISTS (SELECT 1 FROM "PairwiseComparison" WHERE "assignmentId" = OLD.id) THEN
      RAISE EXCEPTION 'PairwiseAssignment cannot be modified once comparison is submitted' USING ERRCODE = '23514';
    END IF;

    -- Status consistency checks
    IF NEW.status = 'SUBMITTED' AND NOT EXISTS (SELECT 1 FROM "PairwiseComparison" WHERE "assignmentId" = NEW.id) THEN
      RAISE EXCEPTION 'PairwiseAssignment cannot have status SUBMITTED without a submitted comparison' USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'PENDING' AND EXISTS (SELECT 1 FROM "PairwiseComparison" WHERE "assignmentId" = NEW.id) THEN
      RAISE EXCEPTION 'PairwiseAssignment with submitted comparison cannot have status PENDING' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "PairwiseAssignment_guard"
  BEFORE INSERT OR UPDATE ON "PairwiseAssignment"
  FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_assignment_guard();

-- Invariant 5 & 6: PairwiseComparison consistency and immutability guard
CREATE OR REPLACE FUNCTION dogfood_pairwise_comparison_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_assignment "PairwiseAssignment"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PairwiseComparison is immutable and cannot be deleted' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'PairwiseComparison is immutable and cannot be updated' USING ERRCODE = '23514';
  END IF;

  -- TG_OP = 'INSERT'
  SELECT * INTO v_assignment FROM "PairwiseAssignment" WHERE id = NEW."assignmentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PairwiseAssignment not found for comparison' USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW."winnerProjectId" = v_assignment."projectAId" AND NEW."loserProjectId" = v_assignment."projectBId")
    OR
    (NEW."winnerProjectId" = v_assignment."projectBId" AND NEW."loserProjectId" = v_assignment."projectAId")
  ) THEN
    RAISE EXCEPTION 'Comparison winner and loser must match linked assignment projects' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "PairwiseComparison_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "PairwiseComparison"
  FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_comparison_guard();

-- Automatically sync PairwiseAssignment status to SUBMITTED after inserting comparison
CREATE OR REPLACE FUNCTION dogfood_sync_pairwise_assignment_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "PairwiseAssignment"
  SET status = 'SUBMITTED'
  WHERE id = NEW."assignmentId" AND status <> 'SUBMITTED';
  RETURN NEW;
END $$;

CREATE TRIGGER "PairwiseComparison_sync_status"
  AFTER INSERT ON "PairwiseComparison"
  FOR EACH ROW EXECUTE FUNCTION dogfood_sync_pairwise_assignment_status();

-- Invariant 7: Historical ranking immutability for PairwiseRankingRun
CREATE OR REPLACE FUNCTION dogfood_pairwise_ranking_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PairwiseRankingRun is immutable after creation' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "PairwiseRankingRun_guard"
  BEFORE UPDATE OR DELETE ON "PairwiseRankingRun"
  FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_ranking_run_guard();

-- Invariant 7: Historical ranking immutability for PairwiseProjectResult
CREATE OR REPLACE FUNCTION dogfood_pairwise_project_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PairwiseProjectResult is immutable after creation' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "PairwiseProjectResult_guard"
  BEFORE UPDATE OR DELETE ON "PairwiseProjectResult"
  FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_project_result_guard();

-- Scope Trigger: PairwiseProjectResult must belong to the same event as the ranking run
CREATE OR REPLACE FUNCTION dogfood_scope_pairwise_project_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ranking_event_id UUID;
  v_proj_event_id UUID;
BEGIN
  SELECT r."eventId" INTO v_ranking_event_id
  FROM "PairwiseRankingRun" rr
  JOIN "PairwiseRun" r ON r.id = rr."pairwiseRunId"
  WHERE rr.id = NEW."rankingRunId";

  SELECT "eventId" INTO v_proj_event_id
  FROM "Project"
  WHERE id = NEW."projectId";

  IF v_ranking_event_id IS NULL THEN
    RAISE EXCEPTION 'PairwiseRankingRun or PairwiseRun does not exist' USING ERRCODE = '23514';
  END IF;

  IF v_proj_event_id IS NULL THEN
    RAISE EXCEPTION 'Project does not exist' USING ERRCODE = '23514';
  END IF;

  IF v_ranking_event_id IS DISTINCT FROM v_proj_event_id THEN
    RAISE EXCEPTION 'PairwiseProjectResult project must belong to the same event as the ranking run' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "PairwiseProjectResult_event_scope"
  BEFORE INSERT OR UPDATE ON "PairwiseProjectResult"
  FOR EACH ROW EXECUTE FUNCTION dogfood_scope_pairwise_project_result();
