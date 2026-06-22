'use client';
// 申报表可视化设计器
import { useCallback, useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';
import {
  TemplatePreviewModal,
  type PreviewTemplate,
  type ScoreOpt,
} from '@/components/template-preview';
import {
  type HeaderFieldConfig,
  type HeaderFieldKey,
  DEFAULT_HEADER_FIELDS,
  HEADER_FIELD_LABELS,
  resolveHeaderFields,
} from '@/lib/header-fields';
import {
  PERFORMANCE_SECTIONS,
  PERFORMANCE_SUB_DIMENSIONS,
  SUB_DIMENSION_BY_CODE,
  defaultSectionTitle,
  getPerformanceSection,
  isSubDimensionInSection,
  subDimensionsForSection,
  type PerformanceSectionCode,
} from '@/lib/performance-dimension-registry';

type ScoreMode = 'TIERS' | 'COUNTED';
interface Item {
  id?: string;
  title: string; hint?: string;
  isRequired: boolean; requireAttachment: boolean;
  maxSelections: number;
  scoreMode: ScoreMode;
  maxScore?: number | null;
  scoreOptions: ScoreOpt[];
  sortOrder: number;
  dimensionCode?: string | null;
}
interface Section {
  id?: string;
  sectionCode?: PerformanceSectionCode | null;
  maxScore?: number | null;
  title: string;
  description?: string;
  sortOrder: number;
  items: Item[];
}
interface Template {
  id: string; year: number; title: string; description?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  sections: Section[];
  headerFields?: HeaderFieldConfig[];
  _count?: { submissions: number };
}

type EditingState = {
  id?: string;
  year: number;
  title: string;
  description: string;
  headerFields: HeaderFieldConfig[];
  sections: Section[];
};

const inputClass =
  'rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const textareaClass =
  'rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

const btnOutline =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50 cursor-pointer disabled:opacity-50';

const btnDanger =
  'rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer';

const btnDashed =
  'w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 cursor-pointer';

function parseScoreOptions(raw: unknown): ScoreOpt[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    const row = o as { optionId?: string; label?: string; score?: number; description?: string };
    return { optionId: row.optionId, label: String(row.label ?? ''), score: Number(row.score ?? 0), description: row.description };
  });
}

