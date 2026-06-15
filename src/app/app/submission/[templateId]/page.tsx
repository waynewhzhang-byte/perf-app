'use client';
// 员工填报页
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { UPLOAD_ACCEPT } from '@/lib/upload-security';
import { type HeaderFieldConfig, type HeaderFieldKey, resolveHeaderFields, isFieldEnabled, isFieldRequired } from '@/lib/header-fields';

interface ScoreOpt { optionId?: string; label: string; score: number; description?: string }
interface FormItem {
  id: string; title: string; hint?: string;
  isRequired: boolean; requireAttachment: boolean; maxSelections: number;
  scoreMode?: 'TIERS' | 'COUNTED';
  maxScore?: number | null;
  scoreOptions: ScoreOpt[];
}
interface Section { id: string; title: string; description?: string; items: FormItem[] }
interface Template { id: string; title: string; year: number; description?: string; headerFields?: HeaderFieldConfig[]; sections: Section[] }
interface SelectOption { id: string; name: string }
interface HeaderOptions {
  branches: SelectOption[];
  declarationLevels: SelectOption[];
  declarationSpecialties: SelectOption[];
}

interface Attachment { id: string; filename: string }
interface Selected { index: number; optionId?: string; label: string; score: number; count?: number }
interface OptionReview { optionId: string; status: string; label: string; rejectReason?: string | null }
interface SubItem {
  id?: string; itemId: string;
  selected: Selected[];
  content?: string;
  status?: string; rejectReason?: string | null;
  attachments?: Attachment[];
  optionReviews?: OptionReview[];
}

// 计算单个申报项得分：COUNTED 模式按 单价×次数 汇总并封顶，TIERS 模式累加选中分值
function computeItemScore(it: FormItem, sel: Selected[]): number {
  if (it.scoreMode === 'COUNTED') {
    const raw = sel.reduce((sum, s) => sum + s.score * (s.count ?? 0), 0);
    const cap = it.maxScore == null ? Infinity : Number(it.maxScore);
    return Math.min(raw, cap);
  }
  return sel.reduce((sum, s) => sum + s.score, 0);
}

