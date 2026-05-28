// 附件在线查看：校验权限后返回 MinIO 预签名 URL（inline）或 302 跳转
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import {
  attachmentViewKind,
  canViewAttachment,
  loadAttachmentForView,
} from '@/lib/attachment-access';
import { getSession, getUserRoles } from '@/lib/auth';
import { presignedGetUrl } from '@/lib/minio';

const VIEW_URL_EXPIRY_SEC = 600;

function inlineContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const s = await getSession(false);
  if (!s) return NextResponse.json({ error: '未授权' }, { status: 401 });

  const att = await loadAttachmentForView(params.id);
  if (!att) return NextResponse.json({ error: '附件不存在' }, { status: 404 });

  const roles = await getUserRoles(s.userId);
  if (!(await canViewAttachment(s.userId, roles, att))) {
    return NextResponse.json({ error: '无权限查看该附件' }, { status: 403 });
  }

  const mimeType = att.mimeType || 'application/octet-stream';
  const viewUrl = await presignedGetUrl(att.storageKey, VIEW_URL_EXPIRY_SEC, {
    'response-content-disposition': inlineContentDisposition(att.filename),
    'response-content-type': mimeType,
  });

  const redirect = new URL(req.url).searchParams.get('redirect') === '1';
  if (redirect) {
    return NextResponse.redirect(viewUrl, 302);
  }

  return NextResponse.json({
    success: true,
    viewUrl,
    mimeType,
    filename: att.filename,
    kind: attachmentViewKind(att.mimeType, att.filename),
  });
}
