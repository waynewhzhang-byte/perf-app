import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateEmployeeDimensions,
  applyTicketCohortNormalization,
  sumTicketFactsByEmployee,
  capToStandard,
  cappedPair,
  normalizeWithinCohort,
  parentCap,
} from './dimension-aggregation';

describe('capToStandard', () => {
  it('caps defect to scoring-standards maxScore 12', () => {
    assert.equal(capToStandard('worksite.defect-governance', 20), 12);
    assert.equal(capToStandard('worksite.defect-governance', 3.5), 3.5);
  });

  it('caps safety to 12', () => {
    assert.equal(capToStandard('performance.safety-contribution', 15), 12);
  });
});

describe('cappedPair / normalizeWithinCohort', () => {
  it('splits under shared parent cap', () => {
    assert.deepEqual(cappedPair(8, 8, parentCap('performance.technical-contribution')), [6, 6]);
  });

  it('normalizes within cohort to ticket maxScore 30', () => {
    assert.equal(normalizeWithinCohort(0.06, 0.11, 30), 16.4);
    assert.equal(normalizeWithinCohort(0.11, 0.11, 30), 30);
  });
});

describe('aggregateEmployeeDimensions', () => {
  it('sums and caps defect / safety; leaves ticket raw without cohort max', () => {
    const totals = aggregateEmployeeDimensions({
      employeeNo: '1001',
      performanceFacts: [
        { dimensionCode: 'worksite.defect-governance', score: 0.5 },
        { dimensionCode: 'worksite.defect-governance', score: 1 },
        { dimensionCode: 'performance.safety-contribution', score: 20 },
        { dimensionCode: 'worksite.ticket-execution', score: 0.06 },
      ],
    });
    assert.equal(totals.byCode['worksite.defect-governance'].score, 1.5);
    assert.equal(totals.byCode['worksite.defect-governance'].factCount, 2);
    assert.equal(totals.byCode['performance.safety-contribution'].score, 12);
    assert.equal(totals.rawTicketScore, 0.06);
    assert.equal(totals.byCode['worksite.ticket-execution'].score, 0.06);
  });

  it('rolls up fine-grained technical codes into parent', () => {
    const totals = aggregateEmployeeDimensions({
      employeeNo: '1001',
      performanceFacts: [
        { dimensionCode: 'performance.technical-contribution.textbook', score: 6 },
        { dimensionCode: 'performance.technical-contribution.regulation', score: 4 },
        { dimensionCode: 'performance.technical-contribution.ticket-revision', score: 4 },
      ],
    });
    assert.equal(totals.byCode['performance.technical-contribution'].rawScore, 14);
    assert.equal(totals.byCode['performance.technical-contribution'].score, 12);
  });

  it('applies ticket cohort max when provided', () => {
    const totals = aggregateEmployeeDimensions({
      employeeNo: '1001',
      performanceFacts: [{ dimensionCode: 'worksite.ticket-execution', score: 0.06 }],
      ticketCohortMax: 0.11,
    });
    assert.equal(totals.byCode['worksite.ticket-execution'].score, 16.4);
  });

  it('maps basic facts and skips empty tiers', () => {
    const totals = aggregateEmployeeDimensions({
      employeeNo: '1001',
      performanceFacts: [],
      basicFacts: [
        { dimension: 'SKILL_LEVEL', score: 3, tierValue: '技师' },
        { dimension: 'TITLE_LEVEL', score: 2, tierValue: '//' },
      ],
    });
    assert.equal(totals.byCode['basic.skill-level']?.score, 3);
    assert.equal(totals.byCode['basic.title-level'], undefined);
  });
});

describe('applyTicketCohortNormalization', () => {
  it('逐票事实先按员工求和再进入专业归一化', () => {
    assert.deepEqual(
      sumTicketFactsByEmployee([
        { employeeNo: '1001', score: 0.01 },
        { employeeNo: '1001', score: 5 },
        { employeeNo: '1002', score: 1.5 },
      ]),
      [
        { employeeNo: '1001', rawTicketScore: 5.01 },
        { employeeNo: '1002', rawTicketScore: 1.5 },
      ],
    );
  });

  it('normalizes by specialty cohort', () => {
    const normalized = applyTicketCohortNormalization(
      [
        { employeeNo: '1001', cohortKey: '变电一次', rawTicketScore: 0.06 },
        { employeeNo: '1004', cohortKey: '变电一次', rawTicketScore: 0.11 },
        { employeeNo: '1002', cohortKey: '变电二次', rawTicketScore: 10 },
      ],
      'specialty',
    );
    assert.equal(normalized.find((r) => r.employeeNo === '1001')?.ticketScore, 16.4);
    assert.equal(normalized.find((r) => r.employeeNo === '1004')?.ticketScore, 30);
    assert.equal(normalized.find((r) => r.employeeNo === '1002')?.ticketScore, 30);
  });
});
