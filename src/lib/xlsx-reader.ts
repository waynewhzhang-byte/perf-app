import { readFileSync } from 'fs';
import { inflateRawSync } from 'zlib';

const NS = {
  a: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
};
const REL_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id';

function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  const siRegex = /<(?:\w+:)?si[\s>]([\s\S]*?)<\/(?:\w+:)?si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRegex.exec(xml)) !== null) {
    const tRegex = /<(?:\w+:)?t[^>]*>([^<]*)<\/(?:\w+:)?t>/g;
    const parts: string[] = [];
    let t: RegExpExecArray | null;
    while ((t = tRegex.exec(m[1])) !== null) parts.push(t[1]);
    strings.push(parts.join(''));
  }
  return strings;
}

function cellValue(cellXml: string, shared: string[]): string | number | null {
  const tMatch = cellXml.match(/\bt="([^"]+)"/);
  const vMatch = cellXml.match(/<(?:\w+:)?v>([^<]*)<\/(?:\w+:)?v>/);
  if (!vMatch) {
    const isMatch = cellXml.match(/<(?:\w+:)?is>([\s\S]*?)<\/(?:\w+:)?is>/);
    if (isMatch) {
      const tRegex = /<(?:\w+:)?t[^>]*>([^<]*)<\/(?:\w+:)?t>/g;
      const parts: string[] = [];
      let t: RegExpExecArray | null;
      while ((t = tRegex.exec(isMatch[1])) !== null) parts.push(t[1]);
      return parts.join('');
    }
    return null;
  }
  const raw = vMatch[1];
  if (tMatch?.[1] === 's') return shared[Number(raw)] ?? raw;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function readZipEntry(buf: Buffer, name: string): string | null {
  let offset = 0;
  while (offset < buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const compMethod = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const entryName = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    offset = dataStart + compSize;
    if (entryName === name) {
      if (compMethod === 0) return data.toString('utf8');
      if (compMethod === 8) return inflateRawSync(data).toString('utf8');
      throw new Error(`Unsupported compression for ${name}`);
    }
  }
  return null;
}

function parseSheetRows(sheetXml: string, shared: string[]): Map<number, Map<number, string | number | null>> {
  const rows = new Map<number, Map<number, string | number | null>>();
  const rowRegex = /<(?:\w+:)?row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rnum = Number(rowMatch[1]);
    const rowMap = new Map<number, string | number | null>();
    const cellRegex = /<(?:\w+:)?c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[2])) !== null) {
      const ref = cellMatch[1];
      const col = ref.match(/^([A-Z]+)/)?.[1];
      if (!col) continue;
      const cnum = colToNum(col);
      const inner = cellMatch[2] ? `<c ${cellMatch[0].match(/<(?:\w+:)?c\b([^>]*)>/)?.[1] ?? ''}>${cellMatch[2]}</c>` : cellMatch[0];
      rowMap.set(cnum, cellValue(inner, shared));
    }
    rows.set(rnum, rowMap);
  }
  return rows;
}

export interface SheetTable {
  sheetName: string;
  headers: string[];
  rows: Record<string, string | number | null>[];
}

/** 读取首个工作表为对象数组（首行为表头） */
export function readXlsxFirstSheet(filePath: string): SheetTable {
  const buf = readFileSync(filePath);
  const sharedXml = readZipEntry(buf, 'xl/sharedStrings.xml') ?? '';
  const shared = parseSharedStrings(sharedXml);
  const workbookXml = readZipEntry(buf, 'xl/workbook.xml');
  if (!workbookXml) throw new Error('Invalid xlsx: missing workbook');

  const sheetMatch = workbookXml.match(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]+)"[^>]*\b[^>]*\/?>/);
  const ridMatch = workbookXml.match(/<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/);
  if (!sheetMatch || !ridMatch) throw new Error('No sheet in workbook');

  const relsXml = readZipEntry(buf, 'xl/_rels/workbook.xml.rels');
  if (!relsXml) throw new Error('Missing workbook rels');
  const relRegex = new RegExp(
    `<Relationship\\b[^>]*\\bId="${ridMatch[1]}"[^>]*\\bTarget="([^"]+)"`,
  );
  const targetMatch = relsXml.match(relRegex);
  if (!targetMatch) throw new Error('Sheet target not found');

  let target = targetMatch[1];
  if (!target.startsWith('xl/')) target = `xl/${target.replace(/^\//, '')}`;
  const sheetXml = readZipEntry(buf, target);
  if (!sheetXml) throw new Error(`Missing sheet file ${target}`);

  const parsedRows = parseSheetRows(sheetXml, shared);
  const maxRow = Math.max(...parsedRows.keys());
  const headerRow = parsedRows.get(1);
  if (!headerRow) throw new Error('Missing header row');

  const maxCol = Math.max(...headerRow.keys());
  const headers: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    headers.push(String(headerRow.get(c) ?? `col${c}`));
  }

  const rows: Record<string, string | number | null>[] = [];
  for (let r = 2; r <= maxRow; r++) {
    const row = parsedRows.get(r);
    if (!row) continue;
    const obj: Record<string, string | number | null> = {};
    let empty = true;
    for (let c = 1; c <= maxCol; c++) {
      const val = row.get(c) ?? null;
      if (val !== null && val !== '') empty = false;
      obj[headers[c - 1]] = val;
    }
    if (!empty) rows.push(obj);
  }

  return { sheetName: sheetMatch[1], headers, rows };
}
