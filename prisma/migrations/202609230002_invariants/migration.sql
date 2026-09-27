-- PostgreSQL-only invariants: keep these migrations when changing the Prisma schema.
CREATE UNIQUE INDEX "TeamMember_one_active_team_per_event"
  ON "TeamMember" ("eventId", "userId") WHERE "leftAt" IS NULL;
CREATE UNIQUE INDEX "User_email_case_insensitive" ON "User" (lower("email"));
ALTER TABLE "Event" ADD CONSTRAINT "Event_team_sizes" CHECK ("minTeamSize" >= 1 AND "maxTeamSize" >= "minTeamSize");
ALTER TABLE "Event" ADD CONSTRAINT "Event_schedule_windows" CHECK (
  ("registrationOpensAt" IS NULL OR "registrationClosesAt" IS NULL OR "registrationOpensAt" < "registrationClosesAt") AND
  ("submissionOpensAt" IS NULL OR "submissionClosesAt" IS NULL OR "submissionOpensAt" < "submissionClosesAt") AND
  ("judgingOpensAt" IS NULL OR "judgingClosesAt" IS NULL OR "judgingOpensAt" < "judgingClosesAt") AND
  ("votingOpensAt" IS NULL OR "votingClosesAt" IS NULL OR "votingOpensAt" < "votingClosesAt"));
ALTER TABLE "Track" ADD CONSTRAINT "Track_capacity" CHECK ("maxSubmissions" > 0);
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_money" CHECK (("amount" IS NULL) = ("currency" IS NULL) AND "amount" >= 0 AND "position" > 0);
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_dates" CHECK ("leftAt" >= "joinedAt");
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "Invitation_recipient" CHECK ("email" IS NOT NULL OR "invitedUserId" IS NOT NULL);
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "Invitation_expiry" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_version" CHECK ("version" > 0);
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_state_dates" CHECK (
  ("status" NOT IN ('SUBMITTED', 'LOCKED') OR "submittedAt" IS NOT NULL) AND
  ("status" <> 'LOCKED' OR "lockedAt" IS NOT NULL));
ALTER TABLE "JudgeProfile" ADD CONSTRAINT "JudgeProfile_capacity" CHECK ("maxAssignments" >= 0);
ALTER TABLE "JudgeExpertise" ADD CONSTRAINT "JudgeExpertise_scale" CHECK ("expertiseLevel" BETWEEN 1 AND 5);
ALTER TABLE "JudgeConflict" ADD CONSTRAINT "JudgeConflict_target" CHECK (
  ("type" = 'TEAM' AND "teamId" IS NOT NULL) OR
  ("type" = 'PROJECT' AND "projectId" IS NOT NULL) OR
  ("type" = 'ORGANIZATION' AND "organization" IS NOT NULL) OR
  ("type" = 'OTHER' AND "reason" IS NOT NULL));
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_version" CHECK ("version" > 0);
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_publish_date" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "Criterion_bounds" CHECK ("weight" > 0 AND "weight" <= 1 AND "minScore" < "maxScore" AND "displayOrder" >= 0);
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_state_dates" CHECK (
  ("status" NOT IN ('SUBMITTED', 'LOCKED') OR "submittedAt" IS NOT NULL) AND
  ("status" <> 'LOCKED' OR "lockedAt" IS NOT NULL));
ALTER TABLE "ProjectScore" ADD CONSTRAINT "ProjectScore_count" CHECK ("evaluationCount" > 0);
ALTER TABLE "ProjectResult" ADD CONSTRAINT "ProjectResult_rank" CHECK ("rank" > 0);
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_publish_date" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);

