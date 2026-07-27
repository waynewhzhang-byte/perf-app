import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dimensionCodesForL2Department,
  isDisputeVisibleToL2Reviewer,
  listAppealReviewRows,
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

  it('未配置路由的可评分维度不可见', () => {
    assert.equal(
      isDisputeVisibleToL2Reviewer('performance.technical-contribution', 'dept-any', routes),
      false,
    );
  });

  it('维度代码缺失时不可见', () => {
    assert.equal(isDisputeVisibleToL2Reviewer(null, 'dept-any', routes), false);
  });

  it('非评分确认维度对所有 L2 可见（如参加工作时间）', () => {
    assert.equal(
      isDisputeVisibleToL2Reviewer('profile.hire-date', 'dept-any', routes),
      true,
    );
  });
});

describe('dimensionCodesForL2Department', () => {
  it('仅返回归属该部门的维度代码', () => {
    const routes = new Map([
      ['performance.safety-contribution', 'dept-a'],
      ['basic.skill-level', 'dept-b'],
      ['performance.defect-governance', 'dept-a'],
    ]);
    assert.deepEqual(
      dimensionCodesForL2Department(routes, 'dept-a').sort(),
      ['performance.defect-governance', 'performance.safety-contribution'].sort(),
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
        workAreaName: '忻州运维站',
        declarationSpecialtyId: 'sp-1',
        declarationSpecialtyName: '变电运维',
        user: {
          fullName: '刘涛',
          contact: '11456348',
          employeeNo: '11456348',
          departmentId: 'd1',
          branch: { id: 'b1', name: '忻州运维站' },
          department: { id: 'd1', name: '运维一班' },
        },
      },
    } as never);
    assert.equal(row.disputeClaimedScore, 5);
    assert.equal(row.attachments[0].filename, 'proof.pdf');
    assert.equal(row.employeeName, '刘涛');
    assert.equal(row.unitName, '忻州运维站 · 运维一班');
    assert.equal(row.declarationSpecialtyName, '变电运维');
  });
});

describe('listAppealReviewRows', () => {
  const sampleItem = {
    id: 'si-1',
    submissionId: 'sub-1',
    score: '2',
    disputeReason: '申诉',
    disputeClaimedScore: '3',
    disputeL1Result: null,
    disputeL2Result: null,
    item: { title: '安全贡献', dimensionCode: 'performance.safety-contribution' },
    attachments: [],
    submission: {
      branchId: 'branch-1',
      workAreaName: '太原运维站',
      declarationSpecialtyId: 'sp-1',
      declarationSpecialtyName: '继电保护',
      submittedAt: new Date('2026-07-01T00:00:00Z'),
      user: {
        fullName: '张三',
        contact: '13800000001',
        employeeNo: '1001',
        departmentId: 'd1',
        branch: { id: 'branch-1', name: '太原运维站' },
        department: { id: 'd1', name: '保护班' },
      },
    },
  };

  it('L2 待审在数据库层分页并按下推的维度路由过滤', async () => {
    let capturedWhere: unknown;
    let capturedSkip: number | undefined;
    let capturedTake: number | undefined;
    const db = {
      dimensionReviewRoute: {
        findMany: async () => [
          { dimensionCode: 'performance.safety-contribution', departmentId: 'dept-safety' },
        ],
      },
      submissionItem: {
        count: async (args: { where: unknown }) => {
          capturedWhere = args.where;
          return 12;
        },
        findMany: async (args: { where: unknown; skip: number; take: number }) => {
          capturedWhere = args.where;
          capturedSkip = args.skip;
          capturedTake = args.take;
          return [sampleItem];
        },
      },
    };

    const result = await listAppealReviewRows(db as never, {
      level: 2,
      reviewerId: 'rev-1',
      l1Scopes: [],
      l2DepartmentId: 'dept-safety',
      filter: 'pending',
      page: 2,
      pageSize: 5,
    });

    assert.equal(result.total, 12);
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 5);
    assert.equal(result.rows.length, 1);
    assert.equal(capturedSkip, 5);
    assert.equal(capturedTake, 5);
    const where = capturedWhere as { AND?: Array<Record<string, unknown>> };
    const andClauses = where.AND ?? [where];
    assert.ok(
      andClauses.some((clause) =>
        (clause.item as { dimensionCode?: { in?: string[] } })?.dimensionCode?.in?.includes(
          'performance.safety-contribution',
        ),
      ),
    );
  });

  it('L1 无 scope 时返回空列表', async () => {
    const db = {
      dimensionReviewRoute: { findMany: async () => [] },
      submissionItem: {
        count: async () => { throw new Error('should not count'); },
        findMany: async () => { throw new Error('should not query'); },
      },
    };
    const result = await listAppealReviewRows(db as never, {
      level: 1,
      reviewerId: 'rev-1',
      l1Scopes: [{ scopeBranchId: null, scopeDepartmentId: null }],
      l2DepartmentId: null,
      filter: 'pending',
    });
    assert.deepEqual(result, { rows: [], total: 0, page: 1, pageSize: 50 });
  });
});
