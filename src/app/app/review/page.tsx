'use client';
// 审核工作台
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';

interface Att { id: string; filename: string; mimeType?: string | null }
type ViewKind = 'image' | 'pdf' | 'other';
interface AttachmentPreview {
  filename: string;
  viewUrl: string;
  kind: ViewKind;
}
interface SubItem {
  id: string;
  item: { title: string; hint?: string; requireAttachment: boolean };
  selected: { label: string; score: number }[];
  content?: string;
  score: string | number;
  status: string;
  attachments: Att[];
}
interface ReviewLogEntry {
  id: string;
  reviewerId: string;
  level: number;
  action: string;
  note?: string | null;
  createdAt: string;
  submissionItemId?: string | null;
}
interface Submission {
  id: string; totalScore: string | number; status: string; submittedAt?: string;
  user: { fullName: string; contact: string; employeeNo?: string };
  items: SubItem[];
  logs?: ReviewLogEntry[];
}

type Tab = 'pending' | 'completed';

export default function ReviewPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const [level, setLevel] = useState<number>(1);
  const [list, setList] = useState<Submission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { action: 'APPROVE' | 'REJECT'; note?: string }>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [openingAttId, setOpeningAttId] = useState<string | null>(null);

  const openAttachment = async (attId: string) => {
    setOpeningAttId(attId);
    try {
      const r = await fetch(`/api/attachments/${attId}/view`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || '无法打开附件'); return; }
      if (d.kind === 'other') {
        window.open(`/api/attachments/${attId}/view?redirect=1`, '_blank', 'noopener,noreferrer');
        return;
      }
      setPreview({ filename: d.filename ?? '附件', viewUrl: d.viewUrl, kind: d.kind as ViewKind });
    } finally { setOpeningAttId(null); }
  };

  const load = async (filter?: string) => {
    const url = filter ? `/api/review?filter=${filter}` : '/api/review';
    const r = await fetch(url); const d = await r.json();
    setList(d.submissions ?? []); setLevel(d.level ?? 1);
    if (d.submissions?.[0]) setActiveId(d.submissions[0].id); else setActiveId(null);
  };

  useEffect(() => { load(); }, []);

  const switchTab = (t: Tab) => {
    setTab(t);
    setDecisions({});
    if (t === 'completed') load('completed'); else load();
  };

  const active = list.find((s) => s.id === activeId) || null;

  const setDec = (itemId: string, patch: Partial<{ action: 'APPROVE' | 'REJECT'; note: string }>) =>
    setDecisions((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? { action: 'APPROVE' }), ...patch } }));

  const setAll = (action: 'APPROVE' | 'REJECT') => {
    if (!active) return;
    const targetStatus = level === 1 ? 'PENDING_L1' : 'PENDING_L2';
    const next: typeof decisions = { ...decisions };
    active.items.forEach((it) => { if (it.status === targetStatus) next[it.id] = { action, note: next[it.id]?.note }; });
    setDecisions(next);
  };

  const submit = async () => {
    if (!active) return;
    const targetStatus = level === 1 ? 'PENDING_L1' : 'PENDING_L2';
    const pendingItems = active.items.filter((it) => it.status === targetStatus);
    const decs = pendingItems.map((it) => ({
      submissionItemId: it.id,
      action: decisions[it.id]?.action ?? 'APPROVE',
      note: decisions[it.id]?.note,
    }));
    const missingNote = decs.find((d) => d.action === 'REJECT' && !d.note?.trim());
    if (missingNote) { alert('驳回的项必须填写原因'); return; }
    setBusy(true);
    const r = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ submissionId: active.id, decisions: decs }) });
    setBusy(false);
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert('提交失败：' + (e.error || r.status)); return; }
    setDecisions({}); load();
  };

  const reviewTimeline = useMemo(() => {
    if (!active?.logs) return [];
    const grouped: { level: number; action: string; note?: string | null; createdAt: string; itemTitles: string[] }[] = [];
    const byTime = new Map<string, ReviewLogEntry[]>();
    for (const log of active.logs) {
      const t = new Date(log.createdAt).toISOString();
      const existing = byTime.get(t) ?? [];
      existing.push(log);
      byTime.set(t, existing);
    }
    for (const [time, logs] of byTime) {
      const titles = logs
        .map((l) => active.items.find((it) => it.id === l.submissionItemId)?.item.title)
        .filter(Boolean) as string[];
      grouped.push({
        level: logs[0].level,
        action: logs[0].action,
        note: logs.map((l) => l.note).filter(Boolean).join('；') || null,
        createdAt: time,
        itemTitles: titles,
      });
    }
    return grouped.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [active]);

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      DRAFT: { label: '草稿', cls: 'bg-slate-100 text-slate-600' },
      SUBMITTED: { label: '待审核', cls: 'bg-amber-50 text-amber-700' },
      L1_APPROVED: { label: '一审通过', cls: 'bg-blue-50 text-blue-700' },
      L2_APPROVED: { label: '终审通过', cls: 'bg-emerald-50 text-emerald-700' },
      REJECTED: { label: '已驳回', cls: 'bg-red-50 text-red-700' },
    };
    const m = map[s] ?? { label: s, cls: 'bg-slate-100 text-slate-600' };
    return (
      <span className={`inline-block rounded-full px-2 py-px text-xs font-medium ${m.cls}`}>
        {m.label}
      </span>
    );
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/app" className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 cursor-pointer">
            ← 返回
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            审核工作台
            <span className="ml-2 text-sm font-normal text-slate-400">
              （{level === 2 ? '二级 / 总公司' : '一级 / 分公司'}）
            </span>
          </h1>
        </div>
        <LogoutButton />
      </div>

      <div className="mt-4 inline-flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          onClick={() => switchTab('pending')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
            tab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          待审核
        </button>
        <button
          onClick={() => switchTab('completed')}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-all cursor-pointer ${
            tab === 'completed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          已审核
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-4 py-3 text-xs font-semibold text-slate-500">
            {tab === 'pending' ? `待审列表（${list.length}）` : `已审列表（${list.length}）`}
          </p>
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {list.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-400">
                {tab === 'pending' ? '暂无待审核' : '暂无已审核记录'}
              </li>
            )}
            {list.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => { setActiveId(s.id); setDecisions({}); }}
                  className={`block w-full px-4 py-3 text-left text-sm transition-colors cursor-pointer ${
                    activeId === s.id ? 'bg-slate-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{s.user.fullName}</p>
                    {statusBadge(s.status)}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {s.user.employeeNo && <span>{s.user.employeeNo} · </span>}
                    总分 {String(s.totalScore)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          {!active && <p className="text-sm text-slate-400">请选择左侧申报。</p>}

          {/* ===== 待审核模式 ===== */}
          {active && tab === 'pending' && (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h2 className="font-semibold">{active.user.fullName}（{active.user.contact}）</h2>
                  <p className="mt-0.5 text-xs text-slate-400">总分 {String(active.totalScore)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAll('APPROVE')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-slate-50 cursor-pointer">
                    全部通过
                  </button>
                  <button onClick={() => setAll('REJECT')} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer">
                    全部驳回
                  </button>
                </div>
              </div>

              <ul className="mt-3 space-y-3">
                {active.items.map((it) => {
                  const d = decisions[it.id] ?? { action: 'APPROVE' as const };
                  const isPreviouslyApproved =
                    (level === 1 && (it.status === 'L1_APPROVED' || it.status === 'L2_APPROVED')) ||
                    (level === 2 && it.status === 'L2_APPROVED');
                  const statusLabel =
                    it.status === 'L1_APPROVED' ? '已通过（一级）' :
                    it.status === 'L2_APPROVED' ? '已通过（终审）' : '';
                  return (
                    <li key={it.id} className={`rounded-lg border p-4 ${
                      d.action === 'REJECT'
                        ? 'border-red-300 bg-red-50'
                        : isPreviouslyApproved
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-slate-200'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm">{it.item.title}</p>
                            {isPreviouslyApproved && (
                              <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-px text-[10px] font-semibold text-white">
                                {statusLabel}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            选中：{it.selected.map((s) => `${s.label}(${s.score}分)`).join('、') || '—'}
                            {' · '}得分 <b>{String(it.score)}</b>
                          </p>
                          {it.content && <p className="mt-1 text-xs text-slate-500">备注：{it.content}</p>}
                          {it.attachments.length > 0 ? (
                            <ul className="mt-1 space-y-0.5">
                              {it.attachments.map((a) => (
                                <li key={a.id}>
                                  <button
                                    type="button"
                                    onClick={() => openAttachment(a.id)}
                                    disabled={openingAttId === a.id}
                                    className="flex items-center gap-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-700 disabled:opacity-50 cursor-pointer"
                                  >
                                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 0119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                                    </svg>
                                    {openingAttId === a.id ? '打开中…' : a.filename}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : it.item.requireAttachment && (
                            <p className="mt-1 text-xs text-red-600">未上传证明材料</p>
                          )}
                        </div>
                        {!isPreviouslyApproved ? (
                          <div className="flex shrink-0 gap-3">
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="radio"
                                checked={d.action === 'APPROVE'}
                                onChange={() => setDec(it.id, { action: 'APPROVE' })}
                                className="text-primary-600"
                              />
                              通过
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input
                                type="radio"
                                checked={d.action === 'REJECT'}
                                onChange={() => setDec(it.id, { action: 'REJECT' })}
                                className="text-red-600"
                              />
                              驳回
                            </label>
                          </div>
                        ) : (
                          <span className="shrink-0 text-xs font-medium text-emerald-600">无需重复审核</span>
                        )}
                      </div>
                      {d.action === 'REJECT' && (
                        <input
                          value={d.note ?? ''}
                          onChange={(e) => setDec(it.id, { note: e.target.value })}
                          placeholder="请填写驳回原因（员工可见）"
                          className="mt-2 w-full rounded-lg border border-red-300 px-3 py-2 text-xs transition-colors placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={submit}
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  {busy ? '提交中…' : '提交审核结论'}
                </button>
              </div>
            </>
          )}

          {/* ===== 已审核模式 ===== */}
          {active && tab === 'completed' && (
            <>
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">{active.user.fullName}（{active.user.contact}）</h2>
                    <p className="mt-0.5 text-xs text-slate-400">工号 {active.user.employeeNo || '—'}</p>
                  </div>
                  <div className="text-right">
                    {statusBadge(active.status)}
                    <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{Number(active.totalScore).toFixed(1)}</p>
                    <p className="text-xs text-slate-400">总分</p>
                  </div>
                </div>
              </div>

              <ul className="mt-3 space-y-2">
                {active.items.map((it) => (
                  <li key={it.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{it.item.title}</p>
                        {it.status === 'REJECTED'
                          ? <span className="shrink-0 rounded-full bg-red-50 px-2 py-px text-[10px] font-medium text-red-700">已驳回</span>
                          : <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-px text-[10px] font-medium text-emerald-700">已通过</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        选择：{it.selected.map((s) => `${s.label}(${s.score}分)`).join('、') || '—'}
                      </p>
                      {it.content && <p className="mt-1 text-xs text-slate-500">备注：{it.content}</p>}
                      {it.attachments.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {it.attachments.map((a) => (
                            <li key={a.id}>
                              <button
                                type="button"
                                onClick={() => openAttachment(a.id)}
                                disabled={openingAttId === a.id}
                                className="flex items-center gap-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-700 disabled:opacity-50 cursor-pointer"
                              >
                                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 0119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                                </svg>
                                {openingAttId === a.id ? '打开中…' : a.filename}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <span className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white tabular-nums">
                      {Number(it.score).toFixed(1)} 分
                    </span>
                  </li>
                ))}
              </ul>

              {reviewTimeline.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold">审核记录</h3>
                  <div className="mt-3 space-y-2">
                    {reviewTimeline.map((entry, i) => (
                      <div key={i} className="flex gap-3 text-sm">
                        <div className="flex flex-col items-center">
                          <div className={`mt-1.5 h-2.5 w-2.5 rounded-full ${
                            entry.action === 'APPROVE' ? 'bg-emerald-500' : 'bg-red-500'
                          }`} />
                          {i < reviewTimeline.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
                        </div>
                        <div className="pb-2">
                          <p className="font-medium">
                            {entry.level === 1 ? '一级审核' : '二级终审'}
                            <span className={`ml-2 text-xs font-medium ${
                              entry.action === 'APPROVE' ? 'text-emerald-600' : 'text-red-600'
                            }`}>
                              {entry.action === 'APPROVE' ? '通过' : '驳回'}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {entry.itemTitles.length > 0 && `${entry.itemTitles.length} 项：${entry.itemTitles.join('、')}`}
                          </p>
                          {entry.note && <p className="mt-0.5 text-xs text-slate-500">备注：{entry.note}</p>}
                          <p className="mt-0.5 text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString('zh-CN')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* 附件预览弹窗 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`预览：${preview.filename}`}
          onClick={() => setPreview(null)}>
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <p className="truncate text-sm font-medium">{preview.filename}</p>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 cursor-pointer"
              >
                关闭
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2">
              {preview.kind === 'image' && <img src={preview.viewUrl} alt={preview.filename} className="mx-auto max-h-[75vh] w-auto max-w-full object-contain" />}
              {preview.kind === 'pdf' && <iframe title={preview.filename} src={preview.viewUrl} className="h-[75vh] w-full rounded border-0 bg-white" />}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
