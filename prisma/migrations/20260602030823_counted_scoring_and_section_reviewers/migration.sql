-- CreateEnum
CREATE TYPE "ScoreMode" AS ENUM ('TIERS', 'COUNTED');

-- AlterTable
ALTER TABLE "FormItem" ADD COLUMN     "maxScore" DECIMAL(10,2),
ADD COLUMN     "scoreMode" "ScoreMode" NOT NULL DEFAULT 'TIERS';

-- CreateTable
CREATE TABLE "SectionReviewer" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionReviewer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionReviewer_reviewerId_idx" ON "SectionReviewer"("reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "SectionReviewer_sectionId_reviewerId_key" ON "SectionReviewer"("sectionId", "reviewerId");

-- AddForeignKey
ALTER TABLE "SectionReviewer" ADD CONSTRAINT "SectionReviewer_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "FormSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectionReviewer" ADD CONSTRAINT "SectionReviewer_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
