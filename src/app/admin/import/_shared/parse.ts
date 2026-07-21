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
  // 展开合并单元格：SheetJS 默认只在每个 merge range 的 top-left cell 填值，
  // 其余覆盖单元格为 undefined。源数据（如《运规》编写会审人员）大量使用合并单元格
  // 表达"同一规程/地域下多个人员"，若不展开会导致 90% 行的地域/规程列为空，进而被
  // 按 (employeeNo, dimensionCode) 去重时压缩成 1 条，漏算多次参与分（B1）。
  const expanded = expandMergedCells(sheet);
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(expanded, { defval: '', raw: false });
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

/**
 * 把所有合并单元格 range 的 top-left 值复制到覆盖范围内的每个单元格。
 * 返回新的 worksheet，原 sheet 不被修改。
 *
 * 策略：遍历 `!merges`，对每个 range 内的所有 cell 地址（除 top-left 外），
 * 从 top-left 浅克隆 CellObject（保留类型/格式信息），让 sheet_to_json 视为有值。
 */
export function expandMergedCells(sheet: XLSX.WorkSheet): XLSX.WorkSheet {
  const merges = sheet['!merges'];
  if (!merges || merges.length === 0) return sheet;

  // 浅克隆 sheet（保留 !merges/!ref/!cols 等元字段，但 cell 对象单独复制）
  const out: XLSX.WorkSheet = { ...sheet };
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    out[key] = { ...(sheet[key] as XLSX.CellObject) };
  }

  for (const range of merges) {
    const { s, e } = range;
    const topLeftAddr = XLSX.utils.encode_cell(s);
    const topLeft = sheet[topLeftAddr];
    if (!topLeft) continue;
    for (let r = s.r; r <= e.r; r += 1) {
      for (let c = s.c; c <= e.c; c += 1) {
        if (r === s.r && c === s.c) continue;
        const addr = XLSX.utils.encode_cell({ r, c });
        out[addr] = { ...topLeft };
      }
    }
  }
  return out;
}
