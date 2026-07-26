'use client';
// 员工填报页
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { UPLOAD_ACCEPT } from '@/lib/upload-security';
import { type HeaderFieldConfig, type HeaderFieldKey, resolveHeaderFields, isFieldEnabled, isFieldRequired } from '@/lib/header-fields';
import { evaluationCutoffDate, formatDeclarationLevelDisplay, levelFromHireDate } from '@/lib/declaration-level';
import { calculateFullWorkYears } from '@/lib/pre-review';
import { computeItemScore, parseDateOnly } from '@/lib/submission-score';
import { isSystemConfirmationDimension } from '@/lib/system-filled-items';
import { groupAppealCascadeItems, isAppealableDimensionCode } from '@/lib/appeal-cascade';
import { SupportPhoneFooter } from '@/components/support-phone-footer';
import { formatDerivationPreview, truncateDerivationPreview } from '@/lib/derivation-display';
import { PERFORMANCE_SECTIONS, SCORING_STANDARDS } from '@/lib/scoring-standards';

const FORM_2026_TITLE = '2026 年能级评价量化积分申报表';
const FORM_2026_DESCRIPTION =
  '国网山西超高压变电公司 2026 年能级评价量化积分申报表全部维度由外部台账导入并按相关评价标准核算计分。请逐项查看系统分值与计算过程；如有异议，请通过页面底部「申诉」提交理由与证明材料；对系统分值无异议请使用「确认报名」。';

const SCORING_POINT_ORDER = new Map<string, number>(
  SCORING_STANDARDS.map((standard, index) => [standard.code, index]),
);

/** 员工端展示用：评价维度 工作现场-两票执行（避免「一级/二级」与能级等级混淆） */
function formatEvaluationDimensionLabel(
  sectionTitle: string | null | undefined,
  itemTitle: string,
): string {
  const section = (sectionTitle ?? '').trim() || '—';
  const item = itemTitle.trim() || '—';
  return `评价维度 ${section}-${item}`;
}

