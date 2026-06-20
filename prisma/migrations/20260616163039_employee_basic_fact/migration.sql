-- CreateEnum
CREATE TYPE "BasicDimension" AS ENUM ('SKILL_LEVEL', 'TITLE_LEVEL', 'PERFORMANCE_LEVEL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "gender" TEXT,
ADD COLUMN     "profile" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "EmployeeBasicFact" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "employeeNo" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "userId" TEXT,
    "dimension" "BasicDimension" NOT NULL,
    "tierValue" TEXT NOT NULL,
    "yearBreakdown" JSONB,
    "score" DECIMAL(10,2) NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeBasicFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeBasicFact_year_employeeNo_idx" ON "EmployeeBasicFact"("year", "employeeNo");

-- CreateIndex
CREATE INDEX "EmployeeBasicFact_userId_year_idx" ON "EmployeeBasicFact"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeBasicFact_year_employeeNo_dimension_key" ON "EmployeeBasicFact"("year", "employeeNo", "dimension");

-- AddForeignKey
ALTER TABLE "EmployeeBasicFact" ADD CONSTRAINT "EmployeeBasicFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "PerformanceFact_year_employeeNo_dimensionCode_defectRef_role_ev" RENAME TO "PerformanceFact_year_employeeNo_dimensionCode_defectRef_rol_key";
