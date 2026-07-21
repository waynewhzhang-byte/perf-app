import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReviewError,
  validateL1Decisions,
  validateL2Decisions,
} from './review-workflow';

describe('validateL1Decisions', () => {
  it('所有待审项均有决策时通过', () => {
    assert.doesNotThrow(() =>
      validateL1Decisions(
        [
          { id: 'i1', title: '缺陷治理' },
          { id: 'i2', title: '两票执行' },
        ],
        [
          { submissionItemId: 'i1', action: 'APPROVE' },
          { submissionItemId: 'i2', action: 'APPROVE' },
        ],
      ),
    );
  });

  it('缺决策时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL1Decisions(
          [
            { id: 'i1', title: '缺陷治理' },
            { id: 'i2', title: '两票执行' },
          ],
          [{ submissionItemId: 'i1', action: 'APPROVE' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError &&
        err.message.includes('两票执行') &&
        err.httpStatus === 400,
    );
  });

  it('驳回缺原因时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL1Decisions(
          [{ id: 'i1', title: '缺陷治理' }],
          [{ submissionItemId: 'i1', action: 'REJECT', note: '  ' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes('必须填写原因'),
    );
  });
});

describe('validateL2Decisions', () => {
  it('所有待审子项均有决策时通过', () => {
    assert.doesNotThrow(() =>
      validateL2Decisions(
        [
          { id: 'or1', label: '缺陷治理' },
          { id: 'or2', label: '安全贡献' },
        ],
        [
          { optionReviewId: 'or1', action: 'APPROVE' },
          { optionReviewId: 'or2', action: 'APPROVE' },
        ],
      ),
    );
  });

  it('缺子项决策时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL2Decisions(
          [
            { id: 'or1', label: '缺陷治理' },
            { id: 'or2', label: '安全贡献' },
          ],
          [{ optionReviewId: 'or1', action: 'APPROVE' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes('安全贡献'),
    );
  });

  it('驳回缺原因时抛 ReviewError', () => {
    assert.throws(
      () =>
        validateL2Decisions(
          [{ id: 'or1', label: '缺陷治理' }],
          [{ optionReviewId: 'or1', action: 'REJECT' }],
        ),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes('必须填写原因'),
    );
  });
});
