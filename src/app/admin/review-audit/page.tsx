'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminPageActions } from '@/components/admin-page-actions';
import { SectionRadarPanel } from '@/components/section-radar-panel';

interface BranchFilter { id: string; name: string }
interface Stats { total: number; draft: number; preReviewRejected: number; submitted: number; l1Approved: number; l2Approved: number; rejected: number }
interface SubUser { id: string; fullName: string; contact: string; employeeNo?: string | null; branch?: { id: string; name: string } | null }
interface SubTemplate { id: string; title: string; year: number }
interface SubItem {
  id: string; item: { title: string }; selected: { label: string; score: number }[];
  content?: string | null; score: number; status: string; rejectReason?: string | null;
  attachments: { id: string; filename: string; storageKey: string; mimeType?: string | null }[];
  // 系统填充项 + 申诉 + 覆盖
  isSystemFilled?: boolean;
  confirmationStatus?: 'CONFIRMED' | 'DISPUTED' | null;
  disputeReason?: string | null;
  disputeL1Result?: 'APPROVED' | 'REJECTED' | null;
  disputeL1Note?: string | null;
  disputeL2Result?: 'APPROVED' | 'REJECTED' | null;
  disputeL2Note?: string | null;
  overrideScore?: number | null;
  overrideReason?: string | null;
}
interface ReviewLogEntry { id: string; reviewerId: string; level: number; action: string; note?: string | null; createdAt: string; submissionItemId?: string | null }
interface AuditSubmission {
  id: string; totalScore: number; status: string; submittedAt?: string | null; createdAt: string;
  workAreaName?: string | null; workYears?: number | null; declarationLevelName?: string | null; declarationSpecialtyName?: string | null;
  user: SubUser; template: SubTemplate;
  _count: { items: number; logs: number };
}
interface AuditDetail {
  id: string; totalScore: number; status: string; submittedAt?: string | null;
  workAreaName?: string | null; hireDate?: string | null; workYears?: number | null;
  declarationLevelName?: string | null; declarationSpecialtyName?: string | null; preReviewMessages?: string[] | null;
  user: SubUser & { department?: { id: string; name: string } | null; position?: { id: string; name: string } | null };
  template: SubTemplate;
  items: SubItem[];
  logs: ReviewLogEntry[];
}
interface AuditRecord { id: string; year: number; totalScore: number; archivedData: any; createdAt: string }

