import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeclarationError,
  autoDeclarationHeaderSubmitError,
  findUnrepairedRejectedItems,
  submissionEditBlockReason,
  systemFilledSubmitError,
  upsertDeclaration,
} from './declaration-workflow';

describe('submissionEditBlockReason', () => {
  it('DRAFT / REJECTED 可编辑', () => {
    assert.equal(submissionEditBlockReason('DRAFT'), null);
    assert.equal(submissionEditBlockReason('REJECTED'), null);
  });

  it('已提交与审核中状态不可编辑', () => {
    assert.equal(submissionEditBlockReason('SUBMITTED'), '申报已提交，不可编辑');
    assert.equal(submissionEditBlockReason('L1_APPROVED'), '申报已通过一级审核，不可编辑');
    assert.equal(submissionEditBlockReason('L2_APPROVED'), '申报已终审通过，不可编辑');
  });
});

describe('findUnrepairedRejectedItems', () => {
  it('找出未出现在 payload 的驳回项', () => {
    const rows = findUnrepairedRejectedItems(
      [
        { itemId: 'a', status: 'REJECTED' },
        { itemId: 'b', status: 'REJECTED' },
        { itemId: 'c', status: 'L1_APPROVED' },
      ],
      new Set(['a']),
      (id) => `标题-${id}`,
    );
    assert.deepEqual(rows, [{ itemId: 'b', title: '标题-b' }]);
  });
});

describe('systemFilledSubmitError', () => {
  it('缺确认/申诉时报错', () => {
    assert.equal(
      systemFilledSubmitError({
        title: '缺陷治理',
        confirmationStatus: null,
        disputeReason: null,
        attachmentCount: 0,
      }),
      '请对系统填充项「缺陷治理」选择「确认」或「申诉」',
    );
  });

  it('申诉缺理由时报错', () => {
    assert.equal(
      systemFilledSubmitError({
        title: '缺陷治理',
        confirmationStatus: 'DISPUTED',
        disputeReason: '  ',
        attachmentCount: 1,
      }),
      '请填写「缺陷治理」的申诉理由',
    );
  });

  it('申诉缺附件时报错', () => {
    assert.equal(
      systemFilledSubmitError({
        title: '缺陷治理',
        confirmationStatus: 'DISPUTED',
        disputeReason: '分数有误',
        attachmentCount: 0,
      }),
      '「缺陷治理」申诉须上传证明材料',
    );
  });

  it('已确认时通过', () => {
    assert.equal(
      systemFilledSubmitError({
        title: '缺陷治理',
        confirmationStatus: 'CONFIRMED',
        disputeReason: null,
        attachmentCount: 0,
      }),
      null,
    );
  });
});

describe('autoDeclarationHeaderSubmitError', () => {
  it('草稿保存不校验自动表头', () => {
    assert.equal(
      autoDeclarationHeaderSubmitError({
        submit: false,
        hireDateEnabled: false,
        declarationLevelEnabled: false,
        parsedHireDate: null,
        declarationLevel: null,
      }),
      null,
    );
  });

  it('自动表头提交时缺少花名册入职时间则拒绝', () => {
    assert.equal(
      autoDeclarationHeaderSubmitError({
        submit: true,
        hireDateEnabled: false,
        declarationLevelEnabled: false,
        parsedHireDate: null,
        declarationLevel: null,
      }),
      '系统未能从员工花名册读取参加工作时间，请联系管理员补全档案后再申报',
    );
  });

  it('自动表头提交时无法匹配参评能级则拒绝', () => {
    assert.equal(
      autoDeclarationHeaderSubmitError({
        submit: true,
        hireDateEnabled: false,
        declarationLevelEnabled: false,
        parsedHireDate: new Date('1985-08-01T00:00:00.000Z'),
        declarationLevel: null,
      }),
      '系统未能根据工龄匹配参评能级，请联系管理员检查等级字典配置',
    );
  });
});

