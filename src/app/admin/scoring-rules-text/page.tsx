'use client';
// 计分规则「显示文案」管理：修改 11 项规则展示给员工的说明文字（纯显示，不影响分数）

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

// ── Types ───────────────────────────────────────────────────────────

interface DefaultItem {
  code: string;
  title: string;
  sectionCode: string;
  sectionTitle: string;
  maxScore: number;
  ownerDepartment: string;
  scoringSummary: string;
  referenceFile?: string | null;
  notes?: string | null;
}

interface Override {
  id?: string;
  title?: string | null;
  scoringSummary?: string | null;
  ownerDepartment?: string | null;
  referenceFile?: string | null;
  notes?: string | null;
}

interface EditFields {
  title: string;
  scoringSummary: string;
  ownerDepartment: string;
  referenceFile: string;
  notes: string;
}

const SECTION_LABEL: Record<string, string> = {
  basic: '基本素质',
  performance: '工作业绩',
  worksite: '工作现场',
  special: '特殊事项（扣分）',
};
const SECTION_ORDER = ['basic', 'performance', 'worksite', 'special'];

const emptyEdit: EditFields = {
  title: '',
  scoringSummary: '',
  ownerDepartment: '',
  referenceFile: '',
  notes: '',
};

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

const btnOutline =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50 disabled:opacity-50';

