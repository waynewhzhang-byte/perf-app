-- AlterTable
ALTER TABLE "UserRole" ADD COLUMN "scopeDepartmentId" TEXT;

-- DropIndex
DROP INDEX "UserRole_userId_role_scopeBranchId_key";

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_scopeBranchId_scopeDepartmentId_key"
ON "UserRole"("userId", "role", "scopeBranchId", "scopeDepartmentId");

-- CreateIndex
CREATE INDEX "UserRole_scopeDepartmentId_idx" ON "UserRole"("scopeDepartmentId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_scopeDepartmentId_fkey"
FOREIGN KEY ("scopeDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Normalize the three head-office departments used by second-level review.
UPDATE "Department" AS department
SET "name" = mapping."targetName"
FROM "Branch" AS branch,
  (VALUES
    ('党委组织部（人力资源部）', '公司组织部'),
    ('安全监察部（应急管理部、保卫部）', '公司安监部'),
    ('运维检修部', '公司运检部')
  ) AS mapping("sourceName", "targetName")
WHERE department."branchId" = branch."id"
  AND branch."name" = '公司总部'
  AND department."name" = mapping."sourceName";

-- Head-office employees are assigned to a department, not to a work team.
UPDATE "User" AS employee
SET "teamId" = NULL
FROM "Branch" AS branch, "Department" AS department
WHERE employee."branchId" = branch."id"
  AND employee."departmentId" = department."id"
  AND branch."name" = '公司总部'
  AND department."name" = '综合服务中心（物资保障中心）';
