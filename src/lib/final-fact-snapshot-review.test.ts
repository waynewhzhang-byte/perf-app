import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { confirmRebuiltFinalFactSnapshot } from './final-fact-snapshot-review';
import type { FinalFactSnapshot } from './final-fact-snapshot';

function snapshot(difference: number): FinalFactSnapshot {
  return {
    version: 1,
    captureMode: 'REBUILT_CURRENT_FACTS',
    capturedAt: '2026-08-01T00:00:00.000Z',
    employee: {
      employeeNo: 'E001',
      employeeName: '张三',
      workAreaId: null,
      workAreaName: null,
      departmentId: null,
      departmentName: null,
      declarationLevelId: null,
      declarationLevelName: null,
      declarationSpecialtyId: null,
      declarationSpecialtyName: null,
    },
    profileFacts: [],
    basicFacts: [],
    performanceFacts: [],
    submissionFacts: [],
    scoreSheet: {} as FinalFactSnapshot['scoreSheet'],
    reconciliation: {
      archivedTotalScore: 10,
      recalculatedTotalScore: 10 + difference,
      difference,
      status: 'MANUAL_REVIEW',
    },
  };
}

describe('confirm rebuilt final fact snapshot', () => {
  it('closes a zero-difference manual review with an audit note', () => {
    const reviewed = confirmRebuiltFinalFactSnapshot(snapshot(0), {
      reviewedAt: new Date('2026-08-02T00:00:00.000Z'),
      reviewedBy: 'admin-1',
      note: ' 已核对原终审材料 ',
    });
    assert.equal(reviewed.captureMode, 'REBUILT_VERIFIED');
    assert.equal(reviewed.reconciliation.status, 'MATCHED');
    assert.equal(reviewed.manualReview?.note, '已核对原终审材料');
  });

  it('refuses to release a snapshot whose score still differs', () => {
    assert.throws(
      () => confirmRebuiltFinalFactSnapshot(snapshot(1), {
        reviewedAt: new Date(),
        reviewedBy: 'admin-1',
        note: '确认',
      }),
      /仍不一致/,
    );
  });
});