interface ScoreOpt { optionId?: string; label: string; score: number; description?: string }
interface FormItem {
  id: string; title: string; hint?: string;
  dimensionCode?: string | null;
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
  declaredScore?: number | null;
  content?: string;
  status?: string; rejectReason?: string | null;
  attachments?: Attachment[];
  optionReviews?: OptionReview[];
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
    items: {
      itemId: string;
      itemTitle: string;
      sectionTitle?: string;
      sectionCode?: string | null;
      dimensionCode?: string;
      factKind?: 'basic' | 'performance' | 'profile';
      ruleSummary?: string;
      totalScore: number;
      facts: {
        id: string;
        score: number;
        role?: string;
        eventType?: string;
        defectRef?: string;
        defectLevel?: string;
        eventDate?: string | null;
        tierValue?: string;
        label?: string;
        thirdLevelTitle?: string;
        yearBreakdown?: unknown;
        sourceFile?: string | null;
      }[];
      derivation?: {
        ruleType: string;
        ruleSummary: string;
        referenceFile?: string;
        notes?: string;
        rawFactFields: {
          id: string;
          label?: string;
          score: number;
          role?: string;
          defectRef?: string;
          defectLevel?: string;
          eventDate?: string | null;
          tierValue?: string;
          thirdLevelTitle?: string;
          metadata?: unknown;
          sourceFile?: string | null;
        }[];
        steps: { label: string; detail?: string; kind?: 'raw' | 'subtotal' | 'cap' | 'final' | 'note' }[];
      };
    }[];
    scoreSheet?: {
      totalScore?: number;
      positiveScore?: number;
      deductionScore?: number;
      positiveMaxScore?: number;
      declarationTier?: string | null;
      sections?: { code: string; title: string; score: number; maxScore: number }[];
    };
  } | null>(null);
  const [factsConfirmations, setFactsConfirmations] = useState<Record<string, 'CONFIRMED' | 'DISPUTED'>>({});
  const [factsDisputes, setFactsDisputes] = useState<Record<string, string>>({});
  const [factsClaimedScores, setFactsClaimedScores] = useState<Record<string, number>>({});
  const [factsItemDbIds, setFactsItemDbIds] = useState<Record<string, string>>({});
  const [factsAttachments, setFactsAttachments] = useState<Record<string, Attachment[]>>({});
  const [appealModalOpen, setAppealModalOpen] = useState(false);
  const [editingAppealItemId, setEditingAppealItemId] = useState<string | null>(null);
  const [modalSectionTitle, setModalSectionTitle] = useState('');
  const [modalItemId, setModalItemId] = useState('');
  const [modalReason, setModalReason] = useState('');
  const [modalClaimedScore, setModalClaimedScore] = useState('');
  const [modalPendingFiles, setModalPendingFiles] = useState<File[]>([]);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const toggleExpand = (itemId: string) =>
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [tplRes, subRes, profileRes] = await Promise.all([
        fetch(`/api/templates/${templateId}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/submissions?templateId=${templateId}`).then((r) => r.json()),
        fetch('/api/profile').then((r) => r.ok ? r.json() : null).catch(() => null),
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
              dimensionCode: si.item.dimensionCode,
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
      const workAreaEnabled = isFieldEnabled(resolveHeaderFields(currentTemplate.headerFields), 'workArea');
      setHeader({
        workAreaId: workAreaEnabled
          ? existing?.branchId ?? nextOptions.branches[0]?.id ?? ''
          : profileRes?.user?.branch?.id ?? '',
        hireDate: existing?.hireDate ? String(existing.hireDate).slice(0, 10) : '',
        declarationLevelId: existing?.declarationLevelId ?? nextOptions.declarationLevels[0]?.id ?? '',
        // 申报专业需员工本人选择，不默认第一项
        declarationSpecialtyId: existing?.declarationSpecialtyId ?? '',
      });

      const map: Record<string, SubItem> = {};
      currentTemplate.sections.forEach((s) => s.items.forEach((it) => {
        const ex = existing?.items?.find((x: any) => x.itemId === it.id);
        if (isSystemConfirmationDimension(it.dimensionCode)) return;
        map[it.id] = ex ? {
          id: ex.id, itemId: it.id, selected: ex.selected ?? [],
          declaredScore: ex.selected?.find((row: Selected) => row.optionId === 'employee-declared-score')?.score ?? null,
          content: ex.content ?? '',
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
        const claimed: Record<string, number> = {};
        if (existing?.items) {
          const dbIds: Record<string, string> = {};
          const factAtts: Record<string, Attachment[]> = {};
          for (const si of existing.items) {
            if ((si as any).isSystemFilled && (si as any).confirmationStatus) {
              confs[si.itemId] = (si as any).confirmationStatus;
              if ((si as any).disputeReason) disps[si.itemId] = (si as any).disputeReason;
              if ((si as any).disputeClaimedScore != null) {
                claimed[si.itemId] = Number((si as any).disputeClaimedScore);
              }
            }
            if ((si as any).isSystemFilled) {
              if (si.id) dbIds[si.itemId] = si.id;
              if (si.attachments?.length) factAtts[si.itemId] = si.attachments;
            }
          }
          setFactsItemDbIds(dbIds);
          setFactsAttachments(factAtts);
        }
        setFactsConfirmations(confs);
        setFactsDisputes(disps);
        setFactsClaimedScores(claimed);
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

  const systemFilledItemIds = useMemo(
    () => new Set(factsData?.items.map((fi) => fi.itemId) ?? []),
    [factsData],
  );

  const appealCentric = Boolean(factsData?.items?.length);
  const is2026AppealView = tpl?.year === 2026 && appealCentric;

  const profileFactItem = useMemo(
    () => factsData?.items.find((fi) => fi.factKind === 'profile') ?? null,
    [factsData],
  );

  const displayHireDate = useMemo(() => {
    const fromProfile = profileFactItem?.facts[0]?.label;
    if (fromProfile) return String(fromProfile).slice(0, 10);
    return header.hireDate || '—';
  }, [profileFactItem, header.hireDate]);

  const participationWorkYears = useMemo(() => {
    const hire = parseDateOnly(displayHireDate !== '—' ? displayHireDate : undefined)
      ?? parseDateOnly(header.hireDate || undefined);
    if (!hire) return null;
    return calculateFullWorkYears(hire, evaluationCutoffDate(tpl?.year ?? new Date().getFullYear()));
  }, [displayHireDate, header.hireDate, tpl?.year]);

  const groupedFactSections = useMemo(() => {
    if (!factsData?.items.length) return [];
    const bySection = new Map<string, typeof factsData.items>();
    for (const fi of factsData.items) {
      if (fi.factKind === 'profile') continue;
      const code = fi.sectionCode ?? 'other';
      if (!bySection.has(code)) bySection.set(code, []);
      bySection.get(code)!.push(fi);
    }
    const sheetSections = factsData.scoreSheet?.sections ?? [];
    const order = PERFORMANCE_SECTIONS.map((section) => section.code);
    return order
      .filter((code) => bySection.has(code))
      .map((code) => {
        const sheet = sheetSections.find((section) => section.code === code);
        const sectionDef = PERFORMANCE_SECTIONS.find((section) => section.code === code);
        const items = [...bySection.get(code)!].sort((a, b) => {
          const ai = SCORING_POINT_ORDER.get(a.dimensionCode ?? '') ?? 999;
          const bi = SCORING_POINT_ORDER.get(b.dimensionCode ?? '') ?? 999;
          return ai - bi;
        });
        return {
          code,
          title: sheet?.title ?? sectionDef?.title ?? items[0]?.sectionTitle ?? code,
          score: sheet?.score ?? items.reduce((sum, fi) => sum + fi.totalScore, 0),
          maxScore: sheet?.maxScore ?? sectionDef?.maxScore ?? 0,
          excelOrder: sectionDef?.excelOrder ?? 99,
          items,
        };
      });
  }, [factsData]);

  const appealCascadeGroups = useMemo(
    () => groupAppealCascadeItems(
      (factsData?.items ?? []).map((fi) => ({
        itemId: fi.itemId,
        itemTitle: fi.itemTitle,
        sectionTitle: fi.sectionTitle ?? '系统导入',
        sectionCode: fi.sectionCode,
        dimensionCode: fi.dimensionCode,
        totalScore: fi.totalScore,
      })),
    ),
    [factsData],
  );

  const savedAppeals = useMemo(
    () => (factsData?.items ?? []).filter((fi) => factsConfirmations[fi.itemId] === 'DISPUTED'),
    [factsData, factsConfirmations],
  );

  const modalFactItem = useMemo(
    () => (factsData?.items ?? []).find((fi) => fi.itemId === modalItemId) ?? null,
    [factsData, modalItemId],
  );

  const availableAppealItems = useMemo(() => {
    const appealed = new Set(
      savedAppeals.map((fi) => fi.itemId).filter((id) => id !== editingAppealItemId),
    );
    return (factsData?.items ?? []).filter(
      (fi) => isAppealableDimensionCode(fi.dimensionCode) && !appealed.has(fi.itemId),
    );
  }, [factsData, savedAppeals, editingAppealItemId]);

  const modalSectionItems = useMemo(() => {
    const pool = editingAppealItemId
      ? (factsData?.items ?? []).filter((fi) => isAppealableDimensionCode(fi.dimensionCode))
      : availableAppealItems;
    return pool.filter((fi) => (fi.sectionTitle ?? '系统导入') === modalSectionTitle);
  }, [factsData, availableAppealItems, editingAppealItemId, modalSectionTitle]);

  const factsScoreTotal = useMemo(
    () => factsData?.items.reduce((s, fi) => s + fi.totalScore, 0) ?? 0,
    [factsData],
  );

  const total = useMemo(
    () => factsScoreTotal + Object.values(answers).reduce((s, a) => {
      if (systemFilledItemIds.has(a.itemId)) return s;
      const it = itemById.get(a.itemId);
      return s + (it
        ? computeItemScore(
          { scoreMode: it.scoreMode ?? 'TIERS', maxScore: it.maxScore ?? null },
          a.selected,
        )
        : a.selected.reduce((x, y) => x + y.score, 0));
    }, 0),
    [answers, itemById, factsScoreTotal, systemFilledItemIds],
  );

  const workYears = useMemo(() => {
    const hire = parseDateOnly(header.hireDate || undefined);
    if (!hire) return null;
    return calculateFullWorkYears(hire, evaluationCutoffDate(tpl?.year ?? new Date().getFullYear()));
  }, [header.hireDate, tpl?.year]);

  const calculatedDeclarationLevel = useMemo(() => {
    const hire = parseDateOnly(displayHireDate !== '—' ? displayHireDate : undefined)
      ?? parseDateOnly(header.hireDate || undefined);
    if (!hire) return null;
    return levelFromHireDate(
      hire,
      evaluationCutoffDate(tpl?.year ?? new Date().getFullYear()),
    );
  }, [displayHireDate, header.hireDate, tpl?.year]);

  const displayParticipationLevel = useMemo(() => {
    const tier = factsData?.scoreSheet?.declarationTier ?? calculatedDeclarationLevel;
    const label = formatDeclarationLevelDisplay(tier);
    return label ? `能级评价${label}` : '—';
  }, [factsData, calculatedDeclarationLevel]);

  const displayCalculatedLevel = useMemo(
    () => formatDeclarationLevelDisplay(calculatedDeclarationLevel) ?? '',
    [calculatedDeclarationLevel],
  );

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

  const setDeclaredScore = (itemId: string, value: string) => {
    const score = value === '' ? null : Number(value);
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], declaredScore: Number.isFinite(score) ? score : null },
    }));
  };

  const upload = async (itemId: string, files: FileList | null, opts?: { isFact?: boolean }) => {
    if (!files || !files.length) return;
    if (!sub?.id) { alert('请先保存草稿后再上传附件'); return; }
    const submissionItemId = answers[itemId]?.id ?? factsItemDbIds[itemId];
    if (!submissionItemId) { alert('请先保存草稿后再上传附件'); return; }
    const fd = new FormData();
    fd.append('submissionItemId', submissionItemId);
    Array.from(files).forEach((f) => fd.append('files', f));
    const r = await fetch('/api/attachments', { method: 'POST', body: fd });
    if (!r.ok) { alert('上传失败'); return; }
    const d = await r.json();
    const newAtts = d.attachments ?? [];
    if (opts?.isFact) {
      setFactsAttachments((prev) => ({
        ...prev,
        [itemId]: [...(prev[itemId] ?? []), ...newAtts],
      }));
    } else {
      setAnswers((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], attachments: [...(prev[itemId].attachments ?? []), ...newAtts] },
      }));
    }
  };

  const buildItemsPayload = (override?: {
    confirmations?: Record<string, 'CONFIRMED' | 'DISPUTED'>;
    disputes?: Record<string, string>;
    claimedScores?: Record<string, number>;
  }) => {
    const confs = override?.confirmations ?? factsConfirmations;
    const disps = override?.disputes ?? factsDisputes;
    const claimed = override?.claimedScores ?? factsClaimedScores;
    return [
      ...Object.values(answers).map((a) => ({
        itemId: a.itemId,
        selected: a.selected,
        content: a.content,
        declaredScore: a.declaredScore ?? undefined,
      })),
      ...(factsData?.items ?? []).map((fi) => ({
        itemId: fi.itemId,
        selected: fi.facts.map((f, index) => ({
          index,
          label: `${f.defectLevel || f.role || ''} ${f.defectRef || f.label || ''}`.trim() || fi.itemTitle,
          score: f.score,
        })),
        isSystemFilled: true as const,
        confirmationStatus: confs[fi.itemId] === 'DISPUTED' ? 'DISPUTED' as const : null,
        disputeReason: disps[fi.itemId] ?? null,
        disputeClaimedScore: claimed[fi.itemId] ?? null,
      })),
    ];
  };

  const refreshSubmissionFromServer = async (): Promise<Record<string, string>> => {
    const subRes = await fetch(`/api/submissions?templateId=${templateId}`).then((r) => r.json());
    const existing = subRes.submissions?.[0];
    if (!existing) return {};
    setSub({
      id: existing.id,
      status: existing.status,
      preReviewMessages: Array.isArray(existing.preReviewMessages) ? existing.preReviewMessages : null,
    });
    const dbIds: Record<string, string> = {};
    const factAtts: Record<string, Attachment[]> = {};
    const confs: Record<string, 'CONFIRMED' | 'DISPUTED'> = {};
    const disps: Record<string, string> = {};
    const claimed: Record<string, number> = {};
    for (const si of existing.items ?? []) {
      if (!(si as { isSystemFilled?: boolean }).isSystemFilled) continue;
      if (si.id) dbIds[si.itemId] = si.id;
      if (si.attachments?.length) factAtts[si.itemId] = si.attachments;
      const conf = (si as { confirmationStatus?: 'CONFIRMED' | 'DISPUTED' }).confirmationStatus;
      if (conf) confs[si.itemId] = conf;
      const reason = (si as { disputeReason?: string }).disputeReason;
      if (reason) disps[si.itemId] = reason;
      const score = (si as { disputeClaimedScore?: string | number }).disputeClaimedScore;
      if (score != null) claimed[si.itemId] = Number(score);
    }
    setFactsItemDbIds(dbIds);
    setFactsAttachments(factAtts);
    setFactsConfirmations(confs);
    setFactsDisputes(disps);
    setFactsClaimedScores(claimed);
    return dbIds;
  };

  const persistDraft = async (opts?: {
    submitMode?: 'APPEAL';
    appeal?: {
      confirmations?: Record<string, 'CONFIRMED' | 'DISPUTED'>;
      disputes?: Record<string, string>;
      claimedScores?: Record<string, number>;
    };
  }) => {
    const confs = opts?.appeal?.confirmations ?? factsConfirmations;
    const hasDisputed = Object.values(confs).some((s) => s === 'DISPUTED');
    const r = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId,
        submit: false,
        ...header,
        ...(opts?.submitMode || (appealCentric && hasDisputed) ? { submitMode: opts?.submitMode ?? 'APPEAL' } : {}),
        items: buildItemsPayload(opts?.appeal),
      }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `保存失败（${r.status}）`);
    }
    const dbIds = await refreshSubmissionFromServer();
    return { dbIds, data: await r.json().catch(() => ({})) };
  };

  const closeAppealModal = () => {
    setAppealModalOpen(false);
    setEditingAppealItemId(null);
    setModalSectionTitle('');
    setModalItemId('');
    setModalReason('');
    setModalClaimedScore('');
    setModalPendingFiles([]);
  };

  const openAppealModal = (itemId?: string) => {
    if (itemId) {
      const fi = factsData?.items.find((row) => row.itemId === itemId);
      setEditingAppealItemId(itemId);
      setModalSectionTitle(fi?.sectionTitle ?? '');
      setModalItemId(itemId);
      setModalReason(factsDisputes[itemId] ?? '');
      setModalClaimedScore(
        factsClaimedScores[itemId] != null
          ? String(factsClaimedScores[itemId])
          : fi != null
            ? String(fi.totalScore)
            : '',
      );
    } else {
      setEditingAppealItemId(null);
      const firstGroup = appealCascadeGroups[0];
      const firstItem = availableAppealItems.find((fi) => fi.sectionTitle === firstGroup?.sectionTitle)
        ?? availableAppealItems[0];
      setModalSectionTitle(firstItem?.sectionTitle ?? firstGroup?.sectionTitle ?? '');
      setModalItemId(firstItem?.itemId ?? '');
      setModalReason('');
      setModalClaimedScore(firstItem != null ? String(firstItem.totalScore) : '');
    }
    setModalPendingFiles([]);
    setAppealModalOpen(true);
  };

  const saveAppealFromModal = async () => {
    if (!modalItemId) {
      alert('请选择申诉项');
      return;
    }
    if (!modalReason.trim()) {
      alert('请填写申诉说明');
      return;
    }
    const claimed = Number(modalClaimedScore);
    if (!Number.isFinite(claimed)) {
      alert('请填写申诉分值（主张分）');
      return;
    }
    const existingAttCount = factsAttachments[modalItemId]?.length ?? 0;
    if (existingAttCount === 0 && modalPendingFiles.length === 0) {
      alert('请上传申诉证明材料');
      return;
    }

    setBusy(true);
    try {
      const nextAppeal = {
        confirmations: { ...factsConfirmations, [modalItemId]: 'DISPUTED' as const },
        disputes: { ...factsDisputes, [modalItemId]: modalReason.trim() },
        claimedScores: { ...factsClaimedScores, [modalItemId]: claimed },
      };

      let dbIds = factsItemDbIds;
      if (modalPendingFiles.length > 0) {
        if (!dbIds[modalItemId]) {
          const boot = await persistDraft();
          dbIds = boot.dbIds;
        }
        const dbId = dbIds[modalItemId];
        if (!dbId) throw new Error('申诉项尚未创建，请稍后重试');
        const fd = new FormData();
        fd.append('submissionItemId', dbId);
        modalPendingFiles.forEach((f) => fd.append('files', f));
        const uploadRes = await fetch('/api/attachments', { method: 'POST', body: fd });
        if (!uploadRes.ok) throw new Error('附件上传失败');
        const uploadData = await uploadRes.json();
        const newAtts = uploadData.attachments ?? [];
        setFactsAttachments((prev) => ({
          ...prev,
          [modalItemId]: [...(prev[modalItemId] ?? []), ...newAtts],
        }));
      }

      setFactsConfirmations(nextAppeal.confirmations);
      setFactsDisputes(nextAppeal.disputes);
      setFactsClaimedScores(nextAppeal.claimedScores);

      await persistDraft({ submitMode: 'APPEAL', appeal: nextAppeal });

      closeAppealModal();
      setSaveNotice('申诉已保存，尚未送审。请确认全部申诉项后点击「提交申诉审核」。');
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存申诉失败');
    } finally {
      setBusy(false);
    }
  };

  const deleteAppeal = async (itemId: string) => {
    if (!confirm('确定删除该申诉？')) return;
    const nextAppeal = {
      confirmations: { ...factsConfirmations },
      disputes: { ...factsDisputes },
      claimedScores: { ...factsClaimedScores },
    };
    delete nextAppeal.confirmations[itemId];
    delete nextAppeal.disputes[itemId];
    delete nextAppeal.claimedScores[itemId];
    setFactsConfirmations(nextAppeal.confirmations);
    setFactsDisputes(nextAppeal.disputes);
    setFactsClaimedScores(nextAppeal.claimedScores);
    setFactsAttachments((prev) => {
      const { [itemId]: _removed, ...next } = prev;
      return next;
    });
    setBusy(true);
    try {
      const hasDisputed = Object.values(nextAppeal.confirmations).some((s) => s === 'DISPUTED');
      await persistDraft(hasDisputed ? { submitMode: 'APPEAL', appeal: nextAppeal } : { appeal: nextAppeal });
    } catch (err) {
      alert(err instanceof Error ? err.message : '删除申诉失败');
    } finally {
      setBusy(false);
    }
  };

  const save = async (submit: boolean, opts?: { submitMode?: 'AFFIRM' | 'APPEAL' }) => {
    if (!tpl) return;
    if (submit) {
      const missing: string[] = [];
      if (requireHeader('workArea') && !header.workAreaId) missing.push('工区');
      if (requireHeader('hireDate') && !header.hireDate) missing.push('入职时间');
      if (requireHeader('declarationLevel') && !header.declarationLevelId) missing.push('能级评价等级');
      if ((is2026AppealView || requireHeader('declarationSpecialty')) && !header.declarationSpecialtyId) {
        missing.push('申报专业');
      }
      tpl.sections.forEach((s) => s.items.forEach((it) => {
        if (isLocked(it.id) || systemFilledItemIds.has(it.id)) return;
        const a = answers[it.id];
        const employeeFactItem = Boolean(it.dimensionCode);
        if (employeeFactItem) {
          if (!a?.content?.trim()) missing.push(`${it.title}（缺事实说明）`);
          if (a?.declaredScore == null) missing.push(`${it.title}（缺申报分数）`);
          if (!(a?.attachments?.length)) missing.push(`${it.title}（缺截图证明）`);
          return;
        }
        if (it.isRequired && !a.selected.length) missing.push(it.title);
        else if (a.selected.length && it.requireAttachment && !(a.attachments?.length)) missing.push(`${it.title}（缺附件）`);
      }));
      if (missing.length) { alert('请补全：\n' + missing.join('\n')); return; }
      if (!appealCentric) {
        const missingFactConfirm = (factsData?.items ?? []).filter(
          (fi) => !factsConfirmations[fi.itemId],
        );
        if (missingFactConfirm.length > 0) {
          alert('请对以下系统填充项选择「确认」或「申诉」：\n' + missingFactConfirm.map((fi) => fi.itemTitle).join('\n'));
          return;
        }
        const missingDisputeReason = (factsData?.items ?? []).filter(
          (fi) => factsConfirmations[fi.itemId] === 'DISPUTED' && !(factsDisputes[fi.itemId] ?? '').trim(),
        );
        if (missingDisputeReason.length > 0) {
          alert('请为以下申诉项填写原因：\n' + missingDisputeReason.map((fi) => fi.itemTitle).join('\n'));
          return;
        }
        const missingDisputeAtt = (factsData?.items ?? []).filter(
          (fi) => factsConfirmations[fi.itemId] === 'DISPUTED' && !(factsAttachments[fi.itemId]?.length),
        );
        if (missingDisputeAtt.length > 0) {
          alert('请为以下申诉项上传证明材料（需先保存草稿）：\n' + missingDisputeAtt.map((fi) => fi.itemTitle).join('\n'));
          return;
        }
      }
    }
    setBusy(true);
    const r = await fetch('/api/submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId, submit,
        ...header,
        ...(opts?.submitMode ? { submitMode: opts.submitMode } : {}),
        items: buildItemsPayload(),
      }),
    });
    setBusy(false);
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert('保存失败：' + (e.error || r.status)); return; }
    const d = await r.json().catch(() => ({}));
    if (submit && d.finalized) {
      const suffix = d.preReviewMessages?.length
        ? '\n自动预审提示：\n' + d.preReviewMessages.join('\n')
        : '';
      alert(`已确认无异议，年度绩效档案已生成。${suffix}`);
      router.push('/app');
      return;
    }
    if (submit && d.preReviewWarnings) {
      alert('已提交一级审核。\n自动预审提示：\n' + (d.preReviewMessages ?? []).join('\n'));
      router.push('/app');
      return;
    }
    if (submit) { alert('已提交，等待审核'); router.push('/app'); return; }
    alert('草稿已保存');
    await refreshSubmissionFromServer();
  };

  const submitAppealCentric = (mode: 'AFFIRM' | 'APPEAL') => {
    if (mode === 'AFFIRM' && savedAppeals.length > 0) return;
    if (mode === 'APPEAL' && savedAppeals.length === 0) return;
    const message = mode === 'AFFIRM'
      ? '确认对系统得分无异议并报名？确认后将直接生成年度绩效档案，不可再修改或申诉。'
      : '确认提交审核？仅已保存的申诉项将进入一级审核队列。';
    if (!confirm(message)) return;
    void save(true, { submitMode: mode });
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

  const editable = !sub?.status || sub.status === 'DRAFT' || sub.status === 'REJECTED';
  const itemEditable = editable;
  const statusMap: Record<string, string> = {
    SUBMITTED: '待审核', L1_APPROVED: '一审通过', L2_APPROVED: '终审通过',
  };

  type FactItem = NonNullable<typeof factsData>['items'][number];

  const renderDerivationCell = (fi: FactItem) => {
    if (fi.factKind === 'profile' || !fi.derivation) {
      return <span className="text-slate-400">—</span>;
    }
    const preview = truncateDerivationPreview(formatDerivationPreview(fi.derivation));
    const expanded = expandedItems.has(fi.itemId);
    return (
      <div className="min-w-0">
        <p className="break-words text-slate-600">{preview}</p>
        <button
          type="button"
          onClick={() => toggleExpand(fi.itemId)}
          className="mt-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-700"
        >
          {expanded ? '收起' : '展开'}
        </button>
        {expanded && (
          <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            {fi.derivation.steps.filter((s) => s.kind === 'note').map((s, i) => (
              <p key={`note-${i}`} className="rounded-md bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800">
                ⚠ {s.label}
              </p>
            ))}
            <div>
              <p className="text-xs font-semibold text-slate-600">原始台账明细</p>
              <div className="mt-1 space-y-0.5">
                {fi.derivation.rawFactFields.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无导入事实</p>
                ) : (
                  fi.derivation.rawFactFields.map((rf) => (
                    <p key={rf.id} className="text-xs text-slate-500">
                      {rf.thirdLevelTitle && <span className="font-medium">{rf.thirdLevelTitle}</span>}
                      {rf.defectLevel && ` · ${rf.defectLevel}`}
                      {rf.defectRef && ` · ${rf.defectRef}`}
                      {rf.role && ` · ${rf.role}`}
                      {rf.tierValue && ` · 档位 ${rf.tierValue}`}
                      {rf.eventDate && ` · ${String(rf.eventDate).slice(0, 10)}`}
                      {' → '}<b>{rf.score} 分</b>
                      {rf.sourceFile && <span className="text-slate-400"> · 来源：{rf.sourceFile}</span>}
                    </p>
                  ))
                )}
              </div>
            </div>
            <div className="border-t border-slate-200 pt-2">
              <p className="text-xs font-semibold text-slate-600">计分规则</p>
              <p className="mt-0.5 text-xs text-slate-500">{fi.derivation.ruleSummary}</p>
              {fi.derivation.referenceFile && (
                <p className="mt-0.5 text-xs text-slate-400">参考台账：{fi.derivation.referenceFile}</p>
              )}
              {fi.derivation.notes && (
                <p className="mt-0.5 text-xs text-amber-700">备注：{fi.derivation.notes}</p>
              )}
            </div>
            <div className="border-t border-slate-200 pt-2">
              <p className="text-xs font-semibold text-slate-600">积分过程</p>
              <ol className="mt-1 space-y-1">
                {fi.derivation.steps.filter((s) => s.kind !== 'note').map((s, i) => (
                  <li key={i} className={`flex items-start gap-2 text-xs ${
                    s.kind === 'final' ? 'font-semibold text-emerald-700' :
                    s.kind === 'cap' ? 'text-slate-600' :
                    s.kind === 'subtotal' ? 'text-slate-600' :
                    'text-slate-500'
                  }`}>
                    <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-medium text-slate-600">
                      {i + 1}
                    </span>
                    <span>
                      {s.label}
                      {s.detail && <span className="ml-1 text-slate-400">（{s.detail}）</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLeafCriterion = (fi: FactItem, fact?: FactItem['facts'][number]) => {
    if (!fact) return fi.ruleSummary ?? fi.itemTitle;
    if (fi.factKind === 'basic') {
      const tier = fact.tierValue ? `档位 ${fact.tierValue}` : '';
      return [fact.thirdLevelTitle ?? fact.label ?? fi.itemTitle, tier].filter(Boolean).join(' · ');
    }
    if (fi.factKind === 'profile') {
      return fact.thirdLevelTitle ?? '参加工作时间';
    }
    const parts = [
      fact.thirdLevelTitle ?? fact.label,
      fact.defectLevel,
      fact.role === 'FIRST_DISCOVERER' ? '第一发现人'
        : fact.role === 'CO_DISCOVERER' ? '共同发现人'
          : fact.role === 'FIRST_HANDLER' ? '第一处理人'
            : fact.role === 'CO_HANDLER' ? '共同处理人'
              : fact.role,
      fact.defectRef,
    ].filter(Boolean);
    return parts.join(' · ') || fi.itemTitle;
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/app" className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 cursor-pointer">
            ← 返回
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {tpl.year === 2026 ? FORM_2026_TITLE : tpl.title}
          </h1>
          {tpl.year === 2026 ? (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-relaxed text-blue-900">
              {FORM_2026_DESCRIPTION}
            </div>
          ) : tpl.description ? (
            <p className="mt-1 text-sm text-slate-500">{tpl.description}</p>
          ) : null}
          <Link
            href="/app/scoring-guide"
            className="mt-2 inline-block text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
          >
            查看 2026 评分规则说明 →
          </Link>
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

      {saveNotice && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {saveNotice}
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
        {factsData?.scoreSheet?.sections && factsData.scoreSheet.sections.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {factsData.scoreSheet.sections
              .filter((section) => section.code !== 'special')
              .map((section) => (
                <span key={section.code} className="rounded-full bg-slate-100 px-2.5 py-0.5 tabular-nums text-slate-600">
                  {section.title} {section.score.toFixed(1)}/{section.maxScore}
                </span>
              ))}
            {(factsData.scoreSheet.deductionScore ?? 0) > 0 && (
              <span className="rounded-full bg-red-50 px-2.5 py-0.5 tabular-nums text-red-700">
                扣分 −{factsData.scoreSheet.deductionScore!.toFixed(1)}
              </span>
            )}
          </div>
        )}
      </div>

      {is2026AppealView && (
        <section className="mt-5 rounded-xl border border-primary-200 bg-primary-50/40 p-5">
          <h2 className="font-semibold text-slate-900">申报专业与参评能级</h2>
          <p className="mt-1 text-xs text-slate-600">
            请先选择本人申报专业；参加工作时间由员工花名册导入（只读）。系统按年度评价截止日（当年 7 月 31 日）自动计算工龄与能级评价等级。
          </p>
          <label className="mt-4 block text-sm">
            <span className="font-medium text-slate-700">
              申报专业
              <span className="ml-1 text-red-500">*</span>
            </span>
            <select
              value={header.declarationSpecialtyId}
              disabled={!editable || options.declarationSpecialties.length === 0}
              onChange={(e) => setHeader((h) => ({ ...h, declarationSpecialtyId: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50 sm:max-w-md"
            >
              <option value="">请选择申报专业</option>
              {options.declarationSpecialties.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name}</option>
              ))}
            </select>
            {options.declarationSpecialties.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">尚未配置申报专业，请联系管理员在组织架构中维护。</p>
            )}
          </label>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
              <dt className="text-xs font-medium text-slate-500">参加工作时间</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{displayHireDate}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
              <dt className="text-xs font-medium text-slate-500">工作年限（整年）</dt>
              <dd className="mt-1 text-sm font-semibold tabular-nums text-slate-900">
                {participationWorkYears != null ? `${participationWorkYears} 年` : '—'}
              </dd>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 sm:col-span-1">
              <dt className="text-xs font-medium text-emerald-800">自动计算的能级评价等级</dt>
              <dd className="mt-1 text-lg font-bold tabular-nums text-emerald-900">
                {displayParticipationLevel}
              </dd>
              <p className="mt-1 text-[11px] text-emerald-700/80">由参加工作时间自动得出，不可手工修改</p>
            </div>
          </dl>
        </section>
      )}

      {!is2026AppealView && headerFields.filter((f) => f.enabled).length > 0 && (
        <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">能级评价申报信息</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {showHeader('declarationSpecialty') && (
              <label className="text-sm sm:col-span-2">
                <span className="font-medium text-slate-600">
                  申报专业
                  {requireHeader('declarationSpecialty') && <span className="ml-1 text-red-500">*</span>}
                </span>
                <select value={header.declarationSpecialtyId}
                  disabled={!editable || options.declarationSpecialties.length === 0}
                  onChange={(e) => setHeader((h) => ({ ...h, declarationSpecialtyId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50">
                  <option value="">请选择申报专业</option>
                  {options.declarationSpecialties.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </select>
              </label>
            )}
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
                    参加工作时间
                    {requireHeader('hireDate') && <span className="ml-1 text-red-500">*</span>}
                  </span>
                  <input type="date" value={header.hireDate}
                    disabled={!editable}
                    onChange={(e) => setHeader((h) => ({ ...h, hireDate: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />
                </label>
                <label className="text-sm">
                  <span className="font-medium text-slate-600">工作年限（年）</span>
                  <input type="text" value={workYears ?? ''} readOnly
                    placeholder="填写参加工作时间后自动计算"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600" />
                </label>
                <label className="text-sm">
                  <span className="font-medium text-slate-600">自动计算的能级评价等级</span>
                  <input type="text" value={displayCalculatedLevel} readOnly
                    placeholder="填写参加工作时间后自动计算"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-700" />
                  <p className="mt-0.5 text-xs text-slate-400">系统按参加工作时间自动计算（展示为 1/2/3 级），不能手工选择。</p>
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
          </div>
        </section>
      )}

      {/* 系统自动填充项：评价维度 → 评分项 → 评价标准与计算过程 */}
      {appealCentric && groupedFactSections.length > 0 && (
        <div className="mt-5 space-y-5">
          <p className="text-xs text-slate-500">
            按量化积分表层级展示：评价维度 → 评分项 → 评价标准与计算过程。
          </p>
          {groupedFactSections.map((section) => (
            <section key={section.code} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-100/90 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                      评价维度
                    </span>
                    <h2 className="text-base font-semibold text-slate-900">
                      {section.excelOrder}. {section.title}
                    </h2>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    下含 {section.items.length} 个评分项
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] font-medium tracking-wide text-slate-500">维度得分</p>
                  <p className="text-sm font-bold tabular-nums text-slate-900">
                    {section.score.toFixed(1)}
                    {section.maxScore > 0 && (
                      <span className="font-normal text-slate-500"> / {section.maxScore}</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="space-y-3 bg-slate-50/60 p-3 sm:p-4">
                {section.items.map((fi) => {
                  const disputed = factsConfirmations[fi.itemId] === 'DISPUTED';
                  const leafRows = fi.facts.length > 0
                    ? fi.facts
                    : [{ id: `${fi.itemId}-empty`, score: fi.totalScore }];
                  const standard = fi.dimensionCode
                    ? SCORING_STANDARDS.find((row) => row.code === fi.dimensionCode)
                    : undefined;
                  return (
                    <div
                      key={fi.itemId}
                      className={`rounded-lg border bg-white ${
                        disputed ? 'border-amber-300 shadow-sm shadow-amber-100' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-primary-700 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                              评分项
                            </span>
                            <h3 className="text-sm font-semibold text-slate-800">{fi.itemTitle}</h3>
                            {disputed && (
                              <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                                申诉中
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {formatEvaluationDimensionLabel(section.title, fi.itemTitle)}
                            {standard?.maxScore != null && standard.maxScore > 0 && (
                              <>
                                <span className="mx-1 text-slate-300">·</span>
                                满分 {standard.maxScore}
                              </>
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] font-medium text-slate-500">评分项得分</p>
                          <p className={`text-sm font-bold tabular-nums ${disputed ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {fi.totalScore.toFixed(1)} 分
                          </p>
                        </div>
                      </div>

                      <div className="px-4 py-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-[11px] font-medium text-slate-600">评价标准与计算过程</span>
                        </div>
                        <div className="overflow-x-auto rounded-md border border-slate-100">
                          <table className="w-full min-w-[28rem] text-left text-xs">
                            <thead>
                              <tr className="bg-slate-50 text-slate-500">
                                <th className="px-3 py-2 font-medium">评价标准</th>
                                <th className="w-16 px-3 py-2 font-medium">得分</th>
                                <th className="px-3 py-2 font-medium">计算过程</th>
                              </tr>
                            </thead>
                            <tbody className="text-slate-600">
                              {leafRows.map((fact, index) => (
                                <tr key={fact.id} className="border-t border-slate-100 align-top">
                                  <td className="px-3 py-2">
                                    {fi.facts.length === 0 && index === 0 ? (
                                      <span className="text-amber-700">暂无部门台账导入记录（当前按 0 分计入）</span>
                                    ) : (
                                      renderLeafCriterion(fi, fi.facts.length > 0 ? fact : undefined)
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-medium tabular-nums">{Number(fact.score).toFixed(1)}</td>
                                  <td className="px-3 py-2">{index === 0 ? renderDerivationCell(fi) : null}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {appealCentric && savedAppeals.length > 0 && itemEditable && (
        <section className="mt-5 rounded-xl border border-amber-200 bg-amber-50/60 p-5">
          <h2 className="text-sm font-semibold text-amber-900">已保存的申诉（{savedAppeals.length}）</h2>
          <ul className="mt-3 space-y-2">
            {savedAppeals.map((fi) => (
              <li key={fi.itemId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-amber-200 bg-white px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{fi.itemTitle}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {formatEvaluationDimensionLabel(fi.sectionTitle, fi.itemTitle)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    系统分 {fi.totalScore.toFixed(1)} → 主张分 {factsClaimedScores[fi.itemId]?.toFixed(1) ?? '—'}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{factsDisputes[fi.itemId]}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => openAppealModal(fi.itemId)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteAppeal(fi.itemId)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-5 space-y-6">
        {tpl.sections.map((sec) => {
          const manualItems = sec.items.filter((it) => !systemFilledItemIds.has(it.id));
          if (manualItems.length === 0) return null;
          return (
          <section key={sec.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">{sec.title}</h2>
            {sec.description && <p className="mt-1 text-xs text-slate-400">{sec.description}</p>}
            <div className="mt-4 space-y-5">
              {manualItems.map((it) => {
                const a = answers[it.id]; const locked = isLocked(it.id);
                const rejected = a?.status === 'REJECTED';
                const employeeFactItem = Boolean(it.dimensionCode);
                const deductionItem = it.dimensionCode?.startsWith('special.');
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

                    {employeeFactItem ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 sm:grid-cols-[1fr_160px]">
                        <div>
                          <p className="text-sm font-semibold text-blue-950">暂无系统导入事实，请自行申报</p>
                          <p className="mt-1 text-xs leading-relaxed text-blue-800">填写可核验的事实经过，并按上方评分标准填写申报分数；提交前须先保存草稿并上传截图证明。一级、二级审核通过后计入最终总分。</p>
                        </div>
                        <label className="text-xs font-medium text-blue-900">{deductionItem ? '申报扣分（不得大于 0 分）' : `申报分数（最高 ${it.maxScore ?? 0} 分）`}
                          <input type="number" min={deductionItem ? undefined : 0} max={deductionItem ? 0 : it.maxScore ?? undefined} step="0.1"
                            value={a?.declaredScore ?? ''}
                            disabled={!itemEditable || locked}
                            onChange={(e) => setDeclaredScore(it.id, e.target.value)}
                            className="mt-1 block w-full rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-slate-100" />
                        </label>
                      </div>
                    ) : it.scoreMode === 'COUNTED' ? (
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
                            {computeItemScore(
                              { scoreMode: it.scoreMode ?? 'TIERS', maxScore: it.maxScore ?? null },
                              a?.selected ?? [],
                            ).toFixed(1)} 分
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
                      placeholder={employeeFactItem ? '事实说明（必填：时间、事项、本人角色及可核验依据）' : '备注说明（可选）'}
                      rows={2}
                      className="mt-3 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />

                    {(it.requireAttachment || employeeFactItem) && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-slate-600">{employeeFactItem ? '截图证明（提交前必传，上传至 MinIO）' : '证明材料'}</p>
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
                              {employeeFactItem ? '请上传截图或扫描件；单文件 ≤10MB' : '仅支持 PDF、图片、Word/Excel、TXT，单文件 ≤10MB'}
                            </p>
                            <input
                              type="file"
                              multiple
                              accept={employeeFactItem ? 'image/*' : UPLOAD_ACCEPT}
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
          );
        })}
      </div>

      {editable && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-slate-200 bg-white px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {appealCentric && itemEditable && (
                <button
                  type="button"
                  onClick={() => openAppealModal()}
                  disabled={busy || availableAppealItems.length === 0}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  申诉
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => save(false)}
                disabled={busy}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {busy ? '保存中…' : '保存草稿'}
              </button>
              {appealCentric ? (
                <>
                  <button
                    type="button"
                    onClick={() => submitAppealCentric('AFFIRM')}
                    disabled={busy || savedAppeals.length > 0}
                    title={savedAppeals.length > 0 ? '存在已保存申诉时不可确认报名' : undefined}
                    className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? '提交中…' : '确认报名'}
                  </button>
                  <button
                    type="button"
                    onClick={() => submitAppealCentric('APPEAL')}
                    disabled={busy || savedAppeals.length === 0}
                    title={savedAppeals.length === 0 ? '请先保存至少一项申诉' : undefined}
                    className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? '提交中…' : '提交审核'}
                  </button>
                </>
              ) : (
                <button
                  onClick={() => save(true)}
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  {busy ? '提交中…' : '提交审核'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {appealModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="appeal-modal-title"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="appeal-modal-title" className="text-lg font-semibold">
                {editingAppealItemId ? '编辑申诉' : '新增申诉'}
              </h2>
              <button
                type="button"
                onClick={closeAppealModal}
                className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                关闭
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">评价维度</span>
                <select
                  value={modalSectionTitle}
                  disabled={!!editingAppealItemId}
                  onChange={(e) => {
                    const sectionTitle = e.target.value;
                    setModalSectionTitle(sectionTitle);
                    const pool = editingAppealItemId
                      ? (factsData?.items ?? []).filter((fi) => isAppealableDimensionCode(fi.dimensionCode))
                      : availableAppealItems;
                    const first = pool.find((fi) => (fi.sectionTitle ?? '系统导入') === sectionTitle);
                    setModalItemId(first?.itemId ?? '');
                    setModalClaimedScore(first != null ? String(first.totalScore) : '');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                >
                  {appealCascadeGroups.map((g) => (
                    <option key={g.sectionTitle} value={g.sectionTitle}>{g.sectionTitle}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">评分项</span>
                <select
                  value={modalItemId}
                  disabled={!!editingAppealItemId}
                  onChange={(e) => {
                    const itemId = e.target.value;
                    setModalItemId(itemId);
                    const fi = factsData?.items.find((row) => row.itemId === itemId);
                    if (fi) setModalClaimedScore(String(fi.totalScore));
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                >
                  {modalSectionItems.map((fi) => (
                    <option key={fi.itemId} value={fi.itemId}>{fi.itemTitle}</option>
                  ))}
                </select>
                <p className="mt-0.5 text-xs text-slate-400">
                  先选评价维度（如工作现场），再选其下评分项（如两票执行）；共 11 项，参加工作时间不可申诉。
                </p>
              </label>
              {modalFactItem && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-slate-600">系统得分（只读）</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">
                    {modalFactItem.totalScore.toFixed(1)} 分
                  </p>
                </div>
              )}
              <label className="block text-sm">
                <span className="font-medium text-slate-700">申诉分值（主张分）</span>
                <input
                  type="number"
                  step="0.1"
                  value={modalClaimedScore}
                  onChange={(e) => setModalClaimedScore(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-700">申诉说明</span>
                <textarea
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  rows={4}
                  placeholder="请说明申诉理由（审核员可见）"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <div>
                <p className="text-sm font-medium text-slate-700">证明材料</p>
                <ul className="mt-1 space-y-0.5">
                  {(factsAttachments[modalItemId] ?? []).map((at) => (
                    <li key={at.id} className="text-xs text-slate-600">{at.filename}</li>
                  ))}
                </ul>
                <input
                  type="file"
                  multiple
                  accept={UPLOAD_ACCEPT}
                  onChange={(e) => setModalPendingFiles(e.target.files ? Array.from(e.target.files) : [])}
                  className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-100 file:px-3 file:py-1 file:text-xs cursor-pointer"
                />
                {modalPendingFiles.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">待上传 {modalPendingFiles.length} 个文件</p>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeAppealModal}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveAppealFromModal}
                disabled={busy}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
              >
                {busy ? '保存中…' : '保存申诉'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SupportPhoneFooter className="mt-8 pb-4" />
    </main>
  );
}
