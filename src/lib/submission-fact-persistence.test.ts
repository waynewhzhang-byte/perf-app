import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSubmissionDimensionFacts,
  submissionFactSourceFile,
} from './submission-fact-persistence';

describe('extractSubmissionDimensionFacts', () => {
  const approvedAt = new Date('2025-06-17T10:00:00Z');

  it('落库二审通过的员工补充事实与扣分事实', () => {
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
            title: '技术贡献',
            dimensionCode: 'performance.technical-contribution',
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
            dimensionCode: 'performance.competition',
            scoreOptions: [{ optionId: 'o2', label: '国网竞赛', score: 10 }],
          },
          optionReviews: [],
          attachments: [],
        },
        {
          id: 'si5',
          itemId: 'form5',
          status: 'L2_APPROVED',
          isSystemFilled: false,
          content: '违章说明',
          selected: [],
          item: {
            title: '严重违章扣分',
            dimensionCode: 'special.violation-severe',
            scoreOptions: [{ optionId: 'oV1', label: '直接责任人', score: -10 }],
          },
          optionReviews: [
            {
              optionId: 'oV1',
              label: '直接责任人',
              score: -10,
              count: 1,
              departmentId: 'dept1',
              status: 'L2_APPROVED',
            },
          ],
          attachments: [{ id: 'aV1', filename: 'violation.pdf', storageKey: 'kV1', mimeType: 'application/pdf' }],
        },
      ],
      approvedAt,
    );

    // 无系统导入事实时，员工补充的 performance.* 维度也必须归档为事实。
    // 无申诉的系统填充项（si2）仍跳过。
    const safetyLine = lines.find((l) => l.dimensionCode === 'performance.safety-contribution');
    assert.equal(safetyLine?.score, 6);
    const techLine = lines.find((l) => l.dimensionCode === 'performance.technical-contribution');
    assert.equal(techLine?.score, 6);

    const violationLine = lines.find((l) => l.dimensionCode === 'special.violation-severe')!;
    assert.equal(lines.length, 3);
    assert.equal(violationLine.score, -10);
    assert.equal(violationLine.count, 1);
    assert.equal(violationLine.metadata?.source, 'submission');
    assert.deepEqual(violationLine.metadata?.attachments, [
      { id: 'aV1', filename: 'violation.pdf', storageKey: 'kV1', mimeType: 'application/pdf' },
    ]);
  });

  it('二审确认有效的系统事实申诉落库为申诉补充事实', () => {
    const lines = extractSubmissionDimensionFacts(
      [
        {
          id: 'si-appeal',
          itemId: 'form-skill',
          status: 'L2_APPROVED',
          isSystemFilled: true,
          content: null,
          selected: [],
          score: 1,
          confirmationStatus: 'DISPUTED',
          disputeReason: '实际为高级技师，导入遗漏',
          disputeClaimedScore: 4,
          disputeL1Result: 'APPROVED',
          disputeL1Note: '材料齐全',
          disputeL2Result: 'APPROVED',
          disputeL2Note: '确认有效',
          overrideScore: 4,
          overrideReason: '按高级技师档计分',
          item: {
            title: '技能等级',
            dimensionCode: 'basic.skill-level',
            scoreOptions: [],
          },
          optionReviews: [],
          attachments: [
            { id: 'a-skill', filename: 'cert.pdf', storageKey: 'k-skill', mimeType: 'application/pdf' },
          ],
        },
        {
          id: 'si-system-ok',
          itemId: 'form-title',
          status: 'L2_APPROVED',
          isSystemFilled: true,
          content: null,
          selected: [],
          score: 2,
          confirmationStatus: 'CONFIRMED',
          item: {
            title: '职称等级',
            dimensionCode: 'basic.title-level',
            scoreOptions: [],
          },
          optionReviews: [],
          attachments: [],
        },
      ],
      approvedAt,
      'sub-1',
    );

    assert.equal(lines.length, 1);
    const appeal = lines[0]!;
    assert.equal(appeal.optionId, 'appeal-supplement');
    assert.equal(appeal.label, '申诉确认补充事实');
    assert.equal(appeal.score, 4);
    assert.match(String(appeal.content), /申诉理由：实际为高级技师，导入遗漏/);
    assert.match(String(appeal.content), /系统原分：1/);
    assert.match(String(appeal.content), /主张分：4/);
    assert.match(String(appeal.content), /管理员覆盖分：4/);
    assert.equal(appeal.sourceFile, 'appeal-supplement:sub-1');
    assert.equal(appeal.metadata?.source, 'appeal-supplement');
    assert.equal(appeal.metadata?.disputeClaimedScore, 4);
    assert.equal(appeal.metadata?.overrideScore, 4);
    assert.equal(appeal.metadata?.systemScore, 1);
    assert.deepEqual(appeal.metadata?.attachments, [
      { id: 'a-skill', filename: 'cert.pdf', storageKey: 'k-skill', mimeType: 'application/pdf' },
    ]);
  });

  it('无二级子项审核时按 selected 落库 deduction', () => {
    const lines = extractSubmissionDimensionFacts(
      [
        {
          id: 'si4',
          itemId: 'form4',
          status: 'L2_APPROVED',
          isSystemFilled: false,
          content: null,
          selected: [{ index: 0, optionId: 'oV2', label: '一般违章-直接', score: -5 }],
          item: {
            title: '一般违章扣分',
            dimensionCode: 'special.violation-general',
            scoreOptions: [{ optionId: 'oV2', label: '一般违章-直接', score: -5 }],
          },
          optionReviews: [],
          attachments: [],
        },
      ],
      approvedAt,
    );

    assert.equal(lines.length, 1);
    assert.equal(lines[0].optionId, 'oV2');
    assert.equal(lines[0].score, -5);
  });

  it('submissionFactSourceFile 格式固定', () => {
    assert.equal(submissionFactSourceFile('sub123'), 'submission:sub123');
  });
});