-- Stable parent keys prevent reparenting from invalidating descendants' event scope.
CREATE FUNCTION dogfood_stable_keys() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE key text;
BEGIN
  FOREACH key IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW)->key IS DISTINCT FROM to_jsonb(OLD)->key THEN
      RAISE EXCEPTION '% identity field % cannot change', TG_TABLE_NAME, key USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE FUNCTION dogfood_judge_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EventMembership" WHERE id = NEW."eventMembershipId" AND role = 'JUDGE') THEN
    RAISE EXCEPTION 'JudgeProfile requires a JUDGE membership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JudgeProfile_membership" BEFORE INSERT OR UPDATE ON "JudgeProfile" FOR EACH ROW EXECUTE FUNCTION dogfood_judge_membership();

-- Submitted snapshots may advance lifecycle but can never return to DRAFT or change content.
CREATE FUNCTION dogfood_submission_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Submitted versions cannot be deleted' USING ERRCODE = '23514'; END IF;
    IF (to_jsonb(NEW) - ARRAY['status','lockedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','lockedAt'])
       OR NEW.status = 'DRAFT' OR (OLD."lockedAt" IS NOT NULL AND NEW."lockedAt" IS DISTINCT FROM OLD."lockedAt") THEN
      RAISE EXCEPTION 'Submitted snapshot is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Submission_snapshot" BEFORE UPDATE OR DELETE ON "Submission" FOR EACH ROW EXECUTE FUNCTION dogfood_submission_snapshot();

CREATE FUNCTION dogfood_evaluation_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('SUBMITTED', 'LOCKED') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Submitted evaluation cannot be deleted' USING ERRCODE = '23514'; END IF;
    IF (to_jsonb(NEW) - ARRAY['status','lockedAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','lockedAt','updatedAt'])
       OR NEW.status NOT IN ('SUBMITTED', 'LOCKED') OR (OLD.status = 'LOCKED' AND NEW.status <> 'LOCKED')
       OR (OLD."lockedAt" IS NOT NULL AND NEW."lockedAt" IS DISTINCT FROM OLD."lockedAt") THEN
      RAISE EXCEPTION 'Submitted evaluation is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Evaluation_snapshot" BEFORE UPDATE OR DELETE ON "Evaluation" FOR EACH ROW EXECUTE FUNCTION dogfood_evaluation_snapshot();

CREATE FUNCTION dogfood_raw_score() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evaluation_id uuid; evaluation_row "Evaluation"; criterion_row "RubricCriterion";
BEGIN
  IF TG_OP = 'DELETE' THEN evaluation_id := OLD."evaluationId"; ELSE evaluation_id := NEW."evaluationId"; END IF;
  SELECT * INTO evaluation_row FROM "Evaluation" WHERE id = evaluation_id FOR UPDATE;
  IF evaluation_row.status IN ('SUBMITTED', 'LOCKED') THEN
    RAISE EXCEPTION 'Submitted raw scores are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO criterion_row FROM "RubricCriterion" WHERE id = NEW."criterionId";
  IF criterion_row."rubricId" IS DISTINCT FROM evaluation_row."rubricId" OR NEW.score < criterion_row."minScore" OR NEW.score > criterion_row."maxScore" THEN
    RAISE EXCEPTION 'Score criterion/range does not match evaluation rubric' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EvaluationScore_integrity" BEFORE INSERT OR UPDATE OR DELETE ON "EvaluationScore" FOR EACH ROW EXECUTE FUNCTION dogfood_raw_score();

CREATE FUNCTION dogfood_rubric_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Published rubric cannot be deleted' USING ERRCODE = '23514'; END IF;
    IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') OR NEW.status = 'DRAFT' THEN
      RAISE EXCEPTION 'Published rubric is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Rubric_snapshot" BEFORE UPDATE OR DELETE ON "Rubric" FOR EACH ROW EXECUTE FUNCTION dogfood_rubric_snapshot();
