export interface L1ReviewerScope {
  scopeBranchId: string | null;
  scopeDepartmentId: string | null;
}

export interface SubmissionOrganization {
  branchId: string | null;
  departmentId: string | null;
}

export function matchesL1Scope(
  scopes: L1ReviewerScope[],
  organization: SubmissionOrganization,
): boolean {
  return scopes.some(
    (scope) =>
      scope.scopeBranchId !== null &&
      scope.scopeBranchId === organization.branchId &&
      (!scope.scopeDepartmentId || scope.scopeDepartmentId === organization.departmentId),
  );
}

export function buildL1SubmissionScopeWhere(scopes: L1ReviewerScope[]) {
  const OR = scopes.flatMap((scope) => {
    if (!scope.scopeBranchId) return [];
    return [{
      branchId: scope.scopeBranchId,
      ...(scope.scopeDepartmentId
        ? { user: { departmentId: scope.scopeDepartmentId } }
        : {}),
    }];
  });

  return OR.length > 0 ? { OR } : null;
}
