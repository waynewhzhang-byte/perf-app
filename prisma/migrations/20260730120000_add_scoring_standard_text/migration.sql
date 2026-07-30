-- CreateTable
CREATE TABLE "ScoringStandardText" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "dimensionCode" TEXT NOT NULL,
    "title" TEXT,
    "scoringSummary" TEXT,
    "ownerDepartment" TEXT,
    "referenceFile" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringStandardText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoringStandardText_year_dimensionCode_key" ON "ScoringStandardText"("year", "dimensionCode");

-- CreateIndex
CREATE INDEX "ScoringStandardText_year_idx" ON "ScoringStandardText"("year");
