'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminPageActions } from '@/components/admin-page-actions';

type ListStatus = 'pending' | 'corrected' | 'all';

type Row = {
  submissionId: string;
  status: string;
  totalScore: number;
  employeeNo: string | null;
  employeeName: string;
  branchName: string | null;
  departmentName: string | null;
  year: number;
  templateTitle: string;
  pendingItemCount: number;
  correctedItemCount: number;
  itemTitles: string[];
  latestL2ReviewedAt: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '待一审',
  L1_APPROVED: '待二审',
  L2_APPROVED: '终审通过',
  REJECTED: '已驳回',
};

export default function FactCorrectionsListPage() {
  const [status, setStatus] = useState<ListStatus>('pending');
  const [year, setYear] = useState('');
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [correctedCount, setCorrectedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextStatus: ListStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: nextStatus });
      if (year.trim()) params.set('year', year.trim());
      if (keyword.trim()) params.set('keyword', keyword.trim());
      const response = await fetch(`/api/admin/fact-corrections?${params}`);
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || '加载失败');
        return;
      }
      setRows(data.rows ?? []);
      setPendingCount(data.pendingCount ?? 0);
      setCorrectedCount(data.correctedCount ?? 0);
    } catch {
      setError('加载失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, [status, year, keyword]);

  useEffect(() => {
    void load('pending');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initial load only

  const switchStatus = (next: ListStatus) => {
    setStatus(next);
    void load(next);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">申诉事实修正</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
            二审确认有效的系统事实申诉会进入本列表。管理员在此修正事实台账后，系统按评分规则重算总分（不可手工改分）。
          </p>
        </div>
        <AdminPageActions />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
          <p className="text-xs font-medium text-orange-700">待修正申诉项</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-orange-900">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-xs font-medium text-emerald-700">已修正申诉项</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-900">{correctedCount}</p>
        </div>
      </div>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="inline-flex gap-1 rounded-lg bg-slate-100 p-1">
            {([
              ['pending', '待修正'],
              ['corrected', '已修正'],
              ['all', '全部'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchStatus(value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                  status === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-600">年度</span>
            <input
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="如 2026"
              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="min-w-[14rem] flex-1 text-sm">
            <span className="mb-1 block font-medium text-slate-600">关键字</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="工号、姓名、申诉项"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? '加载中…' : '筛选'}
          </button>
        </div>
      </section>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-2">
          <p className="text-xs font-semibold text-slate-500">申报列表（{rows.length}）</p>
        </div>
        {rows.length === 0 && !loading && (
          <p className="p-8 text-center text-sm text-slate-400">
            {status === 'pending' ? '暂无待修正的申诉事实' : '暂无记录'}
          </p>
        )}
        {loading && <p className="p-8 text-center text-sm text-slate-400">加载中…</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => (
            <li key={row.submissionId} className="px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">
                      {row.employeeName}
                      <span className="ml-2 text-sm font-normal text-slate-500">
                        {row.employeeNo || '无工号'}
                      </span>
                    </p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {row.year} · {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                    {row.pendingItemCount > 0 && (
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                        待修正 {row.pendingItemCount} 项
                      </span>
                    )}
                    {row.correctedItemCount > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        已修正 {row.correctedItemCount} 项
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {[row.branchName, row.departmentName, row.templateTitle].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    申诉项：{row.itemTitles.join('、')}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    当前总分 {row.totalScore.toFixed(1)}
                    {row.latestL2ReviewedAt
                      ? ` · 二审确认于 ${new Date(row.latestL2ReviewedAt).toLocaleString('zh-CN')}`
                      : ''}
                  </p>
                </div>
                <Link
                  href={`/admin/fact-corrections/${row.submissionId}`}
                  className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
                >
                  {row.pendingItemCount > 0 ? '修正事实并重算' : '查看 / 继续修正'}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
