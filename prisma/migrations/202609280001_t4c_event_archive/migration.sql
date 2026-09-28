-- AlterTable
ALTER TABLE "User" ADD COLUMN     "importedPlaceholder" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- AlterTable
ALTER TABLE "JudgeParticipationRecord" ADD COLUMN     "sourceEventId" UUID,
ADD COLUMN     "sourceInstanceId" UUID,
ADD COLUMN     "sourceRecordId" UUID;

-- AlterTable
ALTER TABLE "WebhookSubscription" ALTER COLUMN "secretCiphertext" DROP NOT NULL,
ALTER COLUMN "secretIv" DROP NOT NULL,
ALTER COLUMN "secretAuthTag" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EventArchiveInstance" (
    "singleton" INTEGER NOT NULL DEFAULT 1,
    "id" UUID NOT NULL,

    CONSTRAINT "EventArchiveInstance_pkey" PRIMARY KEY ("singleton")
);

-- CreateTable
CREATE TABLE "EventArchiveImport" (
    "id" UUID NOT NULL,
    "sourceInstanceId" UUID NOT NULL,
    "sourceEventId" UUID NOT NULL,
    "packageHash" CHAR(64) NOT NULL,
    "destinationEventId" UUID NOT NULL,
    "importedById" UUID NOT NULL,
    "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventArchiveImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventArchiveEntityMap" (
    "importId" UUID NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "sourceId" VARCHAR(160) NOT NULL,
    "destinationId" VARCHAR(160) NOT NULL,

    CONSTRAINT "EventArchiveEntityMap_pkey" PRIMARY KEY ("importId","model","sourceId")
);

-- CreateTable
CREATE TABLE "ImportedVoteAggregate" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "ImportedVoteAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedProjectComment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "status" "ProjectCommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "hiddenAt" TIMESTAMPTZ(6),

    CONSTRAINT "ImportedProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventArchiveInstance_id_key" ON "EventArchiveInstance"("id");

-- CreateIndex
CREATE UNIQUE INDEX "EventArchiveImport_destinationEventId_key" ON "EventArchiveImport"("destinationEventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventArchiveImport_sourceInstanceId_sourceEventId_packageHa_key" ON "EventArchiveImport"("sourceInstanceId", "sourceEventId", "packageHash");

-- CreateIndex
CREATE UNIQUE INDEX "EventArchiveEntityMap_importId_model_destinationId_key" ON "EventArchiveEntityMap"("importId", "model", "destinationId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedVoteAggregate_eventId_projectId_key" ON "ImportedVoteAggregate"("eventId", "projectId");

-- AddForeignKey
ALTER TABLE "EventArchiveImport" ADD CONSTRAINT "EventArchiveImport_destinationEventId_fkey" FOREIGN KEY ("destinationEventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EventArchiveImport" ADD CONSTRAINT "EventArchiveImport_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EventArchiveEntityMap" ADD CONSTRAINT "EventArchiveEntityMap_importId_fkey" FOREIGN KEY ("importId") REFERENCES "EventArchiveImport"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ImportedVoteAggregate" ADD CONSTRAINT "ImportedVoteAggregate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ImportedVoteAggregate" ADD CONSTRAINT "ImportedVoteAggregate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ImportedProjectComment" ADD CONSTRAINT "ImportedProjectComment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ImportedProjectComment" ADD CONSTRAINT "ImportedProjectComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ImportedProjectComment" ADD CONSTRAINT "ImportedProjectComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Imported users have no password or authentication state. Ordinary accounts
-- retain the original non-null password guarantee.
ALTER TABLE "User" ADD CONSTRAINT "User_imported_placeholder_guard" CHECK (
  (NOT "importedPlaceholder" AND "passwordHash" IS NOT NULL)
  OR ("importedPlaceholder" AND "passwordHash" IS NULL
      AND status = 'DEACTIVATED' AND "emailVerifiedAt" IS NULL
      AND email LIKE '%@archive.invalid')
);

CREATE FUNCTION dogfood_no_placeholder_privilege() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE id = NEW."userId" AND "importedPlaceholder") THEN
    RAISE EXCEPTION 'Imported placeholders cannot receive sessions or platform roles' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Session_no_imported_placeholder" BEFORE INSERT OR UPDATE ON "Session"
  FOR EACH ROW EXECUTE FUNCTION dogfood_no_placeholder_privilege();
CREATE TRIGGER "PlatformRole_no_imported_placeholder" BEFORE INSERT OR UPDATE ON "PlatformRole"
  FOR EACH ROW EXECUTE FUNCTION dogfood_no_placeholder_privilege();

ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_secret_state" CHECK (
  ("secretCiphertext" IS NULL AND "secretIv" IS NULL AND "secretAuthTag" IS NULL AND NOT active)
  OR ("secretCiphertext" IS NOT NULL AND "secretIv" IS NOT NULL AND "secretAuthTag" IS NOT NULL)
);

ALTER TABLE "EventArchiveInstance" ADD CONSTRAINT "EventArchiveInstance_singleton" CHECK (singleton = 1);
INSERT INTO "EventArchiveInstance" (singleton, id) VALUES (1, gen_random_uuid());

ALTER TABLE "ImportedVoteAggregate" ADD CONSTRAINT "ImportedVoteAggregate_nonnegative" CHECK (count >= 0);
ALTER TABLE "JudgeParticipationRecord" ADD CONSTRAINT "JudgeParticipationRecord_source_tuple" CHECK (
  ("sourceInstanceId" IS NULL AND "sourceEventId" IS NULL AND "sourceRecordId" IS NULL)
  OR ("sourceInstanceId" IS NOT NULL AND "sourceEventId" IS NOT NULL AND "sourceRecordId" IS NOT NULL)
);

CREATE FUNCTION dogfood_imported_event_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."eventId" IS DISTINCT FROM (SELECT "eventId" FROM "Project" WHERE id = NEW."projectId") THEN
    RAISE EXCEPTION 'Imported row references a project from another event' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'ImportedProjectComment' AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE id = NEW."authorUserId" AND "importedPlaceholder"
  ) THEN
    RAISE EXCEPTION 'Imported comment author must be an unclaimed placeholder' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ImportedVoteAggregate_event_scope" BEFORE INSERT OR UPDATE ON "ImportedVoteAggregate"
  FOR EACH ROW EXECUTE FUNCTION dogfood_imported_event_scope();
CREATE TRIGGER "ImportedProjectComment_event_scope" BEFORE INSERT OR UPDATE ON "ImportedProjectComment"
  FOR EACH ROW EXECUTE FUNCTION dogfood_imported_event_scope();

CREATE TRIGGER "EventArchiveImport_append_only" BEFORE UPDATE OR DELETE ON "EventArchiveImport"
  FOR EACH ROW EXECUTE FUNCTION dogfood_append_only();
CREATE TRIGGER "EventArchiveEntityMap_append_only" BEFORE UPDATE OR DELETE ON "EventArchiveEntityMap"
  FOR EACH ROW EXECUTE FUNCTION dogfood_append_only();

CREATE TABLE "EventArchivePreview" (
  "id" UUID NOT NULL PRIMARY KEY,
  "actorUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "packageHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "EventArchivePreview_actor_hash_expiry" ON "EventArchivePreview"("actorUserId", "packageHash", "expiresAt");
