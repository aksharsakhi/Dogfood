-- Never invent historical submission pins from current project state.
-- B4.1 had no API workflow: installations with direct-SQL assignments need
-- explicit historical remediation before this migration can safely be applied.
BEGIN;
LOCK TABLE "PairwiseRun", "PairwiseAssignment" IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "PairwiseAssignment") THEN
    RAISE EXCEPTION 'Existing pairwise assignments have no provable submission pins; explicit historical remediation required';
  END IF;
END $$;

ALTER TABLE "PairwiseRun" ADD COLUMN "snapshotsFrozenAt" TIMESTAMPTZ(6);
UPDATE "PairwiseRun" SET "snapshotsFrozenAt" = CURRENT_TIMESTAMP
WHERE status IN ('PUBLISHED', 'CLOSED');

CREATE TABLE "PairwiseRunProjectSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pairwiseRunId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "submissionId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PairwiseRunProjectSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PairwiseRunProjectSnapshot_pairwiseRunId_fkey" FOREIGN KEY ("pairwiseRunId") REFERENCES "PairwiseRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PairwiseRunProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PairwiseRunProjectSnapshot_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "PairwiseRunProjectSnapshot_pairwiseRunId_projectId_key" ON "PairwiseRunProjectSnapshot"("pairwiseRunId", "projectId");
CREATE INDEX "PairwiseRunProjectSnapshot_projectId_idx" ON "PairwiseRunProjectSnapshot"("projectId");
CREATE INDEX "PairwiseRunProjectSnapshot_submissionId_idx" ON "PairwiseRunProjectSnapshot"("submissionId");

-- Permanent latch: deleting assignments or reverting a published status cannot
-- thaw the mapping. The existing B4.1 guards remain installed and unchanged.
CREATE FUNCTION dogfood_pairwise_snapshot_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."snapshotsFrozenAt" IS NOT NULL AND NEW."snapshotsFrozenAt" IS DISTINCT FROM OLD."snapshotsFrozenAt" THEN
      RAISE EXCEPTION 'Pairwise snapshot freeze is permanent' USING ERRCODE = '23514';
    END IF;
    IF NEW."eventId" IS DISTINCT FROM OLD."eventId" AND
       (OLD."snapshotsFrozenAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "PairwiseRunProjectSnapshot" WHERE "pairwiseRunId" = OLD.id)) THEN
      RAISE EXCEPTION 'Pairwise run with snapshots cannot change event' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IN ('PUBLISHED', 'CLOSED') THEN
    NEW."snapshotsFrozenAt" := COALESCE(NEW."snapshotsFrozenAt", CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PairwiseRun_snapshot_guard" BEFORE INSERT OR UPDATE ON "PairwiseRun"
FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_snapshot_run_guard();

CREATE FUNCTION dogfood_pairwise_project_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_run UUID;
  new_run UUID;
  r "PairwiseRun"%ROWTYPE;
  s "Submission"%ROWTYPE;
  project_event UUID;
  project_status "ProjectStatus";
  latest_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_run := OLD."pairwiseRunId"; END IF;
  IF TG_OP <> 'DELETE' THEN new_run := NEW."pairwiseRunId"; END IF;
  -- Write-lock the shared run row in stable order. A write (even unchanged)
  -- also prevents stale readers at REPEATABLE READ from missing a freeze.
  FOR r IN SELECT * FROM "PairwiseRun" WHERE id IN (old_run, new_run) ORDER BY id LOOP
    UPDATE "PairwiseRun" SET "snapshotsFrozenAt" = "snapshotsFrozenAt"
      WHERE id = r.id RETURNING * INTO r;
    IF r.status IN ('PUBLISHED', 'CLOSED') OR r."snapshotsFrozenAt" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "PairwiseAssignment" WHERE "runId" = r.id) THEN
      RAISE EXCEPTION 'Pairwise project snapshots are frozen' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  SELECT "eventId", status INTO project_event, project_status FROM "Project" WHERE id = NEW."projectId" FOR SHARE;
  IF project_event IS DISTINCT FROM (SELECT "eventId" FROM "PairwiseRun" WHERE id = NEW."pairwiseRunId") THEN
    RAISE EXCEPTION 'Pairwise snapshot project must belong to run event' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO s FROM "Submission" WHERE id = NEW."submissionId" FOR SHARE;
  IF s."projectId" IS DISTINCT FROM NEW."projectId" THEN
    RAISE EXCEPTION 'Pairwise snapshot submission must belong to project' USING ERRCODE = '23514';
  END IF;
  -- Mirrors EvaluationsService.eligibleSubmission / BatchService.snapshot:
  -- drafts do not supersede finals; a withdrawn latest final is ineligible.
  SELECT id INTO latest_id FROM "Submission"
    WHERE "projectId" = NEW."projectId" AND status IN ('SUBMITTED', 'LOCKED', 'WITHDRAWN')
    ORDER BY version DESC LIMIT 1;
  IF project_status <> 'ACTIVE' OR s.status NOT IN ('SUBMITTED', 'LOCKED') OR latest_id IS DISTINCT FROM s.id THEN
    RAISE EXCEPTION 'Pairwise snapshot requires latest eligible final submission' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PairwiseRunProjectSnapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "PairwiseRunProjectSnapshot"
FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_project_snapshot_guard();

CREATE FUNCTION dogfood_pairwise_assignment_snapshots() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Same write lock as snapshot edits/publication; failed inserts roll it back.
  UPDATE "PairwiseRun" SET "snapshotsFrozenAt" = COALESCE("snapshotsFrozenAt", CURRENT_TIMESTAMP)
    WHERE id = NEW."runId";
  IF NOT EXISTS (SELECT 1 FROM "PairwiseRunProjectSnapshot" WHERE "pairwiseRunId" = NEW."runId" AND "projectId" = NEW."projectAId")
     OR NOT EXISTS (SELECT 1 FROM "PairwiseRunProjectSnapshot" WHERE "pairwiseRunId" = NEW."runId" AND "projectId" = NEW."projectBId") THEN
    RAISE EXCEPTION 'Pairwise assignment requires both run project snapshots' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PairwiseAssignment_snapshots" BEFORE INSERT OR UPDATE ON "PairwiseAssignment"
FOR EACH ROW EXECUTE FUNCTION dogfood_pairwise_assignment_snapshots();
COMMIT;