function newOptionId() {
  return globalThis.crypto?.randomUUID?.() ?? `opt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function templateToEditing(t: Template | EditingState): EditingState {
  const sections = [...t.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s, sIdx) => ({
      id: s.id,
      sectionCode: (s as { sectionCode?: PerformanceSectionCode | null }).sectionCode ?? null,
      maxScore:
        (s as { maxScore?: number | string | null }).maxScore == null
          ? null
          : Number((s as { maxScore?: number | string | null }).maxScore),
      title: s.title,
      description: s.description ?? '',
      sortOrder: s.sortOrder ?? sIdx,
      items: [...s.items]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it, iIdx) => ({
          id: it.id,
          title: it.title,
          hint: it.hint ?? '',
          isRequired: it.isRequired,
          requireAttachment: it.requireAttachment,
          maxSelections: it.maxSelections,
          scoreMode: (it.scoreMode ?? 'TIERS') as ScoreMode,
          maxScore: it.maxScore == null ? null : Number(it.maxScore),
          scoreOptions: parseScoreOptions(it.scoreOptions),
          sortOrder: it.sortOrder ?? iIdx,
          dimensionCode: (it as any).dimensionCode ?? null,
        })),
    }));
  return {
    id: 'id' in t ? t.id : undefined,
    year: t.year,
    title: t.title,
    description: t.description ?? '',
    headerFields: resolveHeaderFields((t as any).headerFields),
    sections,
  };
}

function toPreviewTemplate(editing: EditingState): PreviewTemplate {
  return {
    year: editing.year,
    title: editing.title || '（未命名）',
    description: editing.description || undefined,
    headerFields: editing.headerFields,
    sections: editing.sections.map((s, sIdx) => ({
      ...s,
      sortOrder: sIdx,
      items: s.items.map((it, iIdx) => ({
        ...it,
        sortOrder: iIdx,
        scoreOptions: it.scoreOptions.length ? it.scoreOptions : [{ optionId: newOptionId(), label: '—', score: 0 }],
      })),
    })),
  };
}

const blankItem = (i = 0): Item => ({
  title: '', hint: '', isRequired: true, requireAttachment: true, maxSelections: 1, sortOrder: i,
  scoreMode: 'TIERS', maxScore: null, dimensionCode: null,
  scoreOptions: [
    { optionId: newOptionId(), label: '国家级', score: 10, description: '获得国家级奖项、荣誉或认定' },
    { optionId: newOptionId(), label: '省级', score: 6, description: '获得省部级奖项、荣誉或认定' },
    { optionId: newOptionId(), label: '市级', score: 3, description: '获得市级或公司级奖项' },
    { optionId: newOptionId(), label: '区/县级', score: 1, description: '获得区/县级或部门级表彰' },
  ],
});
const blankSection = (i = 0): Section => ({
  sectionCode: null,
  maxScore: null,
  title: '新章节',
  description: '',
  sortOrder: i,
  items: [blankItem(0)],
});

export default function TemplatesPage() {
  const [list, setList] = useState<Template[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [preview, setPreview] = useState<PreviewTemplate | null>(null);
  const [assignTpl, setAssignTpl] = useState<{ id: string; title: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  const load = async () => {
    setLoadError(null);
    try {
      const r = await fetch('/api/admin/templates');
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      setList(d.templates ?? []);
    } catch {
      setLoadError('加载失败，请检查网络连接');
    } finally {
      setDataLoaded(true);
    }
  };
  useEffect(() => { load(); }, []);

  const newTemplate = () => {
    setEditingId(null);
    setTextMode(false);
    setEditing({
      year: new Date().getFullYear(), title: `${new Date().getFullYear()}年度员工绩效申报表`,
      description: '请如实填写并上传对应证明材料',
      headerFields: [...DEFAULT_HEADER_FIELDS], sections: [blankSection(0)],
    });
  };

  const handleEdit = (t: Template) => {
    if (t.status === 'ARCHIVED') return;
    const subs = t._count?.submissions ?? 0;
    if (t.status === 'PUBLISHED' && subs > 0) {
      alert(
        `该模板已有 ${subs} 份员工申报，无法直接修改结构。\n如需纠正错别字，请点击「文字修订」；如需改结构，请「复制为草稿」。`,
      );
      return;
    }
    setEditingId(t.id);
    setTextMode(false);
    setEditing(templateToEditing(t));
  };

  // 文字修订：仅改文案，不改结构与分值（可用于已发布且有申报的模板）
  const startTextEdit = (t: Template) => {
    if (t.status === 'ARCHIVED') return;
    setEditingId(t.id);
    setTextMode(true);
    setEditing(templateToEditing(t));
  };

  const openPreview = (t: Template) => {
    setPreview(toPreviewTemplate(templateToEditing(t)));
  };

  const duplicateAsDraft = (t: Template) => {
    const base = templateToEditing(t);
    setEditingId(null);
    setTextMode(false);
    setEditing({
      ...base,
      id: undefined,
      title: `${base.title}（副本）`,
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) { alert('请填写标题'); return; }
    // 客户端预校验：避免提交明显不合法的数据
    if (!textMode) {
      for (const sec of editing.sections) {
        if (!sec.title.trim()) { alert('请填写章节标题'); return; }
        for (const it of sec.items) {
          if (!it.title.trim()) { alert('请填写申报项标题'); return; }
          if (
            it.dimensionCode &&
            sec.sectionCode &&
            !isSubDimensionInSection(it.dimensionCode, sec.sectionCode)
          ) {
            alert(`申报项「${it.title}」的二级维度与章节一级维度不匹配，请重新选择`);
            return;
          }
          if (it.scoreMode === 'COUNTED' && (it.maxScore == null || it.maxScore <= 0)) {
            alert(`申报项「${it.title}」：按次数计分必须设置大于 0 的上限分`);
            return;
          }
          for (const opt of it.scoreOptions) {
            if (!opt.label.trim()) { alert(`申报项「${it.title}」：分值档次名称不能为空`); return; }
          }
        }
      }
    }
    setSaving(true);
    try {
      let method: string;
      let body: unknown;
      if (textMode && editingId) {
        method = 'PUT';
        body = {
          id: editingId,
          mode: 'text',
          title: editing.title,
          description: editing.description,
          sections: editing.sections.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            items: s.items.map((it) => ({
              id: it.id,
              title: it.title,
              hint: it.hint,
              scoreOptions: it.scoreOptions.map((o) => ({ optionId: o.optionId, label: o.label, description: o.description })),
            })),
          })),
        };
      } else {
        method = editingId ? 'PUT' : 'POST';
        body = editingId ? { id: editingId, ...editing } : editing;
      }
      const r = await fetch('/api/admin/templates', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        if (Array.isArray(e.issues) && e.issues.length > 0) {
          const msgs = e.issues.map((i: any) => i.message).join('\n');
          alert('保存失败：\n' + msgs);
        } else {
          alert('保存失败：' + (e.error || r.statusText || `HTTP ${r.status}`));
        }
        return;
      }
      const saved = await r.json().catch(() => ({}));
      if (textMode) {
        setEditing(null);
        setEditingId(null);
        setTextMode(false);
        await load();
        alert('文字修订已保存');
        return;
      }
      if (!editingId && saved.id) {
        setEditingId(saved.id);
        await load();
        alert('已保存为草稿，可继续编辑或点击「预览」查看员工端效果');
        return;
      }
      setEditing(null);
      setEditingId(null);
      load();
    } catch {
      alert('保存失败：网络错误');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (id: string, status: Template['status']) => {
    if (status === 'ARCHIVED') return;
    const next = status === 'PUBLISHED' ? 'ARCHIVED' : 'PUBLISHED';
    if (!confirm(`确认将状态切换为 ${next === 'ARCHIVED' ? '已归档' : '已发布'}？`)) return;
    try {
      const r = await fetch('/api/admin/templates', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      });
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert('状态切换失败：' + (e.error || r.statusText || `HTTP ${r.status}`));
        return;
      }
      load();
    } catch {
      alert('状态切换失败：网络错误');
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`确认删除模板「${title}」？此操作不可撤销。`)) return;
    try {
      const r = await fetch('/api/admin/templates', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert('删除失败：' + (e.error || r.statusText || `HTTP ${r.status}`));
        return;
      }
      load();
    } catch {
      alert('删除失败：网络错误');
    }
  };

  if (editing) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        {preview && (
          <TemplatePreviewModal template={preview} onClose={() => setPreview(null)} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{textMode ? '文字修订' : editingId ? '编辑申报表' : '设计申报表'}</h1>
          <div className="flex flex-wrap gap-2">
            <AdminPageActions />
            <button
              type="button"
              onClick={() => setPreview(toPreviewTemplate(editing))}
              className={btnOutline}
            >
              预览
            </button>
            <button
              type="button"
              onClick={() => { setEditing(null); setEditingId(null); setTextMode(false); }}
              className={btnOutline}
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={btnPrimary}
            >
              {saving ? '保存中…' : textMode ? '保存修订' : editingId ? '保存修改' : '保存为草稿'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {textMode
            ? '文字修订模式：仅可修改标题、说明、提示与档次文案，分值与结构保持不变（适用于已发布且有申报的模板纠错别字）。'
            : '保存后可继续编辑；发布前建议先预览确认章节与分值档次。'}
        </p>

        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium text-slate-600">年度</span>
            <input type="number" value={editing.year} disabled={textMode} onChange={(e) => setEditing({ ...editing, year: +e.target.value })}
              className={`mt-1 w-full ${inputClass} disabled:bg-slate-50 disabled:text-slate-400`} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-medium text-slate-600">标题</span>
            <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className={`mt-1 w-full ${inputClass}`} />
          </label>
          <label className="text-sm sm:col-span-3">
            <span className="font-medium text-slate-600">说明</span>
            <textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              className={`mt-1 w-full ${textareaClass}`} rows={2} />
          </label>
        </div>

        {!textMode && (
          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-700">固定表头字段</h2>
            <p className="mt-1 text-xs text-slate-400">
              选择员工填报时需要填写的固定表头信息，并设置是否必填。
            </p>
            <div className="mt-3 space-y-2">
              {DEFAULT_HEADER_FIELDS.map((hf) => {
                const idx = editing.headerFields.findIndex((f) => f.key === hf.key);
                const cfg = idx !== -1 ? editing.headerFields[idx] : hf;
                return (
                  <div key={hf.key} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="w-28 font-medium text-slate-600">
                      {HEADER_FIELD_LABELS[hf.key as HeaderFieldKey]}
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfg.enabled}
                        onChange={(e) => {
                          const hfCopy = [...editing.headerFields];
                          hfCopy[idx] = { ...cfg, enabled: e.target.checked };
                          setEditing({ ...editing, headerFields: hfCopy });
                        }}
                        className="rounded border-slate-300"
                      />
                      启用
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfg.required}
                        disabled={!cfg.enabled}
                        onChange={(e) => {
                          const hfCopy = [...editing.headerFields];
                          hfCopy[idx] = { ...cfg, required: e.target.checked };
                          setEditing({ ...editing, headerFields: hfCopy });
                        }}
                        className="rounded border-slate-300"
                      />
                      必填
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-5 space-y-4">
          {editing.sections.map((sec, sIdx) => (
            <div key={sIdx} className="rounded-xl border border-slate-200 bg-white p-5">
              {!textMode && (
                <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2 font-medium text-slate-700">
                    一级绩效维度
                    <select
                      value={sec.sectionCode ?? ''}
                      onChange={(e) => {
                        const code = (e.target.value || null) as PerformanceSectionCode | null;
                        const ns = [...editing.sections];
                        if (!code) {
                          ns[sIdx] = { ...sec, sectionCode: null, maxScore: null };
                        } else {
                          const def = getPerformanceSection(code);
                          ns[sIdx] = {
                            ...sec,
                            sectionCode: code,
                            title: defaultSectionTitle(code, sIdx),
                            description: def.description,
                            maxScore: def.maxScore,
                            items: sec.items.map((it) =>
                              it.dimensionCode && !isSubDimensionInSection(it.dimensionCode, code)
                                ? { ...it, dimensionCode: null }
                                : it,
                            ),
                          };
                        }
                        setEditing({ ...editing, sections: ns });
                      }}
                      className={`${inputClass} max-w-xs text-sm`}
                    >
                      <option value="">自定义（不绑定标准维度）</option>
                      {PERFORMANCE_SECTIONS.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.excelOrder}. {s.title}
                          {s.maxScore > 0 ? `（满分${s.maxScore}）` : '（扣分项）'}
                        </option>
                      ))}
                    </select>
                  </label>
                  {sec.sectionCode && sec.maxScore != null && sec.maxScore > 0 && (
                    <span className="text-xs text-slate-500">章节满分 {sec.maxScore} 分</span>
                  )}
                </div>
              )}
              <div className="flex items-start gap-2">
                <input value={sec.title} onChange={(e) => {
                  const ns = [...editing.sections]; ns[sIdx] = { ...sec, title: e.target.value }; setEditing({ ...editing, sections: ns });
                }} placeholder="章节标题" className={`flex-1 font-semibold ${inputClass}`} />
                {!textMode && (
                  <button onClick={() => {
                    const ns = editing.sections.filter((_, i) => i !== sIdx);
                    setEditing({ ...editing, sections: ns });
                  }} className={`shrink-0 ${btnDanger}`}>删除章节</button>
                )}
              </div>
              <input value={sec.description ?? ''} onChange={(e) => {
                const ns = [...editing.sections]; ns[sIdx] = { ...sec, description: e.target.value }; setEditing({ ...editing, sections: ns });
              }} placeholder="章节说明（可选）" className={`mt-2 w-full text-sm ${inputClass}`} />

              <div className="mt-4 space-y-3">
                {sec.items.map((it, iIdx) => (
                  <ItemEditor
                    key={iIdx}
                    item={it}
                    sectionCode={sec.sectionCode}
                    textMode={textMode}
                    onChange={(next) => {
                      const ns = [...editing.sections];
                      const ni = [...sec.items]; ni[iIdx] = next;
                      ns[sIdx] = { ...sec, items: ni };
                      setEditing({ ...editing, sections: ns });
                    }}
                    onDelete={() => {
                      const ns = [...editing.sections];
                      ns[sIdx] = { ...sec, items: sec.items.filter((_, i) => i !== iIdx) };
                      setEditing({ ...editing, sections: ns });
                    }}
                  />
                ))}
                {!textMode && (
                  <button onClick={() => {
                    const ns = [...editing.sections];
                    ns[sIdx] = { ...sec, items: [...sec.items, blankItem(sec.items.length)] };
                    setEditing({ ...editing, sections: ns });
                  }} className={btnDashed}>+ 添加申报项</button>
                )}
              </div>
            </div>
          ))}
          {!textMode && (
            <button onClick={() => setEditing({ ...editing, sections: [...editing.sections, blankSection(editing.sections.length)] })}
              className={btnDashed}>+ 添加章节</button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      {preview && (
        <TemplatePreviewModal template={preview} onClose={() => setPreview(null)} />
      )}
      {assignTpl && (
        <OptionReviewerModal template={assignTpl} onClose={() => setAssignTpl(null)} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">申报表配置</h1>
        </div>
        <div className="flex items-center gap-3">
          <AdminPageActions />
          <button onClick={newTemplate} className={btnPrimary}>+ 新建申报表</button>
        </div>
      </div>

      {loadError && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
          <button onClick={load} className="ml-3 font-medium underline cursor-pointer">重试</button>
        </div>
      )}

      <ul className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {!dataLoaded && !loadError && (
          <li className="px-5 py-10 text-center text-sm text-slate-400">加载中…</li>
        )}
        {dataLoaded && list.length === 0 && !loadError && (
          <li className="px-5 py-10 text-center text-sm text-slate-400">暂无申报表，点击右上角新建。</li>
        )}
        {list.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="font-medium truncate">{t.title} <span className="text-xs text-slate-400">{t.year}</span></p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
                <span>{t.sections.length} 章节</span>
                <span>{t.sections.reduce((s, x) => s + x.items.length, 0)} 申报项</span>
                <StatusBadge status={t.status} />
                {(t._count?.submissions ?? 0) > 0 && (
                  <span className="font-medium text-amber-600">{t._count!.submissions} 份申报</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => openPreview(t)} className={btnOutline}>预览</button>
              {t.status !== 'ARCHIVED' && (
                <button type="button" onClick={() => handleEdit(t)} className={btnOutline}>编辑</button>
              )}
              {t.status === 'PUBLISHED' && (
                <button
                  type="button"
                  onClick={() => startTextEdit(t)}
                  className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 cursor-pointer"
                >
                  文字修订
                </button>
              )}
              {t.status !== 'ARCHIVED' && (
                <button
                  type="button"
                  onClick={() => setAssignTpl({ id: t.id, title: t.title })}
                  className="rounded-lg border border-violet-200 px-3 py-1.5 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 cursor-pointer"
                >
                  二级子项分配
                </button>
              )}
              {t.status === 'PUBLISHED' && (t._count?.submissions ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => duplicateAsDraft(t)}
                  className="rounded-lg border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 cursor-pointer"
                >
                  复制为草稿
                </button>
              )}
              {t.status !== 'ARCHIVED' && (
                <button type="button" onClick={() => togglePublish(t.id, t.status)} className={btnOutline}>
                  {t.status === 'PUBLISHED' ? '归档' : '发布'}
                </button>
              )}
              {t.status === 'ARCHIVED' && (
                <span className="self-center text-xs text-slate-400">已终态，仅可预览</span>
              )}
              <button type="button" onClick={() => handleDelete(t.id, t.title)} className={btnDanger}>
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-600' },
    PUBLISHED: { label: '已发布', className: 'bg-emerald-50 text-emerald-700' },
    ARCHIVED: { label: '已归档', className: 'bg-amber-50 text-amber-700' },
  };
  const c = config[status] ?? { label: status, className: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`inline-block rounded-full px-2.5 py-px text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

function ItemEditor({
  item,
  sectionCode,
  onChange,
  onDelete,
  textMode = false,
}: Readonly<{
  item: Item;
  sectionCode?: PerformanceSectionCode | null;
  onChange: (i: Item) => void;
  onDelete: () => void;
  textMode?: boolean;
}>) {
  const smallInput =
    'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20';
  const tinyInput =
    'rounded border border-slate-300 px-2 py-1 text-xs transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20';
  const btnDangerSmall =
    'rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer';

  const isCounted = item.scoreMode === 'COUNTED';
  const dimOptions = sectionCode
    ? subDimensionsForSection(sectionCode)
    : PERFORMANCE_SUB_DIMENSIONS;

  const applyDimensionCode = (code: string | null) => {
    if (!code) {
      onChange({ ...item, dimensionCode: null });
      return;
    }
    const sub = SUB_DIMENSION_BY_CODE[code as keyof typeof SUB_DIMENSION_BY_CODE];
    if (!sub) {
      onChange({ ...item, dimensionCode: code });
      return;
    }
    onChange({
      ...item,
      dimensionCode: code,
      title: item.title.trim() ? item.title : `${sub.title}（满分${sub.maxScore}分）`,
      requireAttachment: sub.isSystemImport ? false : item.requireAttachment,
      maxScore: isCounted ? (item.maxScore ?? sub.maxScore) : item.maxScore,
    });
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-2">
        <input value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="申报项标题，例如：刊物发表" className={`flex-1 ${smallInput}`} />
        {!textMode && <button onClick={onDelete} className={btnDangerSmall}>删除</button>}
      </div>
      <input value={item.hint ?? ''} onChange={(e) => onChange({ ...item, hint: e.target.value })}
        placeholder="提示信息，例如：请上传刊物封面与正文 PDF"
        className={`mt-2 w-full text-xs ${tinyInput}`} />

      {!textMode && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={item.isRequired} onChange={(e) => onChange({ ...item, isRequired: e.target.checked })}
              className="rounded border-slate-300" />
            必填
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={item.requireAttachment} onChange={(e) => onChange({ ...item, requireAttachment: e.target.checked })}
              className="rounded border-slate-300" />
            需要附件
          </label>
          <label className="flex items-center gap-1.5">
            计分方式
            <select value={item.scoreMode}
              onChange={(e) => onChange({ ...item, scoreMode: e.target.value as ScoreMode })}
              className={`${tinyInput}`}>
              <option value="TIERS">档次选择</option>
              <option value="COUNTED">按次数计分</option>
            </select>
          </label>
          {!isCounted && (
            <label className="flex items-center gap-1.5">
              最多可选
              <input type="number" min={1} max={10} value={item.maxSelections}
                onChange={(e) => onChange({ ...item, maxSelections: Math.max(1, +e.target.value) })}
                className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20" />
              项
            </label>
          )}
          {isCounted && (
            <label className="flex items-center gap-1.5">
              本项上限分
              <input type="number" min={0} step="0.1" value={item.maxScore ?? 0}
                onChange={(e) => onChange({ ...item, maxScore: Math.max(0, +e.target.value) })}
                className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20" />
              分
            </label>
          )}
          <label className="flex items-center gap-1.5">
            二级维度
            <select
              value={item.dimensionCode ?? ''}
              onChange={(e) => applyDimensionCode(e.target.value || null)}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20 max-w-[220px]"
            >
              <option value="">手工填写（不绑定）</option>
              {dimOptions.map((d) => (
                <option key={d.code} value={d.code}>
                  {d.title}
                  {d.isSystemImport ? ' · 系统导入' : d.dataSource === 'deduction' ? ' · 扣分' : ''}
                </option>
              ))}
            </select>
          </label>
          {item.dimensionCode && SUB_DIMENSION_BY_CODE[item.dimensionCode as keyof typeof SUB_DIMENSION_BY_CODE]?.isSystemImport && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
              事实导入自动计分
            </span>
          )}
        </div>
      )}

      <div className="mt-3">
        <p className="text-xs font-semibold text-slate-600">
          {isCounted ? '子项（单价分值 × 次数，汇总封顶）' : '分值档次'}
        </p>
        <div className="mt-1.5 space-y-2">
          {item.scoreOptions.map((o, oi) => (
            <div key={o.label + '-' + oi} className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex gap-1.5">
                <input value={o.label} onChange={(e) => {
                  const ns = [...item.scoreOptions]; ns[oi] = { ...o, label: e.target.value };
                  onChange({ ...item, scoreOptions: ns });
                }} placeholder={isCounted ? '子项名称，例如：省级刊物' : '档次名称'} className={`flex-1 ${tinyInput}`} />
                {!textMode && (
                  <input type="number" value={o.score} onChange={(e) => {
                    const ns = [...item.scoreOptions]; ns[oi] = { ...o, score: +e.target.value };
                    onChange({ ...item, scoreOptions: ns });
                  }} className={`w-24 ${tinyInput}`} step="0.1" placeholder={isCounted ? '单价分' : '分值'} />
                )}
                {!textMode && (
                  <button onClick={() => onChange({ ...item, scoreOptions: item.scoreOptions.filter((_, i) => i !== oi) })}
                    className={btnDangerSmall}>×</button>
                )}
              </div>
              <input value={o.description ?? ''} onChange={(e) => {
                const ns = [...item.scoreOptions]; ns[oi] = { ...o, description: e.target.value };
                onChange({ ...item, scoreOptions: ns });
              }} placeholder={isCounted ? '子项说明（可选，例如：每发表一次计分）' : '档次说明（可选，帮助员工理解如何选择）'}
                className={`mt-1.5 w-full text-xs ${tinyInput} text-slate-500`} />
            </div>
          ))}
        </div>
        {!textMode && (
          <button onClick={() => onChange({ ...item, scoreOptions: [...item.scoreOptions, { optionId: newOptionId(), label: '', score: 0, description: '' }] })}
            className="mt-2 rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:border-slate-400 hover:bg-white cursor-pointer">
            {isCounted ? '+ 添加子项' : '+ 添加档次'}
          </button>
        )}
      </div>
    </div>
  );
}

