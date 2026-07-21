import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dimensionReviewOptionId,
  isReviewableDimensionCode,
  reviewPointDefinitions,
} from './dimension-review-routing';

test('二审路由覆盖系统动态生成的全部最终评分点', () => {
  const points = reviewPointDefinitions();

  assert.equal(points.length, 11);
  assert.equal(new Set(points.map((point) => point.dimensionCode)).size, points.length);
  assert.ok(points.some((point) => point.dimensionCode === 'worksite.ticket-execution'));
  assert.ok(points.some((point) => point.dimensionCode === 'performance.innovation'));
});

test('只接受评分标准注册的稳定维度代码', () => {
  assert.equal(isReviewableDimensionCode('basic.skill-level'), true);
  assert.equal(isReviewableDimensionCode('worksite.defect-governance'), true);
  assert.equal(isReviewableDimensionCode('template-item-id'), false);
});

test('最终评分点生成稳定且与模板选项无关的二审键', () => {
  assert.equal(
    dimensionReviewOptionId('worksite.ticket-execution'),
    'dimension:worksite.ticket-execution',
  );
});
