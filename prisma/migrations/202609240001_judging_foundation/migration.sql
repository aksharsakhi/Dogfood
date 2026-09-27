-- PostgreSQL migration. Existing assignments cannot be assigned a historical rubric safely.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "JudgeAssignment") THEN
    RAISE EXCEPTION 'Phase 4A migration requires zero JudgeAssignment rows; reset the development database before applying it';
  END IF;
END $$;

CREATE TYPE "AssignmentRunType" AS ENUM ('BATCH', 'MANUAL');
CREATE TYPE "AssignmentRunStatus" AS ENUM ('PREVIEW', 'PUBLISHED', 'SUPERSEDED');

CREATE TABLE "JudgeInvitation" (
  "id" UUID PRIMARY KEY,
  "eventId" UUID NOT NULL REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "invitedUserId" UUID REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "email" VARCHAR(320),
  "tokenHash" TEXT NOT NULL UNIQUE,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "respondedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JudgeInvitation_expiry" CHECK ("expiresAt" > "createdAt")
);
CREATE INDEX "JudgeInvitation_eventId_idx" ON "JudgeInvitation"("eventId");
CREATE INDEX "JudgeInvitation_expiresAt_idx" ON "JudgeInvitation"("expiresAt");

CREATE TABLE "AssignmentRun" (
  "id" UUID PRIMARY KEY,
  "eventId" UUID NOT NULL REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "rubricVersionId" UUID NOT NULL REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "type" "AssignmentRunType" NOT NULL,
  "status" "AssignmentRunStatus" NOT NULL DEFAULT 'PREVIEW',
  "reviewsPerSubmission" INTEGER NOT NULL,
  "algorithm" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "allocationSource" TEXT NOT NULL,
  "previewStats" JSONB,
  "createdById" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMPTZ(6),
  CONSTRAINT "AssignmentRun_reviews" CHECK ("reviewsPerSubmission" > 0),
  CONSTRAINT "AssignmentRun_dates" CHECK (("status" = 'PUBLISHED') = ("publishedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "AssignmentRun_id_rubricVersionId_key" ON "AssignmentRun"("id", "rubricVersionId");
CREATE INDEX "AssignmentRun_eventId_status_idx" ON "AssignmentRun"("eventId", "status");
CREATE UNIQUE INDEX "AssignmentRun_one_preview_per_event" ON "AssignmentRun"("eventId") WHERE "status" = 'PREVIEW';

CREATE TABLE "AssignmentRunProposal" (
  "id" UUID PRIMARY KEY,
  "runId" UUID NOT NULL REFERENCES "AssignmentRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "judgeProfileId" UUID NOT NULL REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "submissionId" UUID NOT NULL REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "AssignmentRunProposal_runId_judgeProfileId_submissionId_key"
  ON "AssignmentRunProposal"("runId", "judgeProfileId", "submissionId");
CREATE INDEX "AssignmentRunProposal_runId_submissionId_idx" ON "AssignmentRunProposal"("runId", "submissionId");

ALTER TABLE "JudgeAssignment" ADD COLUMN "runId" UUID NOT NULL;
ALTER TABLE "JudgeAssignment" ADD COLUMN "rubricId" UUID NOT NULL;
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_runId_rubricId_fkey"
  FOREIGN KEY ("runId", "rubricId") REFERENCES "AssignmentRun"("id", "rubricVersionId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "JudgeAssignment_id_rubricId_key" ON "JudgeAssignment"("id", "rubricId");

ALTER TABLE "Evaluation" DROP CONSTRAINT "Evaluation_assignmentId_fkey";
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_assignmentId_rubricId_fkey"
  FOREIGN KEY ("assignmentId", "rubricId") REFERENCES "JudgeAssignment"("id", "rubricId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX "Evaluation_assignmentId_rubricId_key" ON "Evaluation"("assignmentId", "rubricId");

CREATE FUNCTION dogfood_assignment_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rubric_event uuid; rubric_status "RubricStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PUBLISHED' THEN RAISE EXCEPTION 'Published assignment run is immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published assignment run is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id", NEW."eventId", NEW."rubricVersionId") IS DISTINCT FROM (OLD."id", OLD."eventId", OLD."rubricVersionId") THEN
    RAISE EXCEPTION 'Assignment run identity cannot change' USING ERRCODE = '23514';
  END IF;
  SELECT "eventId", status INTO rubric_event, rubric_status FROM "Rubric" WHERE id = NEW."rubricVersionId" FOR SHARE;
  IF rubric_event IS DISTINCT FROM NEW."eventId" OR rubric_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Assignment run requires a published same-event rubric' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (OLD.status = 'PREVIEW' AND NEW.status IN ('PUBLISHED','SUPERSEDED')) THEN
    RAISE EXCEPTION 'Invalid assignment run transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssignmentRun_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AssignmentRun"
  FOR EACH ROW EXECUTE FUNCTION dogfood_assignment_run_guard();

CREATE FUNCTION dogfood_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_event uuid; run_status "AssignmentRunStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Published assignment is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT "eventId", status INTO run_event, run_status FROM "AssignmentRun" WHERE id = NEW."runId" FOR SHARE;
  IF run_event IS DISTINCT FROM NEW."eventId" OR run_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Assignment requires a published same-event run' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JudgeAssignment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JudgeAssignment"
  FOR EACH ROW EXECUTE FUNCTION dogfood_assignment_guard();

CREATE FUNCTION dogfood_proposal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_event uuid; run_status "AssignmentRunStatus"; judge_event uuid; submission_event uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF (SELECT status FROM "AssignmentRun" WHERE id = OLD."runId") <> 'PREVIEW' THEN
      RAISE EXCEPTION 'Published proposal is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Assignment proposal is immutable' USING ERRCODE = '23514'; END IF;
  SELECT "eventId", status INTO run_event, run_status FROM "AssignmentRun" WHERE id = NEW."runId" FOR SHARE;
  SELECT m."eventId" INTO judge_event FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id = j."eventMembershipId" WHERE j.id = NEW."judgeProfileId";
  SELECT p."eventId" INTO submission_event FROM "Submission" s JOIN "Project" p ON p.id = s."projectId" WHERE s.id = NEW."submissionId";
  IF run_status <> 'PREVIEW' OR run_event IS DISTINCT FROM judge_event OR run_event IS DISTINCT FROM submission_event THEN
    RAISE EXCEPTION 'Proposal requires a preview run and same-event judge/submission' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AssignmentRunProposal_guard" BEFORE INSERT OR UPDATE OR DELETE ON "AssignmentRunProposal"
  FOR EACH ROW EXECUTE FUNCTION dogfood_proposal_guard();