interface Department { id: string; name: string }
interface OptionAssignment {
  id: string;
  title: string;
  items: Array<{
    id: string;
    title: string;
    scoreOptions: Array<{ optionId: string; label: string; score: number; departmentId: string }>;
  }>;
}

function OptionReviewerModal({ template, onClose }: Readonly<{ template: { id: string; title: string }; onClose: () => void }>) {
  const [sections, setSections] = useState<OptionAssignment[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/option-reviewers?templateId=${template.id}`);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setErr(d.error || '加载失败'); return; }
      setSections(d.sections ?? []);
      setDepartments(d.departments ?? []);
    } catch {
      setErr('加载失败，请检查网络');
    } finally {
      setLoading(false);
    }
  }, [template.id]);
  useEffect(() => { load(); }, [load]);

  const assign = async (itemId: string, optionId: string, departmentId: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/option-reviewers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, optionId, departmentId: departmentId || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || '操作失败'); return; }
      await load();
    } catch {
      setErr('网络错误');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b bg-white px-5 py-3">
          <div>
            <span className="text-sm font-medium text-slate-700">二级子项分配 · {template.title}</span>
            <p className="text-xs text-slate-400">为每个申报子项指定总部负责部门；部门内二级审核员均可审核。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">关闭</button>
        </div>
        <div className="max-h-[calc(100vh-10rem)] space-y-4 overflow-y-auto p-5">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          {loading && <p className="text-sm text-slate-400">加载中…</p>}
          {!loading && departments.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
              暂无可用总部部门，请先在「组织架构」中为公司总部配置部门。
            </p>
          )}
          {!loading && sections.map((sec) => (
            <div key={sec.id} className="rounded-lg border border-slate-200 p-4">
              <p className="font-medium text-sm">{sec.title}</p>
              <div className="mt-3 space-y-3">
                {sec.items.map((item) => (
                  <div key={item.id} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-600">{item.title}</p>
                    <div className="mt-2 space-y-2">
                      {item.scoreOptions.map((option) => (
                        <label key={option.optionId} className="grid gap-2 text-xs sm:grid-cols-[1fr_220px] sm:items-center">
                          <span className="min-w-0">
                            <span className="font-medium text-slate-700">{option.label}</span>
                            <span className="ml-2 text-slate-400">{Number(option.score).toFixed(1)} 分</span>
                          </span>
                          <select
                            value={option.departmentId}
                            disabled={busy}
                            onChange={(e) => assign(item.id, option.optionId, e.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
                          >
                            <option value="">未分配</option>
                            {departments.map((department) => (
                              <option key={department.id} value={department.id}>{department.name}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
