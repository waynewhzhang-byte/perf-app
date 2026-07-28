'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmployeeFactPanel } from '@/components/employee-fact-panel';

interface Branch { id: string; name: string }
interface DimensionAverage { key: string; label: string; group: string; average: number }
interface BranchBreakdown { unit: string; employeeCount: number; averageTotalScore: number; tierCounts: Record<string, number> }
interface QuantitativeRecord {
  rank: number;
  employeeNo: string;
  fullName: string;
  unit: string;
  specialty: string;
  position: string;
  workYears: string;
  tier: string;
  basicScore: number;
  performanceScore: number;
  worksiteScore: number;
  deductionScore: number;
  totalScore: number;
  importedTotalScore?: number;
  appealAdjustmentNote?: string;
  appealAdjustmentDelta?: number;
  [key: string]: string | number | undefined;
}
interface Analysis {
  employeeCount: number;
  averageTotalScore: number;
  maxTotalScore: number;
  minTotalScore: number;
  tierCounts: Record<string, number>;
  dimensionAverages: DimensionAverage[];
  branchBreakdown: BranchBreakdown[];
  records: QuantitativeRecord[];
}
interface Payload {
  years: number[];
  branches: Branch[];
  scope: { year: number; branchId: string | null; unit: string; skippedCount: number };
  analysis: Analysis;
}

const ALL = '';
const GROUPS = ['基本素质', '工作业绩', '工作现场', '扣分项'];

