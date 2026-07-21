-- Removing a department must remove its scoped L1 reviewer assignments.
-- SET NULL would silently widen an HQ department reviewer to all of HQ.
ALTER TABLE "UserRole" DROP CONSTRAINT "UserRole_scopeDepartmentId_fkey";

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_scopeDepartmentId_fkey"
FOREIGN KEY ("scopeDepartmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
