import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentViewKind } from './attachment-access';

describe('attachmentViewKind', () => {
  it('image/png 识别为 image', () => {
    assert.equal(attachmentViewKind('image/png', 'icon.png'), 'image');
  });

  it('image/jpeg 识别为 image', () => {
    assert.equal(attachmentViewKind('image/jpeg', 'photo.jpg'), 'image');
  });

  it('image/gif 识别为 image', () => {
    assert.equal(attachmentViewKind('image/gif', 'anim.gif'), 'image');
  });

  it('image/webp 识别为 image', () => {
    assert.equal(attachmentViewKind('image/webp', 'img.webp'), 'image');
  });

  it('application/pdf 识别为 pdf', () => {
    assert.equal(attachmentViewKind('application/pdf', 'doc.pdf'), 'pdf');
  });

  it('text/plain 识别为 other', () => {
    assert.equal(attachmentViewKind('text/plain', 'readme.txt'), 'other');
  });

  it('application/octet-stream 识别为 other', () => {
    assert.equal(attachmentViewKind('application/octet-stream', 'data.bin'), 'other');
  });

  it('null mimeType 按文件名后缀识别', () => {
    // attachmentViewKind 在 mimeType 为 null 时会检查文件名后缀
    assert.equal(attachmentViewKind(null, 'report.PDF'), 'pdf');
    // 但 image 类型仍需 mimeType
    assert.equal(attachmentViewKind(null, 'notes.txt'), 'other');
  });

  it('无法识别时返回 other', () => {
    assert.equal(attachmentViewKind('video/mp4', 'movie.mp4'), 'other');
  });
});
