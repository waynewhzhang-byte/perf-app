-- PRE_REVIEW_REJECTED was never written by application code (ADR-0006 soft tip).
-- Migrate any stray rows, then recreate the enum without that value.

UPDATE "Submission"
SET status = 'DRAFT'
WHERE status = 'PRE_REVIEW_REJECTED';

ALTER TYPE "SubmissionStatus" RENAME TO "SubmissionStatus_old";

CREATE TYPE "SubmissionStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'L1_APPROVED',
  'L2_APPROVED',
  'REJECTED'
);

ALTER TABLE "Submission"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "SubmissionStatus"
    USING ("status"::text::"SubmissionStatus"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"SubmissionStatus";

DROP TYPE "SubmissionStatus_old";
