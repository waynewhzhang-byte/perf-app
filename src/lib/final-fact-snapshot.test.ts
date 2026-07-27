import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinalFactSnapshot,
  finalFactSnapshotApprovalError,
  readFinalFactSnapshot,
  type ArchivedPerformanceFact,
} from './final-fact-snapshot';

const performanceFact: ArchivedPerformanceFact = {
  id: 'fact-1',
  dimensionCode: 'worksite.defect-governance',
  dimensionTitle: '缺陷治理',
  score: 2,
  role: 'FIRST_DISCOVERER',
  eventType: 'DISCOVERY',
  defectRef: 'DEF-001',
  defectLevel: '一般',
  eventDate: '2026-01-02',
  sourceFile: '缺陷.xlsx',
  metadata: { sourceData: { 变电站: '甲站', 缺陷内容: '机构卡涩' } },
  record: {
    id: 'fact-1',
    recordKey: 'defect:001',
    recordType: 'DEFECT',
    title: '甲站机构卡涩',
    roleLabel: '第一发现人',
    score: 2,
    occurredAt: '2026-01-02',
    details: [{ label: '变电站', value: '甲站' }],
    source: { file: '缺陷.xlsx', sheet: '明细', rowNo: 3 },
  },
};

function build(
  archivedTotalScore: number,
  captureMode: 'FINAL_REVIEW' | 'REBUILT_CURRENT_FACTS' = 'FINAL_REVIEW',
) {
  return buildFinalFactSnapshot({
    capturedAt: new Date('2026-07-31T00:00:00.000Z'),
    captureMode,
    archivedTotalScore,
    employee: {
      employeeNo: 'E001',
      employeeName: '张三',
      workAreaId: 'b1',
      workAreaName: '晋北运维分部',
      departmentId: 'd1',
      departmentName: '运维一班',
      declarationLevelId: 'l1',
      declarationLevelName: '一级',
      declarationSpecialtyId: 's1',
      declarationSpecialtyName: '变电运维',
    },
    year: 2026,
    hireDate: new Date('2010-01-01'),
    templateItems: [{
      id: 'item-defect',
      title: '缺陷治理',
      dimensionCode: 'worksite.defect-governance',
      scoreMode: 'COUNTED',
      maxScore: 20,
      maxSelections: 1,
      scoreOptions: [],
    }],
    submissionItems: [{
      itemId: 'item-defect',
      score: 2,
      selected: [],
      isSystemFilled: true,
      confirmationStatus: 'CONFIRMED',
    }],
    basicFacts: [],
    performanceFacts: [performanceFact],
    submissionFacts: [],
    ticketCohortMax: 0,
  });
}

describe('final fact snapshot', () => {
  it('freezes readable fact records and a matched score calculation', () => {
    const snapshot = build(2);
    assert.equal(snapshot.performanceFacts[0]?.record.title, '甲站机构卡涩');
    assert.equal(snapshot.performanceFacts[0]?.record.source.rowNo, 3);
    assert.equal(snapshot.profileFacts[0]?.value, '2010-01-01');
    assert.equal(snapshot.captureMode, 'FINAL_REVIEW');
    assert.equal(finalFactSnapshotApprovalError(snapshot), null);
    assert.equal(snapshot.scoreSheet.totalScore, 2);
    assert.deepEqual(snapshot.reconciliation, {
      archivedTotalScore: 2,
      recalculatedTotalScore: 2,
      difference: 0,
      status: 'MATCHED',
    });
    assert.equal(
      readFinalFactSnapshot({ factSnapshot: snapshot })?.employee.employeeNo,
      'E001',
    );
  });

  it('marks a score difference for manual review', () => {
    const snapshot = build(3);
    assert.equal(snapshot.reconciliation.status, 'MANUAL_REVIEW');
    assert.equal(snapshot.reconciliation.difference, -1);
    assert.match(finalFactSnapshotApprovalError(snapshot) ?? '', /人工复核/);
  });

  it('marks a snapshot rebuilt from current facts for manual review', () => {
    const rebuilt = build(2, 'REBUILT_CURRENT_FACTS');
    assert.equal(rebuilt.reconciliation.difference, 0);
    assert.equal(rebuilt.reconciliation.status, 'MANUAL_REVIEW');
  });

  it('rejects legacy archives without a fact snapshot', () => {
    assert.equal(readFinalFactSnapshot({ items: [] }), null);
    assert.match(finalFactSnapshotApprovalError(null) ?? '', /生成失败/);
  });
});
