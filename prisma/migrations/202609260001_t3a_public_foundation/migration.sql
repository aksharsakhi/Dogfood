-- CreateEnum
CREATE TYPE "VotingAccessMode" AS ENUM ('OPEN', 'EMAIL_GATED', 'AUTHENTICATED');

-- CreateEnum
CREATE TYPE "ProjectCommentStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "PublicWriteAction" AS ENUM ('VOTE', 'COMMENT');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "votingAccessMode" "VotingAccessMode" NOT NULL DEFAULT 'AUTHENTICATED';

-- CreateTable
CREATE TABLE "VotingIdentity" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "mode" "VotingAccessMode" NOT NULL,
    "userId" UUID,
    "emailHash" CHAR(64),
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "openTokenHash" CHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VotingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VotingEmailChallenge" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "emailHash" CHAR(64) NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VotingEmailChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityVote" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "abuseSignalHash" CHAR(64),
    "castAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicWriteBucket" (
    "eventId" UUID NOT NULL,
    "action" "PublicWriteAction" NOT NULL,
    "subjectHash" CHAR(64) NOT NULL,
    "windowStart" TIMESTAMPTZ(6) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PublicWriteBucket_pkey" PRIMARY KEY ("eventId","action","subjectHash","windowStart")
);

-- CreateTable
CREATE TABLE "ProjectComment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "status" "ProjectCommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hiddenAt" TIMESTAMPTZ(6),
    "hiddenById" UUID,

    CONSTRAINT "ProjectComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VotingIdentity_eventId_mode_idx" ON "VotingIdentity"("eventId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "VotingIdentity_id_eventId_key" ON "VotingIdentity"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VotingIdentity_eventId_userId_key" ON "VotingIdentity"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VotingIdentity_eventId_emailHash_key" ON "VotingIdentity"("eventId", "emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "VotingIdentity_eventId_openTokenHash_key" ON "VotingIdentity"("eventId", "openTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "VotingEmailChallenge_tokenHash_key" ON "VotingEmailChallenge"("tokenHash");

-- CreateIndex
CREATE INDEX "VotingEmailChallenge_eventId_emailHash_createdAt_idx" ON "VotingEmailChallenge"("eventId", "emailHash", "createdAt");

-- CreateIndex
CREATE INDEX "VotingEmailChallenge_expiresAt_idx" ON "VotingEmailChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "CommunityVote_eventId_projectId_idx" ON "CommunityVote"("eventId", "projectId");

-- CreateIndex
CREATE INDEX "CommunityVote_eventId_abuseSignalHash_idx" ON "CommunityVote"("eventId", "abuseSignalHash");

-- CreateIndex
CREATE INDEX "CommunityVote_identityId_idx" ON "CommunityVote"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityVote_eventId_identityId_key" ON "CommunityVote"("eventId", "identityId");

-- CreateIndex
CREATE INDEX "PublicWriteBucket_windowStart_idx" ON "PublicWriteBucket"("windowStart");

-- CreateIndex
CREATE INDEX "ProjectComment_eventId_projectId_status_createdAt_idx" ON "ProjectComment"("eventId", "projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_identityId_createdAt_idx" ON "ProjectComment"("identityId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectComment_hiddenById_idx" ON "ProjectComment"("hiddenById");

-- CreateIndex
CREATE UNIQUE INDEX "Event_id_votingAccessMode_key" ON "Event"("id", "votingAccessMode");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_eventId_key" ON "Project"("id", "eventId");

-- AddForeignKey
ALTER TABLE "VotingIdentity" ADD CONSTRAINT "VotingIdentity_eventId_mode_fkey" FOREIGN KEY ("eventId", "mode") REFERENCES "Event"("id", "votingAccessMode") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VotingIdentity" ADD CONSTRAINT "VotingIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VotingEmailChallenge" ADD CONSTRAINT "VotingEmailChallenge_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CommunityVote" ADD CONSTRAINT "CommunityVote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CommunityVote" ADD CONSTRAINT "CommunityVote_projectId_eventId_fkey" FOREIGN KEY ("projectId", "eventId") REFERENCES "Project"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CommunityVote" ADD CONSTRAINT "CommunityVote_identityId_eventId_fkey" FOREIGN KEY ("identityId", "eventId") REFERENCES "VotingIdentity"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PublicWriteBucket" ADD CONSTRAINT "PublicWriteBucket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express CHECK constraints for discriminated identity material.
ALTER TABLE "VotingIdentity" ADD CONSTRAINT "VotingIdentity_mode_subject_check" CHECK (
    ("mode" = 'OPEN' AND "openTokenHash" IS NOT NULL AND "userId" IS NULL AND "emailHash" IS NULL AND "emailVerifiedAt" IS NULL) OR
    ("mode" = 'EMAIL_GATED' AND "openTokenHash" IS NULL AND "userId" IS NULL AND "emailHash" IS NOT NULL AND "emailVerifiedAt" IS NOT NULL) OR
    ("mode" = 'AUTHENTICATED' AND "openTokenHash" IS NULL AND "userId" IS NOT NULL AND "emailHash" IS NULL AND "emailVerifiedAt" IS NULL)
);

-- A hidden comment must retain the time and organizer who hid it.
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_moderation_state_check" CHECK (
    ("status" = 'VISIBLE' AND "hiddenAt" IS NULL AND "hiddenById" IS NULL) OR
    ("status" = 'HIDDEN' AND "hiddenAt" IS NOT NULL AND "hiddenById" IS NOT NULL)
);

-- A rate bucket cannot be driven below zero by direct database writes.
ALTER TABLE "PublicWriteBucket" ADD CONSTRAINT "PublicWriteBucket_nonnegative_attempts_check" CHECK ("attemptCount" >= 0);

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_projectId_eventId_fkey" FOREIGN KEY ("projectId", "eventId") REFERENCES "Project"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_identityId_eventId_fkey" FOREIGN KEY ("identityId", "eventId") REFERENCES "VotingIdentity"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectComment" ADD CONSTRAINT "ProjectComment_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
