import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { finalArchiveReviewState } from './review-progress';
import type { FinalFactSnapshot } from './final-fact-snapshot';

function archivedData(status: FinalFactSnapshot['reconciliation']['status']) {
  return {
    factSnapshot: {
      version: 1,
      captureMode: status === 'MATCHED'
        ? 'FINAL_REVIEW'
        : 'REBUILT_CURRENT_FACTS',
      profileFacts: [],
      basicFacts: [],
      performanceFacts: [],
      submissionFacts: [],
      scoreSheet: {},
      reconciliation: { status },
    },
  };
}

describe('final archive review state', () => {
  it('accepts a complete set of matched final snapshots', () => {
    assert.deepEqual(
      finalArchiveReviewState(
        ['sub-1', 'sub-2'],
        [
          { submissionId: 'sub-1', archivedData: archivedData('MATCHED') },
          { submissionId: 'sub-2', archivedData: archivedData('MATCHED') },
        ],
      ),
      { missingSnapshotCount: 0, manualReviewCount: 0 },
    );
  });

  it('blocks completion for a missing archive and a mismatched snapshot', () => {
    assert.deepEqual(
      finalArchiveReviewState(
        ['sub-1', 'sub-2'],
        [{
          submissionId: 'sub-1',
          archivedData: archivedData('MANUAL_REVIEW'),
        }],
      ),
      { missingSnapshotCount: 1, manualReviewCount: 1 },
    );
  });
});
