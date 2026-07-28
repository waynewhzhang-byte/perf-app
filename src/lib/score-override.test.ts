import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleScoreOverrideItemWhere,
  effectiveSubmissionItemScore,
  isDeductionDimension,
  resolveDimensionMaxScore,
  SCORE_OVERRIDE_DIMENSION_CODES,
  validateOverrideScore,
} from './score-override';

describe('score-override', () => {
  it('lists L2-approved appeals pending score override by overrideScore null', () => {
    const pending = eligibleScoreOverrideItemWhere('pending');
    assert.equal(pending.isSystemFilled, true);
    assert.equal(pending.confirmationStatus, 'DISPUTED');
    assert.equal(pending.disputeL2Result, 'APPROVED');
    assert.deepEqual(pending.item, { dimensionCode: { in: SCORE_OVERRIDE_DIMENSION_CODES } });
    assert.equal(pending.overrideScore, null);

    const corrected = eligibleScoreOverrideItemWhere('corrected');
    assert.deepEqual(corrected.overrideScore, { not: null });

    const all = eligibleScoreOverrideItemWhere('all');
    assert.equal(all.overrideScore, undefined);
  });

  it('effective score prefers override and keeps system score separate', () => {
    assert.equal(effectiveSubmissionItemScore({ score: 4, overrideScore: 3 }), 3);
    assert.equal(effectiveSubmissionItemScore({ score: 4, overrideScore: null }), 4);
    assert.equal(effectiveSubmissionItemScore({ score: '4.5', overrideScore: undefined }), 4.5);
    assert.equal(effectiveSubmissionItemScore({ score: 0, overrideScore: -2 }), -2);
  });

  it('validates positive dimension override against max score', () => {
    assert.equal(
      validateOverrideScore({
        overrideScore: 12,
        dimensionCode: 'worksite.defect-governance',
      }),
      null,
    );
    assert.match(
      validateOverrideScore({
        overrideScore: 13,
        dimensionCode: 'worksite.defect-governance',
      }) ?? '',
      /满分/,
    );
    assert.match(
      validateOverrideScore({
        overrideScore: -1,
        dimensionCode: 'basic.skill-level',
      }) ?? '',
      /不可为负数/,
    );
  });

  it('allows non-positive scores for deduction dimensions', () => {
    assert.equal(isDeductionDimension('special.violation-severe'), true);
    assert.equal(
      validateOverrideScore({
        overrideScore: -10,
        dimensionCode: 'special.violation-severe',
      }),
      null,
    );
    assert.match(
      validateOverrideScore({
        overrideScore: 1,
        dimensionCode: 'special.violation-general',
      }) ?? '',
      /0 或负数/,
    );
  });

  it('resolves max score from scoring standards', () => {
    assert.equal(resolveDimensionMaxScore('worksite.ticket-execution'), 30);
    assert.equal(resolveDimensionMaxScore('special.violation-severe'), 0);
  });
});
