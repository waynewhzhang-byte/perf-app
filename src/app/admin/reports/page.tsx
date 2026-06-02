'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

interface Template { id: string; title: string; year: number }
interface Stats { count: number; avgScore: number; maxScore: number; minScore: number }
interface RecordItem {
  itemId: string; itemTitle: string; score: number;
  selected: { label: string; score: number }[];
}
interface EmployeeRecord {
  submissionId: string; userId: string; userName: string;
  employeeNo: string | null; contact: string;
  branch: string; department: string;
  totalScore: number; items: RecordItem[];
}
interface Report {
  templateId: string; templateTitle: string; templateYear: number;
  stats: Stats; records: EmployeeRecord[];
}

function distributionBuckets(min: number, max: number, buckets = 8) {
  if (min === max) return [{ label: `${min.toFixed(0)}`, min, max, count: 0 }];
  const step = (max - min) / buckets;
  const result: { label: string; min: number; max: number; count: number }[] = [];
  for (let i = 0; i < buckets; i++) {
    const lo = min + i * step;
    const hi = i === buckets - 1 ? max : min + (i + 1) * step;
    result.push({ label: `${lo.toFixed(0)}–${hi.toFixed(0)}`, min: lo, max: hi, count: 0 });
  }
  return result;
}

export default function ReportsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);

  const downloadFile = useCallback(async (url: string, fallbackName: string) => {
    setError(null);
    try {
      const r = await fetch(url);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || `导出失败（${r.status}）`);
        return;
      }
      const blob = await r.blob();
      const disposition = r.headers.get('Content-Disposition');
      const filenameRe = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;
      const match = disposition ? filenameRe.exec(disposition) : null;
      const filename = match ? decodeURIComponent(match[1]) : fallbackName;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setError('导出请求失败，请稍后重试');
    }
  }, []);

  const exportSummary = useCallback(async () => {
    if (!selectedTpl) return;
    setExporting('csv');
    await downloadFile(`/api/admin/reports/export?format=csv&templateId=${encodeURIComponent(selectedTpl)}`, 'summary.csv');
    setExporting(null);
  }, [selectedTpl, downloadFile]);

  const exportZip = useCallback(async () => {
    if (!selectedTpl) return;
    setExporting('zip');
    await downloadFile(`/api/admin/reports/export?format=zip&templateId=${encodeURIComponent(selectedTpl)}`, 'export.zip');
    setExporting(null);
  }, [selectedTpl, downloadFile]);

  const exportEmployee = useCallback(async (submissionId: string, name: string) => {
    setExporting(submissionId);
    await downloadFile(`/api/admin/reports/export?format=employee&submissionId=${encodeURIComponent(submissionId)}`, `${name}.zip`);
    setExporting(null);
  }, [downloadFile]);

  const load = useCallback(async (tplId?: string) => {
    setLoading(true); setError(null);
    try {
      const params = tplId ? `?templateId=${tplId}` : '';
      const r = await fetch(`/api/admin/reports${params}`);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setError(d.error || '加载失败'); return; }
      setTemplates(d.templates ?? []);
      setReports(d.reports ?? []);
    } catch { setError('网络错误'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => {
    if (!selectedTpl) return reports[0] ?? null;
    return reports.find((r) => r.templateId === selectedTpl) ?? null;
  }, [reports, selectedTpl]);

  // Auto-select first template
  useEffect(() => {
    if (!selectedTpl && templates.length > 0) setSelectedTpl(templates[0].id);
  }, [templates, selectedTpl]);

  const dist = useMemo(() => {
    if (!active || active.stats.count === 0) return [];
    const buckets = distributionBuckets(active.stats.minScore, active.stats.maxScore);
    for (const rec of active.records) {
      for (const b of buckets) {
        if (rec.totalScore >= b.min && rec.totalScore <= b.max) { b.count++; break; }
      }
    }
    return buckets;
  }, [active]);

  const perItemAvg = useMemo(() => {
    if (!active) return [];
    const map = new Map<string, { title: string; total: number; count: number }>();
    for (const rec of active.records) {
      for (const it of rec.items) {
        const entry = map.get(it.itemId) || { title: it.itemTitle, total: 0, count: 0 };
        entry.total += it.score;
        entry.count += 1;
        map.set(it.itemId, entry);
      }
    }
    return [...map.entries()].map(([id, v]) => ({ id, title: v.title, avg: v.total / v.count, count: v.count }));
  }, [active]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const maxDistCount = Math.max(1, ...dist.map((d) => d.count));
  const maxItemAvg = Math.max(1, ...perItemAvg.map((i) => i.avg));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">报表分析</h1>
          <p className="mt-1 text-sm text-slate-500">已审核通过员工的分值统计，按申报表分类</p>
        </div>
        <AdminPageActions />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* 模板选择器 */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-slate-600">
          选择表单：
          <select
            value={selectedTpl}
            onChange={(e) => setSelectedTpl(e.target.value)}
            className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.title}（{t.year}）</option>
            ))}
          </select>
        </label>
        <button onClick={() => load(selectedTpl)} disabled={loading} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {loading ? '加载中…' : '刷新'}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportSummary}
            disabled={!selectedTpl || exporting !== null}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting === 'csv' ? '导出中…' : '导出汇总表 (CSV)'}
          </button>
          <button
            onClick={exportZip}
            disabled={!selectedTpl || exporting !== null}
            className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {exporting === 'zip' ? '打包中…' : '导出完整档案 (ZIP)'}
          </button>
        </div>
      </div>

      {loading && !active && <p className="py-12 text-center text-sm text-slate-400">加载中…</p>}

      {!loading && !active && (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center">
          <p className="text-sm text-slate-400">暂无审核通过的申报数据</p>
          <p className="mt-1 text-xs text-slate-300">员工申报经 L1、L2 两级审核通过后将出现在这里</p>
        </div>
      )}

      {active && (
        <>
          {/* 汇总统计卡片 */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="审核通过人数" value={active.stats.count} unit="人" color="text-slate-900" />
            <StatCard label="平均分" value={Number(active.stats.avgScore.toFixed(1))} unit="分" color="text-blue-600" />
            <StatCard label="最高分" value={active.stats.maxScore} unit="分" color="text-green-600" />
            <StatCard label="最低分" value={active.stats.minScore} unit="分" color="text-amber-600" />
          </div>

          {/* 图表区 */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* 分值分布 */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-700">总分分布</h3>
              <div className="mt-4 space-y-2">
                {dist.map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">{b.label}</span>
                    <div className="flex-1">
                      <div className="h-5 rounded bg-primary-100 overflow-hidden">
                        <div
                          className="h-full rounded bg-primary-500 transition-all duration-300"
                          style={{ width: `${(b.count / maxDistCount) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-slate-600">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 各项平均分 */}
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-700">各项平均分</h3>
              <div className="mt-4 space-y-2">
                {perItemAvg.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-right text-xs text-slate-500" title={item.title}>
                      {item.title}
                    </span>
                    <div className="flex-1">
                      <div className="h-5 rounded bg-amber-100 overflow-hidden">
                        <div
                          className="h-full rounded bg-amber-500 transition-all duration-300"
                          style={{ width: `${(item.avg / maxItemAvg) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-14 shrink-0 text-xs tabular-nums text-slate-600">
                      <span className="font-semibold">{item.avg.toFixed(1)}</span>
                      <span className="text-slate-400"> / {item.count}人</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 员工分值明细表 */}
          <section className="mt-6 rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-700">
                员工分值明细（{active.records.length} 人）
              </h3>
            </div>

            {active.records.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">暂无记录</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-xs font-semibold text-slate-500">
                      <th className="w-8 py-2.5 pl-5" />
                      <th className="py-2.5 pr-3">员工</th>
                      <th className="py-2.5 pr-3">工区</th>
                      <th className="py-2.5 pr-3">部门</th>
                      <th className="py-2.5 pr-3 text-right">总分</th>
                      <th className="w-20 py-2.5 pr-5 text-right">申报项</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {active.records.map((rec, idx) => (
                      <Fragment key={rec.submissionId}>
                        <tr
                          onClick={() => toggle(rec.submissionId)}
                          className={`cursor-pointer transition-colors hover:bg-slate-50 ${expanded.has(rec.submissionId) ? 'bg-slate-50' : ''}`}
                        >
                          <td className="py-3 pl-5 text-xs text-slate-400 tabular-nums">{idx + 1}</td>
                          <td className="py-3 pr-3">
                            <p className="font-medium">{rec.userName}</p>
                            <p className="text-xs text-slate-400">{rec.employeeNo || rec.contact}</p>
                          </td>
                          <td className="py-3 pr-3 text-slate-600">{rec.branch || '—'}</td>
                          <td className="py-3 pr-3 text-slate-600">{rec.department || '—'}</td>
                          <td className="py-3 pr-3 text-right">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              rec.totalScore >= active.stats.avgScore
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {rec.totalScore.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-3 pr-5 text-right text-xs text-slate-400">
                            {rec.items.length} 项
                            <svg className={`ml-1 inline-block h-3 w-3 transition-transform ${expanded.has(rec.submissionId) ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                            </svg>
                          </td>
                        </tr>
                        {expanded.has(rec.submissionId) && (
                          <tr key={`${rec.submissionId}-exp`}>
                            <td colSpan={6} className="bg-slate-50 px-5 py-3">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-slate-400">
                                    <th className="py-1.5 text-left font-medium">申报项</th>
                                    <th className="py-1.5 text-left font-medium">选项</th>
                                    <th className="py-1.5 text-right font-medium">分值</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {rec.items.map((it) => (
                                    <tr key={it.itemId} className="border-t border-slate-100">
                                      <td className="py-2 pr-3 font-medium text-slate-700">{it.itemTitle}</td>
                                      <td className="py-2 pr-3 text-slate-500">
                                        {it.selected && Array.isArray(it.selected)
                                          ? it.selected.map((s: { label: string; score: number }) => s.label).join('、') || '—'
                                          : '—'}
                                      </td>
                                      <td className="py-2 text-right">
                                        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold tabular-nums text-slate-700">
                                          {it.score.toFixed(1)}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={(e) => { e.stopPropagation(); exportEmployee(rec.submissionId, `${rec.employeeNo || ''}-${rec.userName}`); }}
                                  disabled={exporting !== null}
                                  className="rounded-lg border border-primary-300 bg-white px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                                >
                                  {exporting === rec.submissionId ? '导出中…' : '导出该员工档案 (ZIP)'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function StatCard({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-1.5 text-3xl font-bold tracking-tight tabular-nums ${color}`}>
        {Number.isInteger(value) ? value : value.toFixed(1)}
      </p>
      <p className="mt-0.5 text-xs text-slate-400">{unit}</p>
    </div>
  );
}
