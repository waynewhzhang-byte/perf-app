import { NextResponse } from 'next/server';
import { EmployeeScoreTotalsMismatchError } from '@/lib/performance-fact-repository';

export function factImportErrorResponse(error: unknown, logLabel: string) {
  if (error instanceof EmployeeScoreTotalsMismatchError) {
    return NextResponse.json(
      {
        error: error.message,
        reviewId: error.reviewId,
        mismatchCount: error.mismatches.length,
        status: 'PENDING_MANUAL_REVIEW',
      },
      { status: 409 },
    );
  }
  console.error(logLabel, error);
  const message = error instanceof Error ? error.message : '服务器内部错误';
  return NextResponse.json({ error: message }, { status: 500 });
}
