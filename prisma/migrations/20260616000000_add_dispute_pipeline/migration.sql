-- CreateEnum
CREATE TYPE "DisputeResult" AS ENUM ('APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL1Result" "DisputeResult";
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL1Note" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL1ReviewerId" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL1ReviewedAt" TIMESTAMP(3);
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL2Result" "DisputeResult";
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL2Note" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL2ReviewerId" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "disputeL2ReviewedAt" TIMESTAMP(3);
ALTER TABLE "SubmissionItem" ADD COLUMN "overrideScore" DECIMAL(10,2);
ALTER TABLE "SubmissionItem" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "overrideBy" TEXT;
ALTER TABLE "SubmissionItem" ADD COLUMN "overrideAt" TIMESTAMP(3);
