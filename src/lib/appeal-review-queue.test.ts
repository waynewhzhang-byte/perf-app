import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDisputeVisibleToL2Reviewer,
  mapAppealReviewRow,
} from './appeal-review-queue';

describe('isDisputeVisibleToL2Reviewer', () => {
  const routes = new Map([
    ['performance.safety-contribution', 'dept-safety'],
    ['basic.skill-level', 'dept-hr'],
  ]);

  it('有路由的维度仅归属部门可见', () => {
    assert.equal(
      isDisputeVisibleToL2Reviewer('performance.safety-contribution', 'dept-safety', routes),
      true,
    );
    assert.equal(
      isDisputeVisibleToL2Reviewer('performance.safety-contribution', 'dept-other', routes),
      false,
    );
  });

  it('非评分确认维度对所有 L2 可见（如参加工作时间）', () => {
    assert.equal(
      isDisputeVisibleToL2Reviewer('profile.hire-date', 'dept-any', routes),
      true,
    );
  });
});

describe('mapAppealReviewRow', () => {
  it('映射主张分与附件', () => {
    const row = mapAppealReviewRow({
      id: 'si-1',
      submissionId: 'sub-1',
      score: '3.5',
      disputeReason: '理由',
      disputeClaimedScore: '5',
      disputeL1Result: null,
      disputeL2Result: null,
      item: { title: '技术贡献', dimensionCode: 'performance.technical-contribution' },
      attachments: [{ id: 'a1', filename: 'proof.pdf', mimeType: 'application/pdf' }],
      submission: {
        submittedAt: new Date('2026-07-01T00:00:00Z'),
        user: { fullName: '刘涛', contact: '11456348', employeeNo: '11456348', departmentId: 'd1' },
      },
    } as never);
    assert.equal(row.disputeClaimedScore, 5);
    assert.equal(row.attachments[0].filename, 'proof.pdf');
    assert.equal(row.employeeName, '刘涛');
  });
});
