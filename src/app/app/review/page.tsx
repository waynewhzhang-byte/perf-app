'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogoutButton } from '@/components/logout-button';

interface AppealAttachment {
  id: string;
  filename: string;
  mimeType?: string | null;
}

interface AppealReviewRow {
  submissionItemId: string;
  submissionId: string;
  employeeNo: string;
  employeeName: string;
  contact: string;
  itemTitle: string;
  systemScore: number;
  disputeReason: string | null;
  disputeClaimedScore: number | null;
  attachments: AppealAttachment[];
  auditLabel?: '确认' | '驳回';
}

type Tab = 'pending' | 'completed';
type ViewKind = 'image' | 'pdf' | 'other';

interface RowDecision {
  action: 'APPROVE' | 'REJECT';
  note?: string;
  disputeAction?: 'APPROVE' | 'REJECT';
  disputeNote?: string;
}

export default function ReviewPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [level, setLevel] = useState<1 | 2>(1);
  const [rows, setRows] = useState<AppealReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [itemTitle, setItemTitle] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, RowDecision>>({});
  const [batchRejectNote, setBatchRejectNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ filename: string; viewUrl: string; kind: ViewKind } | null>(null);
  const [openingAttId, setOpeningAttId] = useState<string | null>(null);

  const load = useCallback(async (nextTab: Tab = tab) => {
    const params = new URLSearchParams();
    if (nextTab === 'completed') params.set('filter', 'completed');
    if (itemTitle.trim()) params.set('itemTitle', itemTitle.trim());
    if (keyword.trim()) params.set('keyword', keyword.trim());
    const r = await fetch(`/api/review?${params}`);
    const d = await r.json();
    setRows(d.appealRows ?? []);
    setTotal(d.total ?? 0);
    setLevel(d.level ?? 1);
    setSelected(new Set());
    setDecisions({});
    setBatchRejectNote('');
  }, [tab, itemTitle, keyword]);

  // 仅 tab 切换时自动拉取；关键字/申诉项筛选由「筛选」按钮触发，避免输入时清空勾选。
  useEffect(() => {
    void load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: do not reload on every keyword keystroke
  }, [tab]);

  const itemTitleOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => row.itemTitle))).sort(),
    [rows],
  );

  const setDec = (id: string, patch: Partial<RowDecision>) => {
    setDecisions((prev) => {
      const current = prev[id] ?? { action: 'APPROVE' as const, disputeAction: 'APPROVE' as const };
      return { ...prev, [id]: { ...current, ...patch } };
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((row) => row.submissionItemId)));
    }
  };

  const openAttachment = async (attId: string) => {
    setOpeningAttId(attId);
    try {
      const r = await fetch(`/api/attachments/${attId}/view`, { credentials: 'include' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || '无法打开附件'); return; }
      if (!d.viewUrl) { alert('无法获取附件地址'); return; }
      if (d.kind === 'other') {
        window.open(d.viewUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      setPreview({ filename: d.filename ?? '附件', viewUrl: d.viewUrl, kind: d.kind as ViewKind });
    } finally {
      setOpeningAttId(null);
    }
  };

  const buildDecisionForRow = (row: AppealReviewRow, dec: RowDecision) => {
    if (level === 1) {
      return {
        submissionItemId: row.submissionItemId,
        action: dec.action,
        note: dec.action === 'REJECT' ? dec.note : undefined,
        disputeAction: dec.disputeAction ?? 'APPROVE',
        disputeNote: dec.disputeAction === 'REJECT' ? dec.disputeNote : undefined,
      };
    }
    return {
      submissionItemId: row.submissionItemId,
      action: 'APPROVE' as const,
      disputeAction: dec.disputeAction ?? 'APPROVE',
      disputeNote: dec.disputeAction === 'REJECT' ? dec.disputeNote : undefined,
    };
  };

  const submitBatches = async (
    targetRows: AppealReviewRow[],
    decisionOverride?: Record<string, RowDecision>,
  ) => {
    if (targetRows.length === 0) return;
    const decisionMap = decisionOverride ?? decisions;
    for (const row of targetRows) {
      const dec = decisionMap[row.submissionItemId] ?? { action: 'APPROVE', disputeAction: 'APPROVE' };
      if (level === 1 && dec.action === 'REJECT' && !dec.note?.trim()) {
        alert(`请填写「${row.itemTitle}」的驳回原因`);
        return;
      }
      if (dec.disputeAction === 'REJECT' && !dec.disputeNote?.trim()) {
        alert(`请填写「${row.itemTitle}」的申诉驳回原因`);
        return;
      }
    }

    const bySubmission = new Map<string, AppealReviewRow[]>();
    for (const row of targetRows) {
      const list = bySubmission.get(row.submissionId) ?? [];
      list.push(row);
      bySubmission.set(row.submissionId, list);
    }

    const batches = Array.from(bySubmission.entries()).map(([submissionId, submissionRows]) => ({
      submissionId,
      decisions: submissionRows.map((row) =>
        buildDecisionForRow(
          row,
          decisionMap[row.submissionItemId] ?? { action: 'APPROVE', disputeAction: 'APPROVE' },
        ),
      ),
    }));

    setBusy(true);
    try {
      const r = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batches }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error || '提交失败');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const batchApprove = () => {
    const targets = rows.filter((row) => selected.has(row.submissionItemId));
    if (targets.length === 0) { alert('请先勾选申诉行'); return; }
    if (!confirm(`确认批量通过 ${targets.length} 条申诉？`)) return;
    const next: Record<string, RowDecision> = { ...decisions };
    for (const row of targets) {
      next[row.submissionItemId] = { action: 'APPROVE', disputeAction: 'APPROVE' };
    }
    setDecisions(next);
    void submitBatches(targets, next);
  };

  const batchReject = () => {
    const targets = rows.filter((row) => selected.has(row.submissionItemId));
    if (targets.length === 0) { alert('请先勾选申诉行'); return; }
    if (!batchRejectNote.trim()) { alert('批量驳回须填写原因'); return; }
    if (!confirm(`确认批量驳回 ${targets.length} 条申诉？相关申报将整单退回。`)) return;
    const next: Record<string, RowDecision> = { ...decisions };
    for (const row of targets) {
      next[row.submissionItemId] = level === 1
        ? { action: 'REJECT', note: batchRejectNote.trim(), disputeAction: 'REJECT', disputeNote: batchRejectNote.trim() }
        : { action: 'APPROVE', disputeAction: 'REJECT', disputeNote: batchRejectNote.trim() };
    }
    setDecisions(next);
    void submitBatches(targets, next);
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    void load(next);
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            申诉审核工作台
            <span className="ml-2 text-sm font-normal text-slate-400">
              （{level === 2 ? '二级 / 总部部门' : '一级 / 工区'}）
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">每行一条申诉；同一员工在本 scope 内的全部申诉均显示在列表中。</p>
        </div>
        <LogoutButton isAdmin />
      </div>

      <div className="mt-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => switchTab('pending')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
            tab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          待审核
        </button>
        <button
          type="button"
          onClick={() => switchTab('completed')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
            tab === 'completed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          已审核
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="font-medium text-slate-600">申诉项</span>
          <select
            value={itemTitle}
            onChange={(e) => setItemTitle(e.target.value)}
            className="mt-1 block min-w-[12rem] rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">全部</option>
            {itemTitleOptions.map((title) => (
              <option key={title} value={title}>{title}</option>
            ))}
          </select>
        </label>
        <label className="min-w-[14rem] flex-1 text-sm">
          <span className="font-medium text-slate-600">关键字</span>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="工号、姓名、申诉内容…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 cursor-pointer"
        >
          筛选
        </button>
      </div>

      {tab === 'pending' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={batchApprove}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 cursor-pointer"
          >
            批量确认
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={batchRejectNote}
              onChange={(e) => setBatchRejectNote(e.target.value)}
              placeholder="批量驳回原因（必填）"
              className="min-w-[16rem] rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={batchReject}
              disabled={busy || selected.size === 0}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 cursor-pointer"
            >
              批量驳回
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              {tab === 'pending' && (
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleSelectAll}
                    aria-label="全选"
                  />
                </th>
              )}
              <th className="px-3 py-3">序号</th>
              <th className="px-3 py-3">工号</th>
              <th className="px-3 py-3">申诉人</th>
              <th className="px-3 py-3">申诉项</th>
              <th className="px-3 py-3">系统分值</th>
              <th className="px-3 py-3">申诉内容</th>
              <th className="px-3 py-3">附件</th>
              <th className="px-3 py-3">申诉分值</th>
              <th className="px-3 py-3">审核</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={tab === 'pending' ? 10 : 9} className="px-4 py-10 text-center text-slate-400">
                  {tab === 'pending' ? '暂无待审核申诉' : '暂无已审核申诉'}
                </td>
              </tr>
            )}
            {rows.map((row, index) => {
              const dec = decisions[row.submissionItemId] ?? { action: 'APPROVE', disputeAction: 'APPROVE' };
              return (
                <tr key={row.submissionItemId} className="border-b border-slate-50 align-top">
                  {tab === 'pending' && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.submissionItemId)}
                        onChange={() => toggleSelect(row.submissionItemId)}
                        aria-label={`选择 ${row.itemTitle}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-3 tabular-nums text-slate-500">{index + 1}</td>
                  <td className="px-3 py-3 tabular-nums">{row.employeeNo || '—'}</td>
                  <td className="px-3 py-3">{row.employeeName}</td>
                  <td className="px-3 py-3 font-medium">{row.itemTitle}</td>
                  <td className="px-3 py-3 tabular-nums">{row.systemScore.toFixed(1)}</td>
                  <td className="max-w-xs px-3 py-3 text-slate-600">{row.disputeReason || '—'}</td>
                  <td className="px-3 py-3">
                    <ul className="space-y-1">
                      {row.attachments.map((att) => (
                        <li key={att.id}>
                          <button
                            type="button"
                            onClick={() => openAttachment(att.id)}
                            disabled={openingAttId === att.id}
                            className="text-left text-xs font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50 cursor-pointer"
                          >
                            {openingAttId === att.id ? '打开中…' : att.filename}
                          </button>
                        </li>
                      ))}
                      {row.attachments.length === 0 && <span className="text-xs text-slate-400">—</span>}
                    </ul>
                  </td>
                  <td className="px-3 py-3 tabular-nums font-medium text-amber-700">
                    {row.disputeClaimedScore != null ? row.disputeClaimedScore.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-3">
                    {tab === 'completed' ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.auditLabel === '确认' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {row.auditLabel ?? '—'}
                      </span>
                    ) : (
                      <div className="space-y-2">
                        {level === 1 && (
                          <div className="flex gap-3 text-xs">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={dec.action === 'APPROVE'} onChange={() => setDec(row.submissionItemId, { action: 'APPROVE' })} />
                              通过
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" checked={dec.action === 'REJECT'} onChange={() => setDec(row.submissionItemId, { action: 'REJECT' })} />
                              驳回
                            </label>
                          </div>
                        )}
                        <div className="flex gap-3 text-xs">
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              checked={(dec.disputeAction ?? 'APPROVE') === 'APPROVE'}
                              onChange={() => setDec(row.submissionItemId, { disputeAction: 'APPROVE' })}
                            />
                            确认
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              checked={dec.disputeAction === 'REJECT'}
                              onChange={() => setDec(row.submissionItemId, { disputeAction: 'REJECT' })}
                            />
                            驳回
                          </label>
                        </div>
                        {level === 1 && dec.action === 'REJECT' && (
                          <input
                            value={dec.note ?? ''}
                            onChange={(e) => setDec(row.submissionItemId, { note: e.target.value })}
                            placeholder="驳回原因"
                            className="w-full rounded border border-red-200 px-2 py-1 text-xs"
                          />
                        )}
                        {dec.disputeAction === 'REJECT' && (
                          <input
                            value={dec.disputeNote ?? ''}
                            onChange={(e) => setDec(row.submissionItemId, { disputeNote: e.target.value })}
                            placeholder="申诉驳回原因"
                            className="w-full rounded border border-red-200 px-2 py-1 text-xs"
                          />
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void submitBatches([row])}
                          className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50 cursor-pointer"
                        >
                          提交
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-400">共 {total} 条申诉记录</p>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`预览：${preview.filename}`}
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <p className="truncate text-sm font-medium">{preview.filename}</p>
              <button type="button" onClick={() => setPreview(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer">
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2">
              {preview.kind === 'image' && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.viewUrl} alt={preview.filename} className="mx-auto max-h-[75vh] w-auto max-w-full object-contain" />
              )}
              {preview.kind === 'pdf' && (
                <iframe title={preview.filename} src={preview.viewUrl} className="h-[75vh] w-full rounded border-0 bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
