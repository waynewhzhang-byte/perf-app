import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyL1,
  applyL2,
  isPendingL2Dispute,
  ReviewError,
  validateL1Decisions,
  validateL2Decisions,
} from './review-workflow';

describe('isPendingL2Dispute', () => {
  it('识别不依赖评分子项的待二审申诉', () => {
    assert.equal(isPendingL2Dispute({
      isSystemFilled: true,
      confirmationStatus: 'DISPUTED',
      disputeL1Result: 'APPROVED',
      disputeL2Result: null,
    }), true);
  });
});

describe('validateL1Decisions', () => {
  it('所有待审项均有决策时通过', () => {
    assert.doesNotThrow(() =>
      validateL1Decisions(
        [
          { id: 'i1', title: '缺陷治理' },
          { id: 'i2', title: '两票执行' },
        ],
        [
          { submissionItemId: 'i1', action: 'APPROVE' },
          { submissionItemId: 'i2', action: 'APPROVE' },
        ],
      ),
    );
  });

  it('缺决策时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL1Decisions(
          [
            { id: 'i1', title: '缺陷治理' },
            { id: 'i2', title: '两票执行' },
          ],
          [{ submissionItemId: 'i1', action: 'APPROVE' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError &&
        err.message.includes('两票执行') &&
        err.httpStatus === 400,
    );
  });

  it('驳回缺原因时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL1Decisions(
          [{ id: 'i1', title: '缺陷治理' }],
          [{ submissionItemId: 'i1', action: 'REJECT', note: '  ' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes('必须填写原因'),
    );
  });
});

describe('validateL2Decisions', () => {
  it('所有待审子项均有决策时通过', () => {
    assert.doesNotThrow(() =>
      validateL2Decisions(
        [
          { id: 'or1', label: '缺陷治理' },
          { id: 'or2', label: '安全贡献' },
        ],
        [
          { optionReviewId: 'or1', action: 'APPROVE' },
          { optionReviewId: 'or2', action: 'APPROVE' },
        ],
      ),
    );
  });

  it('缺子项决策时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL2Decisions(
          [
            { id: 'or1', label: '缺陷治理' },
            { id: 'or2', label: '安全贡献' },
          ],
          [{ optionReviewId: 'or1', action: 'APPROVE' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes('安全贡献'),
    );
  });

  it('驳回缺原因时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL2Decisions(
          [{ id: 'or1', label: '缺陷治理' }],
          [{ optionReviewId: 'or1', action: 'REJECT' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes('必须填写原因'),
    );
  });
});

describe('applyL2', () => {
  it('仅有基础事实申诉时仍可记录二审结论', async () => {
    const itemUpdates: unknown[] = [];
    const tx = {
      submission: {
        findUnique: async () => ({ id: 'sub-1', status: 'L1_APPROVED', user: { contact: '13800000000' } }),
        update: async () => ({}),
      },
      user: { findUnique: async () => ({ departmentId: 'dept-1' }) },
      submissionOptionReview: {
        findMany: async () => [],
        count: async () => 1,
      },
      submissionItem: {
        findMany: async () => [{
          id: 'fact-1', itemId: 'basic.skill-level',
          isSystemFilled: true,
          confirmationStatus: 'DISPUTED',
          disputeL1Result: 'APPROVED',
          disputeL2Result: null,
          item: { title: '技能等级' },
        }],
        update: async (input: unknown) => { itemUpdates.push(input); return {}; },
      },
      reviewLog: { create: async () => ({}) },
    } as any;

    const result = await applyL2(tx, {
      submissionId: 'sub-1',
      reviewerId: 'reviewer-1',
      decisions: [{ submissionItemId: 'fact-1', action: 'APPROVE', disputeAction: 'APPROVE' }],
    });

    assert.equal(result.outcome, 'pending');
    assert.equal(itemUpdates.length, 1);
    const update = itemUpdates[0] as { where: { id: string }; data: Record<string, unknown> };
    assert.equal(update.where.id, 'fact-1');
    assert.equal(update.data.disputeL2Result, 'APPROVED');
    assert.equal(update.data.disputeL2ReviewerId, 'reviewer-1');
    assert.ok(update.data.disputeL2ReviewedAt instanceof Date);
  });
});

