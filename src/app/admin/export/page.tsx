'use client';
// 有条件导出：申报表 + 能级专业/等级 + 工区；CSV 汇总/明细；单人 ZIP；归档 ZIP
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type Branch = { id: string; name: string; code?: string | null };
type DictItem = { id: string; name: string };
type Template = { id: string; title: string; year: number; status: string };
type Candidate = {
  submissionId: string;
  fullName: string;
  employeeNo: string | null;
  branch: string;
  declarationLevel: string;
  declarationSpecialty: string;
  totalScore: number;
};

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50';

const ALL = '';

function buildFilterQuery(params: {
  templateId: string;
  branchId: string;
  declarationLevelId: string;
  declarationSpecialtyId: string;
}) {
  const q = new URLSearchParams();
  q.set('templateId', params.templateId);
  if (params.branchId) q.set('branchId', params.branchId);
  if (params.declarationLevelId) q.set('declarationLevelId', params.declarationLevelId);
  if (params.declarationSpecialtyId) q.set('declarationSpecialtyId', params.declarationSpecialtyId);
  return q.toString();
}

export default function ExportPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [levels, setLevels] = useState<DictItem[]>([]);
  const [specialties, setSpecialties] = useState<DictItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [templateId, setTemplateId] = useState('');
  const [branchId, setBranchId] = useState(ALL);
  const [declarationLevelId, setDeclarationLevelId] = useState(ALL);
  const [declarationSpecialtyId, setDeclarationSpecialtyId] = useState(ALL);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('');

  const [archiveBranchId, setArchiveBranchId] = useState('');
  const [archiveYear, setArchiveYear] = useState(() => new Date().getFullYear());

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const filterParams = useMemo(
    () => ({
      templateId,
      branchId,
      declarationLevelId,
      declarationSpecialtyId,
    }),
    [templateId, branchId, declarationLevelId, declarationSpecialtyId],
  );

  const filterQuery = useMemo(() => {
    if (!templateId) return '';
    return buildFilterQuery(filterParams);
  }, [filterParams, templateId]);

  useEffect(() => {
    setLoadingMeta(true);
    Promise.all([
      fetch('/api/admin/organization').then((r) => r.json()),
      fetch('/api/admin/templates').then((r) => r.json()),
    ])
      .then(([org, tpl]) => {
        if (org.success) {
          const list: Branch[] = org.branches ?? [];
          setBranches(list);
          setLevels(org.declarationLevels ?? []);
          setSpecialties(org.declarationSpecialties ?? []);
          setArchiveBranchId((prev) => prev || list[0]?.id || '');
        }
        if (tpl.success) {
          const published = (tpl.templates as Template[]).filter(
            (t) => t.status === 'PUBLISHED' || t.status === 'ARCHIVED',
          );
          setTemplates(published);
          setTemplateId((prev) => prev || published[0]?.id || '');
        }
      })
      .catch(() => setMsg({ type: 'error', text: '无法加载筛选选项' }))
      .finally(() => setLoadingMeta(false));
  }, []);

  const refreshCandidates = useCallback(async () => {
    if (!filterQuery) {
      setCandidates([]);
      setSelectedSubmissionId('');
      return;
    }
    setLoadingCandidates(true);
    try {
      const r = await fetch(`/api/admin/export/candidates?${filterQuery}`);
      const d = await r.json();
      if (!r.ok) {
        setCandidates([]);
        setSelectedSubmissionId('');
        return;
      }
      const list: Candidate[] = d.candidates ?? [];
      setCandidates(list);
      setSelectedSubmissionId((prev) =>
        list.some((c) => c.submissionId === prev) ? prev : list[0]?.submissionId ?? '',
      );
    } catch {
      setCandidates([]);
      setSelectedSubmissionId('');
    } finally {
      setLoadingCandidates(false);
    }
  }, [filterQuery]);

  useEffect(() => {
    refreshCandidates();
  }, [refreshCandidates]);

  const downloadFile = useCallback(async (url: string, fallbackName: string, key: string) => {
    setMsg(null);
    setExporting(key);
    try {
      const r = await fetch(url);
      if (r.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setMsg({ type: 'error', text: (d as { error?: string }).error ?? `导出失败（${r.status}）` });
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
      setMsg({ type: 'success', text: '已开始下载' });
    } catch {
      setMsg({ type: 'error', text: '导出请求失败，请稍后重试' });
    } finally {
      setExporting(null);
    }
  }, []);

  async function downloadArchive() {
    setMsg(null);
    if (!archiveBranchId) {
      setMsg({ type: 'error', text: '请选择工区' });
      return;
    }
    if (!Number.isFinite(archiveYear) || archiveYear < 2000 || archiveYear > 2100) {
      setMsg({ type: 'error', text: '请输入有效年度' });
      return;
    }
    const url = `/api/admin/export?branchId=${encodeURIComponent(archiveBranchId)}&year=${archiveYear}`;
    await downloadFile(url, `archive-${archiveYear}.zip`, 'archive');
  }

  const canExport = Boolean(templateId) && !loadingMeta;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">数据导出</h1>
          <p className="mt-1 text-sm text-slate-500">
            按申报表、能级评价专业/等级、工区筛选二审通过数据；支持汇总与明细 CSV、批量 ZIP、单人档案
          </p>
        </div>
        <AdminPageActions />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold">条件导出（二审通过）</h2>
        <p className="mt-1 text-xs text-slate-500">
          仅导出终审通过的申报；未选工区/等级/专业时表示不限制该项
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-600">申报表</span>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={loadingMeta || templates.length === 0}
              className={inputClass}
            >
              {templates.length === 0 ? (
                <option value="">请先发布申报表</option>
              ) : (
                templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}（{t.year}）
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-600">工区</span>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              disabled={loadingMeta}
              className={inputClass}
            >
              <option value={ALL}>全部工区</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-600">能级评价等级</span>
            <select
              value={declarationLevelId}
              onChange={(e) => setDeclarationLevelId(e.target.value)}
              disabled={loadingMeta}
              className={inputClass}
            >
              <option value={ALL}>全部等级</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="font-medium text-slate-600">能级评价专业</span>
            <select
              value={declarationSpecialtyId}
              onChange={(e) => setDeclarationSpecialtyId(e.target.value)}
              disabled={loadingMeta}
              className={inputClass}
            >
              <option value={ALL}>全部专业</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="mt-3 text-sm text-slate-600">
          {loadingCandidates ? (
            '正在统计符合条件的人数…'
          ) : (
            <>
              当前符合条件：<strong>{candidates.length}</strong> 人
            </>
          )}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canExport || exporting !== null}
            onClick={() =>
              downloadFile(
                `/api/admin/reports/export?format=csv&${filterQuery}`,
                'summary.csv',
                'csv',
              )
            }
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting === 'csv' ? '导出中…' : '汇总表 CSV'}
          </button>
          <button
            type="button"
            disabled={!canExport || exporting !== null}
            onClick={() =>
              downloadFile(
                `/api/admin/reports/export?format=detail&${filterQuery}`,
                'detail-summary.csv',
                'detail',
              )
            }
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting === 'detail' ? '导出中…' : '明细汇总 CSV'}
          </button>
          <button
            type="button"
            disabled={!canExport || exporting !== null || candidates.length === 0}
            onClick={() =>
              downloadFile(
                `/api/admin/reports/export?format=zip&${filterQuery}`,
                'export.zip',
                'zip',
              )
            }
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {exporting === 'zip' ? '打包中…' : '完整 ZIP（汇总+明细+附件）'}
          </button>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-slate-800">单人档案导出</h3>
          <p className="mt-1 text-xs text-slate-500">含申报明细 CSV 与全部上传附件</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block min-w-[12rem] flex-1 text-sm">
              <span className="font-medium text-slate-600">选择员工</span>
              <select
                value={selectedSubmissionId}
                onChange={(e) => setSelectedSubmissionId(e.target.value)}
                disabled={candidates.length === 0 || loadingCandidates}
                className={inputClass}
              >
                {candidates.length === 0 ? (
                  <option value="">无符合条件员工</option>
                ) : (
                  candidates.map((c) => (
                    <option key={c.submissionId} value={c.submissionId}>
                      {c.employeeNo ? `${c.employeeNo} · ` : ''}
                      {c.fullName}
                      {c.branch ? ` · ${c.branch}` : ''}
                      {` · ${c.totalScore}分`}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="button"
              disabled={!selectedSubmissionId || exporting !== null}
              onClick={() =>
                downloadFile(
                  `/api/admin/reports/export?format=employee&submissionId=${encodeURIComponent(selectedSubmissionId)}`,
                  'employee.zip',
                  'employee',
                )
              }
              className="rounded-lg border border-primary-600 px-4 py-2.5 text-sm font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
            >
              {exporting === 'employee' ? '导出中…' : '下载单人 ZIP'}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-5">
        <h2 className="text-lg font-semibold">归档导出（绩效档案）</h2>
        <p className="mt-1 text-xs text-slate-500">
          按工区与年度导出已生成的 PerformanceRecord 归档：manifest.csv、archive.json 与附件
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-600">工区</span>
            <select
              value={archiveBranchId}
              onChange={(e) => setArchiveBranchId(e.target.value)}
              disabled={branches.length === 0 || exporting !== null}
              className={inputClass}
            >
              {branches.length === 0 ? (
                <option value="">请先添加工区</option>
              ) : (
                branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
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
              value={archiveYear}
              onChange={(e) => setArchiveYear(Number.parseInt(e.target.value, 10) || archiveYear)}
              disabled={exporting !== null}
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="button"
          onClick={downloadArchive}
          disabled={exporting !== null || branches.length === 0 || !archiveBranchId}
          className="mt-4 rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {exporting === 'archive' ? '正在打包…' : '下载归档 ZIP'}
        </button>
      </section>

      {msg && (
        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            msg.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {msg.text}
        </div>
      )}
    </main>
  );
}