export default function ReviewAuditPage() {
  const [submissions, setSubmissions] = useState<AuditSubmission[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [branches, setBranches] = useState<BranchFilter[]>([]);
  const [branchId, setBranchId] = useState('all');
  const [year, setYear] = useState('all');
  const [status, setStatus] = useState('all');
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [record, setRecord] = useState<AuditRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideItemId, setOverrideItemId] = useState<string | null>(null);
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideBusy, setOverrideBusy] = useState(false);

  const submitOverride = async () => {
    if (!overrideItemId || !overrideScore.trim() || !overrideReason.trim()) {
      alert('请填写覆盖分数和原因');
      return;
    }
    const score = parseFloat(overrideScore);
    if (isNaN(score) || score < 0) { alert('请输入有效的分数'); return; }
    setOverrideBusy(true);
    try {
      const r = await fetch('/api/admin/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionItemId: overrideItemId, overrideScore: score, overrideReason: overrideReason.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || '覆盖失败'); return; }
      alert('覆盖成功');
      setOverrideItemId(null); setOverrideScore(''); setOverrideReason('');
      // 刷新详情
      if (detail) openDetail(detail.id);
    } finally { setOverrideBusy(false); }
  };

  const loadList = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (branchId !== 'all') params.set('branchId', branchId);
      if (year !== 'all') params.set('year', year);
      if (status !== 'all') params.set('status', status);
      const r = await fetch(`/api/admin/review-audit?${params}`);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setError(d.error || '加载失败'); return; }
      setSubmissions(d.submissions ?? []);
      setStats(d.stats ?? null);
      setBranches(d.branches ?? []);
    } catch { setError('网络错误'); }
    finally { setLoading(false); }
  }, [branchId, year, status]);

  useEffect(() => { loadList(); }, [loadList]);

  const openDetail = async (submissionId: string) => {
    if (detail?.id === submissionId) { setDetail(null); setRecord(null); return; }
    setDetailLoading(true);
    try {
      const r = await fetch(`/api/admin/review-audit?submissionId=${submissionId}`);
      const d = await r.json();
      if (!r.ok) { setError(d.error || '加载失败'); return; }
      setDetail(d.submission);
      setRecord(d.record ?? null);
    } finally { setDetailLoading(false); }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      DRAFT: { label: '草稿', cls: 'bg-slate-100 text-slate-600' },
      SUBMITTED: { label: '待一审', cls: 'bg-yellow-100 text-yellow-700' },
      L1_APPROVED: { label: '待二审', cls: 'bg-blue-100 text-blue-700' },
      L2_APPROVED: { label: '终审通过', cls: 'bg-green-100 text-green-700' },
      PRE_REVIEW_REJECTED: { label: '预审未通过', cls: 'bg-red-100 text-red-700' },
      REJECTED: { label: '已驳回', cls: 'bg-red-100 text-red-700' },
    };
    const m = map[s] ?? { label: s, cls: 'bg-slate-100' };
    return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${m.cls}`}>{m.label}</span>;
  };

  const itemStatusBadge = (s: string) => {
    if (s === 'REJECTED') return <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">驳回</span>;
    if (s === 'L2_APPROVED') return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">通过</span>;
    if (s === 'L1_APPROVED') return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">一审通过</span>;
    return null;
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">审核审计</h1>
          <p className="mt-1 text-sm text-slate-600">查看所有员工的审核记录、进度和结果</p>
        </div>
        <AdminPageActions />
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
        <label className="text-xs text-slate-500">
          工区
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="ml-1 rounded border px-2 py-1 text-sm">
            <option value="all">全部</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          年度
          <select value={year} onChange={(e) => setYear(e.target.value)} className="ml-1 rounded border px-2 py-1 text-sm">
            <option value="all">全部</option>
            {[2024, 2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          状态
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="ml-1 rounded border px-2 py-1 text-sm">
            <option value="all">全部</option>
            <option value="DRAFT">草稿</option>
            <option value="PRE_REVIEW_REJECTED">预审未通过</option>
            <option value="SUBMITTED">待审核</option>
            <option value="L1_APPROVED">一级已通过</option>
            <option value="L2_APPROVED">终审通过</option>
            <option value="REJECTED">已驳回</option>
          </select>
        </label>
        <button onClick={loadList} disabled={loading} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-xs text-white">
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {error && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* 统计卡片 */}
      {stats && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-7">
          <StatCard label="总计" value={stats.total} color="text-slate-900" />
          <StatCard label="草稿" value={stats.draft} color="text-slate-500" />
          <StatCard label="预审未过" value={stats.preReviewRejected} color="text-red-600" />
          <StatCard label="待一审" value={stats.submitted} color="text-yellow-600" />
          <StatCard label="待二审" value={stats.l1Approved} color="text-blue-600" />
          <StatCard label="终审通过" value={stats.l2Approved} color="text-green-600" />
          <StatCard label="已驳回" value={stats.rejected} color="text-red-600" />
        </div>
      )}

      {/* 申报列表 */}
      <section className="mt-4 rounded-lg border bg-white">
        <div className="border-b px-4 py-2">
          <p className="text-xs font-semibold text-slate-500">申报记录（{submissions.length}）</p>
        </div>
        {submissions.length === 0 && !loading && (
          <p className="p-6 text-sm text-slate-400 text-center">暂无记录</p>
        )}
        {loading && <p className="p-6 text-sm text-slate-400 text-center">加载中…</p>}
        <ul className="divide-y">
          {submissions.map((sub) => (
            <li key={sub.id}>
              <button
                onClick={() => openDetail(sub.id)}
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${detail?.id === sub.id ? 'bg-slate-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{sub.user.fullName}</span>
                    <span className="ml-2 text-xs text-slate-400">
                      {sub.user.employeeNo || sub.user.contact} · {sub.workAreaName || sub.user.branch?.name || '—'} · {sub.template.title}（{sub.template.year}）
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{sub._count.items} 项 · {sub._count.logs} 条日志</span>
                    {statusBadge(sub.status)}
                    <span className="text-xs font-semibold">{Number(sub.totalScore).toFixed(1)} 分</span>
                  </div>
                </div>
              </button>

              {/* 展开的详情 */}
              {detail?.id === sub.id && (
                <div className="border-t bg-slate-50 px-4 py-4">
                  {detailLoading ? (
                    <p className="text-sm text-slate-400">加载详情中…</p>
                  ) : (
                    <div className="space-y-4">
                      {/* 员工信息 + 总分 */}
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{detail?.user.fullName}</h3>
                          <p className="text-xs text-slate-500">
                            工号 {detail?.user.employeeNo || '—'} · {detail?.user.contact} · {detail?.user.branch?.name || '—'} · {detail?.user.department?.name || '—'} · {detail?.user.position?.name || '—'}
                          </p>
                          <p className="text-xs text-slate-400">申报：{detail?.template.title}（{detail?.template.year} 年度）</p>
                        </div>
                        <div className="text-right">
                          {statusBadge(detail?.status ?? '')}
                          <p className="mt-1 text-2xl font-bold">{Number(detail?.totalScore).toFixed(1)}</p>
                          <p className="text-xs text-slate-400">总分</p>
                        </div>
                      </div>

                      <div className="rounded-lg border bg-white p-3">
                        <h4 className="text-xs font-semibold text-slate-500">能级评价申报信息</h4>
                        <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-5">
                          <span>工区：{detail?.workAreaName || detail?.user.branch?.name || '—'}</span>
                          <span>入职时间：{detail?.hireDate ? String(detail.hireDate).slice(0, 10) : '—'}</span>
                          <span>工作年限：{detail?.workYears ?? '—'}</span>
                          <span>申报等级：{detail?.declarationLevelName || '—'}</span>
                          <span>申报专业：{detail?.declarationSpecialtyName || '—'}</span>
                        </div>
                        {detail?.status === 'PRE_REVIEW_REJECTED' && (detail?.preReviewMessages ?? []).length > 0 && (
                          <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            自动预审说明：{detail!.preReviewMessages!.join('；')}
                          </div>
                        )}
                      </div>

                      {detail?.status === 'L2_APPROVED' && (
                        <SectionRadarPanel
                          fetchUrl={`/api/admin/submissions/${detail.id}/radar`}
                        />
                      )}

                      {/* 逐项明细 */}
                      {(detail?.items ?? []).length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500">申报项明细</h4>
                          <ul className="mt-2 space-y-1.5">
                            {detail!.items.map((it) => (
                              <li key={it.id} className={`rounded border bg-white p-2.5 ${it.isSystemFilled && it.confirmationStatus === 'DISPUTED' ? 'border-amber-200' : ''}`}>
                                <div className="flex items-start justify-between">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <p className="text-sm font-medium">{it.item.title}</p>
                                      {itemStatusBadge(it.status)}
                                      {it.isSystemFilled && (
                                        <span className="rounded-full bg-purple-50 px-2 py-px text-[10px] font-medium text-purple-600">系统填充</span>
                                      )}
                                      {it.confirmationStatus === 'CONFIRMED' && (
                                        <span className="rounded-full bg-emerald-50 px-2 py-px text-[10px] font-medium text-emerald-600">员工已确认</span>
                                      )}
                                      {it.confirmationStatus === 'DISPUTED' && (
                                        <span className="rounded-full bg-amber-50 px-2 py-px text-[10px] font-medium text-amber-600">员工申诉中</span>
                                      )}
                                      {it.overrideScore != null && (
                                        <span className="rounded-full bg-orange-50 px-2 py-px text-[10px] font-medium text-orange-600">管理员已覆盖</span>
                                      )}
                                    </div>
                                    <p className="mt-0.5 text-xs text-slate-500">
                                      {it.selected?.map((s) => `${s.label}(${s.score}分)`).join('、') || '—'}
                                    </p>
                                    {it.content && <p className="mt-0.5 text-xs text-slate-600">备注：{it.content}</p>}
                                    {it.rejectReason && <p className="mt-0.5 text-xs text-red-600">驳回原因：{it.rejectReason}</p>}
                                    {/* 申诉历史 */}
                                    {it.disputeReason && (
                                      <p className="mt-0.5 text-xs text-amber-700">员工申诉理由：{it.disputeReason}</p>
                                    )}
                                    {it.disputeL1Result && (
                                      <p className="mt-0.5 text-xs text-amber-700">
                                        L1 判断：{it.disputeL1Result === 'APPROVED' ? '认定合理' : '驳回'}
                                        {it.disputeL1Note ? ` — ${it.disputeL1Note}` : ''}
                                      </p>
                                    )}
                                    {it.disputeL2Result && (
                                      <p className="mt-0.5 text-xs text-amber-700">
                                        L2 确认：{it.disputeL2Result === 'APPROVED' ? '确认有效' : '认定无效'}
                                        {it.disputeL2Note ? ` — ${it.disputeL2Note}` : ''}
                                      </p>
                                    )}
                                    {it.overrideScore != null && (
                                      <p className="mt-0.5 text-xs text-orange-700">
                                        管理员覆盖：{Number(it.score).toFixed(1)} 分（原因：{it.overrideReason || '—'}）
                                      </p>
                                    )}
                                    {it.attachments.length > 0 && (
                                      <p className="mt-0.5 text-xs text-blue-500">附件 {it.attachments.length} 个</p>
                                    )}
                                    {/* 管理员覆盖表单 */}
                                    {it.disputeL2Result === 'APPROVED' && it.overrideScore == null && (
                                      <div className="mt-2 rounded border border-orange-200 bg-orange-50 p-3">
                                        <p className="text-xs font-semibold text-orange-700 mb-2">申诉已确认有效，可覆盖分数</p>
                                        {overrideItemId === it.id ? (
                                          <div className="space-y-2">
                                            <div>
                                              <label className="text-xs font-medium text-orange-700">覆盖分数（当前 {Number(it.score).toFixed(1)} 分）</label>
                                              <input
                                                type="number"
                                                step="0.1"
                                                min="0"
                                                value={overrideScore}
                                                onChange={(e) => setOverrideScore(e.target.value)}
                                                className="mt-0.5 w-32 rounded border border-orange-300 px-2 py-1 text-sm"
                                                placeholder="新分数"
                                              />
                                            </div>
                                            <div>
                                              <label className="text-xs font-medium text-orange-700">覆盖原因</label>
                                              <input
                                                value={overrideReason}
                                                onChange={(e) => setOverrideReason(e.target.value)}
                                                className="mt-0.5 w-full rounded border border-orange-300 px-2 py-1 text-sm"
                                                placeholder="请填写覆盖原因（审计用）"
                                              />
                                            </div>
                                            <div className="flex gap-2">
                                              <button
                                                onClick={submitOverride}
                                                disabled={overrideBusy}
                                                className="rounded bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                                              >
                                                {overrideBusy ? '提交中…' : '确认覆盖'}
                                              </button>
                                              <button
                                                onClick={() => { setOverrideItemId(null); setOverrideScore(''); setOverrideReason(''); }}
                                                className="rounded border border-orange-300 px-3 py-1 text-xs text-orange-700 hover:bg-orange-100"
                                              >
                                                取消
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => { setOverrideItemId(it.id); setOverrideScore(''); setOverrideReason(''); }}
                                            className="rounded bg-orange-600 px-3 py-1 text-xs font-medium text-white hover:bg-orange-700"
                                          >
                                            覆盖分数
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <span className="ml-3 shrink-0 rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                                    {Number(it.score).toFixed(1)} 分
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* 审核日志时间线 */}
                      {(detail?.logs ?? []).length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-slate-500">审核记录</h4>
                          <div className="mt-2 space-y-1.5">
                            {detail!.logs.map((log, i) => {
                              const itemTitle = detail!.items.find((it) => it.id === log.submissionItemId)?.item.title ?? '';
                              return (
                                <div key={log.id || i} className="flex gap-3 text-sm">
                                  <div className="flex flex-col items-center">
                                    <div className={`mt-1.5 h-2 w-2 rounded-full ${
                                      log.level === 3 ? 'bg-amber-500' : log.action === 'APPROVE' ? 'bg-green-500' : 'bg-red-500'
                                    }`} />
                                    {i < detail!.logs.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
                                  </div>
                                  <div className="pb-2">
                                    <p className="text-xs">
                                      <span className="font-medium">{log.level === 0 ? '提交/预审' : log.level === 1 ? '一级审核' : log.level === 2 ? '二级终审' : '管理员覆盖分'}</span>
                                      <span className={`ml-2 ${log.level === 3 ? 'text-amber-600' : log.action === 'APPROVE' ? 'text-green-600' : 'text-red-600'}`}>
                                        {log.level === 3 ? '已覆盖' : log.action === 'APPROVE' ? '通过' : '驳回'}
                                      </span>
                                      {itemTitle && <span className="ml-1 text-slate-400">· {itemTitle}</span>}
                                    </p>
                                    {log.note && <p className="mt-0.5 text-xs text-slate-500">{log.note}</p>}
                                    <p className="mt-0.5 text-xs text-slate-400">{new Date(log.createdAt).toLocaleString('zh-CN')}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 已归档绩效记录 */}
                      {record && (
                        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                          <p className="text-xs font-semibold text-green-700">
                            已归档 · {record.year} 年度绩效档案 · 总分 {Number(record.totalScore).toFixed(1)} 分
                          </p>
                          <p className="mt-1 text-xs text-green-600">
                            归档时间：{new Date(record.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border bg-white p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
