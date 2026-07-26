// 附件上传：multipart/form-data → MinIO（扩展名 + 魔数 + 权限 + 限流）
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { withAuth, type ErrorMapper } from '@/lib/route-handler';
import {
  isMinioConnectivityError,
  MinioUnavailableError,
  putObject,
  removeObject,
} from '@/lib/minio';
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

/**
 * 附件上传状态对应的不可编辑提示文案。
 * 取代原本的嵌套三元（可读性 P2）。
 */
const MSG_BY_STATUS: Record<string, string> = {
  SUBMITTED: '申报已提交，不可上传附件',
  L1_APPROVED: '申报已通过一级审核，不可上传附件',
  L2_APPROVED: '申报已终审通过，不可上传附件',
};

/** 上传过程中需在事务内创建 DB 记录、事务外再上传 MinIO 的待传条目 */
interface PendingUpload {
  id: string;
  filename: string;
  /** MinIO 对象 key（事务外上传时使用） */
  key: string;
  /** 待上传的缓冲（事务外上传时使用） */
  buf: Buffer;
  /** 探测出的真实 MIME（事务外上传时使用） */
  mimeType: string;
}

/**
 * 附件可编辑性错误：携带 HTTP 状态码，由路由顶层 catch 统一映射。
 * 定义在前以便阅读顺序与使用顺序一致（原本在文件末尾）。
 */
class EditableError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'EditableError';
    this.status = status;
  }
}

/** 校验提交可编辑性与锁定项。不可编辑时直接抛 EditableError。 */
async function validateEditable(
  tx: Prisma.TransactionClient,
  submissionId: string,
  userId: string,
) {
  const sub = await tx.submission.findUnique({
    where: { id: submissionId },
    include: { items: true },
  });
  if (!sub || sub.userId !== userId) {
    throw new EditableError('无权限', 403);
  }

  const editableStates: string[] = ['DRAFT', 'REJECTED'];
  if (!editableStates.includes(sub.status)) {
    throw new EditableError(MSG_BY_STATUS[sub.status] ?? '当前状态不可上传附件', 400);
  }

  const lockedItemIds = new Set<string>();
  if (sub.status === 'REJECTED') {
    for (const it of sub.items) {
      if (it.status !== 'REJECTED') lockedItemIds.add(it.id);
    }
  }
  return { lockedItemIds };
}

/**
 * 附件路由错误映射（POST/DELETE 共用）：
 * - `EditableError` → 携带状态的 4xx（与原 catch 逐字一致）
 * - MinIO 连通错误 → 503 + MinioUnavailableError 文案（仅 POST 上传链路会抛此）
 * - 其余 → 返回 undefined，由 withAuth 走默认 500 兜底
 */
const attachmentOnError: ErrorMapper = (e, req) => {
  if (e instanceof EditableError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (isMinioConnectivityError(e)) {
    console.error(`${req.method} ${new URL(req.url).pathname} MinIO:`, e);
    return NextResponse.json(
      { error: new MinioUnavailableError(e).message },
      { status: 503 },
    );
  }
  return undefined;
};

export const POST = withAuth(async (req: Request, s: { userId: string }) => {
  const ip = extractIP(req);
  if (await isRateLimited(`upload:ip:${ip}`, UPLOAD_RATE_LIMIT_PER_USER * 2, UPLOAD_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: '上传过于频繁，请稍后再试' }, { status: 429 });
  }
  if (
    await isRateLimited(`upload:user:${s.userId}`, UPLOAD_RATE_LIMIT_PER_USER, UPLOAD_RATE_WINDOW_MS)
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

  // attachments 携带事务外上传 MinIO 所需的 buf/key/mimeType；
  // 响应时只取 id/filename，内部字段不会泄露给客户端。
  const attachments: PendingUpload[] = [];
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

      attachments.push({ id: att.id, filename: att.filename, key, buf, mimeType });
    }
  });

  // Upload to MinIO OUTSIDE the transaction to avoid holding DB locks
  // during network I/O. If MinIO fails, clean up the DB records.
  // 内层 try/catch 负责"上传失败时回滚 DB + 清理已上传对象"，再向上抛出由
  // attachmentOnError 映射为 503 / 500——这与原外层 catch 行为逐字等价。
  const createdIds: string[] = [];
  try {
    for (const att of attachments) {
      await putObject(att.key, att.buf, att.mimeType);
      createdIds.push(att.id);
    }
  } catch (uploadErr) {
    // Roll back DB records for files that failed to upload
    if (createdIds.length > 0) {
      await prisma.attachment.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    }
    // Also clean up any MinIO objects that made it through before the failure
    for (const att of attachments) {
      removeObject(att.key).catch(() => {});
    }
    throw uploadErr;
  }

  await recordAttempt(`upload:user:${s.userId}`, UPLOAD_RATE_WINDOW_MS);
  await recordAttempt(`upload:ip:${ip}`, UPLOAD_RATE_WINDOW_MS);

  return NextResponse.json({
    success: true,
    attachments: attachments.map(({ id, filename }) => ({ id, filename })),
  });
}, { onError: attachmentOnError });

export const DELETE = withAuth(async (req: Request, s: { userId: string }) => {
  const parsed = DeleteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: '参数无效' }, { status: 400 });
  const { id } = parsed.data;

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

  return NextResponse.json({ success: true });
}, { onError: attachmentOnError });
