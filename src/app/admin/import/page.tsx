'use client';
// 绩效事实数据导入
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { DIMENSION_DEFS, type DimensionDef } from '@/lib/dimension-codes';

// PerformanceFact 字段中文名
const FACT_FIELDS: { key: string; label: string }[] = [
  { key: 'employeeNo', label: '工号' },
  { key: 'employeeName', label: '姓名' },
  { key: 'role', label: '角色' },
  { key: 'eventType', label: '事件类型' },
  { key: 'defectLevel', label: '缺陷等级' },
  { key: 'defectRef', label: '缺陷编号' },
  { key: 'eventDate', label: '事件日期' },
  { key: 'score', label: '单项得分（可选，已有分数时跳过引擎）' },
  { key: 'faultCount', label: '故障次数（安全贡献）' },
  { key: 'rawScore', label: '原始分（两票执行）' },
  { key: 'incidentId', label: '事件编号（安全贡献分组）' },
  { key: 'declarationLevel', label: '能级等级（两票折算分组）' },
];

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map((v) => v.trim());
    if (vals.length === 0 || (vals.length === 1 && !vals[0])) continue;
    // 用最后一列补全不足的列
    while (vals.length < headers.length) vals.push('');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = vals[j] || '';
    }
    rows.push(row);
  }
  return { headers, rows };
}

/** 解析 XLSX/XLS：取第一个 sheet，第一行为表头，后续为数据行 */
function parseXLSX(
  buffer: ArrayBuffer,
): { headers: string[]; rows: Record<string, string>[] } {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = wb.Sheets[sheetName];
  // sheet_to_json 直接转为对象数组（第一行作 key）
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false, // 日期/数字等格式化为字符串
  });

  if (raw.length === 0) return { headers: [], rows: [] };

  // 推导表头：取所有键的并集
  const headerSet = new Set<string>();
  for (const obj of raw) {
    for (const k of Object.keys(obj)) {
      if (k && typeof k === 'string' && k.trim()) headerSet.add(k.trim());
    }
  }
  const headers = Array.from(headerSet);

  // 转为字符串行
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

export default function ImportFactsPage() {
  const [dim, setDim] = useState<DimensionDef>(DIMENSION_DEFS[0]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; created: number; updated: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 切换维度时，对已加载的文件重新自动匹配字段映射
  useEffect(() => {
    if (headers.length === 0) return;
    const auto: Record<string, string> = {};
    for (const f of FACT_FIELDS) {
      if (!dim.fields.includes(f.key)) continue;
      const match = headers.find((h) => h === f.label || h.includes(f.label));
      if (match) auto[f.key] = match;
    }
    setMapping(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dim]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();

    const process = (parsed: { headers: string[]; rows: Record<string, string>[] }) => {
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setResult(null);
      // 自动匹配映射（仅匹配当前维度需要的字段）
      const auto: Record<string, string> = {};
      for (const f of FACT_FIELDS) {
        if (!dim.fields.includes(f.key)) continue;
        const match = parsed.headers.find((h) => h === f.label || h.includes(f.label));
        if (match) auto[f.key] = match;
      }
      setMapping(auto);
    };

    const reader = new FileReader();
    if (ext === 'xlsx' || ext === 'xls') {
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer;
        process(parseXLSX(buffer));
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        const text = reader.result as string;
        process(parseCSV(text));
      };
      reader.readAsText(file);
    }
  };

  const doImport = async () => {
    if (rows.length === 0) { alert('请先选择文件'); return; }
    setBusy(true);
    const r = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimensionCode: dim.code,
        dimensionTitle: dim.name,
        year,
        sourceFile: fileRef.current?.files?.[0]?.name ?? 'upload.csv',
        mapping,
        rows,
      }),
    });
    setBusy(false);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert('导入失败：' + (d.error || r.status)); return; }
    setResult(d);
  };

  const reset = () => {
    setHeaders([]); setRows([]); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const setMap = (fieldKey: string, colName: string) => {
    setMapping((prev) => ({ ...prev, [fieldKey]: colName }));
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer">← 返回管理后台</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">导入绩效事实数据</h1>

      {/* 维度 + 年度选择 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            评价维度
            <select value={dim.code} onChange={(e) => setDim(DIMENSION_DEFS.find((d) => d.code === e.target.value) ?? DIMENSION_DEFS[0])}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {DIMENSION_DEFS.map((d) => (
                <option key={d.code} value={d.code}>{d.name}（{d.category}）</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            评价年度
            <input type="number" min={2000} max={2100} value={year}
              onChange={(e) => setYear(+e.target.value || new Date().getFullYear())}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-400">数据来源：{dim.dataSource}</p>
      </section>

      {/* 文件上传 */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">上传源文件（CSV / Excel）</h2>
        <div className="mt-3 flex gap-3">
          <input type="file" accept=".csv,.xlsx,.xls" ref={fileRef} onChange={handleFile}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-white transition-colors" />
          <button onClick={doImport} disabled={busy || rows.length === 0}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
            {busy ? '导入中…' : `导入 ${rows.length} 条`}
          </button>
          {rows.length > 0 && (
            <button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-50 cursor-pointer">清空</button>
          )}
        </div>
      </section>

      {/* 字段映射 */}
      {headers.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">字段映射</h2>
          <p className="mt-1 text-xs text-slate-500">将文件列头映射到系统字段。未映射的字段为空。</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FACT_FIELDS.filter((f) => dim.fields.includes(f.key)).map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 font-medium text-slate-600">{f.label}</span>
                <select value={mapping[f.key] ?? ''} onChange={(e) => setMap(f.key, e.target.value)}
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* 预览 */}
      {rows.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">数据预览（{rows.length} 条，前 20 行）</h2>
          <div className="mt-3 max-h-[400px] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  {headers.map((h) => (
                    <th key={h} className="pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    {headers.map((h) => (
                      <td key={h} className="py-1 pr-3 whitespace-nowrap">{row[h] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 结果 */}
      {result && (
        <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-sm font-semibold text-emerald-800">导入完成</h2>
          <p className="mt-1 text-sm text-emerald-700">
            共 {result.total} 条 · 新建 {result.created} 条 · 更新 {result.updated} 条
          </p>
        </section>
      )}
    </main>
  );
}
