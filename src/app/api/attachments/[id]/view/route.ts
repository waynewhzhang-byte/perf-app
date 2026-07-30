// 附件在线查看：校验权限后返回 MinIO 预签名 URL（inline）或 302 跳转
export { dynamic } from '@/lib/api-route';
import { NextResponse } from 'next/server';
import {
  attachmentViewKind,
  loadAttachmentForView,
  resolveAuthorizedAttachmentViewer,
} from '@/lib/attachment-access';
import { getSession } from '@/lib/auth';
import {
  isMinioConnectivityError,
  isMinioObjectNotFoundError,
  MinioUnavailableError,
  getObjectBuffer,
  presignedGetUrl,
} from '@/lib/minio';

const VIEW_URL_EXPIRY_SEC = 600;

function inlineContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename);
  return `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`;
}

/** 仅用于 302：相对 proxy 路径需拼成绝对 URL */
function absoluteFromRequest(req: Request, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
  if (configured) {
    try {
      return new URL(pathOrUrl, configured.endsWith('/') ? configured : `${configured}/`).toString();
    } catch {
      /* fall through */
    }
  }
  const xfProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const xfHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = xfHost || req.headers.get('host');
  if (host) {
    const proto = xfProto || (host.includes('localhost') ? 'http' : 'https');
    return `${proto}://${host}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  }
  return new URL(pathOrUrl, req.url).toString();
}

function contentTypeForAttachment(mimeType: string | null | undefined, filename: string): string {
  const mt = (mimeType ?? '').trim();
  if (mt && mt !== 'application/octet-stream') return mt;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return mt || 'application/octet-stream';
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const att = await loadAttachmentForView(params.id);
  if (!att) return NextResponse.json({ error: '附件不存在' }, { status: 404 });

  const viewer = await resolveAuthorizedAttachmentViewer(att);
  if (!viewer) {
    const hasSession = (await getSession(true)) ?? (await getSession(false));
    if (!hasSession) return NextResponse.json({ error: '未授权' }, { status: 401 });
    return NextResponse.json({ error: '无权限查看该附件' }, { status: 403 });
  }

  const mimeType = contentTypeForAttachment(att.mimeType, att.filename);
  const proxy = new URL(req.url).searchParams.get('proxy') === '1';
  if (proxy) {
    try {
      const body = await getObjectBuffer(att.storageKey);
      return new NextResponse(new Uint8Array(body), {
        headers: {
          'Content-Type': mimeType,
          'Content-Length': String(body.length),
          'Content-Disposition': inlineContentDisposition(att.filename),
          'Cache-Control': 'private, max-age=60',
          // 不声明 Accept-Ranges：未实现 Range/206 时，Chrome PDF 查看器会发 Range 请求并易异常
        },
      });
    } catch (e) {
      if (isMinioConnectivityError(e)) {
        console.error('GET /api/attachments/view MinIO:', e);
        return NextResponse.json(
          { error: new MinioUnavailableError(e).message },
          { status: 503 },
        );
      }
      if (isMinioObjectNotFoundError(e)) {
        return NextResponse.json({ error: '附件文件不存在或已被删除' }, { status: 404 });
      }
      console.error('GET /api/attachments/[id]/view proxy:', e);
      return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
    }
  }

  let viewUrl: string;
  try {
    viewUrl = process.env.MINIO_PUBLIC_ENDPOINT
      ? await presignedGetUrl(att.storageKey, VIEW_URL_EXPIRY_SEC, {
          'response-content-disposition': inlineContentDisposition(att.filename),
          'response-content-type': mimeType,
        })
      // 相对路径：浏览器按当前页面 Origin 请求，避免 Nginx 后 req.url 变成 127.0.0.1:3000
      : `/api/attachments/${params.id}/view?proxy=1`;
  } catch (e) {
    if (isMinioConnectivityError(e)) {
      console.error('GET /api/attachments/view MinIO:', e);
      return NextResponse.json(
        { error: new MinioUnavailableError(e).message },
        { status: 503 },
      );
    }
    if (isMinioObjectNotFoundError(e)) {
      return NextResponse.json({ error: '附件文件不存在或已被删除' }, { status: 404 });
    }
    console.error('GET /api/attachments/[id]/view:', e);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }

  const redirect = new URL(req.url).searchParams.get('redirect') === '1';
  if (redirect) {
    return NextResponse.redirect(absoluteFromRequest(req, viewUrl), 302);
  }

  return NextResponse.json({
    success: true,
    viewUrl,
    mimeType,
    filename: att.filename,
    kind: attachmentViewKind(att.mimeType, att.filename),
  });
}
