/**
 * 员工附件上传安全校验：扩展名白名单 + 魔数检测 + 内容与声明类型一致性
 */

const MB = 1024 * 1024;

export const UPLOAD_MAX_FILE_SIZE =
  Math.min(
    Math.max(parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB || '10', 10) || 10, 1),
    50,
  ) * MB;

export const UPLOAD_MAX_FILES_PER_ITEM = Math.min(
  Math.max(parseInt(process.env.UPLOAD_MAX_FILES_PER_ITEM || '20', 10) || 20, 1),
  50,
);

/** 浏览器 file input 的 accept 属性 */
export const UPLOAD_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/*';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.txt',
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.svg',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.msi',
  '.dll',
  '.sh',
  '.php',
  '.asp',
  '.aspx',
  '.jar',
  '.war',
  '.apk',
  '.dmg',
  '.app',
  '.zip',
  '.rar',
  '.7z',
  '.gz',
  '.tar',
  '.wasm',
  '.vbs',
  '.ps1',
  '.scr',
  '.lnk',
]);

type DetectedKind =
  | 'pdf'
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'ole' // legacy .doc / .xls
  | 'zip' // docx / xlsx (OOXML)
  | 'text'
  | 'unknown';

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
};

const KIND_TO_MIME: Record<DetectedKind, string | null> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  ole: null, // 由扩展名区分 doc / xls
  zip: null, // 由扩展名区分 docx / xlsx
  text: 'text/plain',
  unknown: null,
};

export type UploadValidationResult =
  | { ok: true; mimeType: string; extension: string }
  | { ok: false; error: string };

/** 清洗文件名（与 attachments route 保持一致） */
export function sanitizeUploadFilename(name: string): string {
  return (
    name
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[/\\:*?"<>|]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 200) || 'file'
  );
}

export function getFileExtension(filename: string): string {
  const base = sanitizeUploadFilename(filename);
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot).toLowerCase();
}

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return sig.every((b, i) => buf[offset + i] === b);
}

function detectKind(buf: Buffer): DetectedKind {
  if (buf.length === 0) return 'unknown';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif'; // GIF8
  if (
    buf.length >= 12 &&
    startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp';
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    return 'zip';
  }
  return 'text';
}

function isLikelyPlainText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c === 0) return false;
    if (c < 9 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false;
  }
  return true;
}

function scanForActiveContent(buf: Buffer): string | null {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf8').toLowerCase();
  const patterns = [
    '<!doctype html',
    '<html',
    '<script',
    'javascript:',
    '<?php',
    '<%',
    '<svg',
    'onload=',
    'onerror=',
  ];
  for (const p of patterns) {
    if (head.includes(p)) return `检测到不允许的网页/脚本内容（${p}）`;
  }
  return null;
}

function extensionAllowedForKind(ext: string, kind: DetectedKind): boolean {
  switch (kind) {
    case 'pdf':
      return ext === '.pdf';
    case 'jpeg':
      return ext === '.jpg' || ext === '.jpeg';
    case 'png':
      return ext === '.png';
    case 'gif':
      return ext === '.gif';
    case 'webp':
      return ext === '.webp';
    case 'ole':
      return ext === '.doc' || ext === '.xls';
    case 'zip':
      return ext === '.docx' || ext === '.xlsx';
    case 'text':
      return ext === '.txt';
    default:
      return false;
  }
}

function resolveMimeType(ext: string, kind: DetectedKind): string | null {
  if (kind === 'ole' || kind === 'zip') {
    return EXT_TO_MIME[ext] ?? null;
  }
  const fromKind = KIND_TO_MIME[kind];
  if (fromKind) return fromKind;
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * 校验上传缓冲区。不信任客户端 Content-Type，以魔数 + 扩展名为准。
 */
export function validateUploadBuffer(
  buf: Buffer,
  originalFilename: string,
  _declaredMime?: string,
): UploadValidationResult {
  if (buf.length === 0) {
    return { ok: false, error: '文件为空' };
  }
  if (buf.length > UPLOAD_MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `文件超过 ${UPLOAD_MAX_FILE_SIZE / MB}MB 上限`,
    };
  }

  const ext = getFileExtension(originalFilename);
  if (!ext) {
    return { ok: false, error: '文件必须有合法扩展名' };
  }
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { ok: false, error: `不允许上传 ${ext} 类型文件` };
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: `仅支持：${[...ALLOWED_EXTENSIONS].join(' ')}`,
    };
  }

  const active = scanForActiveContent(buf);
  if (active) return { ok: false, error: active };

  let kind = detectKind(buf);
  if (kind === 'text' && !isLikelyPlainText(buf)) {
    kind = 'unknown';
  }

  if (!extensionAllowedForKind(ext, kind)) {
    return {
      ok: false,
      error: `文件内容与扩展名 ${ext} 不匹配，请上传真实的证明材料`,
    };
  }

  const mimeType = resolveMimeType(ext, kind);
  if (!mimeType) {
    return { ok: false, error: '无法确定安全的文件类型' };
  }

  return { ok: true, mimeType, extension: ext };
}
