/**
 * 源数据加载工具：读 17 个 XLSX 文件并展开合并单元格。
 *
 * 专供 verify-imported-scores.ts 使用——把之前在交互式核对中分散的 openpyxl/python
 * 逻辑统一到 TypeScript，便于 CI 回归。
 *
 * 注意：必须用 src/app/admin/import/_shared/parse.ts 的 expandMergedCells，
 * 保证与生产导入路径完全一致的解析语义。
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { expandMergedCells } from '@/app/admin/import/_shared/parse';

export interface SourceSheet {
  headers: string[];
  rows: Record<string, string>[];
}

/** 读取 xlsx 指定 sheet，返回展开合并单元格后的 SourceSheet */
export function loadSheet(filePath: string, sheetName?: string): SourceSheet {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const name = sheetName ?? wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return { headers: [], rows: [] };
  const expanded = expandMergedCells(sheet);
  const raw = XLSX.utils.sheet_to_json(expanded, { defval: '', raw: false }) as Record<string, unknown>[];
  if (raw.length === 0) return { headers: [], rows: [] };
  const headerSet = new Set<string>();
  for (const obj of raw) {
    for (const k of Object.keys(obj)) {
      if (k && typeof k === 'string' && k.trim() && !k.startsWith('__EMPTY')) headerSet.add(k.trim());
    }
  }
  const headers = Array.from(headerSet);
  const rows = raw.map((obj) => {
    const row: Record<string, string> = {};
    for (const h of headers) {
      const val = obj[h];
      row[h] = val != null ? String(val).trim() : '';
    }
    return row;
  });
  return { headers, rows };
}

/** 读取 xlsx 的所有 sheet（按名字） */
export function loadSheets(filePath: string, sheetNames: string[]): Record<string, SourceSheet> {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const out: Record<string, SourceSheet> = {};
  for (const name of sheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) { out[name] = { headers: [], rows: [] }; continue; }
    const expanded = expandMergedCells(sheet);
    const raw = XLSX.utils.sheet_to_json(expanded, { defval: '', raw: false }) as Record<string, unknown>[];
    if (raw.length === 0) { out[name] = { headers: [], rows: [] }; continue; }
    const headerSet = new Set<string>();
    for (const obj of raw) {
      for (const k of Object.keys(obj)) {
        if (k && typeof k === 'string' && k.trim() && !k.startsWith('__EMPTY')) headerSet.add(k.trim());
      }
    }
    const headers = Array.from(headerSet);
    const rows = raw.map((obj) => {
      const row: Record<string, string> = {};
      for (const h of headers) {
        const val = obj[h];
        row[h] = val != null ? String(val).trim() : '';
      }
      return row;
    });
    out[name] = { headers, rows };
  }
  return out;
}

/** 读取 xlsx 第一个 sheet 的二维数组形态（按列序号读，避开重复列名问题） */
export function loadMatrix(filePath: string, sheetName?: string): string[][] {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const name = sheetName ?? wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  const expanded = expandMergedCells(sheet);
  const matrix = XLSX.utils.sheet_to_json(expanded, { header: 1, defval: '', raw: false }) as unknown[][];
  return matrix.map((row) => (row as unknown[]).map((c) => (c == null ? '' : String(c).trim())));
}
