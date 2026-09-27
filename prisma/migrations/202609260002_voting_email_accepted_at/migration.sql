-- The frozen T3A column recorded email-string acceptance, not inbox ownership.
-- PostgreSQL updates the existing VotingIdentity_mode_subject_check expression
-- to refer to the renamed column without weakening the constraint.
ALTER TABLE "VotingIdentity" RENAME COLUMN "emailVerifiedAt" TO "emailAcceptedAt";
