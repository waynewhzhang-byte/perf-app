'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface ReconciliationRow {
  id: string;
  createdAt: string;
  sourceFiles: unknown;
  summary: {
    status?: string;
    dimensionCode?: string;
    rosterCount?: number;
    checkedEmployees?: number;
    existingFactCount?: number;
    proposedFactCount?: number;
    mismatchCount?: number;
    checkBasis?: string;
    reviewNote?: string;
  };
  coverageIssue?: string | null;
  mismatches: Array<{
    employeeNo: string;
    employeeName: string;
    previous: number;
    next: number;
    difference: number;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  PASSED: '核对通过',
  PENDING_MANUAL_REVIEW: '待人工复核',
  REVIEWED: '已人工复核',
  RETURNED_FOR_CORRECTION: '已退回修正',
};

export default function DetailReconciliationPage() {
  const [year, setYear] = useState(2026);
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/admin/import/reconciliation?year=${year}`);
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      alert(data.error || '加载失败');
      return;
    }
    setRows(data.rows ?? []);
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  const review = async (
    id: string,
    action: 'REVIEWED' | 'RETURNED_FOR_CORRECTION',
  ) => {
    const note = window.prompt(
      action === 'REVIEWED'
        ? '请输入人工核对结论（此操作不会修改现有分数）：'
        : '请输入退回修正原因：',
    );
    if (!note?.trim()) return;
    const response = await fetch('/api/admin/import/reconciliation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action, note }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.error || '处理失败');
      return;
    }
    await load();
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin/import" className="text-sm font-medium text-slate-500 hover:text-slate-700">
        ← 返回数据导入中心
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">事实明细导入核对</h1>
          <p className="mt-1 text-sm text-slate-500">
            按 435 人逐人核对现有原始分与拟导入明细合计。差异批次不会覆盖现有事实或分数。
          </p>
        </div>
        <label className="text-sm text-slate-600">
          年度
          <input
            type="number"
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
            className="ml-2 w-24 rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
      </div>

      <div className="mt-6 space-y-4">
        {loading && <p className="text-sm text-slate-500">加载中…</p>}
        {!loading && rows.length === 0 && (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            暂无核对记录。
          </p>
        )}
        {rows.map((row) => {
          const status = row.summary.status ?? '';
          const pending = status === 'PENDING_MANUAL_REVIEW';
          return (
            <section
              key={row.id}
              className={`rounded-xl border bg-white p-5 ${
                pending ? 'border-amber-300' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{row.summary.dimensionCode ?? '事实维度'}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(row.createdAt).toLocaleString()} · 核对 {row.summary.checkedEmployees ?? row.summary.rosterCount ?? 0} 人
                    · 现有 {row.summary.existingFactCount ?? 0} 条 / 拟导入 {row.summary.proposedFactCount ?? 0} 条
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                  pending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {STATUS_LABELS[status] ?? status}
                </span>
              </div>

              {row.mismatches.length > 0 && (
                <div className="mt-4 overflow-auto">
                  <table className="w-full min-w-[680px] text-xs">
                    <thead>
                      <tr className="border-b text-left text-slate-500">
                        <th className="pb-2 pr-3">工号</th>
                        <th className="pb-2 pr-3">姓名</th>
                        <th className="pb-2 pr-3">现有原始分</th>
                        <th className="pb-2 pr-3">拟导入明细合计</th>
                        <th className="pb-2">差异</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.mismatches.map((mismatch) => (
                        <tr key={mismatch.employeeNo} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-medium">{mismatch.employeeNo}</td>
                          <td className="py-2 pr-3">{mismatch.employeeName || '—'}</td>
                          <td className="py-2 pr-3">{mismatch.previous}</td>
                          <td className="py-2 pr-3">{mismatch.next}</td>
                          <td className="py-2 font-semibold text-red-600">{mismatch.difference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {row.coverageIssue && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  人员覆盖异常：{row.coverageIssue}
                </p>
              )}

              {row.summary.reviewNote && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  人工结论：{row.summary.reviewNote}
                </p>
              )}
              {pending && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => review(row.id, 'REVIEWED')}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                  >
                    记录人工核对结论
                  </button>
                  <button
                    onClick={() => review(row.id, 'RETURNED_FOR_CORRECTION')}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
                  >
                    退回修正数据
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
