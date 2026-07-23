import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyL1,
  applyL2,
  buildArchivedSnapshot,
  finalizeArchive,
  isPendingL2Dispute,
  ReviewError,
  validateL1Decisions,
  validateL2Decisions,
  type ArchiveSubmissionSource,
} from './review-workflow';
import type { ScorableSection } from './score-calculation';

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

describe('buildArchivedSnapshot', () => {
  const finalizedAt = new Date('2026-07-23T12:00:00.000Z');

  const templateSections: ScorableSection[] = [
    {
      id: 'sec-1',
      title: '工作现场',
      sortOrder: 0,
      items: [
        {
          id: 'fi-1',
          scoreMode: 'TIERS',
          maxSelections: 1,
          scoreOptions: [{ label: 'A', score: 3 }],
          sortOrder: 0,
        },
      ],
    },
  ];

  const sub: ArchiveSubmissionSource = {
    id: 'sub-1',
    userId: 'user-1',
    templateId: 'tpl-1',
    branchId: 'branch-1',
    workAreaName: '晋北运维分部',
    hireDate: new Date('2015-01-01'),
    workYears: 11,
    declarationLevelId: 'lv-1',
    declarationLevelName: '一级',
    declarationSpecialtyId: 'sp-1',
    declarationSpecialtyName: '变电运维',
    preReviewPassed: true,
    preReviewMessages: [],
    preReviewMatchedRules: [],
    items: [
      {
        itemId: 'fi-1',
        selected: [{ optionId: 'opt-1', label: 'A', score: 3 }],
        content: '备注',
        score: 3,
        item: { title: '缺陷治理' },
        optionReviews: [
          {
            optionId: 'opt-1',
            label: 'A',
            score: 3,
            count: 1,
            departmentId: 'dept-1',
            department: { name: '运检部' },
            status: 'L2_APPROVED',
            rejectReason: null,
            reviewedBy: 'rev-2',
            reviewedAt: new Date('2026-07-22T00:00:00.000Z'),
          },
        ],
        attachments: [
          {
            id: 'att-1',
            filename: '证明.pdf',
            storageKey: 'submissions/sub-1/fi-1/证明.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    ],
  };

  it('含 ADR-0002 要求的顶层字段与声明表头', () => {
    const snap = buildArchivedSnapshot(sub, templateSections, finalizedAt);
    assert.equal(snap.submissionId, 'sub-1');
    assert.equal(snap.userId, 'user-1');
    assert.equal(snap.templateId, 'tpl-1');
    assert.equal(snap.finalizedAt, finalizedAt);
    assert.equal(snap.declarationHeader.workAreaName, '晋北运维分部');
    assert.equal(snap.declarationHeader.workYears, 11);
    assert.equal(snap.declarationHeader.declarationLevelName, '一级');
    assert.ok(Array.isArray(snap.sections));
    assert.equal(typeof snap.templateMaxScore, 'number');
    assert.ok(snap.templateMaxScore >= 3);
  });

  it('固化 items / optionReviews / attachments', () => {
    const snap = buildArchivedSnapshot(sub, templateSections, finalizedAt);
    assert.equal(snap.items.length, 1);
    const item = snap.items[0];
    assert.equal(item.itemId, 'fi-1');
    assert.equal(item.itemTitle, '缺陷治理');
    assert.equal(item.optionReviews.length, 1);
    assert.equal(item.optionReviews[0].departmentName, '运检部');
    assert.equal(item.optionReviews[0].reviewerId, 'rev-2');
    assert.equal(item.attachments.length, 1);
    assert.equal(item.attachments[0].storageKey, 'submissions/sub-1/fi-1/证明.pdf');
  });
});

describe('finalizeArchive', () => {
  it('编排顺序：submission.update → performanceRecord.upsert → 申报事实落库', async () => {
    const approvedAt = new Date('2026-07-23T12:00:00.000Z');
    const calls: string[] = [];
    let archivedPayload: unknown;

    const subRow = {
      id: 'sub-1',
      userId: 'user-1',
      templateId: 'tpl-1',
      branchId: null,
      workAreaName: null,
      hireDate: null,
      workYears: null,
      declarationLevelId: null,
      declarationLevelName: null,
      declarationSpecialtyId: null,
      declarationSpecialtyName: null,
      preReviewPassed: null,
      preReviewMessages: null,
      preReviewMatchedRules: null,
      template: { year: 2026 },
      items: [
        {
          id: 'si-1',
          itemId: 'fi-1',
          selected: [],
          content: null,
          score: 2,
          status: 'L2_APPROVED',
          isSystemFilled: false,
          item: {
            id: 'fi-1',
            title: '手工项',
            dimensionCode: 'performance.competition',
            scoreOptions: [{ optionId: 'o1', label: '省公司', score: 2 }],
          },
          optionReviews: [],
          attachments: [],
        },
      ],
      user: { id: 'user-1', employeeNo: 'E001', fullName: '张三' },
    };

    const tx = {
      submission: {
        findUnique: async () => subRow,
        update: async (args: { data: Record<string, unknown> }) => {
          calls.push('submission.update');
          assert.equal(args.data.status, 'L2_APPROVED');
          assert.equal(args.data.l2ReviewerId, 'reviewer-1');
          assert.equal(args.data.l2ReviewedAt, approvedAt);
          assert.equal(args.data.totalScore, 2);
          return {};
        },
      },
      formSection: {
        findMany: async () => [
          {
            id: 'sec-1',
            title: '工作业绩',
            sortOrder: 0,
            items: [
              {
                id: 'fi-1',
                scoreMode: 'TIERS',
                maxScore: null,
                maxSelections: 1,
                scoreOptions: [{ label: '省公司', score: 2 }],
                sortOrder: 0,
              },
            ],
          },
        ],
      },
      performanceRecord: {
        upsert: async (args: { create: { archivedData: unknown; totalScore: number } }) => {
          calls.push('performanceRecord.upsert');
          archivedPayload = args.create.archivedData;
          assert.equal(args.create.totalScore, 2);
          return {};
        },
      },
      submissionDimensionFact: {
        deleteMany: async () => {
          calls.push('submissionDimensionFact.deleteMany');
          return { count: 0 };
        },
        create: async () => {
          calls.push('submissionDimensionFact.create');
          return {};
        },
      },
    } as any;

    const total = await finalizeArchive(tx, 'sub-1', 'reviewer-1', approvedAt);
    assert.equal(total, 2);
    assert.deepEqual(calls.slice(0, 3), [
      'submission.update',
      'performanceRecord.upsert',
      'submissionDimensionFact.deleteMany',
    ]);
    const snap = archivedPayload as { finalizedAt: Date; submissionId: string };
    assert.equal(snap.submissionId, 'sub-1');
    assert.equal(snap.finalizedAt, approvedAt);
  });

  it('申报不存在时返回 0 且不写库', async () => {
    const calls: string[] = [];
    const tx = {
      submission: {
        findUnique: async () => null,
        update: async () => { calls.push('update'); return {}; },
      },
      formSection: { findMany: async () => { calls.push('sections'); return []; } },
      performanceRecord: { upsert: async () => { calls.push('upsert'); return {}; } },
    } as any;
    assert.equal(await finalizeArchive(tx, 'missing', 'rev'), 0);
    assert.deepEqual(calls, []);
  });
});
