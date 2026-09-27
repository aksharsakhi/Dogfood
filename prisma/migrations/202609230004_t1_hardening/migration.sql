CREATE TYPE "GalleryVisibility" AS ENUM ('HIDDEN', 'AFTER_SUBMISSIONS_CLOSE', 'PUBLIC');
ALTER TABLE "Event" ADD COLUMN "galleryVisibility" "GalleryVisibility" NOT NULL DEFAULT 'HIDDEN';

ALTER TABLE "Submission" ADD COLUMN "projectName" TEXT,
  ADD COLUMN "projectTagline" TEXT,
  ADD COLUMN "trackId" UUID,
  ADD COLUMN "trackName" TEXT;

-- Existing submitted rows predate these snapshot columns. Backfill under the migration lock,
-- then restore the immutability trigger before the transaction commits.
DROP TRIGGER "Submission_snapshot" ON "Submission";
UPDATE "Submission" s SET
  "projectName" = p.name,
  "projectTagline" = p.tagline,
  "trackId" = p."trackId",
  "trackName" = t.name
FROM "Project" p LEFT JOIN "Track" t ON t.id = p."trackId"
WHERE s."projectId" = p.id AND s.status IN ('SUBMITTED', 'LOCKED');
CREATE TRIGGER "Submission_snapshot" BEFORE UPDATE OR DELETE ON "Submission"
  FOR EACH ROW EXECUTE FUNCTION dogfood_submission_snapshot();
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_project_snapshot" CHECK
  (status NOT IN ('SUBMITTED', 'LOCKED') OR "projectName" IS NOT NULL);

-- Inactive historical roles remain available; a user has one active event role.
CREATE UNIQUE INDEX "EventMembership_one_active_role_per_event"
  ON "EventMembership" ("eventId", "userId") WHERE status = 'ACTIVE';
