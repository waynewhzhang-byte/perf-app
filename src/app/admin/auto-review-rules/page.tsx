'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

interface LevelOption { id: string; name: string }
interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  minWorkYears: number | null;
  maxWorkYears: number | null;
  allowedLevelIds: string[];
  rejectMessage: string;
}

type RuleForm = Omit<Rule, 'id'> & { id?: string };

const emptyRule: RuleForm = {
  name: '',
  enabled: true,
  minWorkYears: 5,
  maxWorkYears: 8,
  allowedLevelIds: [],
  rejectMessage: '工作年限不符合所选能级评价等级的申报条件。',
};

const inputClass =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

const btnOutline =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-50 disabled:opacity-50';

export default function AutoReviewRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [levels, setLevels] = useState<LevelOption[]>([]);
  const [editing, setEditing] = useState<RuleForm>(emptyRule);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const r = await fetch('/api/admin/auto-review-rules');
      if (r.status === 401) { window.location.href = '/admin/login'; return; }
      const d = await r.json();
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '加载失败' }); return; }
      setRules((d.rules ?? []).map((rule: Rule) => ({
        ...rule,
        allowedLevelIds: Array.isArray(rule.allowedLevelIds) ? rule.allowedLevelIds : [],
      })));
      setLevels(d.declarationLevels ?? []);
    } catch {
      setMsg({ type: 'error', text: '加载失败，请检查网络连接' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLevel = (levelId: string) => {
    setEditing((cur) => ({
      ...cur,
      allowedLevelIds: cur.allowedLevelIds.includes(levelId)
        ? cur.allowedLevelIds.filter((id) => id !== levelId)
        : [...cur.allowedLevelIds, levelId],
    }));
  };

  const save = async () => {
    if (!editing.name.trim()) { setMsg({ type: 'error', text: '请填写规则名称' }); return; }
    if (editing.allowedLevelIds.length === 0) { setMsg({ type: 'error', text: '请选择允许申报等级' }); return; }
    if (!editing.rejectMessage.trim()) { setMsg({ type: 'error', text: '请填写自动驳回说明' }); return; }
    setBusy(true); setMsg(null);
    try {
      const body = {
        ...editing,
        name: editing.name.trim(),
        minWorkYears: editing.minWorkYears == null ? null : Number(editing.minWorkYears),
        maxWorkYears: editing.maxWorkYears == null ? null : Number(editing.maxWorkYears),
        rejectMessage: editing.rejectMessage.trim(),
      };
      const r = await fetch('/api/admin/auto-review-rules', {
        method: editing.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '保存失败' }); return; }
      setEditing(emptyRule);
      setMsg({ type: 'success', text: '已保存' });
      await load();
    } catch {
      setMsg({ type: 'error', text: '保存失败，请检查网络连接' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rule: Rule) => {
    if (!confirm(`确认删除规则「${rule.name}」？`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/admin/auto-review-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rule.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ type: 'error', text: d.error || '删除失败' }); return; }
      await load();
    } catch {
      setMsg({ type: 'error', text: '删除失败，请检查网络连接' });
    } finally {
      setBusy(false);
    }
  };

  const levelNames = (ids: string[]) =>
    ids.map((id) => levels.find((lv) => lv.id === id)?.name ?? id).join('、') || '—';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">自动预审规则</h1>
          <p className="mt-1 text-sm text-slate-500">配置工作年限区间与允许申报等级，不通过时自动驳回。</p>
        </div>
        <AdminPageActions />
      </div>

      {msg && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
          msg.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{editing.id ? '编辑规则' : '新增规则'}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="text-sm sm:col-span-2">
            <span className="font-medium text-slate-600">规则名称</span>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className={`mt-1 w-full ${inputClass}`} placeholder="5年以上8年以下只能申报2级" />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-600">工作年限下限（含）</span>
            <input type="number" min={0} value={editing.minWorkYears ?? ''}
              onChange={(e) => setEditing({ ...editing, minWorkYears: e.target.value === '' ? null : Number(e.target.value) })}
              className={`mt-1 w-full ${inputClass}`} />
          </label>
          <label className="text-sm">
            <span className="font-medium text-slate-600">工作年限上限（不含）</span>
            <input type="number" min={0} value={editing.maxWorkYears ?? ''}
              onChange={(e) => setEditing({ ...editing, maxWorkYears: e.target.value === '' ? null : Number(e.target.value) })}
              className={`mt-1 w-full ${inputClass}`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              className="rounded border-slate-300" />
            启用规则
          </label>
          <div className="sm:col-span-3">
            <p className="text-sm font-medium text-slate-600">允许申报等级</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {levels.map((level) => {
                const selected = editing.allowedLevelIds.includes(level.id);
                return (
                  <button key={level.id} type="button" onClick={() => toggleLevel(level.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}>
                    {level.name}
                  </button>
                );
              })}
              {levels.length === 0 && <span className="text-xs text-amber-600">请先在组织架构中维护能级评价等级。</span>}
            </div>
          </div>
          <label className="text-sm sm:col-span-4">
            <span className="font-medium text-slate-600">自动驳回说明</span>
            <textarea value={editing.rejectMessage}
              onChange={(e) => setEditing({ ...editing, rejectMessage: e.target.value })}
              className={`mt-1 w-full ${inputClass}`} rows={2} />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {editing.id && (
            <button type="button" onClick={() => setEditing(emptyRule)} className={btnOutline}>取消编辑</button>
          )}
          <button type="button" onClick={save} disabled={busy || levels.length === 0} className={btnPrimary}>
            {busy ? '保存中…' : '保存规则'}
          </button>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b px-5 py-3">
          <h2 className="font-semibold">规则列表</h2>
        </div>
        <ul className="divide-y divide-slate-100">
          {rules.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-400">暂无规则</li>}
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium">
                  {rule.name}
                  <span className={`ml-2 rounded-full px-2 py-px text-xs ${rule.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {rule.enabled ? '启用' : '停用'}
                  </span>
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  工作年限 {rule.minWorkYears ?? 0} 年以上，{rule.maxWorkYears == null ? '不限上限' : `${rule.maxWorkYears} 年以下`} ·
                  允许等级：{levelNames(rule.allowedLevelIds)}
                </p>
                <p className="mt-1 text-xs text-slate-400">驳回说明：{rule.rejectMessage}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing({ ...rule })} className={btnOutline}>编辑</button>
                <button type="button" onClick={() => remove(rule)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50">
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
