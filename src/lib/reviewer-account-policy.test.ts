import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateReviewerScope,
  validateRoleAccountBoundary,
} from './reviewer-account-policy';

const hqId = 'hq';

test('一级审核员可按普通工区授权，但不能附带部门', () => {
  assert.deepEqual(validateReviewerScope({
    role: 'REVIEWER_L1',
    branchId: 'branch-1',
    branchName: '变电检修中心',
    departmentId: null,
    departmentName: null,
    departmentBranchId: null,
  }), { ok: true });

  assert.equal(validateReviewerScope({
    role: 'REVIEWER_L1',
    branchId: 'branch-1',
    branchName: '变电检修中心',
    departmentId: 'dept-1',
    departmentName: '检修一班',
    departmentBranchId: 'branch-1',
  }).ok, false);
});

test('公司总部一级审核员必须绑定总部二级部门', () => {
  assert.deepEqual(validateReviewerScope({
    role: 'REVIEWER_L1',
    branchId: hqId,
    branchName: '公司总部',
    departmentId: 'dept-1',
    departmentName: '综合服务中心（物资保障中心）',
    departmentBranchId: hqId,
  }), { ok: true });

  assert.equal(validateReviewerScope({
    role: 'REVIEWER_L1',
    branchId: hqId,
    branchName: '公司总部',
    departmentId: 'dept-1',
    departmentName: '综合服务中心（物资保障中心）',
    departmentBranchId: 'another-branch',
  }).ok, false);
});

test('二级审核员只允许公司总部三个指定部门', () => {
  for (const name of ['公司组织部', '公司安监部', '公司运检部']) {
    assert.deepEqual(validateReviewerScope({
      role: 'REVIEWER_L2',
      branchId: hqId,
      branchName: '公司总部',
      departmentId: `dept-${name}`,
      departmentName: name,
      departmentBranchId: hqId,
    }), { ok: true });
  }

  assert.equal(validateReviewerScope({
    role: 'REVIEWER_L2',
    branchId: hqId,
    branchName: '公司总部',
    departmentId: 'dept-other',
    departmentName: '综合服务中心（物资保障中心）',
    departmentBranchId: hqId,
  }).ok, false);
});

test('员工账号与独立审核账号的角色边界不可混用', () => {
  assert.equal(validateRoleAccountBoundary('10001', 'REVIEWER_L1').ok, false);
  assert.equal(validateRoleAccountBoundary('10001', 'REVIEWER_L2').ok, false);
  assert.equal(validateRoleAccountBoundary(null, 'EMPLOYEE').ok, false);
  assert.deepEqual(validateRoleAccountBoundary('10001', 'EMPLOYEE'), { ok: true });
  assert.deepEqual(validateRoleAccountBoundary(null, 'REVIEWER_L1'), { ok: true });
});
