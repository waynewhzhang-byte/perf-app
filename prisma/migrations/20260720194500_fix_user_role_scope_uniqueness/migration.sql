-- PostgreSQL treats NULL values as distinct by default. Reviewer scopes use
-- NULL for absent branch/department values, so make those NULLs comparable.
DROP INDEX "UserRole_userId_role_scopeBranchId_scopeDepartmentId_key";

CREATE UNIQUE INDEX "UserRole_userId_role_scopeBranchId_scopeDepartmentId_key"
ON "UserRole"("userId", "role", "scopeBranchId", "scopeDepartmentId") NULLS NOT DISTINCT;
