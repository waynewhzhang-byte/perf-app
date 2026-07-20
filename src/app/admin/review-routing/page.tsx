'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

interface ReviewPoint {
  dimensionCode: string;
  title: string;
  sectionCode: string;
  sectionTitle: string;
  maxScore: number;
  dataSource: string;
  ownerDepartment: string;
  scoringSummary: string;
  departmentId: string;
}

interface Department {
  id: string;
  name: string;
}

interface RouteData {
  points: ReviewPoint[];
  departments: Department[];
  configuredCount: number;
  totalCount: number;
}

const emptyData: RouteData = {
  points: [],
  departments: [],
  configuredCount: 0,
  totalCount: 0,
};

const selectClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:cursor-wait disabled:bg-slate-50';

export default function ReviewRoutingPage() {
  const [data, setData] = useState<RouteData>(emptyData);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch('/api/admin/review-routes');
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setLoadError(payload.error || '加载二审归属失败');
        return;
      }
      setData({
        points: payload.points ?? [],
        departments: payload.departments ?? [],
        configuredCount: payload.configuredCount ?? 0,
        totalCount: payload.totalCount ?? 0,
      });
    } catch {
      setLoadError('加载失败，请检查网络连接');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groupedPoints = useMemo(() => {
    const groups = new Map<string, ReviewPoint[]>();
    for (const point of data.points) {
      const current = groups.get(point.sectionTitle) ?? [];
      current.push(point);
      groups.set(point.sectionTitle, current);
    }
    return Array.from(groups.entries());
  }, [data.points]);

  async function assign(point: ReviewPoint, departmentId: string) {
    setSavingCode(point.dimensionCode);
    setMessage(null);
    setData((current) => ({
      ...current,
      points: current.points.map((row) =>
        row.dimensionCode === point.dimensionCode ? { ...row, departmentId } : row
      ),
    }));
    try {
      const response = await fetch('/api/admin/review-routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimensionCode: point.dimensionCode, departmentId: departmentId || null }),
      });
      if (response.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || '保存失败');
        await load();
        return;
      }
      setMessage(`已保存「${point.title}」的二审归属`);
      await load();
    } catch {
      setMessage('保存失败，请检查网络连接');
      await load();
    } finally {
      setSavingCode(null);
    }
  }

  const complete = data.totalCount > 0 && data.configuredCount === data.totalCount;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">二审归属配置</h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">
            为系统根据事实数据与积分规则生成的每个最终评分点指定二审部门。这里不配置申报表单，评分点变化由评分标准统一维护。
          </p>
        </div>
        <AdminPageActions />
      </div>

      {loadError && (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}
      {message && (
        <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
          {message}
        </div>
      )}

      <section className="mt-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="最终评分点" value={data.totalCount} />
        <SummaryCard label="已配置" value={data.configuredCount} />
        <div className={`rounded-xl border p-5 ${
          complete ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'
        }`}>
          <p className={`text-sm ${complete ? 'text-emerald-700' : 'text-amber-700'}`}>配置状态</p>
          <p className={`mt-1.5 text-lg font-semibold ${complete ? 'text-emerald-900' : 'text-amber-900'}`}>
            {complete ? '全部完成' : `还差 ${Math.max(data.totalCount - data.configuredCount, 0)} 项`}
          </p>
        </div>
      </section>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
        二审部门仅限公司组织部、公司安监部、公司运检部。员工完成确认或申诉并通过一级审核后，系统会按此处配置把最终评分点分别送达对应部门。
      </div>

      <div className="mt-6 space-y-5">
        {groupedPoints.map(([sectionTitle, points]) => (
          <section key={sectionTitle} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
              <h2 className="font-semibold text-slate-900">{sectionTitle}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{points.length} 个最终评分点</p>
            </div>
            <div className="divide-y divide-slate-100">
              {points.map((point) => (
                <div key={point.dimensionCode} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-slate-900">{point.title}</h3>
                      {point.maxScore > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          满分 {point.maxScore}
                        </span>
                      )}
                      {!point.departmentId && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                          待配置
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{point.dimensionCode}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{point.scoringSummary}</p>
                    <p className="mt-1 text-xs text-slate-400">业务责任参考：{point.ownerDepartment}</p>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1.5 block font-medium text-slate-700">二审归属部门</span>
                    <select
                      value={point.departmentId}
                      disabled={savingCode === point.dimensionCode}
                      onChange={(event) => assign(point, event.target.value)}
                      className={selectClass}
                    >
                      <option value="">请选择部门</option>
                      {data.departments.map((department) => (
                        <option key={department.id} value={department.id}>{department.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}