export function QuantitativeReportAnalysis() {
  const [year, setYear] = useState('');
  const [branchId, setBranchId] = useState(ALL);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async (nextYear: string, nextBranchId: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextYear) params.set('year', nextYear);
      if (nextBranchId) params.set('branchId', nextBranchId);
      const response = await fetch(`/api/admin/reports/quantitative?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '加载量化报表失败');
      setData(body);
      setYear(String(body.scope.year));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载量化报表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load('', ''); }, [load]);

  const records = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.analysis.records ?? []).filter((record) => {
      const matchesQuery = !normalized || [record.employeeNo, record.fullName, record.unit, record.specialty]
        .some((value) => String(value).toLowerCase().includes(normalized));
      return matchesQuery && (!tier || record.tier === tier);
    });
  }, [data, query, tier]);
  const maxDimensionAverage = Math.max(1, ...(data?.analysis.dimensionAverages ?? []).map((dimension) => dimension.average));
  const maxBranchCount = Math.max(1, ...(data?.analysis.branchBreakdown ?? []).map((branch) => branch.employeeCount));

  const exportWorkbook = async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: year || String(new Date().getFullYear()) });
      if (branchId) params.set('branchId', branchId);
      const response = await fetch(`/api/admin/reports/quantitative/export?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || '导出失败');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename ? decodeURIComponent(filename) : '量化积分报送表.xlsx';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const toggle = (employeeNo: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(employeeNo)) next.delete(employeeNo); else next.add(employeeNo);
      return next;
    });
  };

  return (
    <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">年度量化积分报表</h2>
          <p className="mt-1 text-sm text-slate-500">与量化积分报送表同口径：全员导入事实、工龄能级、评分维度；已审核通过的申诉覆盖分计入最终总分，并单独标注调整说明。</p>
        </div>
        <button
          type="button"
          onClick={exportWorkbook}
          disabled={loading || exporting || !data?.analysis.employeeCount}
          className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {exporting ? '导出中…' : '导出量化积分表 (XLSX)'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
        <label className="text-sm text-slate-600">
          年度
          <select value={year} onChange={(event) => setYear(event.target.value)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1.5">
            {(data?.years ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          工区
          <select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-1.5">
            <option value="">全部部门</option>
            {(data?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => void load(year, branchId)} disabled={loading} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          {loading ? '加载中…' : '应用筛选'}
        </button>
        {data && <span className="ml-auto text-xs text-slate-500">范围：{data.scope.unit} · 缺少有效参加工作时间已跳过 {data.scope.skippedCount} 人</span>}
      </div>

      {error && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading && !data && <p className="py-12 text-center text-sm text-slate-400">正在汇总年度量化事实…</p>}

      {data && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="纳入分析员工" value={data.analysis.employeeCount} unit="人" />
            <Metric label="平均量化积分" value={data.analysis.averageTotalScore} unit="分" />
            <Metric label="最高量化积分" value={data.analysis.maxTotalScore} unit="分" />
            <Metric label="最低量化积分" value={data.analysis.minTotalScore} unit="分" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {['一级', '二级', '三级'].map((level) => (
              <div key={level} className="rounded-lg border border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-500">{level}能级</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{data.analysis.tierCounts[level] ?? 0}<span className="ml-1 text-xs font-normal text-slate-400">人</span></p>
              </div>
            ))}
          </div>

          {data.analysis.branchBreakdown.length > 0 && !branchId && (
            <section className="mt-6 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800">各单位量化积分分布</h3>
              <div className="mt-3 space-y-2">
                {data.analysis.branchBreakdown.map((branch) => (
                  <div key={branch.unit} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,1fr)_4rem_5rem] items-center gap-2 text-xs">
                    <span className="truncate text-slate-600" title={branch.unit}>{branch.unit}</span>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(branch.employeeCount / maxBranchCount) * 100}%` }} />
                    </div>
                    <span className="text-right tabular-nums text-slate-500">{branch.employeeCount} 人</span>
                    <span className="text-right font-medium tabular-nums text-slate-700">均 {branch.averageTotalScore.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {GROUPS.map((group) => {
              const dimensions = data.analysis.dimensionAverages.filter((dimension) => dimension.group === group);
              return (
                <section key={group} className="rounded-lg border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-800">{group}平均得分</h3>
                  <div className="mt-3 space-y-2.5">
                    {dimensions.map((dimension) => (
                      <div key={dimension.key} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-xs">
                        <span className="truncate text-slate-600" title={dimension.label}>{dimension.label}</span>
                        <div className="h-2 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-primary-500" style={{ width: `${(dimension.average / maxDimensionAverage) * 100}%` }} />
                        </div>
                        <span className="text-right font-medium tabular-nums text-slate-700">{dimension.average.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          <section className="mt-6 overflow-hidden rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">员工量化积分明细</h3>
                <p className="mt-0.5 text-xs text-slate-500">点击员工查看全部评分项及事实绩效基础。</p>
              </div>
              <div className="flex gap-2">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="工号、姓名、工区或专业" className="w-44 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs" />
                <select value={tier} onChange={(event) => setTier(event.target.value)} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs">
                  <option value="">全部能级</option>
                  <option value="一级">一级</option>
                  <option value="二级">二级</option>
                  <option value="三级">三级</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">排名</th><th className="px-3 py-2.5">员工</th><th className="px-3 py-2.5">单位 / 专业</th><th className="px-3 py-2.5">工龄</th><th className="px-3 py-2.5">能级</th><th className="px-3 py-2.5 text-right">基本素质</th><th className="px-3 py-2.5 text-right">工作业绩</th><th className="px-3 py-2.5 text-right">工作现场</th><th className="px-3 py-2.5 text-right">扣分</th><th className="px-3 py-2.5 text-right">总积分</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((record) => (
                    <EmployeeRows
                      key={record.employeeNo}
                      record={record}
                      dimensions={data.analysis.dimensionAverages}
                      year={data.scope.year}
                      expanded={expanded.has(record.employeeNo)}
                      onToggle={() => toggle(record.employeeNo)}
                    />
                  ))}
                  {records.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-400">没有匹配的员工</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function EmployeeRows({
  record,
  dimensions,
  year,
  expanded,
  onToggle,
}: {
  record: QuantitativeRecord;
  dimensions: DimensionAverage[];
  year: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} className="cursor-pointer hover:bg-slate-50">
        <td className="px-3 py-3 text-slate-500">{record.rank}</td>
        <td className="px-3 py-3"><p className="font-medium text-slate-800">{record.fullName}</p><p className="text-xs text-slate-400">{record.employeeNo}</p></td>
        <td className="px-3 py-3"><p className="text-slate-700">{record.unit}</p><p className="max-w-48 truncate text-xs text-slate-400">{record.specialty || record.position || '—'}</p></td>
        <td className="px-3 py-3 tabular-nums">{record.workYears} 年</td>
        <td className="px-3 py-3"><span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{record.tier}</span></td>
        <Score value={record.basicScore} /><Score value={record.performanceScore} /><Score value={record.worksiteScore} /><Score value={record.deductionScore} />
        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{record.totalScore.toFixed(1)}</td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50">
          <td colSpan={10} className="px-4 py-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {dimensions.map((dimension) => (
                <div key={dimension.key} className="flex items-center justify-between rounded border border-slate-200 bg-white px-3 py-2 text-xs">
                  <span className="text-slate-500">{dimension.label}</span>
                  <span className="font-semibold tabular-nums text-slate-800">{Number(record[dimension.key] ?? 0).toFixed(1)}</span>
                </div>
              ))}
            </div>
            {(record.appealAdjustmentNote || (record.importedTotalScore != null && record.importedTotalScore !== record.totalScore)) && (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                申诉调整：{record.appealAdjustmentNote || '—'}
                {record.importedTotalScore != null && (
                  <span className="ml-2 tabular-nums">
                    导入合计 {Number(record.importedTotalScore).toFixed(1)} → 最终 {record.totalScore.toFixed(1)}
                  </span>
                )}
              </p>
            )}
            <EmployeeFactPanel employeeNo={record.employeeNo} year={year} compact />
          </td>
        </tr>
      )}
    </>
  );
}

function Score({ value }: { value: number }) { return <td className="px-3 py-3 text-right tabular-nums text-slate-700">{value.toFixed(1)}</td>; }
function Metric({ label, value, unit }: { label: string; value: number; unit: string }) { return <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value.toFixed(1).replace(/\.0$/, '')}<span className="ml-1 text-xs font-normal text-slate-400">{unit}</span></p></div>; }
