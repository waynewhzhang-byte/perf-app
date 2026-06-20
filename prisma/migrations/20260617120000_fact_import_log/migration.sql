-- CreateTable
CREATE TABLE "FactImportLog" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pipeline',
    "sourceFiles" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "unmatched" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "FactImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactImportLog_year_createdAt_idx" ON "FactImportLog"("year", "createdAt" DESC);
