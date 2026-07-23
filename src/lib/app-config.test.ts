import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoticeRevision,
  DEFAULT_DECLARATION_NOTICE_TEXT,
  DEFAULT_NOTICE_SECONDS,
} from './app-config';

describe('buildNoticeRevision', () => {
  it('相同输入生成相同 revision', () => {
    const at = new Date('2026-07-23T12:00:00.000Z');
    const a = buildNoticeRevision(DEFAULT_DECLARATION_NOTICE_TEXT, DEFAULT_NOTICE_SECONDS, at);
    const b = buildNoticeRevision(DEFAULT_DECLARATION_NOTICE_TEXT, DEFAULT_NOTICE_SECONDS, at);
    assert.equal(a, b);
  });

  it('文案变更后 revision 变化', () => {
    const at = new Date('2026-07-23T12:00:00.000Z');
    const a = buildNoticeRevision(DEFAULT_DECLARATION_NOTICE_TEXT, DEFAULT_NOTICE_SECONDS, at);
    const b = buildNoticeRevision(`${DEFAULT_DECLARATION_NOTICE_TEXT}\n补充`, DEFAULT_NOTICE_SECONDS, at);
    assert.notEqual(a, b);
  });
});
