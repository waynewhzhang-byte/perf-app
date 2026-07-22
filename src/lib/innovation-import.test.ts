import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildInnovationSeeds, inferInnovationLevel } from './innovation-import';

describe('innovation-import', () => {
  it('treats the source level as authoritative over a national word in the award name', () => {
    assert.equal(
      inferInnovationLevel('省公司级获奖成果', '中国质量改进和创新活动全国QC发表赛一等奖'),
      'sheng',
    );
  });

  it('falls back to the award name only when the source level is absent', () => {
    assert.equal(inferInnovationLevel('', '中国质量改进和创新活动全国QC发表赛一等奖'), 'guowang');
  });

  it('scores Li Peng\'s three provincial QC awards as two points each', () => {
    const rows = [
      ['2025年山西省电业系统“五小”创新大赛优秀奖', '省公司级获奖成果'],
      ['中国质量改进和创新活动全国QC发表赛示范级', '省公司级获奖成果'],
      ['中国质量改进和创新活动全国QC发表赛一等奖', '省公司级获奖成果'],
    ].map(([award, level]) => ({
      人员编号: '30137594',
      姓名: '李鹏',
      奖项: award,
      项目: level,
      备注: '示例项目',
    }));

    const scores = buildInnovationSeeds(
      rows,
      { employeeNo: '人员编号', employeeName: '姓名', award: '奖项', level: '项目', project: '备注' },
      2026,
    ).map((seed) => seed.score);

    assert.deepEqual(scores, [2, 2, 2]);
  });
});
