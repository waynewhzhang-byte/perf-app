import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeUploadFilename,
  getFileExtension,
  validateUploadBuffer,
} from './upload-security';
import { Buffer } from 'node:buffer';

describe('sanitizeUploadFilename', () => {
  it('正常文件名不变', () => {
    assert.equal(sanitizeUploadFilename('report.pdf'), 'report.pdf');
    assert.equal(sanitizeUploadFilename('photo-2024.jpg'), 'photo-2024.jpg');
  });

  it('替换路径分隔符为下划线', () => {
    const result = sanitizeUploadFilename('/etc/passwd');
    assert.ok(!result.includes('/'));
    assert.ok(result.includes('etc'));
    assert.ok(result.includes('passwd'));
  });

  it('去除控制字符', () => {
    assert.equal(sanitizeUploadFilename('file\x00.pdf'), 'file.pdf');
    assert.equal(sanitizeUploadFilename('test\x1f.doc'), 'test.doc');
  });

  it('去除连续和前后点号', () => {
    const result = sanitizeUploadFilename('..hidden..file.txt');
    assert.ok(!result.startsWith('.'));
    assert.ok(!result.includes('..'));
  });

  it('限制文件名长度为 200', () => {
    const long = 'x'.repeat(250) + '.pdf';
    const result = sanitizeUploadFilename(long);
    assert.ok(result.length <= 200);
  });
});

describe('getFileExtension', () => {
  it('提取正常扩展名', () => {
    assert.equal(getFileExtension('report.PDF'), '.pdf');
    assert.equal(getFileExtension('photo.JPG'), '.jpg');
    assert.equal(getFileExtension('doc.docx'), '.docx');
  });

  it('无扩展名返回空字符串', () => {
    assert.equal(getFileExtension('README'), '');
    assert.equal(getFileExtension('Makefile'), '');
  });

  it('多点文件名取最后一段', () => {
    assert.equal(getFileExtension('archive.tar.gz'), '.gz');
  });
});

describe('validateUploadBuffer', () => {
  it('PDF 文件通过魔数验证', () => {
    const buf = Buffer.from('%PDF-1.4 fake pdf content here');
    const result = validateUploadBuffer(buf, 'doc.pdf', 'application/pdf');
    assert.ok(result.ok);
  });

  it('JPEG 文件通过魔数验证', () => {
    const buf = Buffer.alloc(10);
    buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
    const result = validateUploadBuffer(buf, 'photo.jpg', 'image/jpeg');
    assert.ok(result.ok);
  });

  it('PNG 文件通过魔数验证', () => {
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = validateUploadBuffer(buf, 'icon.png', 'image/png');
    assert.ok(result.ok);
  });

  it('白名单外的扩展名拒绝', () => {
    const buf = Buffer.alloc(100);
    const result = validateUploadBuffer(buf, 'script.exe', 'application/octet-stream');
    assert.equal(result.ok, false);
  });

  it('黑名单扩展名拒绝（.html）', () => {
    const buf = Buffer.alloc(100);
    const result = validateUploadBuffer(buf, 'page.html', 'text/html');
    assert.equal(result.ok, false);
  });

  it('黑名单扩展名拒绝（.svg）', () => {
    const buf = Buffer.alloc(100);
    buf.write('<svg></svg>', 0);
    const result = validateUploadBuffer(buf, 'image.svg', 'image/svg+xml');
    assert.equal(result.ok, false);
  });

  it('魔数与扩展名不一致拒绝', () => {
    const buf = Buffer.from('%PDF-1.4'); // PDF magic
    const result = validateUploadBuffer(buf, 'fake.jpg', 'image/jpeg');
    assert.equal(result.ok, false);
  });

  it('含脚本标签的内容被拒绝', () => {
    const buf = Buffer.alloc(4096);
    buf.write('<script>alert(1)</script>', 0);
    const result = validateUploadBuffer(buf, 'doc.pdf', 'application/pdf');
    assert.equal(result.ok, false);
  });

  it('含 javascript: 协议的内容被拒绝', () => {
    const buf = Buffer.alloc(4096);
    buf.write('some content javascript:void(0) more', 0);
    const result = validateUploadBuffer(buf, 'doc.pdf', 'application/pdf');
    assert.equal(result.ok, false);
  });

  it('大小检查在 route 层用 file.size 完成', () => {
    // UPLOAD_MAX_FILE_SIZE 在 route handler 层通过 file.size 检查
    // validateUploadBuffer 只做内容和魔数校验
  });
});

describe('validateUploadBuffer — 扩展名交叉校验', () => {
  it('PDF 文件以 .pdf 为名通过', () => {
    const buf = Buffer.from('%PDF-1.4 content');
    const result = validateUploadBuffer(buf, 'report.pdf', 'application/pdf');
    assert.ok(result.ok);
  });

  it('PDF 魔数 + .jpg 扩展名被拒绝', () => {
    const buf = Buffer.from('%PDF-1.4 content');
    const result = validateUploadBuffer(buf, 'report.jpg', 'image/jpeg');
    assert.equal(result.ok, false);
  });
});
