import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoticeRevision,
  normalizeHomeNotice,
  shouldShowHomeNotice,
} from './app-config';

describe('shouldShowHomeNotice', () => {
  it('shows when body has content', () => {
    assert.equal(shouldShowHomeNotice('技术支持：123'), true);
    assert.equal(shouldShowHomeNotice('  a  '), true);
  });

  it('hides when body is empty or whitespace', () => {
    assert.equal(shouldShowHomeNotice(''), false);
    assert.equal(shouldShowHomeNotice('   \n\t  '), false);
  });
});

describe('normalizeHomeNotice', () => {
  it('trims title and body', () => {
    assert.deepEqual(normalizeHomeNotice('  技术支持  ', '  电话\n微信  '), {
      homeNoticeTitle: '技术支持',
      homeNoticeBody: '电话\n微信',
    });
  });

  it('whitespace-only body becomes empty', () => {
    assert.deepEqual(normalizeHomeNotice('标题', '  \n  '), {
      homeNoticeTitle: '标题',
      homeNoticeBody: '',
    });
  });
});

describe('buildNoticeRevision', () => {
  it('depends only on declaration notice fields, not updatedAt or home notice', () => {
    const at = new Date('2026-07-27T00:00:00.000Z');
    const a = buildNoticeRevision('声明文案', 30, at);
    const b = buildNoticeRevision('声明文案', 30, new Date('2026-08-01T00:00:00.000Z'));
    assert.equal(a, b);
    assert.match(a, /^v1:/);
  });

  it('changes when declaration text or seconds change', () => {
    const base = buildNoticeRevision('声明文案', 30, null);
    assert.notEqual(buildNoticeRevision('声明文案改', 30, null), base);
    assert.notEqual(buildNoticeRevision('声明文案', 20, null), base);
  });
});
