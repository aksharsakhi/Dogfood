-- Phase 4B: Scoring, normalization, results, and CSV exports.
-- Additive migration extending existing ScoreRun / NormalizedScore / ProjectScore / ResultRun / ProjectResult.

-- ============================================================
-- ScoreRun enhancements
-- ============================================================
CREATE TYPE "ScoreRunStatus" AS ENUM ('CREATING', 'COMPLETED', 'FAILED');

ALTER TABLE "ScoreRun" ADD COLUMN "status" "ScoreRunStatus" NOT NULL DEFAULT 'CREATING';
ALTER TABLE "ScoreRun" ADD COLUMN "rubricVersionId" UUID REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ScoreRun" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'Z_SCORE';
ALTER TABLE "ScoreRun" ADD COLUMN "methodVersion" TEXT NOT NULL DEFAULT 'V1';
ALTER TABLE "ScoreRun" ADD COLUMN "inputEvaluationIds" UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE "ScoreRun" ADD COLUMN "inputSetHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ScoreRun" ADD COLUMN "coverageDiagnostics" JSONB;
ALTER TABLE "ScoreRun" ADD COLUMN "normalizationDiagnostics" JSONB;
ALTER TABLE "ScoreRun" ADD COLUMN "completedAt" TIMESTAMPTZ(6);
ALTER TABLE "ScoreRun" ADD COLUMN "failedAt" TIMESTAMPTZ(6);
ALTER TABLE "ScoreRun" ADD COLUMN "failureReason" TEXT;

-- Make createdById NOT NULL for new runs
ALTER TABLE "ScoreRun" ALTER COLUMN "createdById" SET NOT NULL;

-- Unique constraint for idempotency: same event+method+version+inputSetHash
CREATE UNIQUE INDEX "ScoreRun_idempotent_key" ON "ScoreRun"("eventId", "method", "methodVersion", "inputSetHash") WHERE "status" = 'COMPLETED';

-- ============================================================
-- NormalizedScore enhancements
-- ============================================================
ALTER TABLE "NormalizedScore" ADD COLUMN "judgeProfileId" UUID REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NormalizedScore" ADD COLUMN "submissionId" UUID REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NormalizedScore" ADD COLUMN "projectId" UUID REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "NormalizedScore" ADD COLUMN "diagnostic" TEXT;

-- ============================================================
-- ProjectScore enhancements
-- ============================================================
ALTER TABLE "ProjectScore" ADD COLUMN "rawAverage" NUMERIC(20,8) NOT NULL DEFAULT 0;
ALTER TABLE "ProjectScore" ADD COLUMN "requiredCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectScore" ADD COLUMN "coverageComplete" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- ResultRun enhancements
-- ============================================================
ALTER TABLE "ResultRun" ADD COLUMN "coverageIncomplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ResultRun" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "ResultRun" ADD COLUMN "overrideActorId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResultRun" ADD COLUMN "rankingPolicy" TEXT NOT NULL DEFAULT 'COMPETITION';
ALTER TABLE "ResultRun" ADD COLUMN "rankingVersion" TEXT NOT NULL DEFAULT 'V1';
ALTER TABLE "ResultRun" ADD COLUMN "coverageSnapshot" JSONB;

-- Make scoreRunId NOT NULL (already has FK but ensure)
ALTER TABLE "ResultRun" ALTER COLUMN "scoreRunId" SET NOT NULL;
ALTER TABLE "ResultRun" ALTER COLUMN "createdById" SET NOT NULL;

-- Unique for idempotency: same scoreRun + override state
-- (only one non-override result per score run, and overrides are differentiated by overrideReason hash)
CREATE UNIQUE INDEX "ResultRun_idempotent_key" ON "ResultRun"("scoreRunId", "coverageIncomplete");

-- ============================================================
-- JudgeScoreStats: per-judge normalization diagnostics for a ScoreRun
-- ============================================================
CREATE TABLE "JudgeScoreStats" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "scoreRunId" UUID NOT NULL REFERENCES "ScoreRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "judgeProfileId" UUID NOT NULL REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "evaluationCount" INTEGER NOT NULL,
  "mean" NUMERIC(20,8) NOT NULL,
  "populationStdDev" NUMERIC(20,8) NOT NULL,
  "diagnostic" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JudgeScoreStats_unique" UNIQUE ("scoreRunId", "judgeProfileId")
);
CREATE INDEX "JudgeScoreStats_scoreRunId_idx" ON "JudgeScoreStats"("scoreRunId");

-- ============================================================
-- DB-level immutability: ScoreRun (COMPLETED/FAILED)
-- ============================================================
CREATE FUNCTION dogfood_score_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('COMPLETED', 'FAILED') THEN
      RAISE EXCEPTION 'Completed/failed ScoreRun is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('COMPLETED', 'FAILED') THEN
      RAISE EXCEPTION 'Completed/failed ScoreRun is immutable' USING ERRCODE = '23514';
    END IF;
    -- Only allow CREATING -> COMPLETED or CREATING -> FAILED
    IF OLD.status = 'CREATING' AND NEW.status NOT IN ('COMPLETED', 'FAILED') THEN
      RAISE EXCEPTION 'Invalid ScoreRun transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ScoreRun_guard" BEFORE UPDATE OR DELETE ON "ScoreRun"
  FOR EACH ROW EXECUTE FUNCTION dogfood_score_run_guard();

-- ============================================================
-- DB-level immutability: NormalizedScore (no UPDATE/DELETE after creation)
-- ============================================================
CREATE FUNCTION dogfood_normalized_score_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NormalizedScore is immutable after creation' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "NormalizedScore_guard" BEFORE UPDATE OR DELETE ON "NormalizedScore"
  FOR EACH ROW EXECUTE FUNCTION dogfood_normalized_score_guard();

-- ============================================================
-- DB-level immutability: ProjectScore (no UPDATE/DELETE after creation)
-- ============================================================
CREATE FUNCTION dogfood_project_score_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ProjectScore is immutable after creation' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "ProjectScore_guard" BEFORE UPDATE OR DELETE ON "ProjectScore"
  FOR EACH ROW EXECUTE FUNCTION dogfood_project_score_guard();

-- ============================================================
-- DB-level immutability: ResultRun (no UPDATE/DELETE after creation)
-- ============================================================
CREATE FUNCTION dogfood_result_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ResultRun is immutable after creation' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "ResultRun_guard" BEFORE UPDATE OR DELETE ON "ResultRun"
  FOR EACH ROW EXECUTE FUNCTION dogfood_result_run_guard();

-- ============================================================
-- DB-level immutability: ProjectResult (no UPDATE/DELETE after creation)
-- ============================================================
CREATE FUNCTION dogfood_project_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ProjectResult is immutable after creation' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "ProjectResult_guard" BEFORE UPDATE OR DELETE ON "ProjectResult"
  FOR EACH ROW EXECUTE FUNCTION dogfood_project_result_guard();

-- ============================================================
-- DB-level immutability: JudgeScoreStats (no UPDATE/DELETE after creation)
-- ============================================================
CREATE FUNCTION dogfood_judge_score_stats_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'JudgeScoreStats is immutable after creation' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "JudgeScoreStats_guard" BEFORE UPDATE OR DELETE ON "JudgeScoreStats"
  FOR EACH ROW EXECUTE FUNCTION dogfood_judge_score_stats_guard();
