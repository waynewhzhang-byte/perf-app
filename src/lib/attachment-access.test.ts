import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentViewKind, canViewAttachment } from './attachment-access';

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
    assert.equal(attachmentViewKind(null, 'report.PDF'), 'pdf');
    assert.equal(attachmentViewKind(null, 'photo.JPG'), 'image');
    assert.equal(attachmentViewKind('application/octet-stream', 'shot.png'), 'image');
    assert.equal(attachmentViewKind(null, 'notes.txt'), 'other');
  });

  it('无法识别时返回 other', () => {
    assert.equal(attachmentViewKind('video/mp4', 'movie.mp4'), 'other');
  });
});

describe('canViewAttachment', () => {
  it('二级审核员可查看一级已通过申报的附件', async () => {
    const allowed = await canViewAttachment('reviewer-l2', ['REVIEWER_L2'], {
      submissionItem: {
        submission: {
          userId: 'employee-1',
          status: 'L1_APPROVED',
          branchId: 'branch-1',
          user: { departmentId: 'dept-1' },
        },
      },
    } as never);
    assert.equal(allowed, true);
  });

  it('二级审核员不可查看待一级审核的附件', async () => {
    const allowed = await canViewAttachment('reviewer-l2', ['REVIEWER_L2'], {
      submissionItem: {
        submission: {
          userId: 'employee-1',
          status: 'SUBMITTED',
          branchId: 'branch-1',
          user: { departmentId: 'dept-1' },
        },
      },
    } as never);
    assert.equal(allowed, false);
  });

  it('申报人本人可查看附件', async () => {
    const allowed = await canViewAttachment('employee-1', ['EMPLOYEE'], {
      submissionItem: {
        submission: {
          userId: 'employee-1',
          status: 'SUBMITTED',
          branchId: null,
          user: { departmentId: null },
        },
      },
    } as never);
    assert.equal(allowed, true);
  });

  it('管理员可查看申诉附件', async () => {
    const allowed = await canViewAttachment('admin-1', ['ADMIN'], {
      submissionItem: {
        submission: {
          userId: 'employee-1',
          status: 'L2_APPROVED',
          branchId: null,
          user: { departmentId: null },
        },
      },
    } as never);
    assert.equal(allowed, true);
  });
});
