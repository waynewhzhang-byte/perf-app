'use client';
// 申报表可视化设计器
import { useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';
import {
  TemplatePreviewModal,
  type PreviewTemplate,
  type ScoreOpt,
} from '@/components/template-preview';

interface Item {
  id?: string;
  title: string; hint?: string;
  isRequired: boolean; requireAttachment: boolean;
  maxSelections: number;
  scoreOptions: ScoreOpt[];
  sortOrder: number;
}
interface Section { id?: string; title: string; description?: string; sortOrder: number; items: Item[] }
interface Template {
  id: string; year: number; title: string; description?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  sections: Section[];
  _count?: { submissions: number };
}

type EditingState = {
  year: number;
  title: string;
  description: string;
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
    const row = o as { label?: string; score?: number; description?: string };
    return { label: String(row.label ?? ''), score: Number(row.score ?? 0), description: row.description };
  });
}

function templateToEditing(t: Template | EditingState): EditingState {
  const sections = [...t.sections]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s, sIdx) => ({
      title: s.title,
      description: s.description ?? '',
      sortOrder: s.sortOrder ?? sIdx,
      items: [...s.items]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it, iIdx) => ({
          title: it.title,
          hint: it.hint ?? '',
          isRequired: it.isRequired,
          requireAttachment: it.requireAttachment,
          maxSelections: it.maxSelections,
          scoreOptions: parseScoreOptions(it.scoreOptions),
          sortOrder: it.sortOrder ?? iIdx,
        })),
    }));
  return {
    year: t.year,
    title: t.title,
    description: t.description ?? '',
    sections,
  };
}

function toPreviewTemplate(editing: EditingState): PreviewTemplate {
  return {
    year: editing.year,
    title: editing.title || '（未命名）',
    description: editing.description || undefined,
    sections: editing.sections.map((s, sIdx) => ({
      ...s,
      sortOrder: sIdx,
      items: s.items.map((it, iIdx) => ({
        ...it,
        sortOrder: iIdx,
        scoreOptions: it.scoreOptions.length ? it.scoreOptions : [{ label: '—', score: 0 }],
      })),
    })),
  };
}

const blankItem = (i = 0): Item => ({
  title: '', hint: '', isRequired: true, requireAttachment: true, maxSelections: 1, sortOrder: i,
  scoreOptions: [
    { label: '国家级', score: 10, description: '获得国家级奖项、荣誉或认定' },
    { label: '省级', score: 6, description: '获得省部级奖项、荣誉或认定' },
    { label: '市级', score: 3, description: '获得市级或公司级奖项' },
    { label: '区/县级', score: 1, description: '获得区/县级或部门级表彰' },
  ],
});
const blankSection = (i = 0): Section => ({
  title: '新章节', description: '', sortOrder: i, items: [blankItem(0)],
});

