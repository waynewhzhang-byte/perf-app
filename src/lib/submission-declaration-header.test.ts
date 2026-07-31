import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSubmissionDeclarationHeader } from './submission-declaration-header';

const levels = [
  { id: 'lvl-1', name: '1级' },
  { id: 'lvl-2', name: '2级' },
  { id: 'lvl-3', name: '3级' },
];

test('resolveSubmissionDeclarationHeader keeps existing submission snapshot', () => {
  const hireDate = new Date('1985-08-01T00:00:00.000Z');
  const resolved = resolveSubmissionDeclarationHeader(
    {
      hireDate,
      workYears: 40,
      declarationLevelId: 'lvl-1',
      declarationLevelName: '1级',
    },
    { hireDate: null, profile: null },
    2026,
    levels,
  );
  assert.equal(resolved.hireDate?.toISOString(), hireDate.toISOString());
  assert.equal(resolved.workYears, 40);
  assert.equal(resolved.declarationLevelName, '1级');
});

test('resolveSubmissionDeclarationHeader falls back to user profile hire date', () => {
  const resolved = resolveSubmissionDeclarationHeader(
    {},
    {
      hireDate: new Date('1985-08-01T00:00:00.000Z'),
      profile: { 参加工作时间: '1985-08-01' },
    },
    2026,
    levels,
  );
  assert.equal(resolved.hireDate?.toISOString().slice(0, 10), '1985-08-01');
  assert.equal(resolved.workYears, 40);
  assert.equal(resolved.declarationLevelName, '1级');
});
