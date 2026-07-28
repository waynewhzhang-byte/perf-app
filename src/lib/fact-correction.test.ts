import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleFactCorrectionItemWhere,
  FACT_CORRECTION_DIMENSION_CODES,
  factKindForDimension,
} from './fact-correction';

describe('fact-correction', () => {
  it('routes basic and performance dimensions to their fact stores', () => {
    assert.equal(factKindForDimension('basic.skill-level'), 'BASIC');
    assert.equal(factKindForDimension('worksite.ticket-execution'), 'PERFORMANCE');
    assert.equal(factKindForDimension('performance.technical-contribution'), 'PERFORMANCE');
    assert.equal(factKindForDimension('performance.competition'), 'PERFORMANCE');
    assert.equal(factKindForDimension('performance.innovation'), 'PERFORMANCE');
    assert.equal(factKindForDimension('special.violation-general'), 'PERFORMANCE');
  });

  it('builds pending/corrected list filters by overrideScore for L2-approved appeals', () => {
    const pending = eligibleFactCorrectionItemWhere('pending');
    assert.equal(pending.isSystemFilled, true);
    assert.equal(pending.confirmationStatus, 'DISPUTED');
    assert.equal(pending.disputeL2Result, 'APPROVED');
    assert.deepEqual(pending.item, { dimensionCode: { in: FACT_CORRECTION_DIMENSION_CODES } });
    assert.equal(pending.overrideScore, null);
    assert.equal(pending.factCorrections, undefined);

    const corrected = eligibleFactCorrectionItemWhere('corrected');
    assert.deepEqual(corrected.overrideScore, { not: null });

    const all = eligibleFactCorrectionItemWhere('all');
    assert.equal(all.overrideScore, undefined);
  });
});
