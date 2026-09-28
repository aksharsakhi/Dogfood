-- A standard unique index on a nullable column does not treat NULL values as
-- equal. Indexing a constant for only active rows makes every active row
-- compete for the same unique key and therefore enforces at most one.
DROP INDEX "JudgeRecordSigningKey_one_active_idx";

CREATE UNIQUE INDEX "JudgeRecordSigningKey_one_active_idx"
ON "JudgeRecordSigningKey" ((true))
WHERE "retiredAt" IS NULL;
