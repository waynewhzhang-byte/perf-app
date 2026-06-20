import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSystemFilledFromSheet,
  isReviewSkippedSystemItem,
  resolveFormItemDimension,
  systemItemStatusOnSubmit,
} from './system-filled-items';

describe('system-filled-items', () => {
  it('resolveFormItemDimension 支持标题推断', () => {
    assert.equal(
      resolveFormItemDimension({ title: '两票执行（满分30分）', dimensionCode: null }),
      'worksite.ticket-execution',
    );
  });

  it('extractSystemFilledFromSheet 仅含 FACT 且 hasImportedFacts', () => {
    const rows = extractSystemFilledFromSheet({
      year: 2025,
      employeeNo: '1',
      employeeName: '甲',
      declarationTier: '一级',
      positiveMaxScore: 56,
      positiveScore: 20,
      deductionScore: 0,
      totalScore: 20,
      sections: [
        {
          code: 'basic',
          title: '基本素质',
          maxScore: 14,
          score: 10,
          items: [
            {
              dimensionCode: 'basic.skill-level',
              title: '技能等级',
              sectionCode: 'basic',
              sectionTitle: '基本素质',
              maxScore: 4,
              score: 3,
              source: 'FACT',
              dataSource: 'fact',
              ruleType: 'BASIC_TIER',
              ruleSummary: '',
              itemId: 'i1',
              hasImportedFacts: true,
              lines: [{ label: '技师', score: 3 }],
            },
          ],
        },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].itemId, 'i1');
  });

  it('确认项提交后直接进入 L1_APPROVED', () => {
    assert.equal(systemItemStatusOnSubmit(true, 'CONFIRMED'), 'L1_APPROVED');
    assert.equal(systemItemStatusOnSubmit(true, 'DISPUTED'), 'PENDING_L1');
  });

  it('已确认系统项跳过 L1 审核', () => {
    assert.equal(isReviewSkippedSystemItem({ isSystemFilled: true, confirmationStatus: 'CONFIRMED' }), true);
  });
});
