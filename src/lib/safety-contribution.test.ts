import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFaultCountFromReason,
  parseSafetyContributionMatrix,
  scoreSafetyContributionEntries,
  DEFAULT_SAFETY_SCORE_CONFIG,
  type SafetyScoreConfig,
} from './safety-contribution';

// 构造最小明细矩阵（表头在第 0 行）：列顺序对齐真实表
//   col[1]=编号 [2]=申报单位 [3]=事由 [4]=申报时间 [5]=工号 [6]=姓名 [7]=单位 [8]=班组 [9]=金额 [10]=是否第一发现人
// 入参元组顺序：(编号, 申报时间, 工号, 姓名, 是否第一发现人, 事由?)
function buildMatrix(rows: Array<[string, string, string, string, string, string?]>): unknown[][] {
  const header = ['', '编号', '申报单位', '事由', '申报时间', '工号', '姓名', '单位', '班组', '金额', '是否第一发现人'];
  return [
    header,
    ...rows.map(([ref, date, no, name, first, reason = '']) => [
      '', ref, '', reason, date, no, name, '', '', 0, first,
    ]),
  ];
}

describe('parseFaultCountFromReason', () => {
  it('N处故障 → N', () => {
    assert.equal(parseFaultCountFromReason('发现2处故障'), 2);
    assert.equal(parseFaultCountFromReason('发现并处置3处故障'), 3);
  });
  it('无 N处故障 → 默认 1', () => {
    assert.equal(parseFaultCountFromReason('储能电机故障'), 1);
    assert.equal(parseFaultCountFromReason(''), 1);
  });
});

describe('parseSafetyContributionMatrix (全量导入，不按单位过滤)', () => {
  const matrix = buildMatrix([
    ['CB001', '2024.1.5', '11403144', '史建文', '是'],
    ['CB001', '2024.1.5', '11403145', '陈磊', '否'],
    ['CB002', '2024.2.1', '11403146', '王五', '否'],
    ['CB002', '2024.2.1', '11403147', '赵六', '否'],
  ]);

  it('不传 unit 时不按单位过滤，全量进入', () => {
    const res = parseSafetyContributionMatrix(matrix, { year: 2024 });
    assert.equal(res.entries.length, 4);
    assert.equal(res.unit, '');
  });

  it('filterNote 不再含「人员范围：所在单位」', () => {
    const res = parseSafetyContributionMatrix(matrix, { year: 2024 });
    assert.ok(!res.filterNote.includes('所在单位'), res.filterNote);
    assert.ok(res.filterNote.includes('工号'));
  });
});

describe('scoreSafetyContributionEntries (参数化计分 + 工号匹配)', () => {
  const matrix = buildMatrix([
    ['CB001', '2024.1.5', '11403144', '史建文', '是'],
    ['CB001', '2024.1.5', '11403145', '陈磊', '否'],
    ['CB002', '2024.2.1', '11403146', '王五', '否'],
    ['CB002', '2024.2.1', '11403147', '赵六', '否'],
  ]);
  const parsed = parseSafetyContributionMatrix(matrix, { year: 2024 });

  it('第一发现人=3；CB001 共同发现人 1 人独得 3；CB002 两个共同发现人均分 3 → 各 1.5', () => {
    // 无需 resolver（工号已在 entry 上）
    const scored = scoreSafetyContributionEntries(parsed.entries, 2024);
    const shi = scored.facts.find((f) => f.employeeName === '史建文')!;
    assert.equal(shi.score, 3);
    assert.equal(shi.role, 'FIRST_DISCOVERER');
    assert.equal(shi.employeeNo, '11403144'); // 工号直取，未走 resolver
    // CB001 只有陈磊 1 个共同发现人 → 3/1 = 3
    const chen = scored.facts.find((f) => f.employeeName === '陈磊')!;
    assert.equal(chen.score, 3);
    assert.equal(chen.role, 'CO_DISCOVERER');
    // CB002 王五+赵六 两个共同发现人均分 3 → 各 1.5
    const wang = scored.facts.find((f) => f.employeeName === '王五')!;
    assert.equal(wang.score, 1.5);
    const zhao = scored.facts.find((f) => f.employeeName === '赵六')!;
    assert.equal(zhao.score, 1.5);
  });

  it('传入自定义 config 改变分数（验证不依赖硬编码）', () => {
    const doubled: SafetyScoreConfig = {
      ...DEFAULT_SAFETY_SCORE_CONFIG,
      roles: {
        FIRST_DISCOVERER: { perIncident: 6, multiplyByFaultCount: true },
        CO_DISCOVERER: { totalShare: 6, multiplyByFaultCount: true, splitAmong: 'CO_DISCOVERER' },
      },
    };
    const scored = scoreSafetyContributionEntries(parsed.entries, 2024, doubled);
    const shi = scored.facts.find((f) => f.employeeName === '史建文')!;
    assert.equal(shi.score, 6); // 6 × 1
    const chen = scored.facts.find((f) => f.employeeName === '陈磊')!;
    assert.equal(chen.score, 6); // CB001 只有 1 个共同发现人，6/1
  });

  it('事由含 2处故障 → faultCount=2，第一发现人 3×2=6', () => {
    const m2 = buildMatrix([['CB009', '2024.1.5', '11404000', '刘涛', '是', '发现2处故障并处置']]);
    const p2 = parseSafetyContributionMatrix(m2, { year: 2024 });
    const scored = scoreSafetyContributionEntries(p2.entries, 2024);
    assert.equal(scored.facts[0].score, 6);
    assert.equal(scored.facts[0].metadata.faultCount, 2);
  });

  it('封顶由 config.cap 控制（默认 12）', () => {
    // 单人多事件累加超 12 → cappedScore=12
    const m = buildMatrix([
      ['CB101', '2024.1.5', '11405000', '甲', '是'],
      ['CB102', '2024.1.6', '11405000', '甲', '是'],
      ['CB103', '2024.1.7', '11405000', '甲', '是'],
      ['CB104', '2024.1.8', '11405000', '甲', '是'],
      ['CB105', '2024.1.9', '11405000', '甲', '是'],
    ]);
    const p = parseSafetyContributionMatrix(m, { year: 2024 });
    const scored = scoreSafetyContributionEntries(p.entries, 2024);
    const jia = scored.byEmployee.find((e) => e.employeeName === '甲')!;
    assert.equal(jia.rawScore, 15); // 5×3
    assert.equal(jia.cappedScore, 12); // 封顶
  });
});
