import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertEmployeeScoreTotalsPreserved } from './performance-fact-repository';

describe('assertEmployeeScoreTotalsPreserved', () => {
  it('允许汇总事实拆成多条明细，但员工总分必须相同', () => {
    assert.doesNotThrow(() => assertEmployeeScoreTotalsPreserved(
      [{ employeeNo: 'E001', score: 5 }],
      [
        { employeeNo: 'E001', score: 2 },
        { employeeNo: 'E001', score: 3 },
      ],
      '测试维度',
    ));
  });

  it('任一员工原始总分变化时拒绝明细导入', () => {
    assert.throws(
      () => assertEmployeeScoreTotalsPreserved(
        [{ employeeNo: 'E001', score: 5 }],
        [{ employeeNo: 'E001', score: 4.99 }],
        '测试维度',
      ),
      /会改变 1 名员工的原始分，已拒绝写入/,
    );
  });
});
