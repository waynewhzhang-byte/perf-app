-- AlterTable
ALTER TABLE "User" ADD COLUMN     "employeeLevelId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeLevel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeLevel_name_key" ON "EmployeeLevel"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeLevelId_fkey" FOREIGN KEY ("employeeLevelId") REFERENCES "EmployeeLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