describe('upsertDeclaration', () => {
  it('已提交状态不可再编辑', async () => {
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-1',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: null,
          sections: [{ items: [{ id: 'item-1', isRequired: false, requireAttachment: false, title: '手工项', dimensionCode: null, scoreMode: 'TIERS', maxScore: null, scoreOptions: [] }] }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '13800000000',
          branchId: 'b1',
          hireDate: null,
          profile: null,
          employeeNo: null,
        }),
      },
      branch: { findUnique: async () => ({ id: 'b1', name: '运维一分' }) },
      declarationLevel: { findUnique: async () => null, findFirst: async () => null },
      declarationSpecialty: { findUnique: async () => null },
      autoReviewRule: { findMany: async () => [] },
      submission: {
        findUnique: async () => ({
          id: 'sub-1',
          status: 'SUBMITTED',
          submittedAt: new Date(),
          branchId: 'b1',
          workAreaName: '运维一分',
        }),
      },
    } as any;

    await assert.rejects(
      () =>
        upsertDeclaration(tx, {
          userId: 'u1',
          templateId: 'tpl-1',
          items: [],
          submit: false,
          workAreaId: 'b1',
        }),
      (err: unknown) =>
        err instanceof DeclarationError &&
        err.message === '申报已提交，不可编辑' &&
        err.httpStatus === 400,
    );
  });

  it('草稿保存：创建 submission 并写 DRAFT', async () => {
    const submissionUpdates: unknown[] = [];
    const itemUpserts: unknown[] = [];
    let created = false;
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-1',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: null,
          sections: [{
            items: [{
              id: 'item-1',
              isRequired: false,
              requireAttachment: false,
              title: '手工项',
              dimensionCode: null,
              scoreMode: 'TIERS',
              maxScore: null,
              scoreOptions: [{ optionId: 'o1', label: '档A', score: 2 }],
            }],
          }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '13800000000',
          branchId: 'b1',
          hireDate: null,
          profile: null,
          employeeNo: null,
        }),
      },
      branch: { findUnique: async () => ({ id: 'b1', name: '运维一分' }) },
      declarationLevel: { findUnique: async () => null, findFirst: async () => null },
      declarationSpecialty: { findUnique: async () => null },
      autoReviewRule: { findMany: async () => [] },
      submission: {
        findUnique: async () => (created ? { id: 'sub-new', status: 'DRAFT', submittedAt: null, branchId: 'b1', workAreaName: null } : null),
        create: async () => {
          created = true;
          return { id: 'sub-new', status: 'DRAFT', submittedAt: null, branchId: 'b1', workAreaName: null };
        },
        update: async (input: unknown) => {
          submissionUpdates.push(input);
          return {};
        },
      },
      submissionItem: {
        findMany: async () => [],
        upsert: async (input: unknown) => {
          itemUpserts.push(input);
          return {};
        },
      },
      attachment: { findMany: async () => [] },
      reviewLog: { create: async () => ({}) },
    } as any;

    const result = await upsertDeclaration(tx, {
      userId: 'u1',
      templateId: 'tpl-1',
      submit: false,
      workAreaId: 'b1',
      items: [{
        itemId: 'item-1',
        selected: [{ index: 0, optionId: 'o1', label: '档A', score: 2 }],
      }],
    });

    assert.equal(result.submissionId, 'sub-new');
    assert.equal(result.totalScore, 2);
    assert.equal(result.employeeContact, '13800000000');
    assert.equal(itemUpserts.length, 1);
    assert.ok(submissionUpdates.some((u: any) => u.data.status === 'DRAFT' && u.data.totalScore === 2));
  });

  it('提交时驳回项未重填则 DeclarationError', async () => {
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-1',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: null,
          sections: [{
            items: [
              { id: 'item-a', isRequired: false, requireAttachment: false, title: '项A', dimensionCode: null, scoreMode: 'TIERS', maxScore: null, scoreOptions: [] },
              { id: 'item-b', isRequired: false, requireAttachment: false, title: '项B', dimensionCode: null, scoreMode: 'TIERS', maxScore: null, scoreOptions: [] },
            ],
          }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '13800000000',
          branchId: 'b1',
          hireDate: new Date(2010, 0, 1),
          profile: null,
          employeeNo: null,
        }),
      },
      branch: { findUnique: async () => ({ id: 'b1', name: '运维一分' }) },
      declarationLevel: {
        findUnique: async () => ({ id: 'lv1', name: '初级' }),
        findFirst: async () => null,
      },
      declarationSpecialty: { findUnique: async () => ({ id: 'sp1', name: '变电运维' }) },
      autoReviewRule: { findMany: async () => [] },
      submission: {
        findUnique: async () => ({
          id: 'sub-1',
          status: 'REJECTED',
          submittedAt: new Date(),
          branchId: 'b1',
          workAreaName: '运维一分',
        }),
      },
      submissionItem: {
        findMany: async () => [
          { itemId: 'item-a', status: 'REJECTED', score: 0, isSystemFilled: false, confirmationStatus: null, selected: [], optionReviews: [] },
          { itemId: 'item-b', status: 'REJECTED', score: 0, isSystemFilled: false, confirmationStatus: null, selected: [], optionReviews: [] },
        ],
      },
      attachment: { findMany: async () => [] },
    } as any;

    await assert.rejects(
      () =>
        upsertDeclaration(tx, {
          userId: 'u1',
          templateId: 'tpl-1',
          submit: true,
          workAreaId: 'b1',
          hireDate: '2010-01-01',
          declarationLevelId: 'lv1',
          declarationSpecialtyId: 'sp1',
          // 只重填了项A，项B 缺失
          items: [{ itemId: 'item-a', selected: [] }],
        }),
      (err: unknown) =>
        err instanceof DeclarationError &&
        err.message.includes('以下驳回项未重新填写') &&
        err.message.includes('项B'),
    );
  });

  it('提交时预审未通过仍成功并带回 messages（软提示）', async () => {
    const reviewLogs: unknown[] = [];
    const submissionUpdates: unknown[] = [];
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-1',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: null,
          sections: [{
            items: [{
              id: 'item-1',
              isRequired: false,
              requireAttachment: false,
              title: '手工项',
              dimensionCode: null,
              scoreMode: 'TIERS',
              maxScore: null,
              scoreOptions: [{ optionId: 'o1', label: '档A', score: 1 }],
            }],
          }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '13800000000',
          branchId: 'b1',
          hireDate: new Date(2020, 0, 1),
          profile: null,
          employeeNo: null,
        }),
      },
      branch: { findUnique: async () => ({ id: 'b1', name: '运维一分' }) },
      declarationLevel: {
        findUnique: async () => ({ id: 'lv1', name: '高级' }),
        findFirst: async () => null,
      },
      declarationSpecialty: { findUnique: async () => ({ id: 'sp1', name: '变电运维' }) },
      autoReviewRule: {
        findMany: async () => [{
          id: 'rule-1',
          name: '工龄不足不可报高级',
          enabled: true,
          // 覆盖所有工龄；allowedLevelIds 不含 lv1 → 选高级时预审软失败
          minWorkYears: null,
          maxWorkYears: null,
          allowedLevelIds: ['other-level'],
          rejectMessage: '工龄不足，建议改报初级',
        }],
      },
      submission: {
        findUnique: async () => null,
        create: async () => ({
          id: 'sub-new',
          status: 'DRAFT',
          submittedAt: null,
          branchId: 'b1',
          workAreaName: null,
        }),
        update: async (input: unknown) => {
          submissionUpdates.push(input);
          return {};
        },
      },
      submissionItem: {
        findMany: async () => [],
        upsert: async () => ({}),
      },
      attachment: { findMany: async () => [] },
      reviewLog: {
        create: async (input: unknown) => {
          reviewLogs.push(input);
          return {};
        },
      },
    } as any;

    const result = await upsertDeclaration(tx, {
      userId: 'u1',
      templateId: 'tpl-1',
      submit: true,
      workAreaId: 'b1',
      hireDate: '2020-01-01',
      declarationLevelId: 'lv1',
      declarationSpecialtyId: 'sp1',
      items: [{
        itemId: 'item-1',
        selected: [{ index: 0, optionId: 'o1', label: '档A', score: 1 }],
      }],
    });

    assert.equal(result.submissionId, 'sub-new');
    assert.deepEqual(result.preReviewMessages, ['工龄不足，建议改报初级']);
    assert.ok(submissionUpdates.some((u: any) =>
      u.data.status === 'SUBMITTED' && u.data.preReviewPassed === false,
    ));
    assert.ok(reviewLogs.some((log: any) =>
      log.data.action === 'REJECT' && String(log.data.note).includes('自动预审未通过'),
    ));
  });

  it('AFFIRM 提交写入归档且不设 SUBMITTED', async () => {
    const submissionUpdates: unknown[] = [];
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-1',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: null,
          sections: [{
            items: [{
              id: 'item-1',
              isRequired: false,
              requireAttachment: false,
              title: '手工项',
              dimensionCode: null,
              scoreMode: 'TIERS',
              maxScore: null,
              scoreOptions: [{ optionId: 'o1', label: '档A', score: 2 }],
            }],
          }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '13800000000',
          branchId: 'b1',
          hireDate: new Date(2010, 0, 1),
          profile: null,
          employeeNo: null,
        }),
      },
      branch: { findUnique: async () => ({ id: 'b1', name: '运维一分' }) },
      declarationLevel: {
        findUnique: async () => ({ id: 'lv1', name: '初级' }),
        findFirst: async () => null,
      },
      declarationSpecialty: { findUnique: async () => ({ id: 'sp1', name: '变电运维' }) },
      autoReviewRule: { findMany: async () => [] },
      submission: {
        findUnique: async () => null,
        create: async () => ({
          id: 'sub-new',
          status: 'DRAFT',
          submittedAt: null,
          branchId: 'b1',
          workAreaName: null,
        }),
        update: async (input: unknown) => {
          submissionUpdates.push(input);
          return {};
        },
      },
      submissionItem: {
        findMany: async () => [],
        upsert: async () => ({}),
        updateMany: async () => ({ count: 1 }),
      },
      attachment: { findMany: async () => [] },
      reviewLog: { create: async () => ({}) },
      formSection: {
        findMany: async () => [{
          id: 'sec-1',
          title: '章节',
          sortOrder: 0,
          items: [{
            id: 'item-1',
            scoreMode: 'TIERS',
            maxScore: null,
            maxSelections: 1,
            scoreOptions: [{ optionId: 'o1', label: '档A', score: 2 }],
            sortOrder: 0,
          }],
        }],
      },
      performanceRecord: { upsert: async () => ({}) },
      submissionDimensionFact: {
        deleteMany: async () => ({ count: 0 }),
        create: async () => ({}),
      },
    } as any;

    // finalizeArchive 会再次 findUnique；复用同一 sub 行
    const subRow = {
      id: 'sub-new',
      userId: 'u1',
      templateId: 'tpl-1',
      branchId: 'b1',
      workAreaName: '运维一分',
      hireDate: new Date(2010, 0, 1),
      workYears: 16,
      declarationLevelId: 'lv1',
      declarationLevelName: '初级',
      declarationSpecialtyId: 'sp1',
      declarationSpecialtyName: '变电运维',
      preReviewPassed: true,
      preReviewMessages: [],
      preReviewMatchedRules: [],
      template: { year: 2026 },
      items: [{
        id: 'si-1',
        itemId: 'item-1',
        selected: [{ optionId: 'o1', label: '档A', score: 2 }],
        content: null,
        score: 2,
        status: 'L2_APPROVED',
        isSystemFilled: false,
        confirmationStatus: null,
        item: { id: 'item-1', title: '手工项', dimensionCode: null, scoreOptions: [] },
        optionReviews: [],
        attachments: [],
      }],
      user: { id: 'u1', employeeNo: null, fullName: '测试' },
    };
    let findCalls = 0;
    tx.submission.findUnique = async () => {
      findCalls += 1;
      return findCalls === 1 ? null : subRow;
    };

    const result = await upsertDeclaration(tx, {
      userId: 'u1',
      templateId: 'tpl-1',
      submit: true,
      submitMode: 'AFFIRM',
      workAreaId: 'b1',
      hireDate: '2010-01-01',
      declarationLevelId: 'lv1',
      declarationSpecialtyId: 'sp1',
      items: [{
        itemId: 'item-1',
        selected: [{ index: 0, optionId: 'o1', label: '档A', score: 2 }],
      }],
    });

    assert.equal(result.finalized, true);
    assert.equal(result.totalScore, 2);
    assert.ok(submissionUpdates.some((u: any) => u.data.status === undefined));
    assert.ok(!submissionUpdates.some((u: any) => u.data.status === 'SUBMITTED'));
    assert.ok(submissionUpdates.some((u: any) => u.data.submittedAt instanceof Date));
  });

  it('模板含事实维度且无工号时阻断 AFFIRM 提交', async () => {
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-1',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: null,
          sections: [{
            items: [{
              id: 'fact-1',
              isRequired: false,
              requireAttachment: false,
              title: '技能等级',
              dimensionCode: 'basic.skill-level',
              scoreMode: 'TIERS',
              maxScore: null,
              scoreOptions: [],
            }],
          }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '13800000000',
          branchId: 'b1',
          hireDate: new Date(2010, 0, 1),
          profile: null,
          employeeNo: null,
        }),
      },
    } as never;

    await assert.rejects(
      () => upsertDeclaration(tx, {
        userId: 'u1',
        templateId: 'tpl-1',
        submit: true,
        submitMode: 'AFFIRM',
        workAreaId: 'b1',
        hireDate: '2010-01-01',
        declarationLevelId: 'lv1',
        declarationSpecialtyId: 'sp1',
        items: [],
      }),
      (err: unknown) =>
        err instanceof DeclarationError &&
        err.message.includes('工号') &&
        err.httpStatus === 400,
    );
  });

  it('2026 自动表头：花名册无入职时间时拒绝提交', async () => {
    const tx = {
      formTemplate: {
        findUnique: async () => ({
          id: 'tpl-2026',
          status: 'PUBLISHED',
          year: 2026,
          headerFields: [
            { key: 'workArea', enabled: false, required: false },
            { key: 'hireDate', enabled: false, required: false },
            { key: 'declarationLevel', enabled: false, required: false },
            { key: 'declarationSpecialty', enabled: true, required: true },
          ],
          sections: [{ items: [] }],
        }),
      },
      user: {
        findUnique: async () => ({
          id: 'u1',
          contact: '11403328',
          branchId: 'b1',
          hireDate: null,
          profile: {},
          employeeNo: '11403328',
        }),
      },
      branch: { findUnique: async () => ({ id: 'b1', name: '晋北运维分部' }) },
      declarationLevel: { findUnique: async () => null, findFirst: async () => null },
      declarationSpecialty: { findUnique: async () => ({ id: 'sp1', name: '直流运检' }) },
      autoReviewRule: { findMany: async () => [] },
      submission: {
        findUnique: async () => null,
        create: async () => ({
          id: 'sub-new',
          status: 'DRAFT',
          submittedAt: null,
          branchId: 'b1',
          workAreaName: null,
        }),
      },
      submissionItem: { findMany: async () => [], upsert: async () => ({}) },
      attachment: { findMany: async () => [] },
    } as any;

    await assert.rejects(
      () => upsertDeclaration(tx, {
        userId: 'u1',
        templateId: 'tpl-2026',
        items: [],
        submit: true,
        submitMode: 'APPEAL',
        declarationSpecialtyId: 'sp1',
      }),
      (err: unknown) =>
        err instanceof DeclarationError &&
        err.message === '系统未能从员工花名册读取参加工作时间，请联系管理员补全档案后再申报',
    );
  });
});
