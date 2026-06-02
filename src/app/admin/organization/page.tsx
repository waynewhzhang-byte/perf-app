'use client';

import { useCallback, useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type Entity = 'branch' | 'department' | 'position' | 'jobType' | 'employeeLevel' | 'declarationLevel' | 'declarationSpecialty';

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
  declarationLevels: NamedEntity[];
  declarationSpecialties: NamedEntity[];
}

const empty: OrgData = {
  branches: [],
  departments: [],
  positions: [],
  jobTypes: [],
  employeeLevels: [],
  declarationLevels: [],
  declarationSpecialties: [],
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
  const [declarationLevelName, setDeclarationLevelName] = useState('');
  const [declarationSpecialtyName, setDeclarationSpecialtyName] = useState('');

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
        declarationLevels: d.declarationLevels ?? [],
        declarationSpecialties: d.declarationSpecialties ?? [],
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

  async function update(
    entity: Entity,
    body: { id: string; name: string; code?: string | null },
  ): Promise<boolean> {
    setMsg(null);
    const r = await fetch('/api/admin/organization', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity, ...body }),
    });
    if (r.status === 401) {
      window.location.href = '/admin/login';
      return false;
    }
    const d = await r.json();
    if (!r.ok) {
      setMsg({ type: 'error', text: d.error || '保存失败' });
      return false;
    }
    setMsg({ type: 'success', text: '已保存' });
    await load();
    return true;
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
          <p className="mt-1 text-sm text-slate-500">工区、部门、岗位、工种、员工级别、能级评价字典</p>
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
        <h2 className="font-semibold">工区</h2>
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
            placeholder="工区名称"
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
            <BranchRow
              key={b.id}
              branch={b}
              onSave={(name, code) => update('branch', { id: b.id, name, code })}
              onDelete={() => remove('branch', b.id, b.name)}
            />
          ))}
          {data.branches.length === 0 && (
            <li className="py-3 text-sm text-slate-400">暂无工区，请先添加</li>
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
              <option value="">请先添加工区</option>
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
            <DepartmentRow
              key={d.id}
              dept={d}
              branchName={branchNameById(d.branchId)}
              onSave={(name) => update('department', { id: d.id, name })}
              onDelete={() => remove('department', d.id, d.name)}
            />
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
          onSave={(id, name) => update('position', { id, name })}
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
          onSave={(id, name) => update('jobType', { id, name })}
        />
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
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
          onSave={(id, name) => update('employeeLevel', { id, name })}
        />
      </section>

      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">能级评价等级</h2>
        <p className="mt-1 text-xs text-slate-400">员工申报表头中可选择的能级评价等级（如 1级、2级）</p>
        <EntityForm
          name={declarationLevelName}
          onNameChange={setDeclarationLevelName}
          placeholder="申报等级名称"
          onSubmit={() =>
            create('declarationLevel', { name: declarationLevelName.trim() }, () => setDeclarationLevelName(''))
          }
        />
        <EntityList
          items={data.declarationLevels}
          emptyText="暂无能级评价等级"
          onDelete={(id, name) => remove('declarationLevel', id, name)}
          onSave={(id, name) => update('declarationLevel', { id, name })}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">能级评价专业</h2>
        <p className="mt-1 text-xs text-slate-400">员工申报表头中可选择的能级评价专业</p>
        <EntityForm
          name={declarationSpecialtyName}
          onNameChange={setDeclarationSpecialtyName}
          placeholder="申报专业名称"
          onSubmit={() =>
            create('declarationSpecialty', { name: declarationSpecialtyName.trim() }, () => setDeclarationSpecialtyName(''))
          }
        />
        <EntityList
          items={data.declarationSpecialties}
          emptyText="暂无能级评价专业"
          onDelete={(id, name) => remove('declarationSpecialty', id, name)}
          onSave={(id, name) => update('declarationSpecialty', { id, name })}
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

const rowEditInput =
  'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';
const rowActionBtn =
  'rounded-lg px-2 py-1 text-sm font-medium transition-colors cursor-pointer';

function EntityList({
  items,
  emptyText,
  onDelete,
  onSave,
}: Readonly<{
  items: NamedEntity[];
  emptyText: string;
  onDelete: (id: string, name: string) => void;
  onSave: (id: string, name: string) => Promise<boolean>;
}>) {
  return (
    <ul className="mt-4 divide-y divide-slate-100">
      {items.map((item) => (
        <NamedRow
          key={item.id}
          item={item}
          onSave={(name) => onSave(item.id, name)}
          onDelete={() => onDelete(item.id, item.name)}
        />
      ))}
      {items.length === 0 && <li className="py-3 text-sm text-slate-400">{emptyText}</li>}
    </ul>
  );
}

function NamedRow({
  item,
  onSave,
  onDelete,
}: Readonly<{
  item: NamedEntity;
  onSave: (name: string) => Promise<boolean>;
  onDelete: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await onSave(name.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex items-center justify-between gap-2 py-2.5 text-sm">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`flex-1 ${rowEditInput}`}
          autoFocus
        />
        <div className="flex gap-1">
          <button type="button" disabled={busy} onClick={save}
            className={`${rowActionBtn} text-emerald-600 hover:bg-emerald-50 disabled:opacity-50`}>保存</button>
          <button type="button" onClick={() => { setName(item.name); setEditing(false); }}
            className={`${rowActionBtn} text-slate-500 hover:bg-slate-50`}>取消</button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between py-2.5 text-sm">
      <span>{item.name}</span>
      <div className="flex gap-1">
        <button type="button" onClick={() => { setName(item.name); setEditing(true); }}
          className={`${rowActionBtn} text-primary-600 hover:bg-primary-50`}>编辑</button>
        <button type="button" onClick={onDelete}
          className={`${rowActionBtn} text-red-600 hover:bg-red-50`}>删除</button>
      </div>
    </li>
  );
}

function BranchRow({
  branch,
  onSave,
  onDelete,
}: Readonly<{
  branch: Branch;
  onSave: (name: string, code: string | null) => Promise<boolean>;
  onDelete: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(branch.name);
  const [code, setCode] = useState(branch.code ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await onSave(name.trim(), code.trim() || null);
    setBusy(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className={`flex-1 ${rowEditInput}`} placeholder="工区名称" autoFocus />
        <input value={code} onChange={(e) => setCode(e.target.value)}
          className={`w-28 ${rowEditInput}`} placeholder="编码（可选）" />
        <div className="flex gap-1">
          <button type="button" disabled={busy} onClick={save}
            className={`${rowActionBtn} text-emerald-600 hover:bg-emerald-50 disabled:opacity-50`}>保存</button>
          <button type="button" onClick={() => { setName(branch.name); setCode(branch.code ?? ''); setEditing(false); }}
            className={`${rowActionBtn} text-slate-500 hover:bg-slate-50`}>取消</button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between py-2.5 text-sm">
      <span>
        {branch.name}
        {branch.code && <span className="ml-2 text-slate-400">({branch.code})</span>}
      </span>
      <div className="flex gap-1">
        <button type="button" onClick={() => { setName(branch.name); setCode(branch.code ?? ''); setEditing(true); }}
          className={`${rowActionBtn} text-primary-600 hover:bg-primary-50`}>编辑</button>
        <button type="button" onClick={onDelete}
          className={`${rowActionBtn} text-red-600 hover:bg-red-50`}>删除</button>
      </div>
    </li>
  );
}

function DepartmentRow({
  dept,
  branchName,
  onSave,
  onDelete,
}: Readonly<{
  dept: Department;
  branchName: string;
  onSave: (name: string) => Promise<boolean>;
  onDelete: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dept.name);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const ok = await onSave(name.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex items-center justify-between gap-2 py-2.5 text-sm">
        <input value={name} onChange={(e) => setName(e.target.value)}
          className={`flex-1 ${rowEditInput}`} autoFocus />
        <div className="flex gap-1">
          <button type="button" disabled={busy} onClick={save}
            className={`${rowActionBtn} text-emerald-600 hover:bg-emerald-50 disabled:opacity-50`}>保存</button>
          <button type="button" onClick={() => { setName(dept.name); setEditing(false); }}
            className={`${rowActionBtn} text-slate-500 hover:bg-slate-50`}>取消</button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between py-2.5 text-sm">
      <span>
        {dept.name}
        <span className="ml-2 text-slate-400">· {branchName}</span>
      </span>
      <div className="flex gap-1">
        <button type="button" onClick={() => { setName(dept.name); setEditing(true); }}
          className={`${rowActionBtn} text-primary-600 hover:bg-primary-50`}>编辑</button>
        <button type="button" onClick={onDelete}
          className={`${rowActionBtn} text-red-600 hover:bg-red-50`}>删除</button>
      </div>
    </li>
  );
}
