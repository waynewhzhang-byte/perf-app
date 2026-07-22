import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { factKindForDimension } from './fact-correction';

describe('fact-correction', () => {
  it('routes basic and performance dimensions to their fact stores', () => {
    assert.equal(factKindForDimension('basic.skill-level'), 'BASIC');
    assert.equal(factKindForDimension('worksite.ticket-execution'), 'PERFORMANCE');
    assert.equal(factKindForDimension('performance.technical-contribution'), 'PERFORMANCE');
    assert.equal(factKindForDimension('performance.competition'), 'PERFORMANCE');
    assert.equal(factKindForDimension('performance.innovation'), 'PERFORMANCE');
    assert.equal(factKindForDimension('special.violation-general'), 'PERFORMANCE');
  });
});
