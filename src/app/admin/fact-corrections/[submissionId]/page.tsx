'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AdminPageActions } from '@/components/admin-page-actions';

type Fact = {
  id: string;
  score: string | number;
  tierValue?: string;
  yearBreakdown?: Record<string, string | null> | null;
  role?: string;
  eventType?: string;
  defectLevel?: string;
  defectRef?: string;
  eventDate?: string | null;
  sourceFile?: string;
  metadata?: Record<string, unknown>;
};

type Item = {
  item: { id: string; title: string; dimensionCode: string };
  kind: 'BASIC' | 'PERFORMANCE';
  attachments: Array<{ id: string; filename: string; mimeType?: string | null }>;
  facts: Fact[];
  factCorrections: Array<{ id: string; action: string; reason: string; correctedAt: string }>;
};

export default function FactCorrectionPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const [items, setItems] = useState<Item[]>([]);
  const [employee, setEmployee] = useState<{ employeeNo: string; fullName: string } | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [activeId, setActiveId] = useState('');
  const [factId, setFactId] = useState('');
  const [tierValue, setTierValue] = useState('');
  const [grade2023, setGrade2023] = useState('');
  const [grade2024, setGrade2024] = useState('');
  const [grade2025, setGrade2025] = useState('');
  const [defectRef, setDefectRef] = useState('');
  const [defectLevel, setDefectLevel] = useState('');
  const [role, setRole] = useState('FIRST_DISCOVERER');
  const [eventType, setEventType] = useState('DISCOVERY');
  const [rawScore, setRawScore] = useState('');
  const [subtype, setSubtype] = useState('');
  const [award, setAward] = useState('');
  const [level, setLevel] = useState('');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState('');
  const [violationLevel, setViolationLevel] = useState('');
  const [violationRole, setViolationRole] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const active = useMemo(() => items.find((item) => item.item.id === activeId) ?? items[0] ?? null, [activeId, items]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/fact-corrections?submissionId=${submissionId}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error || '加载失败'); return; }
    setItems(data.items ?? []);
    setEmployee(data.employee ?? null);
    setYear(data.year ?? null);
    if (!activeId && data.items?.[0]) setActiveId(data.items[0].item.id);
  }, [activeId, submissionId]);

  useEffect(() => { void load(); }, [load]);

  const chooseFact = (nextId: string) => {
    setFactId(nextId);
    const fact = active?.facts.find((row) => row.id === nextId);
    if (!fact) return;
    setTierValue(fact.tierValue ?? '');
    setGrade2023(fact.yearBreakdown?.['2023'] ?? '');
    setGrade2024(fact.yearBreakdown?.['2024'] ?? '');
    setGrade2025(fact.yearBreakdown?.['2025'] ?? '');
    setDefectRef(fact.defectRef ?? '');
    setDefectLevel(fact.defectLevel ?? '');
    setRole(fact.role ?? 'FIRST_DISCOVERER');
    setEventType(fact.eventType ?? 'DISCOVERY');
    setRawScore(String(fact.score ?? ''));
    const metadata = fact.metadata ?? {};
    setSubtype(fact.defectRef?.match(/technical-contribution\.([\w-]+)/)?.[1] ?? '');
    setAward(String(metadata.award ?? ''));
    setLevel(String(metadata.level ?? ''));
    setProject(String(metadata.project ?? metadata.projectName ?? ''));
    setCategory(String(metadata.category ?? metadata.kind ?? ''));
    setViolationLevel(String(metadata.levelRaw ?? ''));
    setViolationRole(String(metadata.roleRaw ?? ''));
    setDescription(String(metadata.description ?? ''));
  };

  const chooseItem = (nextId: string) => {
    setActiveId(nextId);
    setFactId('');
    setTierValue(''); setGrade2023(''); setGrade2024(''); setGrade2025('');
    setDefectRef(''); setDefectLevel(''); setRole('FIRST_DISCOVERER'); setEventType('DISCOVERY'); setRawScore('');
    setSubtype(''); setAward(''); setLevel(''); setProject(''); setCategory('');
    setViolationLevel(''); setViolationRole(''); setDescription('');
  };

  const submit = async () => {
    if (!active || !reason.trim()) { setError('请填写事实修正原因'); return; }
    setBusy(true); setError('');
    const response = await fetch('/api/admin/fact-corrections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionItemId: active.item.id,
        factId: factId || undefined, kind: active.kind,
        reason, evidenceNote: evidenceNote || undefined,
        ...(active.kind === 'BASIC'
          ? { tierValue, yearBreakdown: { '2023': grade2023 || null, '2024': grade2024 || null, '2025': grade2025 || null } }
          : { defectRef, defectLevel, role, eventType, rawScore: rawScore ? Number(rawScore) : undefined, subtype, award, level, project, category, violationLevel, violationRole, description }),
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error || '保存失败'); return; }
    setReason(''); setEvidenceNote('');
    await load();
    alert(`事实已保存，系统已重算绩效总分：${Number(data.totalScore).toFixed(1)} 分`);
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/review-audit" className="text-sm text-slate-500 hover:text-slate-700">← 返回审核审计</Link>
          <h1 className="mt-2 text-2xl font-bold">申诉事实修正</h1>
          <p className="mt-1 text-sm text-slate-600">修正事实后由系统按评分规则重算；最终分数不可手工编辑。</p>
          {employee && <p className="mt-1 text-sm text-slate-500">{employee.fullName} · {employee.employeeNo} · {year} 年度</p>}
        </div>
        <AdminPageActions />
      </div>

      {error && <p className="mt-5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {items.length === 0 && !error && <p className="mt-8 rounded border bg-white p-6 text-center text-sm text-slate-500">该申报没有二审确认有效、可修正的事实申诉项。</p>}

      {active && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-xl border bg-white p-3">
            <p className="px-2 pb-2 text-xs font-semibold text-slate-500">可修正申诉项</p>
            {items.map((entry) => (
              <button key={entry.item.id} onClick={() => chooseItem(entry.item.id)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left text-sm ${active.item.id === entry.item.id ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}>
                {entry.item.title}
                <span className="ml-1 text-xs opacity-70">{entry.item.dimensionCode}</span>
              </button>
            ))}
          </aside>
          <section className="space-y-5">
            <div className="rounded-xl border bg-white p-5">
              <h2 className="font-semibold">现有事实数据</h2>
              <p className="mt-1 text-xs text-slate-500">选择一条事实后可修正；不选择则新增事实。</p>
              {active.attachments.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-800">员工申诉证明材料</p>
                  <ul className="mt-1 space-y-1">
                    {active.attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <a
                          href={`/api/attachments/${attachment.id}/view?proxy=1`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary-700 hover:text-primary-800 hover:underline"
                        >
                          {attachment.filename}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {active.facts.length === 0 && <p className="text-sm text-slate-400">暂无事实数据，可补录。</p>}
                {active.facts.map((fact) => (
                  <label key={fact.id} className="flex cursor-pointer items-start gap-3 rounded border p-3 text-sm">
                    <input type="radio" name="fact" checked={factId === fact.id} onChange={() => chooseFact(fact.id)} />
                    <span className="flex-1">{fact.tierValue ?? fact.defectRef ?? '事实'}{fact.defectLevel ? ` · ${fact.defectLevel}` : ''}{fact.role ? ` · ${fact.role}` : ''}<br /><span className="text-xs text-slate-400">来源：{fact.sourceFile || '—'} · 当前计分 {Number(fact.score).toFixed(1)} 分</span></span>
                  </label>
                ))}
                {factId && <button onClick={() => { setFactId(''); setTierValue(''); setDefectRef(''); setRawScore(''); }} className="text-xs text-slate-500 underline">改为新增事实</button>}
              </div>
            </div>

            <div className="rounded-xl border bg-white p-5">
              <h2 className="font-semibold">{factId ? '修正事实' : '新增事实'}</h2>
              {active.kind === 'BASIC' ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">事实档位<input value={tierValue} onChange={(e) => setTierValue(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder="如：高级技师、 中级" /></label>
                  {active.item.dimensionCode === 'basic.performance-level' && <div className="grid grid-cols-3 gap-2"><label className="text-sm">2023<input value={grade2023} onChange={(e) => setGrade2023(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm">2024<input value={grade2024} onChange={(e) => setGrade2024(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm">2025<input value={grade2025} onChange={(e) => setGrade2025(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label></div>}
                </div>
              ) : active.item.dimensionCode === 'performance.technical-contribution' ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">事实类型<select value={subtype} onChange={(e) => setSubtype(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">请选择</option><option value="textbook">教材/题库/课件</option><option value="regulation">运规编写/会审</option><option value="ticket-revision">两票修订/审查</option></select></label>
                  <label className="text-sm">项目名称<input value={project} onChange={(e) => setProject(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm sm:col-span-2">本人角色/说明<input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                </div>
              ) : active.item.dimensionCode === 'performance.competition' ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">奖项名称<input value={award} onChange={(e) => setAward(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm">获奖级别<input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="国网/省公司" className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm sm:col-span-2">类别<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="技能竞赛/调考/知识竞赛" className="mt-1 w-full rounded border px-3 py-2" /></label>
                </div>
              ) : active.item.dimensionCode === 'performance.innovation' ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">奖项名称<input value={award} onChange={(e) => setAward(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm">获奖级别<input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="国网公司级/省公司级" className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm sm:col-span-2">成果/项目名称<input value={project} onChange={(e) => setProject(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                </div>
              ) : active.item.dimensionCode.startsWith('special.violation-') ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">违章等级<select value={violationLevel} onChange={(e) => setViolationLevel(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">按当前评分项</option><option value="严重">严重</option><option value="一般">一般</option></select></label>
                  <label className="text-sm">责任类型<select value={violationRole} onChange={(e) => setViolationRole(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">请选择</option><option value="直接责任人">直接责任人</option><option value="连带责任人">连带责任人</option></select></label>
                  <label className="text-sm sm:col-span-2">违章事实说明<textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 min-h-20 w-full rounded border px-3 py-2" /></label>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">事实编号<input value={defectRef} onChange={(e) => setDefectRef(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm">事实等级/说明<input value={defectLevel} onChange={(e) => setDefectLevel(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label className="text-sm">角色<select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="FIRST_DISCOVERER">第一发现人</option><option value="CO_DISCOVERER">共同发现人</option><option value="FIRST_HANDLER">第一处理人</option><option value="CO_HANDLER">共同处理人</option></select></label>
                  <label className="text-sm">事件类型<select value={eventType} onChange={(e) => setEventType(e.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="DISCOVERY">发现</option><option value="REMEDIATION">处理</option></select></label>
                  <label className="text-sm">原始量化值<input type="number" min="0" step="0.01" value={rawScore} onChange={(e) => setRawScore(e.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder="两票等按原始量化值填写" /></label>
                </div>
              )}
              <div className="mt-4 grid gap-3">
                <label className="text-sm">修正原因<textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 min-h-20 w-full rounded border px-3 py-2" /></label>
                <label className="text-sm">证明材料说明<textarea value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} className="mt-1 min-h-16 w-full rounded border px-3 py-2" /></label>
                <button disabled={busy} onClick={submit} className="w-fit rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? '保存并重算中…' : '保存事实并重新计算'}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
