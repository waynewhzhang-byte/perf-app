'use client';
import { useState, useRef } from 'react';
import Link from 'next/link';
import { parseXLSXSheets } from '../_shared/parse';

const OP_SHEET = '操作票';
const WORK_SHEET = '工作票';

interface SheetState {
  headers: string[];
  rows: Record<string, string>[];
}

interface PreviewState {
  stats: { operationRows: number; workRows: number; employeeCount: number };
  unmatchedTotal: number;
  unmatched: string[];
  rows: Record<string, unknown>[];
}

interface ImportResult {
  total: number;
  created: number;
  deleted: number;
  stats: PreviewState['stats'];
  unmatchedTotal: number;
}

const SCORING_RULES = [
  { sheet: OP_SHEET, role: '操作人/监护人/值班负责人/现场配合人员', rule: '每行每角色 0.01 分/项（一行=一项操作任务，与操作步数无关）' },
  { sheet: WORK_SHEET, role: '工作负责人', rule: '总工作票 5 分/份；分工作票 3 分/份；单班组一种票 3 分/份；二种票 1 分/份' },
  { sheet: WORK_SHEET, role: '开工/完工许可人', rule: '总工作票 1.5 分/份；单班组一种票 1 分/份；二种票 0.3 分/份' },
] as const;

