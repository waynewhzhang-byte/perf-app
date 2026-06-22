import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHeaderMapping } from './import-auto-map';
import { getItemConfig } from '../app/admin/import/_shared/field-specs';

describe('resolveHeaderMapping', () => {
  it('合并表头：精确映射技能等级而非技能等级工种', () => {
    const headers = [
      '人员编码', '姓名', '技能等级工种', '技能等级', '专业技术资格等级',
      '2023年考核等级', '2024年考核等级', '2025年考核等级',
    ];
    const mapping = resolveHeaderMapping(headers, getItemConfig('basic').fields);
    assert.equal(mapping.employeeNo, '人员编码');
    assert.equal(mapping.skill, '技能等级');
    assert.equal(mapping.title, '专业技术资格等级');
    assert.equal(mapping.perf2023, '2023年考核等级');
  });

  it('原始 sheet1 表头：人员编号 + 专业技术资格等级', () => {
    const headers = [
      '人员编号', '姓名', '部门', '工区', '班组/处室', '岗位',
      '岗位分类代码', '岗位分类', '工作负责人标识', '性别',
      '技能等级工种', '技能等级', '专业技术资格系列', '专业技术资格等级',
    ];
    const mapping = resolveHeaderMapping(headers, getItemConfig('basic').fields);
    assert.equal(mapping.employeeNo, '人员编号');
    assert.equal(mapping.skill, '技能等级');
    assert.equal(mapping.title, '专业技术资格等级');
  });
});
