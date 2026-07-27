import http from 'http';
import https from 'https';
import { Client as MinioClient } from 'minio';

const CONNECT_TIMEOUT_MS = 10_000;
/** 固定 region，避免 presign 时 getBucketRegion 去连公网/自签名 HTTPS 失败 */
const MINIO_REGION = process.env.MINIO_REGION || 'us-east-1';

type MinioConn = {
  endPoint: string;
  port: number;
  useSSL: boolean;
};

function parsePort(value: string | undefined, fallback: string): number {
  return parseInt(value || fallback, 10);
}

function readCredentials(): { accessKey: string; secretKey: string } {
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY environment variables are required');
  }
  return { accessKey, secretKey };
}

function readInternalConn(): MinioConn {
  return {
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parsePort(process.env.MINIO_PORT, '9000'),
    useSSL: process.env.MINIO_USE_SSL === 'true',
  };
}

/** 浏览器预签名 URL 用；未配置时回退 MINIO_* */
function readPublicConn(): MinioConn {
  return {
    endPoint:
      process.env.MINIO_PUBLIC_ENDPOINT ||
      process.env.MINIO_ENDPOINT ||
      'localhost',
    port: parsePort(
      process.env.MINIO_PUBLIC_PORT || process.env.MINIO_PORT,
      '9000',
    ),
    useSSL:
      process.env.MINIO_PUBLIC_USE_SSL != null
        ? process.env.MINIO_PUBLIC_USE_SSL === 'true'
        : process.env.MINIO_USE_SSL === 'true',
  };
}

function createClient(conn: MinioConn): MinioClient {
  const { accessKey, secretKey } = readCredentials();
  const Agent = conn.useSSL ? https.Agent : http.Agent;
  // 公网自签名反代：SDK 偶发探测时放宽 TLS；正式 CA 可设 MINIO_TLS_INSECURE=false
  const tlsInsecure =
    process.env.MINIO_TLS_INSECURE === 'true' ||
    (conn.useSSL && process.env.MINIO_TLS_INSECURE !== 'false');

  return new MinioClient({
    endPoint: conn.endPoint,
    port: conn.port,
    useSSL: conn.useSSL,
    accessKey,
    secretKey,
    region: MINIO_REGION,
    pathStyle: true,
    transportAgent: new Agent({
      timeout: CONNECT_TIMEOUT_MS,
      ...(conn.useSSL ? { rejectUnauthorized: !tlsInsecure } : {}),
    }),
  });
}

let internalClient: MinioClient | null = null;
let publicClient: MinioClient | null = null;

function getInternalClient(): MinioClient {
  if (!internalClient) {
    internalClient = createClient(readInternalConn());
  }
  return internalClient;
}

function getPublicClient(): MinioClient {
  if (!publicClient) {
    publicClient = createClient(readPublicConn());
  }
  return publicClient;
}

export const BUCKET = process.env.MINIO_BUCKET || 'perf-attachments';

let bucketPromise: Promise<void> | null = null;

export function ensureBucket(): Promise<void> {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const client = getInternalClient();
      const exists = await client.bucketExists(BUCKET).catch(() => false);
      if (!exists) await client.makeBucket(BUCKET, 'us-east-1');
    })();
  }
  return bucketPromise;
}

export async function putObject(key: string, body: Buffer, mimeType?: string) {
  await ensureBucket();
  await getInternalClient().putObject(BUCKET, key, body, body.length, {
    'Content-Type': mimeType || 'application/octet-stream',
  });
}

export async function getObjectStream(key: string) {
  await ensureBucket();
  return getInternalClient().getObject(BUCKET, key);
}

/**
 * 生成浏览器可访问的预签名 URL。
 * 使用 PUBLIC 端点参与签名（Host 与浏览器请求一致）；固定 region 避免去连公网探测。
 */
export async function presignedGetUrl(
  key: string,
  expirySec = 600,
  respHeaders?: Record<string, string>,
) {
  await ensureBucket();
  return getPublicClient().presignedGetObject(BUCKET, key, expirySec, respHeaders);
}

export async function removeObject(key: string) {
  await ensureBucket();
  await getInternalClient().removeObject(BUCKET, key);
}

/** 供 API 错误信息区分 MinIO 连接问题 */
export function isMinioConnectivityError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  const code = e.code ?? '';
  const msg = e.message ?? '';
  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    /connect.*timed out/i.test(msg) ||
    /ECONNREFUSED/i.test(msg) ||
    /self.?signed/i.test(msg) ||
    /certificate/i.test(msg)
  );
}

export class MinioUnavailableError extends Error {
  constructor(cause?: unknown) {
    const pub = process.env.MINIO_PUBLIC_ENDPOINT
      ? ` PUBLIC=${process.env.MINIO_PUBLIC_ENDPOINT}:${process.env.MINIO_PUBLIC_PORT || '9000'}`
      : '';
    super(
      `MinIO 不可达，请检查 MINIO_ENDPOINT（同机部署请用 127.0.0.1）及 MINIO_PUBLIC_* 配置${pub}`,
    );
    this.name = 'MinioUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}
