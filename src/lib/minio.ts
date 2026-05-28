import { Client as MinioClient } from 'minio';

let minioClient: MinioClient | null = null;

function getMinioClient(): MinioClient {
  if (!minioClient) {
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;
    if (!accessKey || !secretKey) {
      throw new Error('MINIO_ACCESS_KEY and MINIO_SECRET_KEY environment variables are required');
    }
    minioClient = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey,
      secretKey,
    });
  }
  return minioClient;
}

export const BUCKET = process.env.MINIO_BUCKET || 'perf-attachments';

// 用 Promise 单例替换 boolean 标志，消除竞态条件
let bucketPromise: Promise<void> | null = null;

export function ensureBucket(): Promise<void> {
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const client = getMinioClient();
      const exists = await client.bucketExists(BUCKET).catch(() => false);
      if (!exists) await client.makeBucket(BUCKET, 'us-east-1');
    })();
  }
  return bucketPromise;
}

export async function putObject(key: string, body: Buffer, mimeType?: string) {
  await ensureBucket();
  await getMinioClient().putObject(BUCKET, key, body, body.length, {
    'Content-Type': mimeType || 'application/octet-stream',
  });
}

export async function getObjectStream(key: string) {
  await ensureBucket();
  return getMinioClient().getObject(BUCKET, key);
}

export async function presignedGetUrl(
  key: string,
  expirySec = 600,
  respHeaders?: Record<string, string>,
) {
  await ensureBucket();
  return getMinioClient().presignedGetObject(BUCKET, key, expirySec, respHeaders);
}

export async function removeObject(key: string) {
  await ensureBucket();
  await getMinioClient().removeObject(BUCKET, key);
}