CREATE FUNCTION dogfood_criterion_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rubric_id uuid; rubric_status "RubricStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN rubric_id := OLD."rubricId"; ELSE rubric_id := NEW."rubricId"; END IF;
  SELECT status INTO rubric_status FROM "Rubric" WHERE id = rubric_id FOR UPDATE;
  IF rubric_status <> 'DRAFT' THEN RAISE EXCEPTION 'Published rubric criteria are immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "RubricCriterion_snapshot" BEFORE INSERT OR UPDATE OR DELETE ON "RubricCriterion" FOR EACH ROW EXECUTE FUNCTION dogfood_criterion_snapshot();

CREATE TRIGGER "Event_stable_keys" BEFORE UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id');

CREATE TRIGGER "EventMembership_stable_keys" BEFORE UPDATE ON "EventMembership" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId','userId','role');

CREATE TRIGGER "Team_stable_keys" BEFORE UPDATE ON "Team" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId');

CREATE TRIGGER "TeamMember_stable_keys" BEFORE UPDATE ON "TeamMember" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId','teamId','userId');

CREATE TRIGGER "Track_stable_keys" BEFORE UPDATE ON "Track" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId');

CREATE TRIGGER "Project_stable_keys" BEFORE UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId','teamId');

CREATE TRIGGER "Submission_stable_keys" BEFORE UPDATE ON "Submission" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','projectId','version');

CREATE TRIGGER "JudgeProfile_stable_keys" BEFORE UPDATE ON "JudgeProfile" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventMembershipId');

CREATE TRIGGER "Rubric_stable_keys" BEFORE UPDATE ON "Rubric" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId','version');

CREATE TRIGGER "RubricCriterion_stable_keys" BEFORE UPDATE ON "RubricCriterion" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','rubricId');

CREATE TRIGGER "JudgeAssignment_stable_keys" BEFORE UPDATE ON "JudgeAssignment" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId','judgeProfileId','submissionId');

CREATE TRIGGER "Evaluation_stable_keys" BEFORE UPDATE ON "Evaluation" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','assignmentId','rubricId');

CREATE TRIGGER "EvaluationScore_stable_keys" BEFORE UPDATE ON "EvaluationScore" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','evaluationId','criterionId');

CREATE TRIGGER "ScoreRun_stable_keys" BEFORE UPDATE ON "ScoreRun" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId');

CREATE TRIGGER "ResultRun_stable_keys" BEFORE UPDATE ON "ResultRun" FOR EACH ROW EXECUTE FUNCTION dogfood_stable_keys('id','eventId','scoreRunId');

CREATE FUNCTION dogfood_scope_prize() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."trackId" IS NOT NULL AND NEW."eventId" IS DISTINCT FROM (SELECT "eventId" FROM "Track" WHERE id = NEW."trackId") THEN RAISE EXCEPTION 'Prize references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Prize_event_scope" BEFORE INSERT OR UPDATE ON "Prize" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_prize();

CREATE FUNCTION dogfood_scope_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND NEW."eventId" IS DISTINCT FROM (SELECT "eventId" FROM "Team" WHERE id = NEW."teamId") THEN RAISE EXCEPTION 'Project references must belong to the same event' USING ERRCODE = '23514'; END IF;
 IF NEW."trackId" IS NOT NULL AND NEW."eventId" IS DISTINCT FROM (SELECT "eventId" FROM "Track" WHERE id = NEW."trackId") THEN RAISE EXCEPTION 'Project references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Project_event_scope" BEFORE INSERT OR UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_project();

CREATE FUNCTION dogfood_scope_judgeexpertise() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND (SELECT m."eventId" FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id=j."eventMembershipId" WHERE j.id=NEW."judgeProfileId") IS DISTINCT FROM (SELECT "eventId" FROM "Track" WHERE id = NEW."trackId") THEN RAISE EXCEPTION 'JudgeExpertise references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "JudgeExpertise_event_scope" BEFORE INSERT OR UPDATE ON "JudgeExpertise" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_judgeexpertise();

