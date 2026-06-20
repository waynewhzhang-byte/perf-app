import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreeTierOrgPlan } from './team-org';

describe('buildThreeTierOrgPlan', () => {
  it('聚合 工区/部门/班组 三层（班组可空）', () => {
    const plan = buildThreeTierOrgPlan([
      { workArea: '晋北运维分部', department: '变电运维一班', team: '一次班' },
      { workArea: '晋北运维分部', department: '变电运维一班', team: '二次班' },
      { workArea: '公司总部', department: '运维检修部', team: '' },
      { workArea: '晋北运维分部', department: '变电运维一班', team: '一次班' }, // 重复去重
    ]);
    assert.deepEqual(plan.workAreas, ['公司总部', '晋北运维分部']);
    assert.deepEqual(plan.departments, [
      { workArea: '公司总部', name: '运维检修部' },
      { workArea: '晋北运维分部', name: '变电运维一班' },
    ]);
    assert.deepEqual(plan.teams, [
      { workArea: '晋北运维分部', department: '变电运维一班', name: '二次班' },
      { workArea: '晋北运维分部', department: '变电运维一班', name: '一次班' },
    ]);
  });

  it('空工区行被跳过', () => {
    const plan = buildThreeTierOrgPlan([
      { workArea: '', department: 'X', team: '' },
      { workArea: '晋北运维分部', department: 'D', team: '' },
    ]);
    assert.deepEqual(plan.workAreas, ['晋北运维分部']);
    assert.deepEqual(plan.departments, [{ workArea: '晋北运维分部', name: 'D' }]);
    assert.deepEqual(plan.teams, []);
  });

  it('部门为空时仅建工区，不建部门/班组', () => {
    const plan = buildThreeTierOrgPlan([
      { workArea: '晋北运维分部', department: '', team: 'T' },
    ]);
    assert.deepEqual(plan.workAreas, ['晋北运维分部']);
    assert.deepEqual(plan.departments, []);
    assert.deepEqual(plan.teams, []);
  });
});
