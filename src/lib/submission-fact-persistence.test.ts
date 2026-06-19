import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSubmissionDimensionFacts,
  submissionFactSourceFile,
} from './submission-fact-persistence';

describe('extractSubmissionDimensionFacts', () => {
  const approvedAt = new Date('2025-06-17T10:00:00Z');

  it('仅落库 L2 通过的手工维度子项（fact 维度如安全贡献不再经此路径）', () => {
    const lines = extractSubmissionDimensionFacts(
      [
        {
          id: 'si1',
          itemId: 'form1',
          status: 'L2_APPROVED',
          isSystemFilled: false,
          content: '说明材料',
          selected: [],
          item: {
            title: '安全贡献（满分12分）',
            dimensionCode: 'performance.safety-contribution',
            scoreOptions: [{ optionId: 'o1', label: '第一发现人', score: 3 }],
          },
          optionReviews: [
            {
              optionId: 'o1',
              label: '第一发现人',
              score: 3,
              count: 2,
              departmentId: 'dept1',
              status: 'L2_APPROVED',
            },
          ],
          attachments: [{ id: 'a1', filename: 'proof.pdf', storageKey: 'k1', mimeType: 'application/pdf' }],
        },
        {
          id: 'si1b',
          itemId: 'form1b',
          status: 'L2_APPROVED',
          isSystemFilled: false,
          content: '技术贡献说明',
          selected: [],
          item: {
            title: '技术贡献（国标）',
            dimensionCode: 'performance.technical-contribution.standard',
            scoreOptions: [{ optionId: 'o9', label: '主编', score: 6 }],
          },
          optionReviews: [
            {
              optionId: 'o9',
              label: '主编',
              score: 6,
              count: 1,
              departmentId: 'dept1',
              status: 'L2_APPROVED',
            },
          ],
          attachments: [{ id: 'a9', filename: 'tech.pdf', storageKey: 'k9', mimeType: 'application/pdf' }],
        },
        {
          id: 'si2',
          itemId: 'form2',
          status: 'L2_APPROVED',
          isSystemFilled: true,
          content: null,
          selected: [],
          item: {
            title: '技能等级',
            dimensionCode: 'basic.skill-level',
            scoreOptions: [],
          },
          optionReviews: [],
          attachments: [],
        },
        {
          id: 'si3',
          itemId: 'form3',
          status: 'PENDING_L2',
          isSystemFilled: false,
          content: null,
          selected: [{ index: 0, optionId: 'o2', label: '国网竞赛', score: 10 }],
          item: {
            title: '竞赛比武',
            dimensionCode: 'performance.competition.competition',
            scoreOptions: [{ optionId: 'o2', label: '国网竞赛', score: 10 }],
          },
          optionReviews: [],
          attachments: [],
        },
      ],
      approvedAt,
    );

    // 安全贡献现属 fact 维度（系统导入），不经申报归档；仅落库技术贡献（manual）
    const safetyLine = lines.find((l) => l.dimensionCode === 'performance.safety-contribution');
    assert.equal(safetyLine, undefined);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].dimensionCode, 'performance.technical-contribution.standard');
    assert.equal(lines[0].score, 6);
    assert.equal(lines[0].count, 1);
    assert.equal(lines[0].metadata?.source, 'submission');
    assert.deepEqual(lines[0].metadata?.attachments, [
      { id: 'a9', filename: 'tech.pdf', storageKey: 'k9', mimeType: 'application/pdf' },
    ]);
  });

  it('无二级子项审核时按 selected 落库', () => {
    const lines = extractSubmissionDimensionFacts(
      [
        {
          id: 'si4',
          itemId: 'form4',
          status: 'L2_APPROVED',
          isSystemFilled: false,
          content: null,
          selected: [{ index: 0, optionId: 'o3', label: '省公司调考', score: 2 }],
          item: {
            title: '竞赛比武（调考）',
            dimensionCode: 'performance.competition.exam',
            scoreOptions: [{ optionId: 'o3', label: '省公司调考', score: 2 }],
          },
          optionReviews: [],
          attachments: [],
        },
      ],
      approvedAt,
    );

    assert.equal(lines.length, 1);
    assert.equal(lines[0].optionId, 'o3');
    assert.equal(lines[0].score, 2);
  });

  it('submissionFactSourceFile 格式固定', () => {
    assert.equal(submissionFactSourceFile('sub123'), 'submission:sub123');
  });
});
