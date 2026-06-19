import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBranchDepartment, parseOrgFromExcelRow, buildOrgBootstrapPlan, HQ_BRANCH_NAME } from './org-mapping';
import { parsePersonList, buildFactsFromDefectRows } from './defect-governance';

describe('org-mapping', () => {
  it('晋北运维分部 → 二级单位', () => {
    assert.equal(isBranchDepartment('晋北运维分部'), true);
    const p = parseOrgFromExcelRow('晋北运维分部', '变电运维一班');
    assert.equal(p?.kind, 'branch');
    assert.equal(p?.branchName, '晋北运维分部');
    assert.equal(p?.departmentName, '变电运维一班');
  });

  it('运维检修部 → 总部部门', () => {
    assert.equal(isBranchDepartment('运维检修部'), false);
    const p = parseOrgFromExcelRow('运维检修部', '');
    assert.equal(p?.kind, 'hq_department');
    assert.equal(p?.branchName, HQ_BRANCH_NAME);
    assert.equal(p?.departmentName, '运维检修部');
  });

  it('buildOrgBootstrapPlan 含公司总部', () => {
    const plan = buildOrgBootstrapPlan([
      { departmentRaw: '晋北运维分部', teamRaw: '变电运维一班' },
      { departmentRaw: '运维检修部', teamRaw: '' },
    ]);
    assert.ok(plan.branches.includes(HQ_BRANCH_NAME));
    assert.ok(plan.branches.includes('晋北运维分部'));
  });
});

describe('defect person split', () => {
  const resolver = {
    resolve(name: string) {
      const map: Record<string, { employeeNo: string; employeeName: string }> = {
        薛青: { employeeNo: '001', employeeName: '薛青' },
        张卓: { employeeNo: '002', employeeName: '张卓' },
      };
      return map[name] ?? null;
    },
  };

  it('分拆发现人并标记合作完成', () => {
    const partial = buildFactsFromDefectRows(
      [
        {
          编号: 'T-1',
          等级: '严重',
          所属类别: '缺陷',
          发现人: '薛青、张卓',
          发现时间: '2025-06-01',
          问题状态: '待消除',
        },
      ],
      2025,
      resolver,
    );
    assert.equal(partial.facts.length, 2);
    const first = partial.facts.find((f) => f.role === 'FIRST_DISCOVERER');
    const co = partial.facts.find((f) => f.role === 'CO_DISCOVERER');
    assert.ok(first);
    assert.ok(co);
    assert.equal(first!.metadata.isCollaborative, false);
    assert.equal(co!.metadata.isCollaborative, true);
    assert.equal(co!.metadata.rawPersonField, '薛青、张卓');
  });

  it('非缺陷类别跳过', () => {
    const partial = buildFactsFromDefectRows(
      [{ 编号: 'T-2', 等级: '一般', 所属类别: '问题', 发现人: '薛青', 发现时间: '2025-01-01' }],
      2025,
      resolver,
    );
    assert.equal(partial.facts.length, 0);
    assert.equal(partial.rowsSkippedCategory, 1);
  });
});

describe('parsePersonList', () => {
  it('顿号与逗号分拆', () => {
    assert.deepEqual(parsePersonList('薛青、张卓'), ['薛青', '张卓']);
    assert.deepEqual(parsePersonList('薛青,张卓'), ['薛青', '张卓']);
  });
});

describe('buildFactsFromDefectRows (从 scoreMatrix 查分，非硬编码)', () => {
  const resolver = {
    resolve(n: string) {
      const map: Record<string, { employeeNo: string; employeeName: string }> = {
        张三: { employeeNo: 'E-1', employeeName: '张三' },
        李四: { employeeNo: 'E-2', employeeName: '李四' },
      };
      return map[n] ?? null;
    },
  };
  const matrix = {
    危急: { FIRST_DISCOVERER: 3, CO_DISCOVERER: 1, FIRST_HANDLER: 3, CO_HANDLER: 1 },
    严重: { FIRST_DISCOVERER: 1, CO_DISCOVERER: 0.5, FIRST_HANDLER: 1, CO_HANDLER: 0.5 },
    一般: { FIRST_DISCOVERER: 0.5, FIRST_HANDLER: 0.5 },
  };
  const rows = [
    { 编号: 'Q001', 等级: '危急', 发现人: '张三', 消缺人: '', 发现时间: '2024-1-1', 问题状态: '', 所属类别: '缺陷' },
    { 编号: 'Q002', 等级: '一般', 发现人: '李四', 消缺人: '', 发现时间: '2024-1-1', 问题状态: '', 所属类别: '缺陷' },
  ];

  it('事实 score 来自传入的 scoreMatrix', () => {
    const res = buildFactsFromDefectRows(rows as any, 2024, resolver, {}, matrix);
    const zhang = res.facts.find((f) => f.employeeName === '张三')!;
    assert.equal(zhang.score, 3); // 危急 FIRST_DISCOVERER
    const li = res.facts.find((f) => f.employeeName === '李四')!;
    assert.equal(li.score, 0.5); // 一般 FIRST_DISCOVERER
  });

  it('修改 matrix 参数即改变分数（验证不依赖硬编码）', () => {
    const doubled = JSON.parse(JSON.stringify(matrix)) as typeof matrix;
    doubled.危急.FIRST_DISCOVERER = 9;
    const res = buildFactsFromDefectRows([rows[0]] as any, 2024, resolver, {}, doubled);
    assert.equal(res.facts[0].score, 9);
  });

  it('不传 matrix 时回退默认（向后兼容）', () => {
    const res = buildFactsFromDefectRows([rows[0]] as any, 2024, resolver);
    assert.equal(res.facts[0].score, 3); // 默认 危急 FIRST_DISCOVERER=3
  });
});
