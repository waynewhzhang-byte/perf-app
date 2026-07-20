CREATE TYPE "FactCorrectionKind" AS ENUM ('BASIC', 'PERFORMANCE');
CREATE TYPE "FactCorrectionAction" AS ENUM ('CREATE', 'UPDATE');

CREATE TABLE "FactCorrection" (
    "id" TEXT NOT NULL,
    "submissionItemId" TEXT NOT NULL,
    "kind" "FactCorrectionKind" NOT NULL,
    "action" "FactCorrectionAction" NOT NULL,
    "factId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceNote" TEXT,
    "correctedBy" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FactCorrection_submissionItemId_correctedAt_idx" ON "FactCorrection"("submissionItemId", "correctedAt");

ALTER TABLE "FactCorrection" ADD CONSTRAINT "FactCorrection_submissionItemId_fkey"
  FOREIGN KEY ("submissionItemId") REFERENCES "SubmissionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
