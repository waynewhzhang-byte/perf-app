import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCompetitionSeeds } from './competition-import';
import { buildInnovationSeeds } from './innovation-import';
import { buildTechContribSeeds, TECH_CONTRIB_KINDS } from './tech-contrib-import';
import { buildViolationSeeds } from './violation-import';

describe('导入事实的源行身份', () => {
  it('内容相同的两条源记录仍生成两条不同事实', () => {
    const duplicateRows = [
      { 工号: 'E001', 姓名: '张三', 项目: '同一项目', 级别: '省公司' },
      { 工号: 'E001', 姓名: '张三', 项目: '同一项目', 级别: '省公司' },
    ];

    const competition = buildCompetitionSeeds(
      duplicateRows,
      { employeeNo: '工号', employeeName: '姓名', award: '项目', level: '级别' },
      2026,
    );
    const innovation = buildInnovationSeeds(
      duplicateRows,
      { employeeNo: '工号', employeeName: '姓名', award: '项目', level: '级别' },
      2026,
    );
    const technical = buildTechContribSeeds(
      TECH_CONTRIB_KINDS.regulation!,
      duplicateRows,
      { employeeNo: '工号', employeeName: '姓名', projectName: '项目' },
      2026,
    );
    const violations = buildViolationSeeds(
      duplicateRows,
      {
        employeeNo: '工号',
        employeeName: '姓名',
        description: '项目',
        level: '级别',
        role: '姓名',
      },
      2026,
    );

    for (const seeds of [competition, innovation, technical, violations]) {
      assert.equal(seeds.length, 2);
      assert.notEqual(seeds[0]!.recordKey, seeds[1]!.recordKey);
      assert.notEqual(seeds[0]!.defectRef, seeds[1]!.defectRef);
      assert.deepEqual(seeds.map((seed) => seed.sourceRowNo), [2, 3]);
    }
  });
});