export default function ScoringRulesTextPage() {
  const [year, setYear] = useState(2026);
  const [defaults, setDefaults] = useState<DefaultItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [edits, setEdits] = useState<Record<string, EditFields>>({});
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async (y: number) => {
    setLoading(true);
    setLoadError(null);
    setMsg(null);
    try {
      const r = await fetch(`/api/admin/scoring-rules-text?year=${y}`);
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setLoadError(d.error || '加载失败'); return; }
      setDefaults(d.defaults ?? []);
      setOverrides(d.overrides ?? {});
      // 用当前覆盖值预填编辑区（覆盖为 null/未配置 → 空，由占位符显示默认）
      const nextEdits: Record<string, EditFields> = {};
      for (const item of d.defaults as DefaultItem[]) {
        const ov: Override | undefined = d.overrides?.[item.code];
        nextEdits[item.code] = {
          title: ov?.title ?? '',
          scoringSummary: ov?.scoringSummary ?? '',
          ownerDepartment: ov?.ownerDepartment ?? '',
          referenceFile: ov?.referenceFile ?? '',
          notes: ov?.notes ?? '',
        };
      }
      setEdits(nextEdits);
    } catch {
      setLoadError('加载失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(year); }, [year, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, DefaultItem[]>();
    for (const item of defaults) {
      const list = map.get(item.sectionCode) ?? [];
      list.push(item);
      map.set(item.sectionCode, list);
    }
    return map;
  }, [defaults]);

  const save = async (item: DefaultItem) => {
    const edit = edits[item.code] ?? emptyEdit;
    const existing = overrides[item.code];
    setBusyCode(item.code); setMsg(null);
    try {
      const body = {
        id: existing?.id,
        year,
        dimensionCode: item.code,
        // 空串 → null（表示回退常量）；非空 → 自定义文案
        title: edit.title.trim() || null,
        scoringSummary: edit.scoringSummary.trim() || null,
        ownerDepartment: edit.ownerDepartment.trim() || null,
        referenceFile: edit.referenceFile.trim() || null,
        notes: edit.notes.trim() || null,
      };
      const r = await fetch('/api/admin/scoring-rules-text', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '保存失败' }); return; }
      setMsg({ type: 'success', text: `已保存「${item.title}」的文案` });
      await load(year);
    } catch {
      setMsg({ type: 'error', text: '保存失败，请检查网络连接' });
    } finally {
      setBusyCode(null);
    }
  };

  const reset = async (item: DefaultItem) => {
    const existing = overrides[item.code];
    if (!existing?.id) {
      // 本就无覆盖，直接清空编辑区
      setEdits((prev) => ({ ...prev, [item.code]: { ...emptyEdit } }));
      return;
    }
    if (!confirm(`确认将「${item.title}」恢复为默认文案？`)) return;
    setBusyCode(item.code); setMsg(null);
    try {
      const r = await fetch('/api/admin/scoring-rules-text', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: existing.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '恢复失败' }); return; }
      setMsg({ type: 'success', text: `「${item.title}」已恢复默认` });
      await load(year);
    } catch {
      setMsg({ type: 'error', text: '恢复失败，请检查网络连接' });
    } finally {
      setBusyCode(null);
    }
  };

  const setField = (code: string, field: keyof EditFields, value: string) => {
    setEdits((prev) => ({ ...prev, [code]: { ...(prev[code] ?? emptyEdit), [field]: value } }));
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">计分规则文案</h1>
          <p className="mt-1 text-sm text-slate-500">
            修改 11 项计分规则显示给员工的说明文字（标题 / 说明 / 责任部门 / 参考台账 / 备注）。
            <span className="text-slate-400">仅影响展示，不修改满分、计分算法与事实数据。</span>
          </p>
        </div>
        <AdminPageActions />
      </div>

      <section className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="font-medium text-slate-600">年度</span>
          <input
            type="number"
            min={2020}
            max={2100}
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || 2026)}
            className={`mt-1 block w-32 ${inputClass}`}
          />
        </label>
        <p className="text-xs text-slate-400">
          按年度区分文案；未配置的年度自动回退系统默认。修改后只影响后续展示，不动已归档报表。
        </p>
      </section>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </div>
      )}
      {msg && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          msg.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">加载中…</p>
      ) : (
        <div className="space-y-6">
          {SECTION_ORDER.map((sectionCode) => {
            const items = grouped.get(sectionCode);
            if (!items || items.length === 0) return null;
            return (
              <section key={sectionCode} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
                  <h2 className="font-semibold text-slate-900">{SECTION_LABEL[sectionCode] ?? sectionCode}</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const edit = edits[item.code] ?? emptyEdit;
                    const hasOverride = Boolean(overrides[item.code]?.id);
                    return (
                      <div key={item.code} className="px-5 py-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <h3 className="font-medium text-slate-900">{item.title}</h3>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            满分 {item.maxScore}
                          </span>
                          {hasOverride && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">已自定义</span>
                          )}
                          <span className="text-xs text-slate-400">{item.code}</span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FieldText
                            label="标题"
                            value={edit.title}
                            placeholder={item.title}
                            onChange={(v) => setField(item.code, 'title', v)}
                          />
                          <FieldText
                            label="责任部门"
                            value={edit.ownerDepartment}
                            placeholder={item.ownerDepartment}
                            onChange={(v) => setField(item.code, 'ownerDepartment', v)}
                          />
                          <FieldText
                            label="参考台账"
                            value={edit.referenceFile}
                            placeholder={item.referenceFile || '（无）'}
                            onChange={(v) => setField(item.code, 'referenceFile', v)}
                          />
                          <FieldArea
                            label="计分说明"
                            value={edit.scoringSummary}
                            placeholder={item.scoringSummary}
                            onChange={(v) => setField(item.code, 'scoringSummary', v)}
                          />
                          <FieldArea
                            label="备注"
                            value={edit.notes}
                            placeholder={item.notes || '（无）'}
                            onChange={(v) => setField(item.code, 'notes', v)}
                          />
                        </div>
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => reset(item)}
                            disabled={busyCode === item.code || !hasOverride}
                            className={btnOutline}
                            title={hasOverride ? '恢复为系统默认文案' : '当前未自定义'}
                          >
                            恢复默认
                          </button>
                          <button
                            type="button"
                            onClick={() => save(item)}
                            disabled={busyCode === item.code}
                            className={btnPrimary}
                          >
                            {busyCode === item.code ? '保存中…' : '保存'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function FieldText({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function FieldArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm sm:col-span-2">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className={inputClass}
      />
    </label>
  );
}
