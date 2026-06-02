import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFullWorkYears,
  evaluatePreReviewRules,
  type PreReviewRule,
} from './pre-review';

test('calculateFullWorkYears counts complete anniversaries only', () => {
  assert.equal(
    calculateFullWorkYears(new Date('2021-06-03T00:00:00.000Z'), new Date('2026-06-03T00:00:00.000Z')),
    5,
  );
  assert.equal(
    calculateFullWorkYears(new Date('2021-06-04T00:00:00.000Z'), new Date('2026-06-03T00:00:00.000Z')),
    4,
  );
});

test('evaluatePreReviewRules rejects declaration levels outside the matched work-year range', () => {
  const rules: PreReviewRule[] = [{
    id: 'rule-5-8',
    name: '5年以上8年以下只能申报2级',
    enabled: true,
    minWorkYears: 5,
    maxWorkYears: 8,
    allowedLevelIds: ['level-2'],
    rejectMessage: '工作年限满5年未满8年时，只能申报2级。',
  }];

  const result = evaluatePreReviewRules({
    workYears: 5,
    declarationLevelId: 'level-1',
    rules,
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.messages, ['工作年限满5年未满8年时，只能申报2级。']);
  assert.deepEqual(result.matchedRuleIds, ['rule-5-8']);
});

test('evaluatePreReviewRules allows configured levels and ignores unmatched ranges', () => {
  const rules: PreReviewRule[] = [{
    id: 'rule-5-8',
    name: '5年以上8年以下只能申报2级',
    enabled: true,
    minWorkYears: 5,
    maxWorkYears: 8,
    allowedLevelIds: ['level-2'],
    rejectMessage: '工作年限满5年未满8年时，只能申报2级。',
  }];

  assert.equal(evaluatePreReviewRules({ workYears: 5, declarationLevelId: 'level-2', rules }).passed, true);
  assert.equal(evaluatePreReviewRules({ workYears: 8, declarationLevelId: 'level-1', rules }).passed, true);
});
