CREATE TABLE "JudgeRecordSigningKey" (
    "id" VARCHAR(80) NOT NULL,
    "publicKeyPem" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(6),
    CONSTRAINT "JudgeRecordSigningKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JudgeRecordKeyRotation" (
    "id" UUID NOT NULL,
    "previousKeyId" VARCHAR(80) NOT NULL,
    "activeKeyId" VARCHAR(80) NOT NULL,
    "previousFingerprint" CHAR(64) NOT NULL,
    "activeFingerprint" CHAR(64) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JudgeRecordKeyRotation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JudgeRecordKeyRotation_distinct_keys_check" CHECK ("previousKeyId" <> "activeKeyId")
);

CREATE TABLE "JudgeRecordSubject" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "judgeProfileId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JudgeRecordSubject_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JudgeRecordSubject_eventId_judgeProfileId_key" UNIQUE ("eventId", "judgeProfileId")
);

CREATE TABLE "JudgeParticipationRecord" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "judgeProfileId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "assignmentCount" INTEGER NOT NULL,
    "evaluationCount" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "issuerKeyId" VARCHAR(80) NOT NULL,
    "canonicalPayload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "supersedesRecordId" UUID,
    CONSTRAINT "JudgeParticipationRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JudgeParticipationRecord_counts_check" CHECK ("assignmentCount" >= 0 AND "evaluationCount" >= 0 AND "evaluationCount" <= "assignmentCount"),
    CONSTRAINT "JudgeParticipationRecord_schema_version_check" CHECK ("schemaVersion" > 0)
);

CREATE TABLE "JudgeRecordRevocation" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "issuerKeyId" VARCHAR(80) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revokedAt" TIMESTAMPTZ(6) NOT NULL,
    "canonicalPayload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    CONSTRAINT "JudgeRecordRevocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "JudgeRecordRevocation_schema_version_check" CHECK ("schemaVersion" > 0)
);

CREATE UNIQUE INDEX "JudgeRecordSigningKey_fingerprint_key" ON "JudgeRecordSigningKey"("fingerprint");
CREATE INDEX "JudgeRecordSigningKey_retiredAt_idx" ON "JudgeRecordSigningKey"("retiredAt");
CREATE UNIQUE INDEX "JudgeRecordSigningKey_one_active_idx" ON "JudgeRecordSigningKey"("retiredAt") WHERE "retiredAt" IS NULL;
CREATE INDEX "JudgeRecordKeyRotation_previousKeyId_activeKeyId_idx" ON "JudgeRecordKeyRotation"("previousKeyId", "activeKeyId");
CREATE INDEX "JudgeRecordKeyRotation_rotatedAt_idx" ON "JudgeRecordKeyRotation"("rotatedAt");
CREATE INDEX "JudgeRecordSubject_judgeProfileId_idx" ON "JudgeRecordSubject"("judgeProfileId");
CREATE INDEX "JudgeParticipationRecord_eventId_judgeProfileId_issuedAt_idx" ON "JudgeParticipationRecord"("eventId", "judgeProfileId", "issuedAt");
CREATE INDEX "JudgeParticipationRecord_subjectId_idx" ON "JudgeParticipationRecord"("subjectId");
CREATE UNIQUE INDEX "JudgeParticipationRecord_supersedesRecordId_key" ON "JudgeParticipationRecord"("supersedesRecordId");
CREATE UNIQUE INDEX "JudgeRecordRevocation_recordId_key" ON "JudgeRecordRevocation"("recordId");

ALTER TABLE "JudgeRecordKeyRotation" ADD CONSTRAINT "JudgeRecordKeyRotation_previousKeyId_fkey" FOREIGN KEY ("previousKeyId") REFERENCES "JudgeRecordSigningKey"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeRecordKeyRotation" ADD CONSTRAINT "JudgeRecordKeyRotation_activeKeyId_fkey" FOREIGN KEY ("activeKeyId") REFERENCES "JudgeRecordSigningKey"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeRecordSubject" ADD CONSTRAINT "JudgeRecordSubject_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeRecordSubject" ADD CONSTRAINT "JudgeRecordSubject_judgeProfileId_fkey" FOREIGN KEY ("judgeProfileId") REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeParticipationRecord" ADD CONSTRAINT "JudgeParticipationRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeParticipationRecord" ADD CONSTRAINT "JudgeParticipationRecord_judgeProfileId_fkey" FOREIGN KEY ("judgeProfileId") REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeParticipationRecord" ADD CONSTRAINT "JudgeParticipationRecord_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "JudgeRecordSubject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeParticipationRecord" ADD CONSTRAINT "JudgeParticipationRecord_issuerKeyId_fkey" FOREIGN KEY ("issuerKeyId") REFERENCES "JudgeRecordSigningKey"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeParticipationRecord" ADD CONSTRAINT "JudgeParticipationRecord_supersedesRecordId_fkey" FOREIGN KEY ("supersedesRecordId") REFERENCES "JudgeParticipationRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeRecordRevocation" ADD CONSTRAINT "JudgeRecordRevocation_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "JudgeParticipationRecord"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "JudgeRecordRevocation" ADD CONSTRAINT "JudgeRecordRevocation_issuerKeyId_fkey" FOREIGN KEY ("issuerKeyId") REFERENCES "JudgeRecordSigningKey"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION dogfood_t4b_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JudgeParticipationRecord_append_only"
BEFORE UPDATE OR DELETE ON "JudgeParticipationRecord"
FOR EACH ROW EXECUTE FUNCTION dogfood_t4b_append_only();
CREATE TRIGGER "JudgeRecordRevocation_append_only"
BEFORE UPDATE OR DELETE ON "JudgeRecordRevocation"
FOR EACH ROW EXECUTE FUNCTION dogfood_t4b_append_only();
CREATE TRIGGER "JudgeRecordKeyRotation_append_only"
BEFORE UPDATE OR DELETE ON "JudgeRecordKeyRotation"
FOR EACH ROW EXECUTE FUNCTION dogfood_t4b_append_only();
CREATE TRIGGER "JudgeRecordSubject_append_only"
BEFORE UPDATE OR DELETE ON "JudgeRecordSubject"
FOR EACH ROW EXECUTE FUNCTION dogfood_t4b_append_only();

CREATE OR REPLACE FUNCTION dogfood_t4b_key_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Signing key history cannot be deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'retiredAt') IS DISTINCT FROM (to_jsonb(OLD) - 'retiredAt') THEN
    RAISE EXCEPTION 'Published signing key material is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JudgeRecordSigningKey_immutable_material"
BEFORE UPDATE OR DELETE ON "JudgeRecordSigningKey"
FOR EACH ROW EXECUTE FUNCTION dogfood_t4b_key_guard();
