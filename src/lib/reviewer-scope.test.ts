import assert from 'node:assert/strict';
import test from 'node:test';
import { buildL1SubmissionScopeWhere, matchesL1Scope } from './reviewer-scope';

test('工区级一级审核范围覆盖整个工区', () => {
  assert.equal(
    matchesL1Scope(
      [{ scopeBranchId: 'branch-1', scopeDepartmentId: null }],
      { branchId: 'branch-1', departmentId: 'department-2' },
    ),
    true,
  );
});

test('总部部门级一级审核范围只覆盖指定部门', () => {
  const scopes = [{ scopeBranchId: 'hq', scopeDepartmentId: 'department-1' }];
  assert.equal(matchesL1Scope(scopes, { branchId: 'hq', departmentId: 'department-1' }), true);
  assert.equal(matchesL1Scope(scopes, { branchId: 'hq', departmentId: 'department-2' }), false);
});

test('空范围角色不具备一级审核权限', () => {
  assert.equal(
    matchesL1Scope(
      [{ scopeBranchId: null, scopeDepartmentId: null }],
      { branchId: null, departmentId: null },
    ),
    false,
  );
});

test('一级审核查询条件同时保留工区级和部门级范围', () => {
  assert.deepEqual(
    buildL1SubmissionScopeWhere([
      { scopeBranchId: 'branch-1', scopeDepartmentId: null },
      { scopeBranchId: 'hq', scopeDepartmentId: 'department-1' },
      { scopeBranchId: null, scopeDepartmentId: null },
    ]),
    {
      OR: [
        { branchId: 'branch-1' },
        { branchId: 'hq', user: { departmentId: 'department-1' } },
      ],
    },
  );
});
