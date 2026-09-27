-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('ADMIN');

-- CreateEnum
CREATE TYPE "EventRole" AS ENUM ('PARTICIPANT', 'JUDGE', 'ORGANIZER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WAITLISTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('FORMING', 'ACTIVE', 'LOCKED', 'DISBANDED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConflictType" AS ENUM ('TEAM', 'PROJECT', 'ORGANIZATION', 'OTHER');

-- CreateEnum
CREATE TYPE "RubricStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssignmentMethod" AS ENUM ('MANUAL', 'RANDOM', 'BALANCED', 'ALGORITHMIC');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformRole" (
    "userId" UUID NOT NULL,
    "role" "GlobalRole" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortDescription" TEXT,
    "description" TEXT,
    "rules" TEXT,
    "eligibility" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "registrationOpensAt" TIMESTAMPTZ(6),
    "registrationClosesAt" TIMESTAMPTZ(6),
    "submissionOpensAt" TIMESTAMPTZ(6),
    "submissionClosesAt" TIMESTAMPTZ(6),
    "judgingOpensAt" TIMESTAMPTZ(6),
    "judgingClosesAt" TIMESTAMPTZ(6),
    "votingOpensAt" TIMESTAMPTZ(6),
    "votingClosesAt" TIMESTAMPTZ(6),
    "resultsPublishAt" TIMESTAMPTZ(6),
    "minTeamSize" INTEGER NOT NULL DEFAULT 1,
    "maxTeamSize" INTEGER NOT NULL DEFAULT 5,
    "visibility" "EventVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMembership" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "EventRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EventMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "maxSubmissions" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prize" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "trackId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER,
    "amount" DECIMAL(19,4),
    "currency" CHAR(3),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registration" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'FORMING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(6),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInvitation" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "email" VARCHAR(320),
    "invitedUserId" UUID,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdById" UUID NOT NULL,
    "respondedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "trackId" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "repositoryUrl" TEXT,
    "demoUrl" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "repositoryUrl" TEXT,
    "demoUrl" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(6),
    "lockedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeProfile" (
    "id" UUID NOT NULL,
    "eventMembershipId" UUID NOT NULL,
    "bio" TEXT,
    "organization" TEXT,
    "maxAssignments" INTEGER,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "JudgeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeExpertise" (
    "judgeProfileId" UUID NOT NULL,
    "trackId" UUID NOT NULL,
    "expertiseLevel" INTEGER NOT NULL,

    CONSTRAINT "JudgeExpertise_pkey" PRIMARY KEY ("judgeProfileId","trackId")
);

-- CreateTable
CREATE TABLE "JudgeConflict" (
    "id" UUID NOT NULL,
    "judgeProfileId" UUID NOT NULL,
    "teamId" UUID,
    "projectId" UUID,
    "organization" TEXT,
    "type" "ConflictType" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rubric" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RubricStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricCriterion" (
    "id" UUID NOT NULL,
    "rubricId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weight" DECIMAL(10,9) NOT NULL,
    "minScore" DECIMAL(12,4) NOT NULL,
    "maxScore" DECIMAL(12,4) NOT NULL,
    "displayOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubricCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeAssignment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "judgeProfileId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "assignmentMethod" "AssignmentMethod" NOT NULL,
    "assignedById" UUID,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',

    CONSTRAINT "JudgeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "rubricId" UUID NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "comments" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "submittedAt" TIMESTAMPTZ(6),
    "lockedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationScore" (
    "id" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "criterionId" UUID NOT NULL,
    "score" DECIMAL(12,4) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EvaluationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreRun" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "algorithm" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedScore" (
    "id" UUID NOT NULL,
    "scoreRunId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "rawScore" DECIMAL(20,8) NOT NULL,
    "normalizedScore" DECIMAL(20,8) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizedScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectScore" (
    "id" UUID NOT NULL,
    "scoreRunId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "aggregatedScore" DECIMAL(20,8) NOT NULL,
    "evaluationCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultRun" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "scoreRunId" UUID NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),
    "createdById" UUID,

    CONSTRAINT "ResultRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectResult" (
    "id" UUID NOT NULL,
    "resultRunId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "score" DECIMAL(20,8) NOT NULL,
    "rank" INTEGER NOT NULL,
    "tieGroup" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "eventId" UUID,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID,
    "beforeState" JSONB,
    "afterState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- CreateIndex
CREATE INDEX "Event_createdById_idx" ON "Event"("createdById");

-- CreateIndex
CREATE INDEX "EventMembership_userId_idx" ON "EventMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventMembership_eventId_userId_role_key" ON "EventMembership"("eventId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Track_eventId_slug_key" ON "Track"("eventId", "slug");

-- CreateIndex
CREATE INDEX "Prize_eventId_idx" ON "Prize"("eventId");

-- CreateIndex
CREATE INDEX "Prize_trackId_idx" ON "Prize"("trackId");

-- CreateIndex
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_eventId_userId_key" ON "Registration"("eventId", "userId");

-- CreateIndex
CREATE INDEX "Team_createdById_idx" ON "Team"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_slug_key" ON "Team"("eventId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_eventId_key" ON "Team"("id", "eventId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvitation_tokenHash_key" ON "TeamInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "TeamInvitation_teamId_idx" ON "TeamInvitation"("teamId");

-- CreateIndex
CREATE INDEX "TeamInvitation_invitedUserId_idx" ON "TeamInvitation"("invitedUserId");

-- CreateIndex
CREATE INDEX "TeamInvitation_createdById_idx" ON "TeamInvitation"("createdById");

-- CreateIndex
CREATE INDEX "TeamInvitation_expiresAt_idx" ON "TeamInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");

-- CreateIndex
CREATE INDEX "Project_trackId_idx" ON "Project"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_eventId_slug_key" ON "Project"("eventId", "slug");

-- CreateIndex
CREATE INDEX "Submission_createdById_idx" ON "Submission"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_projectId_version_key" ON "Submission"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeProfile_eventMembershipId_key" ON "JudgeProfile"("eventMembershipId");

-- CreateIndex
CREATE INDEX "JudgeExpertise_trackId_idx" ON "JudgeExpertise"("trackId");

-- CreateIndex
CREATE INDEX "JudgeConflict_judgeProfileId_idx" ON "JudgeConflict"("judgeProfileId");

-- CreateIndex
CREATE INDEX "JudgeConflict_teamId_idx" ON "JudgeConflict"("teamId");

-- CreateIndex
CREATE INDEX "JudgeConflict_projectId_idx" ON "JudgeConflict"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Rubric_eventId_version_key" ON "Rubric"("eventId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RubricCriterion_rubricId_displayOrder_key" ON "RubricCriterion"("rubricId", "displayOrder");

-- CreateIndex
CREATE INDEX "JudgeAssignment_eventId_idx" ON "JudgeAssignment"("eventId");

-- CreateIndex
CREATE INDEX "JudgeAssignment_submissionId_idx" ON "JudgeAssignment"("submissionId");

-- CreateIndex
CREATE INDEX "JudgeAssignment_assignedById_idx" ON "JudgeAssignment"("assignedById");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeAssignment_judgeProfileId_submissionId_key" ON "JudgeAssignment"("judgeProfileId", "submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_assignmentId_key" ON "Evaluation"("assignmentId");

-- CreateIndex
CREATE INDEX "Evaluation_rubricId_idx" ON "Evaluation"("rubricId");

-- CreateIndex
CREATE INDEX "EvaluationScore_criterionId_idx" ON "EvaluationScore"("criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationScore_evaluationId_criterionId_key" ON "EvaluationScore"("evaluationId", "criterionId");

-- CreateIndex
CREATE INDEX "ScoreRun_eventId_createdAt_idx" ON "ScoreRun"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreRun_createdById_idx" ON "ScoreRun"("createdById");

-- CreateIndex
CREATE INDEX "NormalizedScore_evaluationId_idx" ON "NormalizedScore"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedScore_scoreRunId_evaluationId_key" ON "NormalizedScore"("scoreRunId", "evaluationId");

-- CreateIndex
CREATE INDEX "ProjectScore_projectId_idx" ON "ProjectScore"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectScore_scoreRunId_projectId_key" ON "ProjectScore"("scoreRunId", "projectId");

-- CreateIndex
CREATE INDEX "ResultRun_eventId_idx" ON "ResultRun"("eventId");

-- CreateIndex
CREATE INDEX "ResultRun_scoreRunId_idx" ON "ResultRun"("scoreRunId");

-- CreateIndex
CREATE INDEX "ResultRun_createdById_idx" ON "ResultRun"("createdById");

-- CreateIndex
CREATE INDEX "ProjectResult_projectId_idx" ON "ProjectResult"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectResult_resultRunId_projectId_key" ON "ProjectResult"("resultRunId", "projectId");

-- CreateIndex
CREATE INDEX "AuditEvent_eventId_createdAt_idx" ON "AuditEvent"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "PlatformRole" ADD CONSTRAINT "PlatformRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EventMembership" ADD CONSTRAINT "EventMembership_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EventMembership" ADD CONSTRAINT "EventMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_eventId_fkey" FOREIGN KEY ("teamId", "eventId") REFERENCES "Team"("id", "eventId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamInvitation" ADD CONSTRAINT "TeamInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeProfile" ADD CONSTRAINT "JudgeProfile_eventMembershipId_fkey" FOREIGN KEY ("eventMembershipId") REFERENCES "EventMembership"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeExpertise" ADD CONSTRAINT "JudgeExpertise_judgeProfileId_fkey" FOREIGN KEY ("judgeProfileId") REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeExpertise" ADD CONSTRAINT "JudgeExpertise_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeConflict" ADD CONSTRAINT "JudgeConflict_judgeProfileId_fkey" FOREIGN KEY ("judgeProfileId") REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeConflict" ADD CONSTRAINT "JudgeConflict_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeConflict" ADD CONSTRAINT "JudgeConflict_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Rubric" ADD CONSTRAINT "Rubric_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "RubricCriterion" ADD CONSTRAINT "RubricCriterion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_judgeProfileId_fkey" FOREIGN KEY ("judgeProfileId") REFERENCES "JudgeProfile"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "JudgeAssignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EvaluationScore" ADD CONSTRAINT "EvaluationScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EvaluationScore" ADD CONSTRAINT "EvaluationScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "RubricCriterion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScoreRun" ADD CONSTRAINT "ScoreRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ScoreRun" ADD CONSTRAINT "ScoreRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "NormalizedScore" ADD CONSTRAINT "NormalizedScore_scoreRunId_fkey" FOREIGN KEY ("scoreRunId") REFERENCES "ScoreRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "NormalizedScore" ADD CONSTRAINT "NormalizedScore_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "Evaluation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectScore" ADD CONSTRAINT "ProjectScore_scoreRunId_fkey" FOREIGN KEY ("scoreRunId") REFERENCES "ScoreRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectScore" ADD CONSTRAINT "ProjectScore_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_scoreRunId_fkey" FOREIGN KEY ("scoreRunId") REFERENCES "ScoreRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ResultRun" ADD CONSTRAINT "ResultRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectResult" ADD CONSTRAINT "ProjectResult_resultRunId_fkey" FOREIGN KEY ("resultRunId") REFERENCES "ResultRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProjectResult" ADD CONSTRAINT "ProjectResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

