-- CreateTable
CREATE TABLE "SubmissionDimensionFact" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "userId" TEXT,
    "submissionId" TEXT NOT NULL,
    "submissionItemId" TEXT NOT NULL,
    "formItemId" TEXT NOT NULL,
    "dimensionCode" TEXT NOT NULL,
    "dimensionTitle" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unitScore" DECIMAL(10,2) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "score" DECIMAL(10,2) NOT NULL,
    "content" TEXT,
    "departmentId" TEXT,
    "sourceFile" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionDimensionFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionDimensionFact_year_employeeNo_dimensionCode_idx" ON "SubmissionDimensionFact"("year", "employeeNo", "dimensionCode");

-- CreateIndex
CREATE INDEX "SubmissionDimensionFact_submissionId_idx" ON "SubmissionDimensionFact"("submissionId");

-- CreateIndex
CREATE INDEX "SubmissionDimensionFact_userId_year_idx" ON "SubmissionDimensionFact"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionDimensionFact_year_employeeNo_dimensionCode_submissionItemId_optionId_key" ON "SubmissionDimensionFact"("year", "employeeNo", "dimensionCode", "submissionItemId", "optionId");

-- AddForeignKey
ALTER TABLE "SubmissionDimensionFact" ADD CONSTRAINT "SubmissionDimensionFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
