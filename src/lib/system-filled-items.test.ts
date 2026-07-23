import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  disputedItemPersistError,
  extractSystemFilledFromSheet,
  isL1ReviewQueueItem,
  isReviewSkippedSystemItem,
  isSystemConfirmationDimension,
  resolveAppealCentricConfirmation,
  resolveFormItemDimension,
  submitModeCrossCheckError,
  systemItemStatusOnSubmit,
} from './system-filled-items';

describe('system-filled-items', () => {
  it('resolveFormItemDimension 支持标题推断', () => {
    assert.equal(
      resolveFormItemDimension({ title: '两票执行（满分30分）', dimensionCode: null }),
      'worksite.ticket-execution',
    );
  });

  it('extractSystemFilledFromSheet 包含没有导入事实的 0 分事实项', () => {
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
            {
              dimensionCode: 'basic.title-level',
              title: '职称等级',
              sectionCode: 'basic',
              sectionTitle: '基本素质',
              maxScore: 4,
              score: 0,
              source: 'NONE',
              dataSource: 'fact',
              ruleType: 'BASIC_TIER',
              ruleSummary: '',
              itemId: 'i2',
              hasImportedFacts: false,
              lines: [],
            },
          ],
        },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].itemId, 'i1');
    assert.equal(rows[1].itemId, 'i2');
  });

  it('参加工作时间也是系统确认项', () => {
    assert.equal(isSystemConfirmationDimension('profile.hire-date'), true);
    assert.equal(isSystemConfirmationDimension('basic.skill-level'), true);
    assert.equal(isSystemConfirmationDimension('unknown'), false);
  });

  it('确认项提交后直接进入 L1_APPROVED', () => {
    assert.equal(systemItemStatusOnSubmit(true, 'CONFIRMED'), 'L1_APPROVED');
    assert.equal(systemItemStatusOnSubmit(true, 'DISPUTED'), 'PENDING_L1');
  });

  it('已确认系统项跳过 L1 审核', () => {
    assert.equal(isReviewSkippedSystemItem({ isSystemFilled: true, confirmationStatus: 'CONFIRMED' }), true);
  });

  it('submitModeCrossCheck AFFIRM 拒绝存在申诉', () => {
    assert.equal(submitModeCrossCheckError('AFFIRM', true), '存在申诉内容时不能使用「确认无异议」提交');
    assert.equal(submitModeCrossCheckError('AFFIRM', false), null);
  });

  it('submitModeCrossCheck APPEAL 要求至少一项申诉', () => {
    assert.equal(submitModeCrossCheckError('APPEAL', false), '请先保存至少一项申诉后再提交审核');
    assert.equal(submitModeCrossCheckError('APPEAL', true), null);
  });

  it('disputedItemPersistError 校验理由、主张分、附件', () => {
    assert.equal(
      disputedItemPersistError({
        title: '缺陷治理',
        disputeReason: '',
        disputeClaimedScore: 5,
        attachmentCount: 1,
      }),
      '请填写「缺陷治理」的申诉理由',
    );
    assert.equal(
      disputedItemPersistError({
        title: '缺陷治理',
        disputeReason: '分数有误',
        disputeClaimedScore: null,
        attachmentCount: 1,
      }),
      '请填写「缺陷治理」的申诉分值',
    );
    assert.equal(
      disputedItemPersistError({
        title: '缺陷治理',
        disputeReason: '分数有误',
        disputeClaimedScore: 5,
        attachmentCount: 0,
      }),
      '「缺陷治理」申诉须上传证明材料',
    );
    assert.equal(
      disputedItemPersistError({
        title: '缺陷治理',
        disputeReason: '分数有误',
        disputeClaimedScore: 5,
        attachmentCount: 1,
      }),
      null,
    );
  });

  it('resolveAppealCentricConfirmation AFFIRM 提交全部确认', () => {
    assert.equal(
      resolveAppealCentricConfirmation({
        submit: true,
        submitMode: 'AFFIRM',
        payloadStatus: 'DISPUTED',
      }),
      'CONFIRMED',
    );
  });

  it('resolveAppealCentricConfirmation 草稿显式 null 清除已有申诉', () => {
    assert.equal(
      resolveAppealCentricConfirmation({
        submit: false,
        submitMode: 'APPEAL',
        payloadStatus: null,
        existingStatus: 'DISPUTED',
        payloadIncludesStatus: true,
      }),
      null,
    );
    assert.equal(
      resolveAppealCentricConfirmation({
        submit: false,
        submitMode: 'APPEAL',
        existingStatus: 'DISPUTED',
      }),
      'DISPUTED',
    );
  });

  it('resolveAppealCentricConfirmation APPEAL 提交未申诉项自动确认', () => {
    assert.equal(
      resolveAppealCentricConfirmation({
        submit: true,
        submitMode: 'APPEAL',
        payloadStatus: null,
      }),
      'CONFIRMED',
    );
    assert.equal(
      resolveAppealCentricConfirmation({
        submit: true,
        submitMode: 'APPEAL',
        payloadStatus: 'DISPUTED',
      }),
      'DISPUTED',
    );
  });

  it('isL1ReviewQueueItem 仅申诉行进 L1 队列', () => {
    assert.equal(
      isL1ReviewQueueItem({
        status: 'PENDING_L1',
        isSystemFilled: true,
        confirmationStatus: 'DISPUTED',
      }),
      true,
    );
    assert.equal(
      isL1ReviewQueueItem({
        status: 'L1_APPROVED',
        isSystemFilled: true,
        confirmationStatus: 'CONFIRMED',
      }),
      false,
    );
    assert.equal(
      isL1ReviewQueueItem({
        status: 'PENDING_L1',
        isSystemFilled: true,
        confirmationStatus: 'CONFIRMED',
      }),
      false,
    );
  });
});