export default function TicketImportWizard({ year }: { year: number }) {
  const [fileName, setFileName] = useState('');
  const [allSheetNames, setAllSheetNames] = useState<string[]>([]);
  const [operation, setOperation] = useState<SheetState | null>(null);
  const [work, setWork] = useState<SheetState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      alert('请上传 Excel 文件（.xlsx / .xls）');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const { sheetNames, sheets } = parseXLSXSheets(reader.result as ArrayBuffer, [OP_SHEET, WORK_SHEET]);
      setFileName(file.name);
      setAllSheetNames(sheetNames);
      setOperation(sheets[OP_SHEET] ?? { headers: [], rows: [] });
      setWork(sheets[WORK_SHEET] ?? { headers: [], rows: [] });
      setPreview(null);
      setResult(null);
    };
    reader.readAsArrayBuffer(file);
  };

  const reset = () => {
    setFileName('');
    setAllSheetNames([]);
    setOperation(null);
    setWork(null);
    setPreview(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const hasSheets = Boolean(operation && work);
  const canProceed = hasSheets && (operation!.rows.length > 0 || work!.rows.length > 0);

  const runPreview = async () => {
    if (!canProceed) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemCode: 'tickets',
          year,
          operationRows: operation!.rows,
          workRows: work!.rows,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert('试算失败：' + (d.error || r.status));
        setPreview(null);
        return;
      }
      setPreview({
        stats: d.stats,
        unmatchedTotal: d.unmatchedTotal ?? 0,
        unmatched: d.unmatched ?? [],
        rows: d.rows ?? [],
      });
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!canProceed) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/import/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year,
          sourceFile: fileName || 'upload.xlsx',
          operationRows: operation!.rows,
          workRows: work!.rows,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert('导入失败：' + (d.error || r.status));
        return;
      }
      setResult({
        total: d.total,
        created: d.created,
        deleted: d.deleted ?? 0,
        stats: d.stats,
        unmatchedTotal: d.unmatchedTotal ?? 0,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/import" className="text-sm font-medium text-slate-500 hover:text-slate-700 cursor-pointer">
        ← 返回导入中心
      </Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">两票执行</h1>
      <p className="mt-1 text-sm text-slate-500">
        上传《工作现场-两票执行》.xlsx，分别读取「操作票」「工作票」两个工作表，按积分表 3.1 规则聚合每人<strong>原始分</strong>并入库；折算为维度得分在最终汇总阶段完成。
      </p>
      <p className="mt-1 text-xs text-slate-400">依赖员工档案名册 · 能级可先在 profile 中写入 mockDeclarationTier 模拟</p>

      {/* 计分规则对照 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-semibold text-slate-800">积分表 3.1 计分规则（与系统默认单价一致）</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="pb-2 pr-3 font-medium">工作表</th>
                <th className="pb-2 pr-3 font-medium">角色/字段</th>
                <th className="pb-2 font-medium">计分</th>
              </tr>
            </thead>
            <tbody>
              {SCORING_RULES.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.sheet}</td>
                  <td className="py-1.5 pr-3">{r.role}</td>
                  <td className="py-1.5">{r.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          操作票单价 0.01 分/项（按 Excel 行计，非按步数）；票状态「已归档」「归档」「已执行」均计入。
        </p>
      </section>

      {/* 上传 */}
      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold">① 上传 Excel（含两个工作表）</h2>
        <div className="mt-3 flex gap-3">
          <input
            type="file"
            accept=".xlsx,.xls"
            ref={fileRef}
            onChange={handleFile}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:text-white"
          />
          {hasSheets && (
            <button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
              清空
            </button>
          )}
        </div>
        {hasSheets && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SheetCard
              title={OP_SHEET}
              found={allSheetNames.includes(OP_SHEET)}
              rowCount={operation!.rows.length}
              keyColumns={['操作人', '监护人', '值班负责人', '现场配合人员', '实际操作步数', '票状态']}
              headers={operation!.headers}
            />
            <SheetCard
              title={WORK_SHEET}
              found={allSheetNames.includes(WORK_SHEET)}
              rowCount={work!.rows.length}
              keyColumns={['工作负责人', '开工许可人', '完工许可人', '票种类']}
              headers={work!.headers}
            />
          </div>
        )}
        {hasSheets && !allSheetNames.includes(OP_SHEET) && (
          <p className="mt-2 text-xs text-red-600">缺少工作表「{OP_SHEET}」</p>
        )}
        {hasSheets && !allSheetNames.includes(WORK_SHEET) && (
          <p className="mt-2 text-xs text-red-600">缺少工作表「{WORK_SHEET}」</p>
        )}
        <p className="mt-2 text-xs text-amber-700">⚠️ 请一次上传全年完整两票明细，否则员工全年累计分不完整。</p>
      </section>

      {/* 预览 */}
      {canProceed && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">② 聚合试算（按姓名匹配工号）</h2>
          <button
            onClick={runPreview}
            disabled={busy}
            className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            {busy ? '试算中…' : '试算聚合结果（前 20 人）'}
          </button>
          {preview && (
            <>
              <p className="mt-3 text-xs text-slate-600">
                操作票 {preview.stats.operationRows} 行 · 工作票 {preview.stats.workRows} 行 · 聚合 {preview.stats.employeeCount} 人
                {preview.unmatchedTotal > 0 && (
                  <span className="text-amber-700"> · 未匹配姓名 {preview.unmatchedTotal} 个</span>
                )}
              </p>
              {preview.unmatched.length > 0 && (
                <p className="mt-1 text-xs text-amber-700 truncate" title={preview.unmatched.join('、')}>
                  未匹配示例：{preview.unmatched.slice(0, 8).join('、')}
                  {preview.unmatched.length > 8 ? '…' : ''}
                </p>
              )}
              <div className="mt-3 max-h-[320px] overflow-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      {Object.keys(preview.rows[0] ?? {}).map((k) => (
                        <th key={k} className="pb-2 pr-3 font-medium whitespace-nowrap">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        {Object.keys(preview.rows[0] ?? {}).map((k) => (
                          <td key={k} className="py-1 pr-3 whitespace-nowrap">{String(r[k] ?? '—')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* 导入 */}
      {canProceed && (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold">③ 写入事实库</h2>
          <button
            onClick={doImport}
            disabled={busy}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {busy ? '导入中…' : `导入（操作票 ${operation!.rows.length} 行 + 工作票 ${work!.rows.length} 行）`}
          </button>
          {result && (
            <p className="mt-3 text-sm text-emerald-700">
              聚合 {result.total} 人 · 写入 {result.created} 条 · 替换旧记录 {result.deleted} 条
              {result.unmatchedTotal > 0 && ` · 未匹配姓名 ${result.unmatchedTotal} 个`}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function SheetCard({
  title,
  found,
  rowCount,
  keyColumns,
  headers,
}: {
  title: string;
  found: boolean;
  rowCount: number;
  keyColumns: string[];
  headers: string[];
}) {
  const missing = keyColumns.filter((c) => !headers.includes(c));
  return (
    <div className={`rounded-lg border p-4 ${found ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`text-xs ${found ? 'text-slate-500' : 'text-red-600'}`}>
          {found ? `${rowCount} 行` : '未找到'}
        </span>
      </div>
      {found && missing.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">缺少列：{missing.join('、')}</p>
      )}
      {found && missing.length === 0 && (
        <p className="mt-2 text-xs text-emerald-700">关键列齐全</p>
      )}
    </div>
  );
}
