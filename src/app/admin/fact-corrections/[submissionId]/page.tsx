'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminPageActions } from '@/components/admin-page-actions';

type ScoreLine = { label: string; score: number; detail?: string };

type Item = {
  submissionItemId: string;
  formItemId: string;
  title: string;
  dimensionCode: string;
  maxScore: number;
  currentScore: number;
  systemScore: number;
  disputeClaimedScore: number | null;
  disputeReason: string | null;
  disputeL1Note: string | null;
  disputeL2Note: string | null;
  ruleSummary: string;
  scoreLines: ScoreLine[];
  attachments: Array<{ id: string; filename: string; mimeType?: string | null }>;
  overrideScore: number | null;
  overrideReason: string | null;
  overrideAt: string | null;
};

export default function ScoreOverridePage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [items, setItems] = useState<Item[]>([]);
  const [employee, setEmployee] = useState<{ employeeNo: string; fullName: string } | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [totalScore, setTotalScore] = useState<number | null>(null);
  const [activeId, setActiveId] = useState('');
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const active = useMemo(
    () => items.find((item) => item.submissionItemId === activeId) ?? items[0] ?? null,
    [activeId, items],
  );

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/fact-corrections?submissionId=${submissionId}`);
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || '加载失败');
      return;
    }
    const nextItems: Item[] = data.items ?? [];
    setItems(nextItems);
    setEmployee(data.employee ?? null);
    setYear(data.year ?? null);
    setTotalScore(data.totalScore != null ? Number(data.totalScore) : null);
    if (!activeId && nextItems[0]) setActiveId(nextItems[0].submissionItemId);
  }, [activeId, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!active) return;
    const suggested = active.overrideScore
      ?? active.disputeClaimedScore
      ?? active.currentScore;
    setOverrideScore(String(suggested));
    setOverrideReason(active.overrideReason ?? '');
  }, [active?.submissionItemId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset form when switching item

  const chooseItem = (nextId: string) => {
    setActiveId(nextId);
    setError('');
  };

  const submit = async () => {
    if (!active) return;
    const score = Number(overrideScore);
    if (!Number.isFinite(score)) {
      setError('请填写有效分数');
      return;
    }
    if (!overrideReason.trim()) {
      setError('请填写调整原因');
      return;
    }
    setBusy(true);
    setError('');
    const response = await fetch('/api/admin/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionItemId: active.submissionItemId,
        overrideScore: score,
        overrideReason: overrideReason.trim(),
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.error || '保存失败');
      return;
    }
    await load();
    setTotalScore(Number(data.totalScore));
    alert(`得分已调整：${Number(data.oldScore).toFixed(1)} → ${Number(data.newScore).toFixed(1)} 分；申报总分 ${Number(data.totalScore).toFixed(1)}`);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/fact-corrections" className="text-sm text-slate-500 hover:text-slate-700">
            ← 返回待调整列表
          </Link>
          <h1 className="mt-2 text-2xl font-bold">申诉得分调整</h1>
          <p className="mt-1 text-sm text-slate-600">
            二审已确认申诉成立。按计分规则直接调整该维度总分，不修改事实台账。
          </p>
          {employee && (
            <p className="mt-1 text-sm text-slate-500">
              {employee.fullName} · {employee.employeeNo} · {year} 年度
              {totalScore != null ? ` · 当前总分 ${totalScore.toFixed(1)}` : ''}
            </p>
          )}
        </div>
        <AdminPageActions />
      </div>

      {error && (
        <p className="mt-5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {items.length === 0 && !error && (
        <p className="mt-8 rounded border bg-white p-6 text-center text-sm text-slate-500">
          该申报没有二审确认有效、可调整得分的申诉项。
        </p>
      )}

      {active && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border bg-white p-3">
            <p className="px-2 pb-2 text-xs font-semibold text-slate-500">可调整申诉项</p>
            {items.map((entry) => (
              <button
                key={entry.submissionItemId}
                type="button"
                onClick={() => chooseItem(entry.submissionItemId)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${
                  active.submissionItemId === entry.submissionItemId
                    ? 'bg-slate-900 text-white'
                    : 'hover:bg-slate-50'
                }`}
              >
                <span className="block font-medium">{entry.title}</span>
                <span className="mt-0.5 block text-xs opacity-70">
                  {entry.overrideScore != null ? '已调整' : '待调整'} · 当前 {entry.currentScore.toFixed(1)} 分
                </span>
              </button>
            ))}
          </aside>

          <section className="space-y-5">
            <div className="rounded-xl border bg-white p-5">
              <h2 className="font-semibold">{active.title}</h2>
              <p className="mt-1 text-xs text-slate-500">{active.dimensionCode}</p>
              {active.ruleSummary && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  计分规则：{active.ruleSummary}
                  {active.maxScore > 0 ? `（满分 ${active.maxScore}）` : ''}
                </p>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Metric label="事实推算参考分" value={active.systemScore} />
                <Metric label="当前得分" value={active.currentScore} />
                <Metric
                  label="员工主张分"
                  value={active.disputeClaimedScore}
                  empty="未填写"
                />
              </div>

              {active.disputeReason && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-800">申诉理由</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">{active.disputeReason}</p>
                  {(active.disputeL1Note || active.disputeL2Note) && (
                    <p className="mt-2 text-xs text-amber-800">
                      {active.disputeL1Note ? `一审备注：${active.disputeL1Note}` : ''}
                      {active.disputeL1Note && active.disputeL2Note ? ' · ' : ''}
                      {active.disputeL2Note ? `二审备注：${active.disputeL2Note}` : ''}
                    </p>
                  )}
                </div>
              )}

              {active.attachments.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-slate-500">证明材料</p>
                  <ul className="mt-1 space-y-1">
                    {active.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <a
                          href={`/api/attachments/${attachment.id}/view?proxy=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary-700 hover:underline"
                        >
                          {attachment.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4">
                <p className="text-xs font-medium text-slate-500">计分明细（只读参考）</p>
                {active.scoreLines.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">暂无明细行</p>
                ) : (
                  <ul className="mt-2 divide-y rounded-lg border">
                    {active.scoreLines.map((line, index) => (
                      <li key={`${line.label}-${index}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                        <span>
                          {line.label}
                          {line.detail ? <span className="ml-2 text-xs text-slate-400">{line.detail}</span> : null}
                        </span>
                        <span className="shrink-0 tabular-nums font-medium">{Number(line.score).toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-5">
              <h2 className="font-semibold">调整该维度得分</h2>
              <p className="mt-1 text-xs text-slate-500">
                输入调整后的维度总分。默认预填主张分（若有），保存后同步申报总分与归档档案。
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  调整后得分
                  <input
                    type="number"
                    step="0.1"
                    value={overrideScore}
                    onChange={(e) => setOverrideScore(e.target.value)}
                    className="mt-1 w-full rounded border px-3 py-2"
                  />
                </label>
                <div className="text-sm text-slate-500 sm:pt-7">
                  {active.maxScore > 0
                    ? `满分上限 ${active.maxScore} 分`
                    : '扣分项请填写 0 或负数'}
                </div>
              </div>
              <label className="mt-3 block text-sm">
                调整原因
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  className="mt-1 min-h-20 w-full rounded border px-3 py-2"
                  placeholder="说明依据哪条计分规则、为何调整"
                />
              </label>
              {active.overrideAt && (
                <p className="mt-2 text-xs text-slate-400">
                  上次调整于 {new Date(active.overrideAt).toLocaleString('zh-CN')}
                  {active.overrideReason ? ` · ${active.overrideReason}` : ''}
                </p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit()}
                className="mt-4 w-fit rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? '保存中…' : active.overrideScore != null ? '更新覆盖分' : '保存得分调整'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  empty,
}: {
  label: string;
  value: number | null;
  empty?: string;
}) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
        {value == null ? (empty ?? '—') : value.toFixed(1)}
      </p>
    </div>
  );
}
