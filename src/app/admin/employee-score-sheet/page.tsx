'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

interface Employee {
  id: string;
  employeeNo: string;
  fullName: string;
  branch?: { name: string } | null;
  department?: { name: string } | null;
}

interface ScoreLine {
  id?: string;
  label: string;
  score: number;
  detail?: string;
}

interface ScoreItem {
  dimensionCode: string;
  title: string;
  maxScore: number;
  score: number;
  source: 'FACT' | 'MANUAL' | 'NONE' | 'DEDUCTION';
  ruleSummary: string;
  hasImportedFacts: boolean;
  lines: ScoreLine[];
}

interface ScoreSection {
  code: string;
  title: string;
  maxScore: number;
  score: number;
  items: ScoreItem[];
}

interface ScoreSheet {
  year: number;
  employeeNo: string;
  employeeName: string;
  declarationTier: string | null;
  positiveMaxScore: number;
  positiveScore: number;
  deductionScore: number;
  totalScore: number;
  sections: ScoreSection[];
}

interface ScoreResult {
  employeeNo: string;
  employeeName: string;
  gender: string | null;
  branchName: string | null;
  departmentName: string | null;
  declarationTier: string | null;
  ticketRawScore: number | null;
  defectRawScore: number | null;
  sheet: ScoreSheet;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const SOURCE_LABEL: Record<ScoreItem['source'], string> = {
  FACT: '事实数据',
  MANUAL: '申报数据',
  NONE: '暂无数据',
  DEDUCTION: '扣分事实',
};

export default function EmployeeScoreSheetPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [year, setYear] = useState(2026);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadEmployees = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users');
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setLoadError(payload.error || '员工列表加载失败');
        return;
      }
      const list = (payload.users ?? [])
        .filter((user: Employee & { employeeNo?: string | null }) => Boolean(user.employeeNo))
        .sort((a: Employee, b: Employee) => a.employeeNo.localeCompare(b.employeeNo, 'zh-CN'));
      setEmployees(list);
    } catch {
      setLoadError('员工列表加载失败，请检查网络连接');
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const filteredEmployees = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return employees.slice(0, 30);
    return employees.filter((employee) =>
      employee.employeeNo.toLowerCase().includes(keyword) ||
      employee.fullName.toLowerCase().includes(keyword) ||
      employee.branch?.name.toLowerCase().includes(keyword) ||
      employee.department?.name.toLowerCase().includes(keyword)
    ).slice(0, 30);
  }, [employees, search]);

  async function loadSheet() {
    if (!employeeNo) {
      setLoadError('请先选择员工');
      return;
    }
    setLoading(true);
    setLoadError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ year: String(year), employeeNo });
      const response = await fetch(`/api/admin/import/scores?${params}`);
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setLoadError(payload.error || '绩效表生成失败');
        return;
      }
      const row = payload.rows?.[0] as ScoreResult | undefined;
      if (!row?.sheet) {
        setLoadError('未找到该员工，或该年度暂无可生成的数据');
        return;
      }
      setResult(row);
    } catch {
      setLoadError('绩效表生成失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">员工事实绩效表</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
            从 435 名员工中按工号、姓名或工区选择一人，查看系统根据事实数据与积分规则实时生成的年度绩效表。
          </p>
        </div>
        <AdminPageActions />
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid gap-4 lg:grid-cols-[140px_minmax(220px,1fr)_minmax(280px,1.2fr)_auto] lg:items-end">
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">年度</span>
            <input
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">查找员工</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="输入工号、姓名、工区或部门"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium text-slate-700">
              选择员工 <span className="font-normal text-slate-400">（共 {employees.length} 人）</span>
            </span>
            <select
              value={employeeNo}
              onChange={(event) => setEmployeeNo(event.target.value)}
              className={inputClass}
            >
              <option value="">请选择员工工号</option>
              {filteredEmployees.map((employee) => (
                <option key={employee.id} value={employee.employeeNo}>
                  {employee.employeeNo} · {employee.fullName} · {employee.branch?.name ?? '未分配工区'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={loading || !employeeNo}
            onClick={loadSheet}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? '生成中…' : '查看绩效表'}
          </button>
        </div>
        {search && filteredEmployees.length === 30 && (
          <p className="mt-2 text-xs text-slate-400">当前仅展示前 30 条匹配结果，请继续输入以缩小范围。</p>
        )}
      </section>

      {loadError && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">{result.employeeName} · {result.employeeNo}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {[result.branchName, result.departmentName, result.declarationTier ? `${result.declarationTier}能级` : null]
                    .filter(Boolean)
                    .join(' · ') || '暂无组织信息'}
                </p>
              </div>
              <span className="rounded-full bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700">
                {result.sheet.year} 年度
              </span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="事实正向得分" value={result.sheet.positiveScore} suffix={` / ${result.sheet.positiveMaxScore}`} />
              <Metric label="扣分" value={result.sheet.deductionScore} />
              <Metric label="最终得分" value={result.sheet.totalScore} emphasize />
              <Metric label="两票原始分" value={result.ticketRawScore} />
              <Metric label="缺陷治理原始分" value={result.defectRawScore} />
            </div>
          </section>

          {result.sheet.sections.map((section) => (
            <section key={section.code} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
                <div>
                  <h2 className="font-semibold text-slate-900">{section.title}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">系统事实与积分规则计算结果</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">{formatScore(section.score)}</p>
                  <p className="text-xs text-slate-400">满分 {formatScore(section.maxScore)}</p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {section.items.map((item) => (
                  <div key={item.dimensionCode} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_120px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-slate-900">{item.title}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.hasImportedFacts
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          {SOURCE_LABEL[item.source]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{item.dimensionCode}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.ruleSummary}</p>
                      {item.lines.length > 0 ? (
                        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                          {item.lines.map((line, index) => (
                            <div key={line.id ?? `${item.dimensionCode}-${index}`} className="flex items-start justify-between gap-4 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                              <div>
                                <span className="text-slate-700">{line.label}</span>
                                {line.detail && <span className="ml-2 text-xs text-slate-400">{line.detail}</span>}
                              </div>
                              <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatScore(line.score)} 分</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-slate-400">该年度暂无对应事实明细，计 0 分。</p>
                      )}
                    </div>
                    <div className="text-left lg:text-right">
                      <p className="text-2xl font-bold tabular-nums text-slate-900">{formatScore(item.score)}</p>
                      <p className="text-xs text-slate-400">满分 {formatScore(item.maxScore)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function formatScore(value: number | null | undefined): string {
  if (value == null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Metric({
  label,
  value,
  suffix = '',
  emphasize = false,
}: {
  label: string;
  value: number | null;
  suffix?: string;
  emphasize?: boolean;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${
      emphasize ? 'border-primary-200 bg-primary-50' : 'border-slate-200 bg-slate-50'
    }`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${emphasize ? 'text-primary-700' : 'text-slate-900'}`}>
        {formatScore(value)}{suffix}
      </p>
    </div>
  );
}