CREATE FUNCTION dogfood_scope_judgeconflict() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."teamId" IS NOT NULL AND (SELECT m."eventId" FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id=j."eventMembershipId" WHERE j.id=NEW."judgeProfileId") IS DISTINCT FROM (SELECT "eventId" FROM "Team" WHERE id = NEW."teamId") THEN RAISE EXCEPTION 'JudgeConflict references must belong to the same event' USING ERRCODE = '23514'; END IF;
 IF NEW."projectId" IS NOT NULL AND (SELECT m."eventId" FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id=j."eventMembershipId" WHERE j.id=NEW."judgeProfileId") IS DISTINCT FROM (SELECT "eventId" FROM "Project" WHERE id = NEW."projectId") THEN RAISE EXCEPTION 'JudgeConflict references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "JudgeConflict_event_scope" BEFORE INSERT OR UPDATE ON "JudgeConflict" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_judgeconflict();

CREATE FUNCTION dogfood_scope_judgeassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND NEW."eventId" IS DISTINCT FROM (SELECT m."eventId" FROM "JudgeProfile" j JOIN "EventMembership" m ON m.id=j."eventMembershipId" WHERE j.id=NEW."judgeProfileId") THEN RAISE EXCEPTION 'JudgeAssignment references must belong to the same event' USING ERRCODE = '23514'; END IF;
 IF true AND NEW."eventId" IS DISTINCT FROM (SELECT p."eventId" FROM "Submission" s JOIN "Project" p ON p.id=s."projectId" WHERE s.id=NEW."submissionId") THEN RAISE EXCEPTION 'JudgeAssignment references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "JudgeAssignment_event_scope" BEFORE INSERT OR UPDATE ON "JudgeAssignment" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_judgeassignment();

CREATE FUNCTION dogfood_scope_evaluation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND (SELECT "eventId" FROM "JudgeAssignment" WHERE id = NEW."assignmentId") IS DISTINCT FROM (SELECT "eventId" FROM "Rubric" WHERE id = NEW."rubricId") THEN RAISE EXCEPTION 'Evaluation references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Evaluation_event_scope" BEFORE INSERT OR UPDATE ON "Evaluation" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_evaluation();

CREATE FUNCTION dogfood_scope_normalizedscore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND (SELECT "eventId" FROM "ScoreRun" WHERE id = NEW."scoreRunId") IS DISTINCT FROM (SELECT a."eventId" FROM "Evaluation" e JOIN "JudgeAssignment" a ON a.id=e."assignmentId" WHERE e.id=NEW."evaluationId") THEN RAISE EXCEPTION 'NormalizedScore references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "NormalizedScore_event_scope" BEFORE INSERT OR UPDATE ON "NormalizedScore" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_normalizedscore();

CREATE FUNCTION dogfood_scope_projectscore() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND (SELECT "eventId" FROM "ScoreRun" WHERE id = NEW."scoreRunId") IS DISTINCT FROM (SELECT "eventId" FROM "Project" WHERE id = NEW."projectId") THEN RAISE EXCEPTION 'ProjectScore references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ProjectScore_event_scope" BEFORE INSERT OR UPDATE ON "ProjectScore" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_projectscore();

CREATE FUNCTION dogfood_scope_resultrun() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND NEW."eventId" IS DISTINCT FROM (SELECT "eventId" FROM "ScoreRun" WHERE id = NEW."scoreRunId") THEN RAISE EXCEPTION 'ResultRun references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ResultRun_event_scope" BEFORE INSERT OR UPDATE ON "ResultRun" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_resultrun();

CREATE FUNCTION dogfood_scope_projectresult() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF true AND (SELECT "eventId" FROM "ResultRun" WHERE id = NEW."resultRunId") IS DISTINCT FROM (SELECT "eventId" FROM "Project" WHERE id = NEW."projectId") THEN RAISE EXCEPTION 'ProjectResult references must belong to the same event' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ProjectResult_event_scope" BEFORE INSERT OR UPDATE ON "ProjectResult" FOR EACH ROW EXECUTE FUNCTION dogfood_scope_projectresult();
