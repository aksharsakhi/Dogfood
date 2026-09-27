-- Judging may only consume frozen inputs, even before the domain API is implemented.
CREATE FUNCTION dogfood_assignment_input() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE submission_status "SubmissionStatus";
BEGIN
  SELECT status INTO submission_status FROM "Submission" WHERE id = NEW."submissionId" FOR SHARE;
  IF submission_status NOT IN ('SUBMITTED', 'LOCKED') THEN
    RAISE EXCEPTION 'Assignment requires an immutable submitted version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JudgeAssignment_frozen_input" BEFORE INSERT ON "JudgeAssignment" FOR EACH ROW EXECUTE FUNCTION dogfood_assignment_input();

CREATE FUNCTION dogfood_evaluation_input() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rubric_status "RubricStatus";
BEGIN
  SELECT status INTO rubric_status FROM "Rubric" WHERE id = NEW."rubricId" FOR SHARE;
  IF rubric_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Evaluation requires a published immutable rubric' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Evaluation_frozen_input" BEFORE INSERT ON "Evaluation" FOR EACH ROW EXECUTE FUNCTION dogfood_evaluation_input();

CREATE FUNCTION dogfood_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION dogfood_append_only();
