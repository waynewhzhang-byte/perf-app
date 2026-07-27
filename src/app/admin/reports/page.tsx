'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';
import { FinalizedFactPanel } from '@/components/finalized-fact-panel';
import { QuantitativeReportAnalysis } from '@/components/quantitative-report-analysis';
import type { ReviewProgress } from '@/lib/review-progress';

interface Template { id: string; title: string; year: number }
interface DictItem { id: string; name: string }
interface Stats { count: number; avgScore: number; maxScore: number; minScore: number }
interface BranchBreakdown { unit: string; employeeCount: number; averageTotalScore: number }
interface RecordItem {
  itemId: string; itemTitle: string; score: number;
  selected: { label: string; score: number }[];
}
interface EmployeeRecord {
  submissionId: string; userId: string; userName: string;
  employeeNo: string | null; contact: string;
  branch: string; department: string;
  declarationLevel: string; declarationSpecialty: string;
  totalScore: number; items: RecordItem[];
}
interface Report {
  templateId: string; templateTitle: string; templateYear: number;
  stats: Stats; branchBreakdown: BranchBreakdown[];
  records: EmployeeRecord[]; progress: ReviewProgress | null;
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

function buildFilterQuery(params: {
  templateId: string;
  branchIds: string[];
  declarationLevelIds: string[];
  declarationSpecialtyIds: string[];
  complete?: boolean;
  format?: string;
  submissionId?: string;
}) {
  const q = new URLSearchParams();
  if (params.format) q.set('format', params.format);
  if (params.templateId) q.set('templateId', params.templateId);
  params.branchIds.forEach((id) => q.append('branchIds', id));
  params.declarationLevelIds.forEach((id) => q.append('declarationLevelIds', id));
  params.declarationSpecialtyIds.forEach((id) =>
    q.append('declarationSpecialtyIds', id));
  if (params.complete) q.set('complete', '1');
  if (params.submissionId) q.set('submissionId', params.submissionId);
  return q.toString();
}

export default function ReportsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [branches, setBranches] = useState<DictItem[]>([]);
  const [declarationLevels, setDeclarationLevels] = useState<DictItem[]>([]);
  const [declarationSpecialties, setDeclarationSpecialties] = useState<DictItem[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [declarationLevelIds, setDeclarationLevelIds] = useState<string[]>([]);
  const [declarationSpecialtyIds, setDeclarationSpecialtyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string | null>(null);

  const hasFilters = (
    branchIds.length > 0
    || declarationLevelIds.length > 0
    || declarationSpecialtyIds.length > 0
  );

  const active = useMemo(() => {
    if (!selectedTpl) return reports[0] ?? null;
    return reports.find((r) => r.templateId === selectedTpl) ?? null;
  }, [reports, selectedTpl]);

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

  const exportQueryBase = useMemo(() => ({
    templateId: selectedTpl,
    branchIds,
    declarationLevelIds,
    declarationSpecialtyIds,
  }), [
    selectedTpl,
    branchIds,
    declarationLevelIds,
    declarationSpecialtyIds,
  ]);

  const canExport = Boolean(
    selectedTpl
    && active?.progress?.complete
    && (active?.records.length ?? 0) > 0,
  );

  const exportSummary = useCallback(async () => {
    if (!selectedTpl || !canExport) return;
    setExporting('csv');
    await downloadFile(
      `/api/admin/reports/export?${buildFilterQuery({ ...exportQueryBase, format: 'csv', complete: true })}`,
      'summary.csv',
    );
    setExporting(null);
  }, [canExport, downloadFile, exportQueryBase, selectedTpl]);

  const exportDetail = useCallback(async () => {
    if (!selectedTpl || !canExport) return;
    setExporting('detail');
    await downloadFile(
      `/api/admin/reports/export?${buildFilterQuery({ ...exportQueryBase, format: 'detail', complete: true })}`,
      'detail-summary.csv',
    );
    setExporting(null);
  }, [canExport, downloadFile, exportQueryBase, selectedTpl]);

  const exportZip = useCallback(async () => {
    if (!selectedTpl || !canExport) return;
    setExporting('zip');
    await downloadFile(
      `/api/admin/reports/export?${buildFilterQuery({ ...exportQueryBase, format: 'zip', complete: true })}`,
      'export.zip',
    );
    setExporting(null);
  }, [canExport, downloadFile, exportQueryBase, selectedTpl]);

  const exportXlsx = useCallback(async () => {
    if (!selectedTpl || !canExport) return;
    setExporting('xlsx');
    await downloadFile(
      `/api/admin/reports/export?${buildFilterQuery({ ...exportQueryBase, format: 'xlsx', complete: true })}`,
      'final-performance-facts.xlsx',
    );
    setExporting(null);
  }, [canExport, downloadFile, exportQueryBase, selectedTpl]);

  const exportEmployee = useCallback(async (submissionId: string, name: string) => {
    setExporting(submissionId);
    await downloadFile(
      `/api/admin/reports/export?${buildFilterQuery({ templateId: selectedTpl, branchIds: [], declarationLevelIds: [], declarationSpecialtyIds: [], format: 'employee', submissionId })}`,
      `${name}.zip`,
    );
    setExporting(null);
  }, [downloadFile, selectedTpl]);

  const load = useCallback(async (tplId?: string) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (tplId) params.set('templateId', tplId);
      branchIds.forEach((id) => params.append('branchIds', id));
      declarationLevelIds.forEach((id) => params.append('declarationLevelIds', id));
      declarationSpecialtyIds.forEach((id) =>
        params.append('declarationSpecialtyIds', id));
      const r = await fetch(`/api/admin/reports?${params}`);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setError(d.error || '加载失败'); return; }
      setTemplates(d.templates ?? []);
      setBranches(d.branches ?? []);
      setDeclarationLevels(d.declarationLevels ?? []);
      setDeclarationSpecialties(d.declarationSpecialties ?? []);
      setReports(d.reports ?? []);
    } catch { setError('网络错误'); }
    finally { setLoading(false); }
  }, [branchIds, declarationLevelIds, declarationSpecialtyIds]);

  useEffect(() => { void load(); }, [load]);

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
  const maxBranchCount = Math.max(1, ...(active?.branchBreakdown ?? []).map((b) => b.employeeCount));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">报表分析</h1>
          <p className="mt-1 text-sm text-slate-500">年度量化积分全员分析与终审申报结果汇总，支持全局与个人多维报表及导出</p>
        </div>
        <AdminPageActions />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <QuantitativeReportAnalysis />

      <div className="mb-4 border-t border-slate-200 pt-8">
        <h2 className="text-lg font-semibold text-slate-900">终审申报结果汇总</h2>
        <p className="mt-1 text-sm text-slate-500">仅统计完成两级审核的申报快照；可按单位、能级、申报专业筛选并导出。</p>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">
            申报表
            <select
              value={selectedTpl}
              onChange={(e) => setSelectedTpl(e.target.value)}
              className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title}（{t.year}）</option>
              ))}
            </select>
          </label>
          <MultiChoiceFilter
            label="单位"
            items={branches}
            selected={branchIds}
            onChange={setBranchIds}
          />
          <MultiChoiceFilter
            label="能级等级"
            items={declarationLevels}
            selected={declarationLevelIds}
            onChange={setDeclarationLevelIds}
          />
          <MultiChoiceFilter
            label="申报专业"
            items={declarationSpecialties}
            selected={declarationSpecialtyIds}
            onChange={setDeclarationSpecialtyIds}
          />
          {loading && <span className="text-xs text-slate-400">正在应用筛选…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <button
            onClick={exportXlsx}
            disabled={!canExport || exporting !== null}
            title={active?.progress?.complete ? '导出最终绩效、事实明细和评分过程' : '须等待当前筛选范围完成两级审核'}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {exporting === 'xlsx' ? '生成中…' : '最终绩效事实报表 (XLSX)'}
          </button>
          <button
            onClick={exportSummary}
            disabled={!canExport || exporting !== null}
            title={active?.progress?.complete ? '导出当前范围汇总表' : '须等待当前筛选范围完成两级审核'}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting === 'csv' ? '导出中…' : '汇总表 (CSV)'}
          </button>
          <button
            onClick={exportDetail}
            disabled={!canExport || exporting !== null}
            title={active?.progress?.complete ? '导出当前范围评分项明细' : '须等待当前筛选范围完成两级审核'}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting === 'detail' ? '导出中…' : '明细汇总 (CSV)'}
          </button>
          <button
            onClick={exportZip}
            disabled={!canExport || exporting !== null}
            title={active?.progress?.complete ? '导出当前范围完整档案' : '须等待当前筛选范围完成两级审核'}
            className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {exporting === 'zip' ? '打包中…' : '完整档案 (ZIP)'}
          </button>
          {hasFilters && <span className="ml-auto text-xs text-slate-500">已启用筛选，可导出当前范围数据</span>}
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
          {active.progress && (
            <section className={`mb-6 rounded-xl border p-5 ${
              active.progress.complete ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
            }`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">全员审核进度</h2>
                  <p className="mt-1 text-xs text-slate-600">{active.templateTitle}（{active.templateYear}）</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  active.progress.complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {active.progress.complete ? '完整报表已就绪' : '完整报表尚未就绪'}
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <ProgressMetric label="应审核员工" value={active.progress.totalEmployees} />
                <ProgressMetric label="已提交" value={active.progress.submittedEmployees} />
                <ProgressMetric label="终审通过" value={active.progress.approvedEmployees} />
                <ProgressMetric label="待完成" value={Math.max(active.progress.totalEmployees - active.progress.approvedEmployees, 0)} />
              </div>
              {!active.progress.complete && active.progress.blockers.length > 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-white/70 p-3">
                  <p className="text-xs font-semibold text-amber-800">当前审核卡点</p>
                  <ul className="mt-2 space-y-1 text-xs text-amber-900">
                    {active.progress.blockers.slice(0, 8).map((blocker) => (
                      <li key={`${blocker.level}-${blocker.code}-${blocker.scope ?? 'all'}`}>
                        {blocker.level === 'L1' ? '一级' : '二级'} · {blocker.label}{blocker.scope ? `（${blocker.scope}）` : ''}：{blocker.count} 项
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="审核通过人数" value={active.stats.count} unit="人" color="text-slate-900" />
            <StatCard label="平均分" value={Number(active.stats.avgScore.toFixed(1))} unit="分" color="text-blue-600" />
            <StatCard label="最高分" value={active.stats.maxScore} unit="分" color="text-green-600" />
            <StatCard label="最低分" value={active.stats.minScore} unit="分" color="text-amber-600" />
          </div>

          {active.branchBreakdown.length > 0 && !hasFilters && (
            <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-700">各单位终审通过分布</h3>
              <div className="mt-4 space-y-2">
                {active.branchBreakdown.map((branch) => (
                  <div key={branch.unit} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,1fr)_4rem_5rem] items-center gap-2 text-xs">
                    <span className="truncate text-slate-600" title={branch.unit}>{branch.unit}</span>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${(branch.employeeCount / maxBranchCount) * 100}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-slate-500">{branch.employeeCount} 人</span>
                    <span className="text-right font-medium tabular-nums text-slate-700">均 {branch.averageTotalScore.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-700">总分分布</h3>
              <div className="mt-4 space-y-2">
                {dist.map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-500">{b.label}</span>
                    <div className="flex-1">
                      <div className="h-5 rounded bg-primary-100 overflow-hidden">
                        <div className="h-full rounded bg-primary-500 transition-all duration-300" style={{ width: `${(b.count / maxDistCount) * 100}%` }} />
                      </div>
                    </div>
                    <span className="w-8 shrink-0 text-xs font-semibold tabular-nums text-slate-600">{b.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-700">各项平均分</h3>
              <div className="mt-4 space-y-2">
                {perItemAvg.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-right text-xs text-slate-500" title={item.title}>{item.title}</span>
                    <div className="flex-1">
                      <div className="h-5 rounded bg-amber-100 overflow-hidden">
                        <div className="h-full rounded bg-amber-500 transition-all duration-300" style={{ width: `${(item.avg / maxItemAvg) * 100}%` }} />
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

          <section className="mt-6 rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-700">员工分值明细（{active.records.length} 人）</h3>
              <p className="text-xs text-slate-400">展开可查看终审申报项、事实明细与计分过程</p>
            </div>

            {active.records.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">当前筛选条件下暂无记录</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-xs font-semibold text-slate-500">
                      <th className="w-8 py-2.5 pl-5" />
                      <th className="py-2.5 pr-3">员工</th>
                      <th className="py-2.5 pr-3">单位</th>
                      <th className="py-2.5 pr-3">能级等级</th>
                      <th className="py-2.5 pr-3">申报专业</th>
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
                          <td className="py-3 pr-3 text-slate-600">
                            {[rec.branch, rec.department].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td className="py-3 pr-3 text-slate-600">{rec.declarationLevel || '—'}</td>
                          <td className="py-3 pr-3 text-slate-600">{rec.declarationSpecialty || '—'}</td>
                          <td className="py-3 pr-3 text-right">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                              rec.totalScore >= active.stats.avgScore ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
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
                            <td colSpan={7} className="space-y-4 bg-slate-50 px-5 py-4">
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
                                        <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold tabular-nums text-slate-700">{it.score.toFixed(1)}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <FinalizedFactPanel submissionId={rec.submissionId} />
                              <div className="flex justify-end">
                                <button
                                  onClick={(e) => { e.stopPropagation(); void exportEmployee(rec.submissionId, `${rec.employeeNo || ''}-${rec.userName}`); }}
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

function MultiChoiceFilter({
  label,
  items,
  selected,
  onChange,
}: {
  label: string;
  items: DictItem[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  };
  return (
    <fieldset className="min-w-[12rem] rounded-lg border border-slate-200 px-3 py-2">
      <legend className="px-1 text-xs font-medium text-slate-500">
        {label}（可多选）
      </legend>
      <div className="flex max-w-sm flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`rounded-full px-2 py-1 text-xs ${
            selected.length === 0
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          全部
        </button>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            className={`rounded-full px-2 py-1 text-xs ${
              selected.includes(item.id)
                ? 'bg-primary-100 font-medium text-primary-700 ring-1 ring-primary-300'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {item.name}
          </button>
        ))}
      </div>
    </fieldset>
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

function ProgressMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
