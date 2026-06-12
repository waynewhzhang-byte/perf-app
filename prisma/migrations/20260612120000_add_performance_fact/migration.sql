-- CreateEnum
CREATE TYPE "PerformanceFactRole" AS ENUM ('FIRST_DISCOVERER', 'CO_DISCOVERER', 'FIRST_HANDLER', 'CO_HANDLER');

-- CreateEnum
CREATE TYPE "PerformanceFactEventType" AS ENUM ('DISCOVERY', 'REMEDIATION');

-- CreateTable
CREATE TABLE "PerformanceFact" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "userId" TEXT,
    "dimensionCode" TEXT NOT NULL,
    "dimensionTitle" TEXT NOT NULL,
    "role" "PerformanceFactRole" NOT NULL,
    "eventType" "PerformanceFactEventType" NOT NULL,
    "score" DECIMAL(10,2) NOT NULL,
    "defectRef" TEXT NOT NULL,
    "defectLevel" TEXT NOT NULL,
    "eventDate" TEXT,
    "sourceFile" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PerformanceFact_year_employeeNo_dimensionCode_idx" ON "PerformanceFact"("year", "employeeNo", "dimensionCode");

-- CreateIndex
CREATE INDEX "PerformanceFact_userId_year_idx" ON "PerformanceFact"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceFact_year_employeeNo_dimensionCode_defectRef_role_eventType_key" ON "PerformanceFact"("year", "employeeNo", "dimensionCode", "defectRef", "role", "eventType");

-- AddForeignKey
ALTER TABLE "PerformanceFact" ADD CONSTRAINT "PerformanceFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