describe('applyL1', () => {
  it('已确认的系统填充项不写逐项日志，但保留一级审核归属', async () => {
    const submissionUpdates: unknown[] = [];
    let reviewLogCreates = 0;
    const tx = {
      submission: {
        findUnique: async () => ({
          id: 'sub-1', status: 'SUBMITTED', branchId: 'branch-1',
          user: { contact: '13800000000', departmentId: 'dept-1' },
          items: [{
            id: 'fact-1', itemId: 'basic.skill-level', status: 'L1_APPROVED', score: 0,
            isSystemFilled: true, confirmationStatus: 'CONFIRMED',
            disputeL1Result: null, disputeL2Result: null,
            item: { title: '技能等级', dimensionCode: 'basic.skill-level' },
            optionReviews: [],
          }],
        }),
        update: async (input: unknown) => { submissionUpdates.push(input); return {}; },
      },
      userRole: { findMany: async () => [{ scopeBranchId: 'branch-1', scopeDepartmentId: null }] },
      dimensionReviewRoute: { findMany: async () => [{ dimensionCode: 'basic.skill-level', departmentId: 'dept-l2' }] },
      submissionOptionReview: { deleteMany: async () => ({}), upsert: async () => ({}), count: async () => 1 },
      submissionItem: {
        findMany: async () => [{
          id: 'fact-1', isSystemFilled: true, confirmationStatus: 'CONFIRMED',
          disputeL1Result: null, disputeL2Result: null,
          optionReviews: [{ status: 'PENDING_L2' }],
        }],
        count: async () => 0,
        update: async () => ({}),
      },
      reviewLog: { create: async () => { reviewLogCreates += 1; return {}; } },
    } as any;

    const result = await applyL1(tx, {
      submissionId: 'sub-1', reviewerId: 'reviewer-1', decisions: [],
    });

    assert.equal(result.outcome, 'pending');
    assert.equal(reviewLogCreates, 0);
    assert.ok(submissionUpdates.some((update: any) =>
      update.data.status === 'L1_APPROVED' && update.data.l1ReviewerId === 'reviewer-1',
    ));
  });

  it('基础事实申诉待二审时不提前归档为终审通过', async () => {
    const submissionUpdates: unknown[] = [];
    const itemUpdates: unknown[] = [];
    const tx = {
      submission: {
        findUnique: async () => ({
          id: 'sub-1', status: 'SUBMITTED', branchId: 'branch-1',
          user: { contact: '13800000000', departmentId: 'dept-1' },
          items: [{
            id: 'fact-1', itemId: 'basic.skill-level', status: 'PENDING_L1', score: 0,
            isSystemFilled: true, confirmationStatus: 'DISPUTED',
            disputeL1Result: null, disputeL2Result: null,
            item: { title: '技能等级', dimensionCode: 'profile.hire-date' },
            optionReviews: [],
          }],
        }),
        update: async (input: unknown) => { submissionUpdates.push(input); return {}; },
      },
      userRole: { findMany: async () => [{ scopeBranchId: 'branch-1', scopeDepartmentId: null }] },
      dimensionReviewRoute: { findMany: async () => [] },
      submissionOptionReview: { count: async () => 0 },
      submissionItem: {
        findMany: async () => [{
          id: 'fact-1', isSystemFilled: true, confirmationStatus: 'DISPUTED',
          disputeL1Result: 'APPROVED', disputeL2Result: null, optionReviews: [],
        }],
        count: async () => 1,
        update: async (input: unknown) => { itemUpdates.push(input); return {}; },
      },
      reviewLog: { create: async () => ({}) },
    } as any;

    const result = await applyL1(tx, {
      submissionId: 'sub-1', reviewerId: 'reviewer-1',
      decisions: [{ submissionItemId: 'fact-1', action: 'APPROVE', disputeAction: 'APPROVE' }],
    });

    assert.equal(result.outcome, 'pending');
    assert.ok(submissionUpdates.some((update: any) => update.data.status === 'L1_APPROVED'));
    assert.ok(itemUpdates.some((update: any) => update.data.status === 'PENDING_L2'));
    assert.ok(!submissionUpdates.some((update: any) => update.data.status === 'L2_APPROVED'));
  });
});
