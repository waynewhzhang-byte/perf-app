import * as XLSX from 'xlsx';

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCSV(text: string): ParsedFile {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
    while (vals.length < headers.length) vals.push('');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = vals[j] || '';
    rows.push(row);
  }
  return { headers, rows };
}

export function parseXLSX(buffer: ArrayBuffer, sheetName?: string): ParsedFile {
  const wb = XLSX.read(buffer, { type: 'array' });
  const name = sheetName ?? wb.SheetNames[0];
  if (!name) return { headers: [], rows: [] };
  const sheet = wb.Sheets[name];
  if (!sheet) return { headers: [], rows: [] };
  return sheetToParsedFile(sheet);
}

/** 读取 Excel 中指定工作表（用于两票等多 sheet 模板） */
export function parseXLSXSheets(
  buffer: ArrayBuffer,
  sheetNames: string[],
): { sheetNames: string[]; sheets: Record<string, ParsedFile> } {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheets: Record<string, ParsedFile> = {};
  for (const name of sheetNames) {
    const sheet = wb.Sheets[name];
    sheets[name] = sheet ? sheetToParsedFile(sheet) : { headers: [], rows: [] };
  }
  return { sheetNames: wb.SheetNames, sheets };
}

function sheetToParsedFile(sheet: XLSX.WorkSheet): ParsedFile {
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
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
