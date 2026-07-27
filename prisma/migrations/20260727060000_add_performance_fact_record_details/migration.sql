-- AlterTable
ALTER TABLE "PerformanceFact"
ADD COLUMN "recordKey" TEXT,
ADD COLUMN "recordType" TEXT,
ADD COLUMN "recordTitle" TEXT,
ADD COLUMN "participationRole" TEXT,
ADD COLUMN "sourceSheet" TEXT,
ADD COLUMN "sourceRowNo" INTEGER;

-- CreateIndex
CREATE INDEX "PerformanceFact_year_employeeNo_dimensionCode_recordKey_idx"
ON "PerformanceFact"("year", "employeeNo", "dimensionCode", "recordKey");
