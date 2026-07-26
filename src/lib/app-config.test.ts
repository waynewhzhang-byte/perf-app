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
  it('depends only on declaration notice fields, not home notice', () => {
    const at = new Date('2026-07-27T00:00:00.000Z');
    const a = buildNoticeRevision('声明文案', 30, at);
    const b = buildNoticeRevision('声明文案', 30, at);
    assert.equal(a, b);
    assert.match(a, new RegExp(`^${at.getTime()}:`));
  });

  it('changes when declaration text or seconds change', () => {
    const at = new Date('2026-07-27T00:00:00.000Z');
    const base = buildNoticeRevision('声明文案', 30, at);
    assert.notEqual(buildNoticeRevision('声明文案改', 30, at), base);
    assert.notEqual(buildNoticeRevision('声明文案', 20, at), base);
  });
});
