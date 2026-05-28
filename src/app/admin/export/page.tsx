'use client';
// 按分公司 + 年度导出归档 ZIP
import { useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type Branch = { id: string; name: string; code?: string | null };

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50';

export default function ExportPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/organization')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        const list: Branch[] = d.branches ?? [];
        setBranches(list);
        setBranchId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => setMsg({ type: 'error', text: '无法加载分公司列表' }));
  }, []);

  async function download() {
    setMsg(null);
    if (!branchId) {
      setMsg({ type: 'error', text: '请选择分公司' });
      return;
    }
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      setMsg({ type: 'error', text: '请输入有效年度' });
      return;
    }

    setLoading(true);
    try {
      const url = `/api/admin/export?branchId=${encodeURIComponent(branchId)}&year=${year}`;
      const r = await fetch(url);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const errText = d.error ?? '导出失败（' + r.status + '）';
        setMsg({ type: 'error', text: errText });
        return;
      }

      const blob = await r.blob();
      const disposition = r.headers.get('Content-Disposition');
      const filenameRe = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;
      const match = disposition ? filenameRe.exec(disposition) : null;
      const filename = match
        ? decodeURIComponent(match[1])
        : `export-${branchId}-${year}.zip`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ type: 'success', text: '已开始下载 ZIP' });
    } catch {
      setMsg({ type: 'error', text: '导出请求失败，请稍后重试' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据导出</h1>
          <p className="mt-1 text-sm text-slate-500">
            按分公司与年度打包下载：manifest.csv、每人 archive.json 及附件
          </p>
        </div>
        <AdminPageActions />
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <label className="block text-sm">
          <span className="font-medium text-slate-600">分公司</span>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={branches.length === 0 || loading}
            className={inputClass}
          >
            {branches.length === 0 ? (
              <option value="">请先在组织架构中添加分公司</option>
            ) : (
              branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.code ? `（${b.code}）` : ''}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">年度</span>
          <input
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number.parseInt(e.target.value, 10) || year)}
            disabled={loading}
            className={inputClass}
          />
        </label>
      </div>

      {msg && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
          msg.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      <button
        type="button"
        onClick={download}
        disabled={loading || branches.length === 0 || !branchId}
        className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {loading ? '正在打包…' : '下载 ZIP'}
      </button>
    </main>
  );
}
