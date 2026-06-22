'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { ImportItemConfig } from './types';
import { parseCSV, parseXLSX, type ParsedFile } from './parse';
import { resolveHeaderMapping } from '@/lib/import-auto-map';

interface PreviewRow { employeeNo: string; [k: string]: unknown }

export default function ImportWizard({ config, year }: { config: ImportItemConfig; year: number }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ total: number; created: number; updated: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 切换配置或表头变化时，按 label / 别名精确匹配
  useEffect(() => {
    if (headers.length === 0) return;
    setMapping(resolveHeaderMapping(headers, config.fields));
  }, [config, headers]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();
    const process = (parsed: ParsedFile) => {
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setResult(null);
      setPreview(null);
      setMapping(resolveHeaderMapping(parsed.headers, config.fields));
    };
    if (ext === 'xlsx' || ext === 'xls') {
      reader.onload = () => process(parseXLSX(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => process(parseCSV(reader.result as string));
      reader.readAsText(file);
    }
  };

  const requiredOk = config.fields.filter((f) => f.required).every((f) => mapping[f.key]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemCode: config.code, mapping, rows: rows.slice(0, 20) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert('试算失败：' + (d.error || r.status)); setPreview(null); }
      else setPreview(d.rows ?? []);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (rows.length === 0) { alert('请先选择文件'); return; }
    setBusy(true);
    try {
      const r = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year, sourceFile: fileRef.current?.files?.[0]?.name ?? 'upload.csv',
          mapping, rows,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert('导入失败：' + (d.error || r.status)); return; }
      setResult(d);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setHeaders([]); setRows([]); setResult(null); setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/import" className="text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer">← 返回导入中心</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{config.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{config.description}</p>
      <p className="mt-1 text-xs text-slate-400">{config.dependsOn}</p>

      {/* 步骤1：上传 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">① 上传文件（CSV / Excel）</h2>
        <div className="mt-3 flex gap-3">
          <input type="file" accept=".csv,.xlsx,.xls" ref={fileRef} onChange={handleFile}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-white transition-colors" />
          {rows.length > 0 && (
            <button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">清空</button>
          )}
        </div>
        {rows.length > 0 && <p className="mt-2 text-xs text-slate-500">已解析 {rows.length} 行</p>}
        {config.requireFullBatch && (
          <p className="mt-2 text-xs text-amber-700">⚠️ 请上传全部人员数据，分批会导致折算错误。</p>
        )}
      </section>

      {/* 步骤2：映射 */}
      {headers.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">② 字段映射</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {config.fields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 font-medium text-slate-600">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </span>
                <select value={mapping[f.key] ?? ''} onChange={(e) => setMapping((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs">
                  <option value="">—</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {config.fields.filter((f) => f.required && f.hint).map((f) => (
            <p key={f.key} className="mt-2 text-xs text-slate-400">{f.label}：{f.hint}</p>
          ))}
        </section>
      )}

      {/* 步骤3：预览 + 试算 */}
      {rows.length > 0 && config.hasScorePreview && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">③ 预览（含分数试算）</h2>
          <button onClick={runPreview} disabled={busy || !requiredOk}
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
            {busy ? '试算中…' : '试算（前20行）'}
          </button>
          {preview && (
            <div className="mt-3 max-h-[300px] overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b text-left text-slate-500">
                  {Object.keys(preview[0] ?? {}).map((k) => <th key={k} className="pb-2 pr-3 font-medium whitespace-nowrap">{k}</th>)}
                </tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      {Object.keys(preview[0] ?? {}).map((k) => <td key={k} className="py-1 pr-3 whitespace-nowrap">{String(r[k] ?? '—')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 步骤4：导入 */}
      {rows.length > 0 && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">④ 导入</h2>
          <button onClick={doImport} disabled={busy || !requiredOk}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
            {busy ? '导入中…' : `导入 ${rows.length} 条`}
          </button>
          {!requiredOk && <p className="mt-2 text-xs text-red-500">请先完成必填字段映射（*）。</p>}
          {result && (
            <p className="mt-3 text-sm text-emerald-700">
              共 {result.total} 条 · 新建 {result.created} · 更新 {result.updated} · 跳过 {result.skipped}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
