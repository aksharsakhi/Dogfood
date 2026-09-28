-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERING', 'DELIVERED', 'RETRYING', 'EXHAUSTED');

-- CreateTable
CREATE TABLE "WebhookSubscription" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretCiphertext" TEXT NOT NULL,
    "secretIv" VARCHAR(32) NOT NULL,
    "secretAuthTag" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookOutboxEvent" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "outboxEventId" UUID NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cycleAttempts" INTEGER NOT NULL DEFAULT 0,
    "manualReplays" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(6),
    "leaseToken" UUID,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "lastHttpStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDeliveryAttempt" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "httpStatus" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookSubscription_eventId_active_createdAt_idx" ON "WebhookSubscription"("eventId", "active", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookOutboxEvent_eventId_occurredAt_idx" ON "WebhookOutboxEvent"("eventId", "occurredAt");

-- CreateIndex
CREATE INDEX "WebhookOutboxEvent_eventType_occurredAt_idx" ON "WebhookOutboxEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_leaseUntil_idx" ON "WebhookDelivery"("status", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_idx" ON "WebhookDelivery"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_subscriptionId_outboxEventId_key" ON "WebhookDelivery"("subscriptionId", "outboxEventId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryAttempt_deliveryId_startedAt_idx" ON "WebhookDeliveryAttempt"("deliveryId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeliveryAttempt_deliveryId_attemptNo_key" ON "WebhookDeliveryAttempt"("deliveryId", "attemptNo");

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WebhookOutboxEvent" ADD CONSTRAINT "WebhookOutboxEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "WebhookOutboxEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "WebhookDeliveryAttempt" ADD CONSTRAINT "WebhookDeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Logical outbox events are immutable; delivery attempts and state remain mutable.
CREATE FUNCTION dogfood_webhook_outbox_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Webhook outbox events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER webhook_outbox_event_immutable
BEFORE UPDATE OR DELETE ON "WebhookOutboxEvent"
FOR EACH ROW EXECUTE FUNCTION dogfood_webhook_outbox_immutable();

ALTER TABLE "WebhookOutboxEvent"
  ADD CONSTRAINT "WebhookOutboxEvent_schemaVersion_check" CHECK ("schemaVersion" = 1);