export default function SubmissionPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const router = useRouter();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [sub, setSub] = useState<{
    id?: string; status?: string; preReviewMessages?: string[] | null;
  } | null>(null);
  const [options, setOptions] = useState<HeaderOptions>({ branches: [], declarationLevels: [], declarationSpecialties: [] });
  const [header, setHeader] = useState({
    workAreaId: '',
    hireDate: '',
    declarationLevelId: '',
    declarationSpecialtyId: '',
  });
  const [answers, setAnswers] = useState<Record<string, SubItem>>({});
  const [factsData, setFactsData] = useState<{
    items: { itemId: string; itemTitle: string; dimensionCode?: string; totalScore: number; facts: { id: string; role: string; eventType: string; score: number; defectRef: string; defectLevel?: string; eventDate?: string | null }[] }[];
  } | null>(null);
  const [factsConfirmations, setFactsConfirmations] = useState<Record<string, 'CONFIRMED' | 'DISPUTED'>>({});
  const [factsDisputes, setFactsDisputes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [tplRes, subRes] = await Promise.all([
        fetch(`/api/templates/${templateId}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/submissions?templateId=${templateId}`).then((r) => r.json()),
      ]);
      const orgRes = await fetch('/api/public/organization').then((r) => r.json()).catch(() => ({}));
      const nextOptions: HeaderOptions = {
        branches: orgRes.branches ?? [],
        declarationLevels: orgRes.declarationLevels ?? [],
        declarationSpecialties: orgRes.declarationSpecialties ?? [],
      };
      setOptions(nextOptions);
      const template: Template | null = tplRes?.template ?? null;
      let currentTemplate: Template | null = template;
      const existing = subRes.submissions?.[0];

      if (!currentTemplate && existing) {
        currentTemplate = {
          id: existing.template.id, title: existing.template.title,
          year: existing.template.year, description: existing.template.description,
          sections: [{
            id: 's', title: '申报项', items: existing.items.map((si: any) => ({
              id: si.item.id, title: si.item.title, hint: si.item.hint,
              isRequired: si.item.isRequired, requireAttachment: si.item.requireAttachment,
              maxSelections: si.item.maxSelections, scoreOptions: si.item.scoreOptions,
              scoreMode: si.item.scoreMode, maxScore: si.item.maxScore,
            })),
          }],
        };
      }

      if (!currentTemplate) { setLoading(false); return; }
      setTpl(currentTemplate);
      setSub(existing ? {
        id: existing.id,
        status: existing.status,
        preReviewMessages: Array.isArray(existing.preReviewMessages) ? existing.preReviewMessages : null,
      } : null);
      setHeader({
        workAreaId: existing?.branchId ?? nextOptions.branches[0]?.id ?? '',
        hireDate: existing?.hireDate ? String(existing.hireDate).slice(0, 10) : '',
        declarationLevelId: existing?.declarationLevelId ?? nextOptions.declarationLevels[0]?.id ?? '',
        declarationSpecialtyId: existing?.declarationSpecialtyId ?? nextOptions.declarationSpecialties[0]?.id ?? '',
      });

      const map: Record<string, SubItem> = {};
      currentTemplate.sections.forEach((s) => s.items.forEach((it) => {
        const ex = existing?.items?.find((x: any) => x.itemId === it.id);
        map[it.id] = ex ? {
          id: ex.id, itemId: it.id, selected: ex.selected ?? [], content: ex.content ?? '',
          status: ex.status, rejectReason: ex.rejectReason, attachments: ex.attachments,
          optionReviews: ex.optionReviews ?? [],
        } : { itemId: it.id, selected: [], content: '' };
      }));
      setAnswers(map);
      // 加载系统填充事实数据
      const factsRes = await fetch(`/api/facts?templateId=${templateId}`).then((r) => r.ok ? r.json() : null).catch(() => null);
      if (factsRes?.items?.length) {
        setFactsData(factsRes);
        // 从已有 submission item 恢复确认/申诉状态
        const confs: Record<string, 'CONFIRMED' | 'DISPUTED'> = {};
        const disps: Record<string, string> = {};
        if (existing?.items) {
          for (const si of existing.items) {
            if ((si as any).isSystemFilled && (si as any).confirmationStatus) {
              confs[si.itemId] = (si as any).confirmationStatus;
              if ((si as any).disputeReason) disps[si.itemId] = (si as any).disputeReason;
            }
          }
        }
        setFactsConfirmations(confs);
        setFactsDisputes(disps);
      }
      setLoading(false);
    })();
  }, [templateId]);

  const itemById = useMemo(() => {
    const m = new Map<string, FormItem>();
    tpl?.sections.forEach((s) => s.items.forEach((it) => m.set(it.id, it)));
    return m;
  }, [tpl]);

  const headerFields = useMemo(
    () => resolveHeaderFields(tpl?.headerFields),
    [tpl?.headerFields],
  );

  const showHeader = (key: HeaderFieldKey) => isFieldEnabled(headerFields, key);
  const requireHeader = (key: HeaderFieldKey) => isFieldRequired(headerFields, key);

  const total = useMemo(
    () => Object.values(answers).reduce((s, a) => {
      const it = itemById.get(a.itemId);
      return s + (it ? computeItemScore(it, a.selected) : a.selected.reduce((x, y) => x + y.score, 0));
    }, 0),
    [answers, itemById],
  );

  const workYears = useMemo(() => {
    if (!header.hireDate) return null;
    const hire = new Date(`${header.hireDate}T00:00:00`);
    const now = new Date();
    let years = now.getFullYear() - hire.getFullYear();
    const beforeAnniversary =
      now.getMonth() < hire.getMonth() ||
      (now.getMonth() === hire.getMonth() && now.getDate() < hire.getDate());
    if (beforeAnniversary) years -= 1;
    return Math.max(0, years);
  }, [header.hireDate]);

  const isLocked = (itemId: string): boolean => {
    if (sub?.status !== 'REJECTED') return false;
    return !!(answers[itemId]?.status && answers[itemId]?.status !== 'REJECTED');
  };
  const optionKey = (itemId: string, option: ScoreOpt, index: number) => option.optionId || `${itemId}:${index}`;
  const isOptionLocked = (itemId: string, option: ScoreOpt, index: number): boolean => {
    if (sub?.status !== 'REJECTED') return false;
    const key = optionKey(itemId, option, index);
    return !!answers[itemId]?.optionReviews?.some((review) => review.optionId === key && review.status === 'L2_APPROVED');
  };
  const isPreReviewRejected = sub?.status === 'PRE_REVIEW_REJECTED';

  const toggle = (it: FormItem, idx: number) => {
    if (isLocked(it.id) || isOptionLocked(it.id, it.scoreOptions[idx], idx)) return;
    setAnswers((prev) => {
      const cur = prev[it.id]; const has = cur.selected.find((s) => s.index === idx);
      let selected = cur.selected;
      if (has) selected = selected.filter((s) => s.index !== idx);
      else {
        const opt = it.scoreOptions[idx];
        const lockedSelected = cur.selected.filter((s) => isOptionLocked(it.id, it.scoreOptions[s.index], s.index));
        if (lockedSelected.length >= it.maxSelections) return prev;
        const next = { index: idx, optionId: optionKey(it.id, opt, idx), label: opt.label, score: opt.score };
        const editableSelected = it.maxSelections === 1 ? [next] : [...selected.filter((s) => !isOptionLocked(it.id, it.scoreOptions[s.index], s.index)), next];
        selected = [...lockedSelected, ...editableSelected.slice(-(it.maxSelections - lockedSelected.length))];
      }
      return { ...prev, [it.id]: { ...cur, selected } };
    });
  };

  // COUNTED 模式：设置某个子项的次数（0 表示未选）
  const setCount = (it: FormItem, idx: number, count: number) => {
    if (isLocked(it.id) || isOptionLocked(it.id, it.scoreOptions[idx], idx)) return;
    const safe = Math.max(0, Math.floor(count || 0));
    setAnswers((prev) => {
      const cur = prev[it.id];
      const opt = it.scoreOptions[idx];
      let selected = cur.selected.filter((s) => s.index !== idx);
      if (safe > 0) {
        selected = [...selected, { index: idx, optionId: optionKey(it.id, opt, idx), label: opt.label, score: opt.score, count: safe }];
      }
      return { ...prev, [it.id]: { ...cur, selected } };
    });
  };

  const setContent = (itemId: string, val: string) => {
    if (isLocked(itemId)) return;
    setAnswers((prev) => ({ ...prev, [itemId]: { ...prev[itemId], content: val } }));
  };

  const upload = async (itemId: string, files: FileList | null) => {
    if (!files || !files.length) return;
    if (!sub?.id) { alert('请先保存草稿后再上传附件'); return; }
    const subItemId = answers[itemId].id;
    if (!subItemId) { alert('请先保存草稿后再上传附件'); return; }
    const fd = new FormData();
    fd.append('submissionItemId', subItemId);
    Array.from(files).forEach((f) => fd.append('files', f));
    const r = await fetch('/api/attachments', { method: 'POST', body: fd });
    if (!r.ok) { alert('上传失败'); return; }
    const d = await r.json();
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], attachments: [...(prev[itemId].attachments ?? []), ...(d.attachments ?? [])] },
    }));
  };

  const save = async (submit: boolean) => {
    if (!tpl) return;
    if (submit) {
      const missing: string[] = [];
      if (requireHeader('workArea') && !header.workAreaId) missing.push('工区');
      if (requireHeader('hireDate') && !header.hireDate) missing.push('入职时间');
      if (requireHeader('declarationLevel') && !header.declarationLevelId) missing.push('能级评价等级');
      if (requireHeader('declarationSpecialty') && !header.declarationSpecialtyId) missing.push('能级评价专业');
      tpl.sections.forEach((s) => s.items.forEach((it) => {
        if (isLocked(it.id)) return;
        const a = answers[it.id];
        if (it.isRequired && !a.selected.length) missing.push(it.title);
        else if (a.selected.length && it.requireAttachment && !(a.attachments?.length)) missing.push(`${it.title}（缺附件）`);
      }));
      if (missing.length) { alert('请补全：\n' + missing.join('\n')); return; }
      // 校验：申诉项必须填写原因
      const missingDisputeReason = (factsData?.items ?? []).filter(
        (fi) => factsConfirmations[fi.itemId] === 'DISPUTED' && !(factsDisputes[fi.itemId] ?? '').trim(),
      );
      if (missingDisputeReason.length > 0) {
        alert('请为以下申诉项填写原因：\n' + missingDisputeReason.map((fi) => fi.itemTitle).join('\n'));
        return;
      }
    }
    setBusy(true);
    const r = await fetch('/api/submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId, submit,
        ...header,
        items: [
          ...Object.values(answers).map((a) => ({
            itemId: a.itemId, selected: a.selected, content: a.content,
            confirmationStatus: (a as any).confirmationStatus,
            disputeReason: (a as any).disputeReason,
            isSystemFilled: (a as any).isSystemFilled ?? false,
          })),
          // 系统填充项：根据确认/申诉状态构建 payload
          ...(factsData?.items ?? []).map((fi) => ({
            itemId: fi.itemId,
            selected: fi.facts.map((f) => ({ label: `${f.defectLevel || f.role} ${f.defectRef}`, score: f.score })),
            isSystemFilled: true as any,
            confirmationStatus: factsConfirmations[fi.itemId] || undefined,
            disputeReason: factsDisputes[fi.itemId] || undefined,
          })),
        ],
      }),
    });
    setBusy(false);
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert('保存失败：' + (e.error || r.status)); return; }
    const d = await r.json().catch(() => ({}));
    if (submit && d.preReviewWarnings) {
      alert('已提交一级审核。\n自动预审提示：\n' + (d.preReviewMessages ?? []).join('\n'));
      router.push('/app');
      return;
    }
    if (submit) { alert('已提交，等待审核'); router.push('/app'); return; }
    alert('草稿已保存');
    location.reload();
  };

  if (loading) return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 h-6 w-48 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="h-4 w-3/4 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
  if (!tpl) return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <p className="text-sm text-red-600">表单不存在或未发布</p>
    </main>
  );

  const editable = !sub?.status || sub.status === 'DRAFT' || sub.status === 'REJECTED' || sub.status === 'PRE_REVIEW_REJECTED';
  const itemEditable = editable && !isPreReviewRejected;
  const statusMap: Record<string, string> = {
    SUBMITTED: '待审核', L1_APPROVED: '一审通过', L2_APPROVED: '终审通过',
    PRE_REVIEW_REJECTED: '自动预审未通过',
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/app" className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 cursor-pointer">
            ← 返回
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{tpl.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{tpl.description}</p>
        </div>
        <LogoutButton />
      </div>

      {sub?.status === 'REJECTED' && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          本次申报已被驳回，仅可修改下方标红的项后重新提交。
        </div>
      )}

      {isPreReviewRejected && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">自动预审未通过，请修改固定表头后重新提交。</p>
          {(sub?.preReviewMessages ?? []).length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {sub!.preReviewMessages!.map((msg, idx) => <li key={`${msg}-${idx}`}>{msg}</li>)}
            </ul>
          )}
        </div>
      )}

      {sub?.status && sub.status !== 'DRAFT' && sub.status !== 'REJECTED' && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          当前状态：{statusMap[sub.status] ?? sub.status}，已不可编辑。
        </div>
      )}

      <div className="sticky top-0 z-10 -mx-4 mt-4 border-y border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">累计分数</span>
          <span className="text-2xl font-bold tracking-tight tabular-nums">{total.toFixed(1)}</span>
        </div>
      </div>

      {headerFields.filter((f) => f.enabled).length > 0 && (
        <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">能级评价申报信息</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {showHeader('workArea') && (
              <label className="text-sm">
                <span className="font-medium text-slate-600">
                  工区
                  {requireHeader('workArea') && <span className="ml-1 text-red-500">*</span>}
                </span>
                <select value={header.workAreaId}
                  disabled={!editable || options.branches.length === 0}
                  onChange={(e) => setHeader((h) => ({ ...h, workAreaId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50">
                  {options.branches.length === 0 && <option value="">请先配置工区</option>}
                  {options.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            {showHeader('hireDate') && (
              <>
                <label className="text-sm">
                  <span className="font-medium text-slate-600">
                    入职时间
                    {requireHeader('hireDate') && <span className="ml-1 text-red-500">*</span>}
                  </span>
                  <input type="date" value={header.hireDate}
                    disabled={!editable}
                    onChange={(e) => setHeader((h) => ({ ...h, hireDate: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />
                </label>
                <label className="text-sm">
                  <span className="font-medium text-slate-600">工作年限（年）</span>
                  <input type="number" min={0} max={60}
                    key={`wy-${header.hireDate}`}
                    defaultValue={workYears ?? undefined}
                    disabled={!editable}
                    placeholder="由入职时间自动计算，可手动修改"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />
                  <p className="mt-0.5 text-xs text-slate-400">提交时根据入职日期自动重算，手动填写仅用于预览参考</p>
                </label>
              </>
            )}
            {showHeader('declarationLevel') && (
              <label className="text-sm">
                <span className="font-medium text-slate-600">
                  能级评价等级
                  {requireHeader('declarationLevel') && <span className="ml-1 text-red-500">*</span>}
                </span>
                <select value={header.declarationLevelId}
                  disabled={!editable || options.declarationLevels.length === 0}
                  onChange={(e) => setHeader((h) => ({ ...h, declarationLevelId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50">
                  {options.declarationLevels.length === 0 && <option value="">请先配置等级</option>}
                  {options.declarationLevels.map((lv) => <option key={lv.id} value={lv.id}>{lv.name}</option>)}
                </select>
              </label>
            )}
            {showHeader('declarationSpecialty') && (
              <label className="text-sm sm:col-span-2">
                <span className="font-medium text-slate-600">
                  能级评价专业
                  {requireHeader('declarationSpecialty') && <span className="ml-1 text-red-500">*</span>}
                </span>
                <select value={header.declarationSpecialtyId}
                  disabled={!editable || options.declarationSpecialties.length === 0}
                  onChange={(e) => setHeader((h) => ({ ...h, declarationSpecialtyId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50">
                  {options.declarationSpecialties.length === 0 && <option value="">请先配置专业</option>}
                  {options.declarationSpecialties.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </select>
              </label>
            )}
          </div>
        </section>
      )}

      {/* 系统自动填充项 */}
      {factsData && factsData.items.length > 0 && (
        <div className="mt-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-500">系统自动填充（来自部门台账）</h2>
          {factsData.items.map((fi) => {
            const confirmed = factsConfirmations[fi.itemId] === 'CONFIRMED';
            const disputed = factsConfirmations[fi.itemId] === 'DISPUTED';
            return (
              <section key={fi.itemId} className={`rounded-xl border p-5 ${
                confirmed ? 'border-emerald-200 bg-emerald-50' :
                disputed ? 'border-amber-200 bg-amber-50' :
                'border-slate-200 bg-white'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{fi.itemTitle}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      系统计算得分：<b className="text-emerald-700">{fi.totalScore.toFixed(1)} 分</b>
                    </p>
                    <div className="mt-2 space-y-1">
                      {fi.facts.map((f) => (
                        <p key={f.id} className="text-xs text-slate-500">
                          {f.defectLevel && <span className="font-medium">{f.defectLevel}</span>}
                          {' · '}{f.role === 'FIRST_DISCOVERER' ? '第一发现人' : f.role === 'CO_DISCOVERER' ? '共同发现人' : f.role === 'FIRST_HANDLER' ? '第一处理人' : '共同处理人'}
                          {' · '}{f.defectRef}
                          {f.eventDate && ` · ${String(f.eventDate).slice(0, 10)}`}
                          {' → '}<b>{f.score} 分</b>
                        </p>
                      ))}
                    </div>
                  </div>
                  {!confirmed && !disputed && (
                    <div className="flex shrink-0 gap-2">
                      <button type="button"
                        onClick={() => setFactsConfirmations((p) => ({ ...p, [fi.itemId]: 'CONFIRMED' }))}
                        className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 cursor-pointer">
                        确认
                      </button>
                      <button type="button"
                        onClick={() => setFactsConfirmations((p) => ({ ...p, [fi.itemId]: 'DISPUTED' }))}
                        className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 cursor-pointer">
                        申诉
                      </button>
                    </div>
                  )}
                  {confirmed && (
                    <span className="shrink-0 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white">
                      已确认（锁定）
                    </span>
                  )}
                  {disputed && (
                    <span className="shrink-0 rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white">
                      申诉中
                    </span>
                  )}
                </div>
                {disputed && (
                  <div className="mt-3">
                    <textarea
                      value={factsDisputes[fi.itemId] ?? ''}
                      onChange={(e) => setFactsDisputes((p) => ({ ...p, [fi.itemId]: e.target.value }))}
                      placeholder="请说明申诉原因（必填，审核员可见）"
                      rows={3}
                      className="w-full rounded-lg border border-amber-300 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20" />
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-5 space-y-6">
        {tpl.sections.map((sec) => (
          <section key={sec.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">{sec.title}</h2>
            {sec.description && <p className="mt-1 text-xs text-slate-400">{sec.description}</p>}
            <div className="mt-4 space-y-5">
              {sec.items.map((it) => {
                const a = answers[it.id]; const locked = isLocked(it.id);
                const rejected = a?.status === 'REJECTED';
                return (
                  <div key={it.id} className={`rounded-lg border p-4 ${
                    rejected ? 'border-red-300 bg-red-50' : locked ? 'bg-slate-50 opacity-70' : 'border-slate-200'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {it.title}
                        {it.isRequired && <span className="ml-1 text-red-500">*</span>}
                        {locked && <span className="ml-2 text-xs text-slate-400">（已审核通过，锁定）</span>}
                      </p>
                      <span className="shrink-0 text-xs text-slate-400">
                        {it.scoreMode === 'COUNTED'
                          ? `按次数计分 · 上限 ${it.maxScore ?? 0} 分`
                          : it.maxSelections > 1 ? `最多选择 ${it.maxSelections} 项` : '单项选择'}
                      </span>
                    </div>

                    {it.hint && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                        <svg className="mt-px h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 17.25h.008v.008H12v-.008z" />
                        </svg>
                        <span>{it.hint}</span>
                      </div>
                    )}
                    {rejected && a?.rejectReason && (
                      <p className="mt-2 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700">
                        驳回原因：{a.rejectReason}
                      </p>
                    )}

                    {it.scoreMode === 'COUNTED' ? (
                      <div className="mt-3 space-y-2">
                        {it.scoreOptions.map((o, idx) => {
                          const cur = a?.selected.find((s) => s.index === idx);
                          const cnt = cur?.count ?? 0;
                          const optionLocked = isOptionLocked(it.id, o, idx);
                          return (
                            <div key={`${o.label}-${idx}`}
                              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-3 text-sm ${
                                optionLocked ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                              }`}>
                              <div className="min-w-0">
                                <span className="font-medium">{o.label}</span>
                                <span className="ml-2 text-xs font-medium text-slate-500">{o.score} 分 / 次</span>
                                {optionLocked && <span className="ml-2 text-xs font-medium text-emerald-600">已终审通过，锁定</span>}
                                {o.description && (
                                  <p className="mt-0.5 text-xs text-slate-400">{o.description}</p>
                                )}
                              </div>
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                次数
                                <input type="number" min={0} value={cnt}
                                  disabled={!itemEditable || locked || optionLocked}
                                  onChange={(e) => setCount(it, idx, +e.target.value)}
                                  className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />
                                <span className="text-slate-400">= {(o.score * cnt).toFixed(1)} 分</span>
                              </label>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-end gap-2 text-xs text-slate-500">
                          <span>本项得分</span>
                          <span className="text-sm font-bold tabular-nums text-slate-900">
                            {computeItemScore(it, a?.selected ?? []).toFixed(1)} 分
                          </span>
                          <span>（上限 {it.maxScore ?? 0} 分）</span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {it.scoreOptions.map((o, idx) => {
                          const on = a?.selected.some((s) => s.index === idx);
                          const optionLocked = isOptionLocked(it.id, o, idx);
                          return (
                            <button key={`${o.label}-${idx}`} type="button" disabled={!itemEditable || locked || optionLocked}
                              onClick={() => toggle(it, idx)}
                              className={`rounded-lg border px-4 py-3 text-left text-sm transition-all duration-200 ${
                                on
                                  ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                  : 'bg-white hover:border-slate-400 hover:shadow-sm'
                              } disabled:cursor-not-allowed disabled:opacity-60`}>
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {o.label}
                                  {optionLocked && <span className="ml-2 text-xs text-emerald-500">已锁定</span>}
                                </span>
                                <span className={`text-sm ${on ? 'font-bold text-white' : 'font-medium text-slate-500'}`}>
                                  {o.score} 分
                                </span>
                              </div>
                              {o.description && (
                                <p className={`mt-1 text-xs leading-relaxed ${on ? 'text-slate-300' : 'text-slate-400'}`}>
                                  {o.description}
                                </p>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <textarea value={a?.content ?? ''} onChange={(e) => setContent(it.id, e.target.value)}
                      disabled={!itemEditable || locked}
                      placeholder="备注说明（可选）"
                      rows={2}
                      className="mt-3 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />

                    {it.requireAttachment && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-slate-600">证明材料</p>
                        <ul className="mt-1 space-y-0.5">
                          {(a?.attachments ?? []).map((at) => (
                            <li key={at.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                              <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                              </svg>
                              {at.filename}
                            </li>
                          ))}
                          {(!a?.attachments || a.attachments.length === 0) && (
                            <li className="text-xs text-slate-400">尚未上传</li>
                          )}
                        </ul>
                        {itemEditable && !locked && (
                          <div className="mt-2">
                            <p className="text-xs text-slate-400">
                              仅支持 PDF、图片、Word/Excel、TXT，单文件 ≤10MB
                            </p>
                            <input
                              type="file"
                              multiple
                              accept={UPLOAD_ACCEPT}
                              onChange={(e) => upload(it.id, e.target.files)}
                              className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-700 file:transition-colors hover:file:bg-slate-200 cursor-pointer"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editable && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-slate-200 bg-white px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex justify-end gap-3">
            <button
              onClick={() => save(false)}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {busy ? '保存中…' : '保存草稿'}
            </button>
            <button
              onClick={() => save(true)}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {busy ? '提交中…' : '提交审核'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
