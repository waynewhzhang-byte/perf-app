// 附件上传：multipart/form-data → MinIO（扩展名 + 魔数 + 权限 + 限流）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { putObject, removeObject } from '@/lib/minio';
import {
  sanitizeUploadFilename,
  UPLOAD_MAX_FILES_PER_ITEM,
  UPLOAD_MAX_FILE_SIZE,
  validateUploadBuffer,
} from '@/lib/upload-security';
import { extractIP, isRateLimited, recordAttempt } from '@/lib/rate-limit';

const DeleteSchema = z.object({
  id: z.string(),
});

// 每用户每小时最多上传次数（所有申报项合计）
const UPLOAD_RATE_LIMIT_PER_USER = 60;
const UPLOAD_RATE_WINDOW_MS = 60 * 60_000;

/** 校验提交可编辑性与锁定项。不可编辑时直接抛 EditableError。 */
async function validateEditable(tx: any, submissionId: string, userId: string) {
  const sub = await tx.submission.findUnique({
    where: { id: submissionId },
    include: { items: true },
  });
  if (!sub || sub.userId !== userId) {
    throw new EditableError('无权限', 403);
  }

  const editableStates: string[] = ['DRAFT', 'REJECTED'];
  if (!editableStates.includes(sub.status)) {
    const msg =
      sub.status === 'SUBMITTED'
        ? '申报已提交，不可上传附件'
        : sub.status === 'L1_APPROVED'
          ? '申报已通过一级审核，不可上传附件'
          : sub.status === 'L2_APPROVED'
            ? '申报已终审通过，不可上传附件'
            : '当前状态不可上传附件';
    throw new EditableError(msg, 400);
  }

  const lockedItemIds = new Set<string>();
  if (sub.status === 'REJECTED') {
    for (const it of sub.items) {
      if (it.status !== 'REJECTED') lockedItemIds.add(it.id);
    }
  }
  return { lockedItemIds };
}

export async function POST(req: Request) {
  try {
    const s = await getSession(false);
    if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });

    const ip = extractIP(req);
    if (isRateLimited(`upload:ip:${ip}`, UPLOAD_RATE_LIMIT_PER_USER * 2, UPLOAD_RATE_WINDOW_MS)) {
      return NextResponse.json({ error: '上传过于频繁，请稍后再试' }, { status: 429 });
    }
    if (
      isRateLimited(`upload:user:${s.userId}`, UPLOAD_RATE_LIMIT_PER_USER, UPLOAD_RATE_WINDOW_MS)
    ) {
      return NextResponse.json({ error: '上传次数过多，请稍后再试' }, { status: 429 });
    }

    const form = await req.formData();
    const submissionItemId = form.get('submissionItemId') as string | null;
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    const single = form.get('file');
    if (single instanceof File) files.push(single);
    if (!submissionItemId || files.length === 0) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    if (files.length > UPLOAD_MAX_FILES_PER_ITEM) {
      return NextResponse.json(
        { error: `单次最多上传 ${UPLOAD_MAX_FILES_PER_ITEM} 个文件` },
        { status: 400 },
      );
    }

    const item = await prisma.submissionItem.findUnique({
      where: { id: submissionItemId },
      include: { submission: true },
    });
    if (!item || item.submission.userId !== s.userId) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const validatedBuffers: { buf: Buffer; filename: string; mimeType: string }[] = [];
    for (const file of files) {
      if (file.size > UPLOAD_MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `文件 ${file.name} 超过 ${UPLOAD_MAX_FILE_SIZE / 1024 / 1024}MB 上限`,
          },
          { status: 400 },
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const check = validateUploadBuffer(buf, file.name, file.type);
      if (!check.ok) {
        return NextResponse.json({ error: `${file.name}：${check.error}` }, { status: 400 });
      }
      validatedBuffers.push({
        buf,
        filename: sanitizeUploadFilename(file.name),
        mimeType: check.mimeType,
      });
    }

    const attachments: { id: string; filename: string }[] = [];
    await prisma.$transaction(async (tx) => {
      const { lockedItemIds } = await validateEditable(tx, item.submissionId, s.userId);

      if (lockedItemIds.has(submissionItemId)) {
        throw new EditableError('该项已通过审核，不可上传附件', 400);
      }

      const currentCount = await tx.attachment.count({ where: { submissionItemId } });
      if (currentCount + validatedBuffers.length > UPLOAD_MAX_FILES_PER_ITEM) {
        throw new EditableError(
          `该项最多 ${UPLOAD_MAX_FILES_PER_ITEM} 个附件，当前已有 ${currentCount} 个`,
          400,
        );
      }

      for (const { buf, filename, mimeType } of validatedBuffers) {
        const key = `submissions/${item.submissionId}/${submissionItemId}/${randomUUID()}-${filename}`;

        const att = await tx.attachment.create({
          data: {
            submissionItemId,
            filename,
            mimeType,
            sizeBytes: BigInt(buf.length),
            storageKey: key,
            uploadedBy: s.userId,
          },
        });

        await putObject(key, buf, mimeType);
        attachments.push({ id: att.id, filename: att.filename });
      }
    });

    recordAttempt(`upload:user:${s.userId}`, UPLOAD_RATE_WINDOW_MS);
    recordAttempt(`upload:ip:${ip}`, UPLOAD_RATE_WINDOW_MS);

    return NextResponse.json({ success: true, attachments });
  } catch (e) {
    if (e instanceof EditableError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('POST /api/attachments:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const parsed = DeleteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
  const { id } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const att = await tx.attachment.findUnique({
        where: { id },
        include: { submissionItem: { include: { submission: true } } },
      });
      if (!att || att.submissionItem.submission.userId !== s.userId) {
        throw new EditableError('无权限', 403);
      }

      const { lockedItemIds } = await validateEditable(tx, att.submissionItem.submissionId, s.userId);

      if (lockedItemIds.has(att.submissionItemId)) {
        throw new EditableError('该项已通过审核，不可删除附件', 400);
      }

      await tx.attachment.delete({ where: { id } });

      try {
        await removeObject(att.storageKey);
      } catch (minioErr) {
        console.error(`[attachments] MinIO delete failed for ${att.storageKey}:`, minioErr);
      }
    });
  } catch (e) {
    if (e instanceof EditableError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('DELETE /api/attachments:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

class EditableError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'EditableError';
    this.status = status;
  }
}
