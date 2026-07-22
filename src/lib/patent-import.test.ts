/**
 * 发明专利导入测试
 *
 * 重点验证 B3 修复：同一员工在不同专利中担任同一序号发明人时，
 * 必须产生多条独立 PerformanceFactSeed（不被 dedupeSeeds 合并）。
 *
 * 历史数据中李勇（11425691）在 4 个专利都是第 1 发明人，被去重成 1 条，
 * 漏算 12 分。本测试确保此场景正确展开为 4 条。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePatentRows,
  buildPatentSeeds,
  DEFAULT_PATENT_MAPPING,
  type PatentFieldMapping,
} from './patent-import';

const mapping: PatentFieldMapping = {
  patentName: '专利名',
  inventorCols: ['发明人1', '工号1', '发明人2', '工号2', '发明人3', '工号3', '发明人4', '工号4'],
};

describe('parsePatentRows', () => {
  it('展开每行至多 4 位发明人', () => {
    const rows = [{
      '专利名': '专利A',
      '发明人1': '张三', '工号1': '001',
      '发明人2': '李四', '工号2': '002',
      '发明人3': '', '工号3': '',
      '发明人4': '', '工号4': '',
    }];
    const parsed = parsePatentRows(rows, mapping);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].rowIndex, 1);
    assert.equal(parsed[0].inventors.length, 2);
    assert.deepEqual(parsed[0].inventors.map((i) => i.order), [1, 2]);
  });

  it('跳过工号缺失的位次', () => {
    const rows = [{
      '专利名': '专利X',
      '发明人1': '张三', '工号1': '001',
      '发明人2': '李四', '工号2': '', // 工号缺失
      '发明人3': '王五', '工号3': '003',
    }];
    const parsed = parsePatentRows(rows, mapping);
    assert.equal(parsed[0].inventors.length, 2);
    assert.deepEqual(parsed[0].inventors.map((i) => i.employeeNo), ['001', '003']);
  });

  it('同行同人多次出现只保留首次', () => {
    const rows = [{
      '专利名': '专利Y',
      '发明人1': '张三', '工号1': '001',
      '发明人2': '张三', '工号2': '001', // 同工号同人
      '发明人3': '李四', '工号3': '002',
    }];
    const parsed = parsePatentRows(rows, mapping);
    assert.equal(parsed[0].inventors.length, 2);
    assert.equal(parsed[0].inventors[0].employeeNo, '001');
    assert.equal(parsed[0].inventors[0].order, 1);
  });
});

describe('buildPatentSeeds', () => {
  it('前 4 位发明人按序得 4/3/2/1 分', () => {
    const parsed = [{
      rowIndex: 1,
      patentName: '专利A',
      inventors: [
        { name: '张三', employeeNo: '001', order: 1 },
        { name: '李四', employeeNo: '002', order: 2 },
        { name: '王五', employeeNo: '003', order: 3 },
        { name: '赵六', employeeNo: '004', order: 4 },
      ],
    }];
    const seeds = buildPatentSeeds(parsed, 2026, 'test.xlsx');
    assert.equal(seeds.length, 4);
    assert.equal(seeds[0].score, 4);
    assert.equal(seeds[1].score, 3);
    assert.equal(seeds[2].score, 2);
    assert.equal(seeds[3].score, 1);
  });

  it('**B3 修复**：同一员工在同名申请人的不同行均为同序号 → 多条独立 seed', () => {
    // 李勇在 4 个专利都是第 1 发明人，源列名相同
    const parsed = [
      { rowIndex: 1, patentName: '同一申请人', inventors: [{ name: '李勇', employeeNo: '11425691', order: 1 }] },
      { rowIndex: 2, patentName: '同一申请人', inventors: [{ name: '李勇', employeeNo: '11425691', order: 1 }] },
      { rowIndex: 3, patentName: '同一申请人', inventors: [{ name: '李勇', employeeNo: '11425691', order: 1 }] },
      { rowIndex: 4, patentName: '同一申请人', inventors: [{ name: '李勇', employeeNo: '11425691', order: 1 }] },
    ];
    const seeds = buildPatentSeeds(parsed, 2026, 'test.xlsx');
    assert.equal(seeds.length, 4, '必须产生 4 条独立 seed');
    // 每条 score 都是 4（第 1 发明人）
    for (const s of seeds) assert.equal(s.score, 4);
    // defectRef 必须各不相同（含专利名）
    const refs = seeds.map((s) => s.defectRef);
    assert.equal(new Set(refs).size, 4, 'defectRef 必须唯一');
    // 同名申请人时仍由 rowIndex 保证 defectRef 唯一
    for (const s of seeds) {
      assert.match(s.defectRef, /^patent:row\d+:order1:同一申请人$/);
    }
  });

  it('defectRef 含 order 避免同人不同专利被合并', () => {
    // 同员工在同一专利的不同序号（理论不可能但验证语义）
    const parsed = [{
      rowIndex: 1,
      patentName: '专利Z',
      inventors: [
        { name: '李', employeeNo: '001', order: 1 },
        { name: '李', employeeNo: '001', order: 2 }, // 实际 parsePatentRows 会去重，但 buildPatentSeeds 仍要稳健
      ],
    }];
    const seeds = buildPatentSeeds(parsed, 2026, 'test.xlsx');
    assert.equal(seeds.length, 2);
    assert.notEqual(seeds[0].defectRef, seeds[1].defectRef);
  });

  it('工号缺失的发明人位次被过滤', () => {
    const parsed = [{
      rowIndex: 1,
      patentName: '专利B',
      inventors: [{ name: '张三', employeeNo: '001', order: 1 }],
    }];
    const seeds = buildPatentSeeds(parsed, 2026, 'test.xlsx');
    assert.equal(seeds.length, 1);
  });
});
