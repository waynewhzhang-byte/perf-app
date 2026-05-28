'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type Entity = 'branch' | 'department' | 'position' | 'jobType' | 'employeeLevel';

interface Branch {
  id: string;
  name: string;
  code: string | null;
}

interface Department {
  id: string;
  name: string;
  branchId: string;
}

interface NamedEntity {
  id: string;
  name: string;
}

interface OrgData {
  branches: Branch[];
  departments: Department[];
  positions: NamedEntity[];
  jobTypes: NamedEntity[];
  employeeLevels: NamedEntity[];
}

const empty: OrgData = {
  branches: [],
  departments: [],
  positions: [],
  jobTypes: [],
  employeeLevels: [],
};

const inputClass =
  'rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const selectClass =
  'rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors disabled:bg-slate-50 disabled:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

export default function OrganizationPage() {
  const [data, setData] = useState<OrgData>(empty);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptBranchId, setDeptBranchId] = useState('');
  const [positionName, setPositionName] = useState('');
  const [jobTypeName, setJobTypeName] = useState('');
  const [employeeLevelName, setEmployeeLevelName] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await fetch('/api/admin/organization');
      if (r.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const d = await r.json();
      if (!r.ok) {
        setLoadError(d.error || '加载失败');
        return;
      }
      const next: OrgData = {
        branches: d.branches ?? [],
        departments: d.departments ?? [],
        positions: d.positions ?? [],
        jobTypes: d.jobTypes ?? [],
        employeeLevels: d.employeeLevels ?? [],
      };
      setData(next);
      setDeptBranchId((prev) => prev || next.branches[0]?.id || '');
    } catch {
      setLoadError('加载失败，请检查网络连接');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(
    entity: Entity,
    body: { name: string; code?: string; branchId?: string },
    onSuccess: () => void,
  ) {
    setMsg(null);
    const r = await fetch('/api/admin/organization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity, ...body }),
    });
    if (r.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const d = await r.json();
    if (!r.ok) {
      setMsg({ type: 'error', text: d.error || '创建失败' });
      return;
    }
    onSuccess();
    setMsg({ type: 'success', text: '已添加' });
    await load();
  }

  async function remove(entity: Entity, id: string, label: string) {
    if (!confirm(`确认删除「${label}」？若仍有关联用户可能失败。`)) return;
    setMsg(null);
    const r = await fetch('/api/admin/organization', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity, id }),
    });
    if (r.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const d = await r.json();
    if (!r.ok) {
      setMsg({ type: 'error', text: d.error || '删除失败' });
      return;
    }
    setMsg({ type: 'success', text: '已删除' });
    await load();
  }

  const branchNameById = (id: string) =>
    data.branches.find((b) => b.id === id)?.name ?? id;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">组织架构</h1>
          <p className="mt-1 text-sm text-slate-500">分公司、部门、岗位、工种、员工级别</p>
        </div>
        <AdminPageActions />
      </div>

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

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">分公司</h2>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!branchName.trim()) return;
            create('branch', { name: branchName.trim(), code: branchCode.trim() || undefined }, () => {
              setBranchName('');
              setBranchCode('');
            });
          }}
        >
          <input
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            placeholder="分公司名称"
            className={`flex-1 ${inputClass}`}
          />
          <input
            value={branchCode}
            onChange={(e) => setBranchCode(e.target.value)}
            placeholder="编码（可选）"
            className={`w-32 ${inputClass}`}
          />
          <button type="submit" className={btnPrimary}>添加</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {data.branches.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2.5 text-sm">
              <span>
                {b.name}
                {b.code && <span className="ml-2 text-slate-400">({b.code})</span>}
              </span>
              <button
                type="button"
                onClick={() => remove('branch', b.id, b.name)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
              >
                删除
              </button>
            </li>
          ))}
          {data.branches.length === 0 && (
            <li className="py-3 text-sm text-slate-400">暂无分公司，请先添加</li>
          )}
        </ul>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">部门</h2>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!deptName.trim() || !deptBranchId) return;
            create('department', { name: deptName.trim(), branchId: deptBranchId }, () => {
              setDeptName('');
            });
          }}
        >
          <select
            value={deptBranchId}
            onChange={(e) => setDeptBranchId(e.target.value)}
            className={selectClass}
            disabled={data.branches.length === 0}
          >
            {data.branches.length === 0 ? (
              <option value="">请先添加分公司</option>
            ) : (
              data.branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))
            )}
          </select>
          <input
            value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            placeholder="部门名称"
            className={`flex-1 ${inputClass}`}
          />
          <button type="submit" disabled={data.branches.length === 0} className={btnPrimary}>添加</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {data.departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2.5 text-sm">
              <span>
                {d.name}
                <span className="ml-2 text-slate-400">· {branchNameById(d.branchId)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove('department', d.id, d.name)}
                className="rounded-lg px-2 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
              >
                删除
              </button>
            </li>
          ))}
          {data.departments.length === 0 && (
            <li className="py-3 text-sm text-slate-400">暂无部门</li>
          )}
        </ul>
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">岗位</h2>
        <EntityForm
          name={positionName}
          onNameChange={setPositionName}
          placeholder="岗位名称"
          onSubmit={() =>
            create('position', { name: positionName.trim() }, () => setPositionName(''))
          }
        />
        <EntityList
          items={data.positions}
          emptyText="暂无岗位"
          onDelete={(id, name) => remove('position', id, name)}
        />
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">工种</h2>
        <EntityForm
          name={jobTypeName}
          onNameChange={setJobTypeName}
          placeholder="工种名称"
          onSubmit={() =>
            create('jobType', { name: jobTypeName.trim() }, () => setJobTypeName(''))
          }
        />
        <EntityList
          items={data.jobTypes}
          emptyText="暂无工种"
          onDelete={(id, name) => remove('jobType', id, name)}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">员工级别</h2>
        <p className="mt-1 text-xs text-slate-400">员工注册时可选择的能级（如一级、二级等）</p>
        <EntityForm
          name={employeeLevelName}
          onNameChange={setEmployeeLevelName}
          placeholder="级别名称"
          onSubmit={() =>
            create('employeeLevel', { name: employeeLevelName.trim() }, () => setEmployeeLevelName(''))
          }
        />
        <EntityList
          items={data.employeeLevels}
          emptyText="暂无员工级别"
          onDelete={(id, name) => remove('employeeLevel', id, name)}
        />
      </section>
    </main>
  );
}

function EntityForm({
  name,
  onNameChange,
  placeholder,
  onSubmit,
}: {
  name: string;
  onNameChange: (v: string) => void;
  placeholder: string;
  onSubmit: () => void;
}) {
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit();
      }}
    >
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={placeholder}
        className={`flex-1 ${inputClass}`}
      />
      <button type="submit" className={btnPrimary}>添加</button>
    </form>
  );
}

function EntityList({
  items,
  emptyText,
  onDelete,
}: {
  items: NamedEntity[];
  emptyText: string;
  onDelete: (id: string, name: string) => void;
}) {
  return (
    <ul className="mt-4 divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between py-2.5 text-sm">
          <span>{item.name}</span>
          <button
            type="button"
            onClick={() => onDelete(item.id, item.name)}
            className="rounded-lg px-2 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 cursor-pointer"
          >
            删除
          </button>
        </li>
      ))}
      {items.length === 0 && <li className="py-3 text-sm text-slate-400">{emptyText}</li>}
    </ul>
  );
}
