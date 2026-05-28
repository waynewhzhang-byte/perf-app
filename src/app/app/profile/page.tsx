'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';

interface SelectOption { id: string; name: string; branchId?: string }
interface UserProfile {
  id: string; fullName: string; contact: string; employeeNo: string | null;
  branch: SelectOption | null;
  department: SelectOption | null;
  position: SelectOption | null;
  jobType: SelectOption | null;
  employeeLevel: SelectOption | null;
}
interface Options {
  branches: SelectOption[];
  departments: (SelectOption & { branchId: string })[];
  positions: SelectOption[];
  jobTypes: SelectOption[];
  employeeLevels: SelectOption[];
}

export default function ProfilePage() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ branchId: '', departmentId: '', positionId: '', jobTypeId: '', employeeLevelId: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/profile');
      if (r.status === 401) { window.location.href = '/login'; return; }
      const d = await r.json();
      if (!r.ok) { setError(d.error || '加载失败'); return; }
      setUser(d.user);
      setOptions(d.options);
      const u = d.user;
      const f = { branchId: u.branch?.id || '', departmentId: u.department?.id || '', positionId: u.position?.id || '', jobTypeId: u.jobType?.id || '', employeeLevelId: u.employeeLevel?.id || '' };
      setForm(f);
    } catch { setError('网络错误'); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 根据所选分公司过滤部门
  const filteredDepts = useMemo(() => {
    if (!options) return [];
    if (!form.branchId) return options.departments;
    return options.departments.filter((d) => d.branchId === form.branchId);
  }, [options, form.branchId]);

  const startEdit = () => {
    setEditing(true);
    setMsg(null);
  };

  const cancel = () => {
    setEditing(false);
    setMsg(null);
    if (user) {
      setForm({ branchId: user.branch?.id || '', departmentId: user.department?.id || '', positionId: user.position?.id || '', jobTypeId: user.jobType?.id || '', employeeLevelId: user.employeeLevel?.id || '' });
    }
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch('/api/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId: form.branchId || null,
          departmentId: form.departmentId || null,
          positionId: form.positionId || null,
          jobTypeId: form.jobTypeId || null,
          employeeLevelId: form.employeeLevelId || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg(`❌ ${d.error}`); return; }
      setMsg('✅ 保存成功');
      setEditing(false);
      await load();
    } finally { setSaving(false); }
  };

  if (!user) {
    return <main className="mx-auto max-w-4xl px-6 py-10"><p className="text-sm text-slate-500">加载中…</p></main>;
  }

  const label = (v?: string | null) => v || <span className="text-slate-300">未设置</span>;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">个人资料</h1>
          <p className="mt-1 text-sm text-slate-600">查看与修改您的个人信息</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/app" className="rounded border px-3 py-1.5 hover:bg-slate-50">← 返回</Link>
          <LogoutButton />
        </div>
      </header>

      {error && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {msg && <p className="mt-4 text-sm">{msg}</p>}

      {/* 基本信息（只读） */}
      <section className="mt-6 rounded-lg border bg-white p-5">
        <h2 className="font-semibold">基本信息</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-slate-500">姓名</dt><dd className="font-medium">{user.fullName}</dd></div>
          <div><dt className="text-slate-500">联系方式</dt><dd className="font-medium">{user.contact}</dd></div>
          <div><dt className="text-slate-500">工号</dt><dd className="font-medium">{user.employeeNo || '—'}</dd></div>
        </dl>
      </section>

      {/* 组织信息（可编辑） */}
      <section className="mt-4 rounded-lg border bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">组织信息</h2>
          {!editing && (
            <button onClick={startEdit} className="rounded border px-3 py-1 text-xs hover:bg-slate-50">
              修改
            </button>
          )}
        </div>

        {!editing ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">工作单位</dt><dd className="font-medium">{label(user.branch?.name)}</dd></div>
            <div><dt className="text-slate-500">部门</dt><dd className="font-medium">{label(user.department?.name)}</dd></div>
            <div><dt className="text-slate-500">岗位</dt><dd className="font-medium">{label(user.position?.name)}</dd></div>
            <div><dt className="text-slate-500">工种</dt><dd className="font-medium">{label(user.jobType?.name)}</dd></div>
            <div><dt className="text-slate-500">员工级别</dt><dd className="font-medium">{label(user.employeeLevel?.name)}</dd></div>
          </dl>
        ) : (
          <div className="mt-3 space-y-3">
            <FormRow label="工作单位">
              <select value={form.branchId} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value, departmentId: '' }))}
                className="w-full rounded border px-3 py-2 text-sm">
                <option value="">请选择</option>
                {options?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="部门">
              <select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm">
                <option value="">请选择</option>
                {filteredDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="岗位">
              <select value={form.positionId} onChange={(e) => setForm((f) => ({ ...f, positionId: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm">
                <option value="">请选择</option>
                {options?.positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="工种">
              <select value={form.jobTypeId} onChange={(e) => setForm((f) => ({ ...f, jobTypeId: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm">
                <option value="">请选择</option>
                {options?.jobTypes.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="员工级别">
              <select value={form.employeeLevelId} onChange={(e) => setForm((f) => ({ ...f, employeeLevelId: e.target.value }))}
                className="w-full rounded border px-3 py-2 text-sm">
                <option value="">请选择</option>
                {options?.employeeLevels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </FormRow>
            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={saving}
                className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                {saving ? '保存中…' : '保存'}
              </button>
              <button onClick={cancel} className="rounded border px-4 py-2 text-sm hover:bg-slate-50">取消</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      {children}
    </label>
  );
}
