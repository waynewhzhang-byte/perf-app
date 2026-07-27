import type { FinalFactSnapshot } from '@/lib/final-fact-snapshot';

export function confirmRebuiltFinalFactSnapshot(
  snapshot: FinalFactSnapshot,
  input: {
    reviewedAt: Date;
    reviewedBy: string;
    note: string;
  },
): FinalFactSnapshot {
  if (snapshot.captureMode !== 'REBUILT_CURRENT_FACTS') {
    throw new Error('该快照不是待确认的当前事实重建快照');
  }
  if (Math.abs(snapshot.reconciliation.difference) > 0.01) {
    throw new Error('事实重算分与归档分仍不一致，请先修正事实或归档分数');
  }
  const note = input.note.trim();
  if (!note) throw new Error('请填写人工复核说明');
  return {
    ...snapshot,
    captureMode: 'REBUILT_VERIFIED',
    manualReview: {
      reviewedAt: input.reviewedAt.toISOString(),
      reviewedBy: input.reviewedBy,
      note,
    },
    reconciliation: {
      ...snapshot.reconciliation,
      status: 'MATCHED',
    },
  };
}
