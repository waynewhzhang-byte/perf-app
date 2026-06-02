import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSelectedOptions,
  optionIdForIndex,
  optionWithFallbackId,
} from './form-options';

test('optionWithFallbackId gives old score options a deterministic item/index id', () => {
  assert.equal(
    optionWithFallbackId({ label: '国家刊物发表', score: 4 }, 'item-a', 0).optionId,
    'item-a:0',
  );
  assert.equal(
    optionWithFallbackId({ optionId: 'stable-id', label: '省级刊物发表', score: 3 }, 'item-a', 1).optionId,
    'stable-id',
  );
});

test('normalizeSelectedOptions resolves old index-only selections to stable option ids', () => {
  const selected = normalizeSelectedOptions(
    'item-paper',
    [{ label: '国家刊物发表', score: 4 }, { optionId: 'province', label: '省级刊物发表', score: 3 }],
    [{ index: 0, score: 999 }, { index: 1, optionId: 'province', label: 'old', score: 0, count: 2 }],
  );

  assert.deepEqual(selected, [
    { index: 0, optionId: optionIdForIndex('item-paper', 0), label: '国家刊物发表', score: 4, count: undefined },
    { index: 1, optionId: 'province', label: '省级刊物发表', score: 3, count: 2 },
  ]);
});
