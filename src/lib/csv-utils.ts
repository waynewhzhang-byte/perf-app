// 共享 CSV / 路径安全工具

/**
 * Sanitize a value for safe CSV output (RFC 4180).
 * - Wraps fields containing comma, double-quote, or newline in double-quotes.
 * - Doubles any embedded double-quotes (RFC 4180 escaping).
 * - Prefixes formula-trigger characters (=, +, -, @) with a single quote
 *   to prevent CSV injection when opened in Excel or Google Sheets.
 */
export function csvField(value: string): string {
  let sanitized = value;
  // Prevent CSV formula injection (OWASP: CSV Injection)
  if (/^[=+\-@]/.test(sanitized)) {
    sanitized = `'${sanitized}`;
  }
  // RFC 4180: wrap in double-quotes if field contains comma, double-quote, or newline
  if (/[",\n\r]/.test(sanitized)) {
    sanitized = `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

/**
 * Sanitize a path segment for safe use in ZIP entry names.
 * Replaces characters invalid on Windows and blocks path traversal.
 * Falls back to '_unnamed_' if the segment collapses to empty.
 */
export function safeSegment(segment: string): string {
  const cleaned = segment
    .replace(/[/\\:*?"<>|]/g, '_') // Windows-invalid chars and path separators
    .replace(/\.\./g, '_')          // path traversal
    .trim();
  return cleaned || '_unnamed_';
}

export const BOM = '\uFEFF'; // UTF-8 BOM for Excel CJK compatibility on Windows
