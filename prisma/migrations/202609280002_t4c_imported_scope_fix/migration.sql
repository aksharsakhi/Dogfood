-- A shared trigger must inspect the comment-only author column through a
-- record-independent representation when invoked for vote aggregates.
CREATE OR REPLACE FUNCTION dogfood_imported_event_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."eventId" IS DISTINCT FROM (SELECT "eventId" FROM "Project" WHERE id = NEW."projectId") THEN
    RAISE EXCEPTION 'Imported row references a project from another event' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'ImportedProjectComment' AND NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE id = ((to_jsonb(NEW)->>'authorUserId')::uuid)
      AND "importedPlaceholder"
  ) THEN
    RAISE EXCEPTION 'Imported comment author must be an unclaimed placeholder' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
