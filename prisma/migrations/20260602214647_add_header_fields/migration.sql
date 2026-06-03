-- AlterTable
ALTER TABLE "AutoReviewRule" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FormTemplate" ADD COLUMN     "headerFields" JSONB NOT NULL DEFAULT '[]';
