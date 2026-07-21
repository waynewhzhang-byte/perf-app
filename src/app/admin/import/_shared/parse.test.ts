/**
 * parse.ts 合并单元格展开测试
 *
 * 验证 B1 修复：源文件（如《运规》编写会审人员）使用合并单元格表达
 * "同一规程/地域下多人"，必须展开后才能正确解析每行。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { expandMergedCells, parseXLSX } from './parse';

/** 构造一个含合并单元格的 worksheet，模拟《运规》数据格式。
 *  用 null 模拟真实 .xlsx 文件读出的合并范围（只有 top-left 有值）。
 */
function buildMergedSheet(): XLSX.WorkSheet {
  // 真实 .xlsx 读出后形态：合并范围内只有 top-left 有值，其他为 null/undefined
  const aoa: (string | null)[][] = [
    ['规程名', '姓名', '人员编号', '角色'],
    ['A规程', '张三', '001', '会审'],
    [null, '李四', '002', '会审'],
    [null, '王五', '003', '编写'],
    ['B规程', '张三', '001', '会审'],
    [null, '赵六', '004', '会审'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 合并 A2:A4 (A规程) 和 A5:A6 (B规程)
  ws['!merges'] = [
    { s: { r: 1, c: 0 }, e: { r: 3, c: 0 } }, // A2:A4
    { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } }, // A5:A6
  ];
  return ws;
}

describe('expandMergedCells', () => {
  it('无 merges 时原样返回', () => {
    const ws = XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]);
    const out = expandMergedCells(ws);
    assert.equal(out, ws); // 同一引用
  });

  it('把 top-left 值复制到所有覆盖单元格', () => {
    const ws = buildMergedSheet();
    // 原始 sheet：合并范围内的非 top-left cell 不存在
    assert.equal(ws.A3, undefined);
    assert.equal(ws.A4, undefined);
    assert.equal(ws.A6, undefined);

    const out = expandMergedCells(ws);
    // 展开后：A3、A4 应有 'A规程'，A6 应有 'B规程'
    assert.equal((out.A3 as XLSX.CellObject).v, 'A规程');
    assert.equal((out.A4 as XLSX.CellObject).v, 'A规程');
    assert.equal((out.A6 as XLSX.CellObject).v, 'B规程');
    // top-left 保持不变
    assert.equal((out.A2 as XLSX.CellObject).v, 'A规程');
  });

  it('不修改原 sheet（返回新对象）', () => {
    const ws = buildMergedSheet();
    const originalA3 = ws.A3;
    expandMergedCells(ws);
    // 原 sheet 的 A3 不变（仍是 undefined）
    assert.equal(ws.A3, originalA3);
    assert.equal(ws.A3, undefined);
  });

  it('合并 header 行也正确展开', () => {
    // 模拟：表头第 1 行合并 A1:B1 = "基本信息"，B1 是合并范围内的非 top-left（null）
    const aoa: (string | null)[][] = [
      ['基本信息', null, '姓名'],
      ['x', 'y', '张三'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    assert.equal(ws.B1, undefined);
    const out = expandMergedCells(ws);
    assert.equal((out.B1 as XLSX.CellObject).v, '基本信息');
  });
});

describe('parseXLSX (含合并单元格)', () => {
  /** 把含合并单元格的 worksheet 写入 buffer，再用 parseXLSX 读回 */
  function roundTrip(ws: XLSX.WorkSheet): ReturnType<typeof parseXLSX> {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    return parseXLSX(buf);
  }

  it('《运规》场景：6 行 2 规程，每行的规程名都被填充', () => {
    const parsed = roundTrip(buildMergedSheet());
    assert.equal(parsed.rows.length, 5);
    // 所有行都应有规程名，不再为空
    const rules = parsed.rows.map((r) => r['规程名']);
    assert.deepEqual(rules, ['A规程', 'A规程', 'A规程', 'B规程', 'B规程']);
  });

  it('每行的地域/规程等合并字段都被填充，避免按工号去重时漏算多次参与', () => {
    const parsed = roundTrip(buildMergedSheet());
    // 张三出现在 A规程 和 B规程（两行）
    const zhangRows = parsed.rows.filter((r) => r['姓名'] === '张三');
    assert.equal(zhangRows.length, 2);
    assert.deepEqual(
      zhangRows.map((r) => r['规程名']),
      ['A规程', 'B规程'],
    );
    // 李四、王五、赵六 各 1 行，规程名都正确
    assert.equal(parsed.rows.find((r) => r['姓名'] === '李四')?.['规程名'], 'A规程');
    assert.equal(parsed.rows.find((r) => r['姓名'] === '王五')?.['规程名'], 'A规程');
    assert.equal(parsed.rows.find((r) => r['姓名'] === '赵六')?.['规程名'], 'B规程');
  });

  it('无合并单元格的普通 sheet 行为不变（向后兼容）', () => {
    const aoa = [
      ['姓名', '工号'],
      ['张三', '001'],
      ['李四', '002'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const parsed = roundTrip(ws);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0]['姓名'], '张三');
    assert.equal(parsed.rows[1]['姓名'], '李四');
  });
});
