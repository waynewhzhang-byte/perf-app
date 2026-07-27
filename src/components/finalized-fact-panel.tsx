'use client';

import { useCallback, useEffect, useState } from 'react';
import { BASIC_DIMENSION_LABELS } from '@/lib/basic-dimension-map';
import type { FinalFactSnapshot } from '@/lib/final-fact-snapshot';

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function FinalizedFactPanel({
  submissionId,
}: {
  submissionId: string;
}) {
  const [snapshot, setSnapshot] = useState<FinalFactSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/reports/facts?submissionId=${encodeURIComponent(submissionId)}`,
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '终审事实快照加载失败');
      setSnapshot(body.factSnapshot ?? null);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : '终审事实快照加载失败');
    } finally {
      setLoading(false);
    }
  }, [submissionId]);

  useEffect(() => { void load(); }, [load]);

  const confirmRebuiltSnapshot = useCallback(async () => {
    if (!reviewNote.trim()) return;
    setReviewing(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/reports/facts/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, note: reviewNote.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '人工复核确认失败');
      setSnapshot(body.factSnapshot ?? null);
      setReviewNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '人工复核确认失败');
    } finally {
      setReviewing(false);
    }
  }, [reviewNote, submissionId]);

  if (loading) {
    return <p className="text-xs text-slate-400">正在加载终审事实快照…</p>;
  }
  if (error && !snapshot) {
    return (
      <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {error}
      </p>
    );
  }
  if (!snapshot) return null;

  const performanceFacts = snapshot.performanceFacts;
  const dimensionRows = snapshot.scoreSheet.sections.flatMap((section) =>
    section.items.map((item) => ({ section, item })));

  return (
    <section className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">终审事实快照</h4>
          <p className="mt-1 text-xs text-slate-500">
            冻结时间 {new Date(snapshot.capturedAt).toLocaleString('zh-CN')} ·
            档案事实 {snapshot.profileFacts.length} 条 ·
            基本事实 {snapshot.basicFacts.length} 条 ·
            绩效事实 {performanceFacts.length} 条 ·
            补充事实 {snapshot.submissionFacts.length} 条
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
          snapshot.reconciliation.status === 'MATCHED'
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-red-100 text-red-700'
        }`}>
          {snapshot.reconciliation.status === 'MATCHED'
            ? `事实重算一致 · ${formatScore(snapshot.scoreSheet.totalScore)} 分`
            : `待人工复核 · 差额 ${formatScore(snapshot.reconciliation.difference)} 分`}
        </span>
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {snapshot.captureMode === 'REBUILT_CURRENT_FACTS' && (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p>该快照由当前事实重建，不代表原终审时点事实，须经人工复核确认。</p>
          {Math.abs(snapshot.reconciliation.difference) <= 0.01 ? (
            <div className="flex flex-wrap gap-2">
              <input
                value={reviewNote}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="填写与原终审材料的核对说明"
                className="min-w-64 flex-1 rounded border border-amber-300 bg-white px-2 py-1.5 text-xs text-slate-700"
              />
              <button
                type="button"
                onClick={() => void confirmRebuiltSnapshot()}
                disabled={reviewing || reviewNote.trim().length < 2}
                className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white disabled:opacity-50"
              >
                {reviewing ? '确认中…' : '确认重建快照'}
              </button>
            </div>
          ) : (
            <a
              href="/admin/import/reconciliation"
              className="inline-block font-medium underline"
            >
              分数仍不一致，前往数据导入核对；修正事实并重新回填后再确认
            </a>
          )}
        </div>
      )}

      {snapshot.captureMode === 'REBUILT_VERIFIED' && snapshot.manualReview && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          重建快照已人工复核：{snapshot.manualReview.note} ·
          {' '}{new Date(snapshot.manualReview.reviewedAt).toLocaleString('zh-CN')}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead>
            <tr className="border-b bg-slate-50 text-slate-500">
              <th className="px-3 py-2 font-medium">评价维度</th>
              <th className="px-3 py-2 font-medium">事实/计算行</th>
              <th className="px-3 py-2 text-right font-medium">最终得分</th>
              <th className="px-3 py-2 font-medium">评分规则</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {dimensionRows.map(({ section, item }) => (
              <tr key={item.dimensionCode}>
                <td className="px-3 py-2 align-top">
                  <p className="font-medium text-slate-800">{item.title}</p>
                  <p className="mt-0.5 text-slate-400">{section.title}</p>
                </td>
                <td className="px-3 py-2 align-top text-slate-600">
                  {item.lines.length > 0
                    ? item.lines.map((line) => (
                        <p key={line.id ?? `${line.label}-${line.score}`}>
                          {line.label}：{formatScore(line.score)}
                          {line.detail ? `（${line.detail}）` : ''}
                        </p>
                      ))
                    : '无事实记录，按 0 分'}
                </td>
                <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">
                  {formatScore(item.score)}
                </td>
                <td className="max-w-sm px-3 py-2 align-top text-slate-500">
                  {item.ruleSummary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {performanceFacts.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-700">
            逐条绩效事实（{performanceFacts.length} 条）
          </h5>
          <div className="mt-2 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {performanceFacts.map((fact) => (
              <article key={fact.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{fact.record.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {fact.dimensionTitle}
                      {fact.record.roleLabel ? ` · ${fact.record.roleLabel}` : ''}
                      {fact.record.occurredAt ? ` · ${fact.record.occurredAt}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {formatScore(fact.score)} 分
                  </span>
                </div>
                {fact.record.details.length > 0 && (
                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    {fact.record.details.map((detail) => (
                      <div key={`${fact.id}-${detail.label}`} className="flex gap-1">
                        <dt className="shrink-0 text-slate-400">{detail.label}：</dt>
                        <dd className="text-slate-600">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  来源：{fact.record.source.file ?? fact.sourceFile}
                  {fact.record.source.sheet ? ` / ${fact.record.source.sheet}` : ''}
                  {fact.record.source.rowNo ? ` / 第 ${fact.record.source.rowNo} 行` : ''}
                  {' · '}记录标识：{fact.record.recordKey}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}

      {snapshot.basicFacts.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-700">
            逐条基本事实（{snapshot.basicFacts.length} 条）
          </h5>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {snapshot.basicFacts.map((fact) => (
              <article key={fact.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {BASIC_DIMENSION_LABELS[fact.dimension]}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{fact.tierValue}</p>
                  </div>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {formatScore(fact.score)} 分
                  </span>
                </div>
                {fact.yearBreakdown != null && (
                  <p className="mt-2 break-words text-xs text-slate-500">
                    年度明细：{typeof fact.yearBreakdown === 'string'
                      ? fact.yearBreakdown
                      : JSON.stringify(fact.yearBreakdown)}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  来源：{fact.sourceFile}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}

      {snapshot.profileFacts.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-700">
            逐条员工档案事实（{snapshot.profileFacts.length} 条）
          </h5>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {snapshot.profileFacts.map((fact) => (
              <article key={fact.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-800">{fact.dimensionTitle}</p>
                <p className="mt-0.5 text-xs text-slate-600">{fact.value}</p>
                <p className="mt-2 text-[11px] text-slate-400">
                  来源：{fact.sourceFile}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}

      {snapshot.submissionFacts.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold text-slate-700">
            逐条补充事实（{snapshot.submissionFacts.length} 条）
          </h5>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {snapshot.submissionFacts.map((fact) => (
              <article key={fact.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{fact.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {fact.dimensionTitle} · {formatScore(fact.unitScore)} 分 × {fact.count}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {formatScore(fact.score)} 分
                  </span>
                </div>
                {fact.content && (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">
                    {fact.content}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  来源：{fact.sourceFile}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