export default function TemplatesPage() {
  const [list, setList] = useState<Template[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [preview, setPreview] = useState<PreviewTemplate | null>(null);
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
    setEditing({
      year: new Date().getFullYear(), title: `${new Date().getFullYear()}年度员工绩效申报表`,
      description: '请如实填写并上传对应证明材料', sections: [blankSection(0)],
    });
  };

  const handleEdit = (t: Template) => {
    if (t.status === 'ARCHIVED') return;
    const subs = t._count?.submissions ?? 0;
    if (t.status === 'PUBLISHED' && subs > 0) {
      alert(
        `该模板已有 ${subs} 份员工申报，无法直接修改结构。\n请使用「复制为草稿」创建新版本后再编辑。`,
      );
      return;
    }
    setEditingId(t.id);
    setEditing(templateToEditing(t));
  };

  const openPreview = (t: Template) => {
    setPreview(toPreviewTemplate(templateToEditing(t)));
  };

  const duplicateAsDraft = (t: Template) => {
    const base = templateToEditing(t);
    setEditingId(null);
    setEditing({
      ...base,
      title: `${base.title}（副本）`,
    });
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) { alert('请填写标题'); return; }
    setSaving(true);
    try {
      const method = editingId ? 'PUT' : 'POST';
      const body = editingId ? { id: editingId, ...editing } : editing;
      const r = await fetch('/api/admin/templates', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert('保存失败：' + (e.error || r.statusText || `HTTP ${r.status}`));
        return;
      }
      const saved = await r.json().catch(() => ({}));
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
          <h1 className="text-xl font-bold tracking-tight">{editingId ? '编辑申报表' : '设计申报表'}</h1>
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
              onClick={() => { setEditing(null); setEditingId(null); }}
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
              {saving ? '保存中…' : editingId ? '保存修改' : '保存为草稿'}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          保存后可继续编辑；发布前建议先预览确认章节与分值档次。
        </p>

        <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-3">
          <label className="text-sm">
            <span className="font-medium text-slate-600">年度</span>
            <input type="number" value={editing.year} onChange={(e) => setEditing({ ...editing, year: +e.target.value })}
              className={`mt-1 w-full ${inputClass}`} />
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

        <div className="mt-5 space-y-4">
          {editing.sections.map((sec, sIdx) => (
            <div key={sIdx} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-2">
                <input value={sec.title} onChange={(e) => {
                  const ns = [...editing.sections]; ns[sIdx] = { ...sec, title: e.target.value }; setEditing({ ...editing, sections: ns });
                }} placeholder="章节标题" className={`flex-1 font-semibold ${inputClass}`} />
                <button onClick={() => {
                  const ns = editing.sections.filter((_, i) => i !== sIdx);
                  setEditing({ ...editing, sections: ns });
                }} className={`shrink-0 ${btnDanger}`}>删除章节</button>
              </div>
              <input value={sec.description ?? ''} onChange={(e) => {
                const ns = [...editing.sections]; ns[sIdx] = { ...sec, description: e.target.value }; setEditing({ ...editing, sections: ns });
              }} placeholder="章节说明（可选）" className={`mt-2 w-full text-sm ${inputClass}`} />

              <div className="mt-4 space-y-3">
                {sec.items.map((it, iIdx) => (
                  <ItemEditor
                    key={iIdx} item={it}
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
                <button onClick={() => {
                  const ns = [...editing.sections];
                  ns[sIdx] = { ...sec, items: [...sec.items, blankItem(sec.items.length)] };
                  setEditing({ ...editing, sections: ns });
                }} className={btnDashed}>+ 添加申报项</button>
              </div>
            </div>
          ))}
          <button onClick={() => setEditing({ ...editing, sections: [...editing.sections, blankSection(editing.sections.length)] })}
            className={btnDashed}>+ 添加章节</button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      {preview && (
        <TemplatePreviewModal template={preview} onClose={() => setPreview(null)} />
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

function ItemEditor({ item, onChange, onDelete }: { item: Item; onChange: (i: Item) => void; onDelete: () => void }) {
  const smallInput =
    'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20';
  const tinyInput =
    'rounded border border-slate-300 px-2 py-1 text-xs transition-colors focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20';
  const btnDangerSmall =
    'rounded-lg px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start gap-2">
        <input value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })}
          placeholder="申报项标题，例如：发表论文" className={`flex-1 ${smallInput}`} />
        <button onClick={onDelete} className={btnDangerSmall}>删除</button>
      </div>
      <input value={item.hint ?? ''} onChange={(e) => onChange({ ...item, hint: e.target.value })}
        placeholder="提示信息，例如：请上传刊物封面与正文 PDF"
        className={`mt-2 w-full text-xs ${tinyInput}`} />

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
          最多可选
          <input type="number" min={1} max={10} value={item.maxSelections}
            onChange={(e) => onChange({ ...item, maxSelections: Math.max(1, +e.target.value) })}
            className={`w-14 rounded border border-slate-300 px-1.5 py-0.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20`} />
          项
        </label>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold text-slate-600">分值档次</p>
        <div className="mt-1.5 space-y-2">
          {item.scoreOptions.map((o, oi) => (
            <div key={oi} className="rounded-lg border border-slate-200 bg-white p-2.5">
              <div className="flex gap-1.5">
                <input value={o.label} onChange={(e) => {
                  const ns = [...item.scoreOptions]; ns[oi] = { ...o, label: e.target.value };
                  onChange({ ...item, scoreOptions: ns });
                }} placeholder="档次名称" className={`flex-1 ${tinyInput}`} />
                <input type="number" value={o.score} onChange={(e) => {
                  const ns = [...item.scoreOptions]; ns[oi] = { ...o, score: +e.target.value };
                  onChange({ ...item, scoreOptions: ns });
                }} className={`w-20 ${tinyInput}`} step="0.1" placeholder="分值" />
                <button onClick={() => onChange({ ...item, scoreOptions: item.scoreOptions.filter((_, i) => i !== oi) })}
                  className={btnDangerSmall}>×</button>
              </div>
              <input value={o.description ?? ''} onChange={(e) => {
                const ns = [...item.scoreOptions]; ns[oi] = { ...o, description: e.target.value };
                onChange({ ...item, scoreOptions: ns });
              }} placeholder="档次说明（可选，帮助员工理解如何选择）"
                className={`mt-1.5 w-full text-xs ${tinyInput} text-slate-500`} />
            </div>
          ))}
        </div>
        <button onClick={() => onChange({ ...item, scoreOptions: [...item.scoreOptions, { label: '', score: 0, description: '' }] })}
          className="mt-2 rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:border-slate-400 hover:bg-white cursor-pointer">
          + 添加档次
        </button>
      </div>
    </div>
  );
}
