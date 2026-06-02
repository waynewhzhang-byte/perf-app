'use client';

import { AdminPageActions } from '@/components/admin-page-actions';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

type AppRole = 'EMPLOYEE' | 'REVIEWER_L1' | 'REVIEWER_L2' | 'ADMIN';

interface UserRole {
  id: string;
  role: AppRole;
  scopeBranchId: string | null;
  branch?: { id: string; name: string } | null;
}

interface UserRow {
  id: string;
  contact: string;
  fullName: string;
  employeeNo: string | null;
  branchId: string | null;
  departmentId: string | null;
  positionId: string | null;
  jobTypeId: string | null;
  employeeLevelId: string | null;
  branch?: { name: string } | null;
  department?: { name: string } | null;
  employeeLevel?: { name: string } | null;
  roles: UserRole[];
}

interface Branch {
  id: string;
  name: string;
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

interface UserProfileForm {
  contact: string;
  password: string;
  fullName: string;
  employeeNo: string;
  branchId: string;
  departmentId: string;
  positionId: string;
  jobTypeId: string;
  employeeLevelId: string;
}

const emptyOrg: OrgData = {
  branches: [],
  departments: [],
  positions: [],
  jobTypes: [],
  employeeLevels: [],
};

const emptyProfile: UserProfileForm = {
  contact: '',
  password: '',
  fullName: '',
  employeeNo: '',
  branchId: '',
  departmentId: '',
  positionId: '',
  jobTypeId: '',
  employeeLevelId: '',
};

const ROLE_LABEL: Record<AppRole, string> = {
  EMPLOYEE: '员工',
  REVIEWER_L1: '一级审核',
  REVIEWER_L2: '二级审核',
  ADMIN: '管理员',
};

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const selectClass =
  'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors disabled:bg-slate-50 disabled:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const btnPrimary =
  'rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';

const btnDanger =
  'rounded-lg px-2 py-1 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 cursor-pointer';

function roleLabel(role: UserRole): string {
  if (role.role === 'REVIEWER_L1' && role.scopeBranchId) {
    const name = role.branch?.name;
    return name ? `一级审核 · ${name}` : '一级审核';
  }
  return ROLE_LABEL[role.role];
}

function hasRole(user: UserRow, role: AppRole, scopeBranchId?: string | null): boolean {
  return user.roles.some(
    (r) =>
      r.role === role &&
      (role !== 'REVIEWER_L1' || (r.scopeBranchId ?? null) === (scopeBranchId ?? null)),
  );
}

function profileFromUser(u: UserRow): UserProfileForm {
  return {
    contact: u.contact,
    password: '',
    fullName: u.fullName,
    employeeNo: u.employeeNo ?? '',
    branchId: u.branchId ?? '',
    departmentId: u.departmentId ?? '',
    positionId: u.positionId ?? '',
    jobTypeId: u.jobTypeId ?? '',
    employeeLevelId: u.employeeLevelId ?? '',
  };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [org, setOrg] = useState<OrgData>(emptyOrg);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [l1BranchByUser, setL1BranchByUser] = useState<Record<string, string>>({});
  const [createForm, setCreateForm] = useState<UserProfileForm>(emptyProfile);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserProfileForm>(emptyProfile);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [usersRes, orgRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/organization'),
      ]);
      if (usersRes.status === 401 || orgRes.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const usersData = await usersRes.json();
      const orgData = await orgRes.json();
      if (!usersRes.ok) {
        setLoadError(usersData.error || '加载用户失败');
        return;
      }
      if (!orgRes.ok) {
        setLoadError(orgData.error || '加载组织信息失败');
        return;
      }
      const list: UserRow[] = usersData.users ?? [];
      const nextOrg: OrgData = {
        branches: orgData.branches ?? [],
        departments: orgData.departments ?? [],
        positions: orgData.positions ?? [],
        jobTypes: orgData.jobTypes ?? [],
        employeeLevels: orgData.employeeLevels ?? [],
      };
      setUsers(list);
      setOrg(nextOrg);
      setCreateForm((prev) => ({
        ...prev,
        branchId: prev.branchId || nextOrg.branches[0]?.id || '',
      }));
      setL1BranchByUser((prev) => {
        const next = { ...prev };
        for (const u of list) {
          if (!next[u.id]) next[u.id] = nextOrg.branches[0]?.id ?? '';
        }
        return next;
      });
    } catch {
      setLoadError('加载失败，请检查网络连接');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const departmentsForBranch = useCallback(
    (branchId: string) => org.departments.filter((d) => d.branchId === branchId),
    [org.departments],
  );

  const createDepartments = useMemo(
    () => departmentsForBranch(createForm.branchId),
    [createForm.branchId, departmentsForBranch],
  );

  const editDepartments = useMemo(
    () => departmentsForBranch(editForm.branchId),
    [editForm.branchId, departmentsForBranch],
  );

  async function postAdmin(body: Record<string, unknown>) {
    const r = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 401) {
      window.location.href = '/admin/login';
      return null;
    }
    const d = await r.json();
    return { ok: r.ok, status: r.status, data: d };
  }

  async function mutateRole(
    userId: string,
    role: AppRole,
    action: 'add' | 'remove',
    scopeBranchId?: string | null,
  ) {
    setMsg(null);
    setBusy(true);
    try {
      const res = await postAdmin({ userId, role, action, scopeBranchId: scopeBranchId ?? null });
      if (!res) return;
      if (!res.ok) {
        setMsg({ type: 'error', text: res.data.error || '操作失败' });
        return;
      }
      setMsg({ type: 'success', text: '已更新' });
      await load();
    } catch {
      setMsg({ type: 'error', text: '网络错误' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleRole(user: UserRow, role: AppRole, scopeBranchId?: string | null) {
    const present = hasRole(user, role, scopeBranchId);
    if (role === 'REVIEWER_L1' && !present) {
      const branchId = scopeBranchId ?? l1BranchByUser[user.id];
      if (!branchId) {
        setMsg({ type: 'error', text: '请先添加工区' });
        return;
      }
      if (hasRole(user, 'REVIEWER_L1', branchId)) return;
      await mutateRole(user.id, role, 'add', branchId);
      return;
    }
    await mutateRole(user.id, role, present ? 'remove' : 'add', scopeBranchId ?? null);
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!createForm.contact.trim() || !createForm.fullName.trim()) {
      setMsg({ type: 'error', text: '请填写联系方式与姓名' });
      return;
    }
    if (createForm.password.length < 8) {
      setMsg({ type: 'error', text: '登录密码至少 8 位' });
      return;
    }
    setBusy(true);
    try {
      const res = await postAdmin({
        action: 'create',
        contact: createForm.contact.trim(),
        password: createForm.password,
        fullName: createForm.fullName.trim(),
        employeeNo: createForm.employeeNo.trim() || null,
        branchId: createForm.branchId || null,
        departmentId: createForm.departmentId || null,
        positionId: createForm.positionId || null,
        jobTypeId: createForm.jobTypeId || null,
        employeeLevelId: createForm.employeeLevelId || null,
      });
      if (!res) return;
      if (!res.ok) {
        setMsg({ type: 'error', text: res.data.error || '创建失败' });
        return;
      }
      setMsg({ type: 'success', text: '用户已创建' });
      setCreateForm({ ...emptyProfile, branchId: org.branches[0]?.id ?? '' });
      await load();
    } catch {
      setMsg({ type: 'error', text: '网络错误' });
    } finally {
      setBusy(false);
    }
  }

  function startEdit(u: UserRow) {
    setPasswordUserId(null);
    setNewPassword('');
    setEditingUserId(u.id);
    setEditForm(profileFromUser(u));
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUserId) return;
    setMsg(null);
    if (!editForm.fullName.trim()) {
      setMsg({ type: 'error', text: '姓名不能为空' });
      return;
    }
    setBusy(true);
    try {
      const res = await postAdmin({
        action: 'update',
        userId: editingUserId,
        fullName: editForm.fullName.trim(),
        employeeNo: editForm.employeeNo.trim() || null,
        branchId: editForm.branchId || null,
        departmentId: editForm.departmentId || null,
        positionId: editForm.positionId || null,
        jobTypeId: editForm.jobTypeId || null,
        employeeLevelId: editForm.employeeLevelId || null,
      });
      if (!res) return;
      if (!res.ok) {
        setMsg({ type: 'error', text: res.data.error || '保存失败' });
        return;
      }
      setMsg({ type: 'success', text: '资料已更新' });
      setEditingUserId(null);
      await load();
    } catch {
      setMsg({ type: 'error', text: '网络错误' });
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!passwordUserId) return;
    setMsg(null);
    if (newPassword.length < 8) {
      setMsg({ type: 'error', text: '密码至少 8 位' });
      return;
    }
    setBusy(true);
    try {
      const res = await postAdmin({
        action: 'setPassword',
        userId: passwordUserId,
        password: newPassword,
      });
      if (!res) return;
      if (!res.ok) {
        setMsg({ type: 'error', text: res.data.error || '重置失败' });
        return;
      }
      setMsg({ type: 'success', text: '密码已更新' });
      setPasswordUserId(null);
      setNewPassword('');
    } catch {
      setMsg({ type: 'error', text: '网络错误' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用户与角色</h1>
          <p className="mt-1 text-sm text-slate-500">手工添加用户、维护资料与登录密码，并分配审核角色</p>
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

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">添加用户</h2>
        <p className="mt-1 text-xs text-slate-400">
          由管理员创建账号并设置初始密码，用户可使用联系方式登录员工端
        </p>
        <form onSubmit={createUser}>
          <ProfileFields
            form={createForm}
            setForm={setCreateForm}
            org={org}
            departments={createDepartments}
            showContact
            showPassword
            passwordLabel="初始密码"
            contactReadOnly={false}
          />
          <button type="submit" disabled={busy} className={`mt-4 ${btnPrimary}`}>
            创建用户
          </button>
        </form>
      </section>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">姓名</th>
                <th className="px-4 py-3 font-medium">联系方式</th>
                <th className="px-4 py-3 font-medium">组织</th>
                <th className="px-4 py-3 font-medium">当前角色</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <Fragment key={u.id}>
                  <tr className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.fullName}</div>
                      {u.employeeNo && (
                        <div className="text-xs text-slate-400">工号 {u.employeeNo}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{u.contact}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {[u.branch?.name, u.department?.name, u.employeeLevel?.name]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length === 0 ? (
                          <span className="text-slate-400">无</span>
                        ) : (
                          u.roles.map((r) => (
                            <span
                              key={r.id}
                              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
                            >
                              {roleLabel(r)}
                              {r.role !== 'EMPLOYEE' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => mutateRole(u.id, r.role, 'remove', r.scopeBranchId)}
                                  className="ml-0.5 text-red-500 transition-colors hover:text-red-700 disabled:opacity-50 cursor-pointer"
                                  title="移除角色"
                                >
                                  ×
                                </button>
                              )}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              editingUserId === u.id ? setEditingUserId(null) : startEdit(u)
                            }
                            className="font-medium text-primary-600 transition-colors hover:text-primary-700 disabled:opacity-50 cursor-pointer"
                          >
                            {editingUserId === u.id ? '取消编辑' : '编辑资料'}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setEditingUserId(null);
                              setPasswordUserId(passwordUserId === u.id ? null : u.id);
                              setNewPassword('');
                            }}
                            className="font-medium text-primary-600 transition-colors hover:text-primary-700 disabled:opacity-50 cursor-pointer"
                          >
                            {passwordUserId === u.id ? '取消改密' : '重置密码'}
                          </button>
                        </div>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={busy || hasRole(u, 'REVIEWER_L2')}
                            checked={hasRole(u, 'REVIEWER_L2')}
                            onChange={() => toggleRole(u, 'REVIEWER_L2')}
                            className="rounded border-slate-300"
                          />
                          二级审核
                        </label>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            disabled={busy || hasRole(u, 'ADMIN')}
                            checked={hasRole(u, 'ADMIN')}
                            onChange={() => toggleRole(u, 'ADMIN')}
                            className="rounded border-slate-300"
                          />
                          管理员
                        </label>
                        <div className="flex flex-wrap items-center gap-1 text-xs">
                          <select
                            value={l1BranchByUser[u.id] ?? ''}
                            onChange={(e) =>
                              setL1BranchByUser((prev) => ({ ...prev, [u.id]: e.target.value }))
                            }
                            className="max-w-[8rem] rounded-lg border border-slate-300 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/20"
                            disabled={org.branches.length === 0 || busy}
                          >
                            {org.branches.length === 0 ? (
                              <option value="">无工区</option>
                            ) : (
                              org.branches.map((b) => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))
                            )}
                          </select>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              org.branches.length === 0 ||
                              hasRole(u, 'REVIEWER_L1', l1BranchByUser[u.id])
                            }
                            onClick={() => toggleRole(u, 'REVIEWER_L1', l1BranchByUser[u.id])}
                            className="rounded-lg border border-slate-300 px-2 py-1 font-medium transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                          >
                            添加一级审核
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                  {editingUserId === u.id && (
                    <tr>
                      <td colSpan={5} className="bg-slate-50 px-4 py-4">
                        <form onSubmit={saveEdit}>
                          <p className="mb-3 text-sm font-semibold">编辑资料 · {u.fullName}</p>
                          <ProfileFields
                            form={editForm}
                            setForm={setEditForm}
                            org={org}
                            departments={editDepartments}
                            showContact
                            contactReadOnly
                          />
                          <button type="submit" disabled={busy} className={`mt-3 ${btnPrimary}`}>
                            保存资料
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                  {passwordUserId === u.id && (
                    <tr>
                      <td colSpan={5} className="bg-amber-50 px-4 py-4">
                        <form onSubmit={savePassword}>
                          <p className="mb-2 text-sm font-semibold">设置登录密码 · {u.contact}</p>
                          <label className="block text-sm">
                            <span className="text-slate-600">新密码（至少 8 位）</span>
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              className="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                            />
                          </label>
                          <button type="submit" disabled={busy} className={`mt-3 ${btnPrimary}`}>
                            更新密码
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {users.length === 0 && !loadError && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                    暂无用户
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function ProfileFields({
  form,
  setForm,
  org,
  departments,
  showContact = false,
  showPassword = false,
  passwordLabel = '密码',
  contactReadOnly = false,
}: {
  form: UserProfileForm;
  setForm: (f: UserProfileForm) => void;
  org: OrgData;
  departments: Department[];
  showContact?: boolean;
  showPassword?: boolean;
  passwordLabel?: string;
  contactReadOnly?: boolean;
}) {
  const patch = (partial: Partial<UserProfileForm>) => setForm({ ...form, ...partial });

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {showContact && (
        <Field label="联系方式（手机/邮箱）">
          <input
            value={form.contact}
            onChange={(e) => patch({ contact: e.target.value })}
            readOnly={contactReadOnly}
            className={`${inputClass} ${contactReadOnly ? 'bg-slate-50 text-slate-500' : ''}`}
            placeholder="登录账号"
          />
        </Field>
      )}
      {showPassword && (
        <Field label={passwordLabel}>
          <input
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => patch({ password: e.target.value })}
            className={inputClass}
            placeholder="至少 8 位"
          />
        </Field>
      )}
      <Field label="姓名">
        <input
          value={form.fullName}
          onChange={(e) => patch({ fullName: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="工号">
        <input
          value={form.employeeNo}
          onChange={(e) => patch({ employeeNo: e.target.value })}
          className={inputClass}
        />
      </Field>
      <Field label="工区">
        <select
          value={form.branchId}
          onChange={(e) => patch({ branchId: e.target.value, departmentId: '' })}
          className={selectClass}
        >
          <option value="">未选择</option>
          {org.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </Field>
      <Field label="部门">
        <select
          value={form.departmentId}
          onChange={(e) => patch({ departmentId: e.target.value })}
          className={selectClass}
          disabled={!form.branchId}
        >
          <option value="">未选择</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </Field>
      <Field label="岗位">
        <select
          value={form.positionId}
          onChange={(e) => patch({ positionId: e.target.value })}
          className={selectClass}
        >
          <option value="">未选择</option>
          {org.positions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="工种">
        <select
          value={form.jobTypeId}
          onChange={(e) => patch({ jobTypeId: e.target.value })}
          className={selectClass}
        >
          <option value="">未选择</option>
          {org.jobTypes.map((j) => (
            <option key={j.id} value={j.id}>{j.name}</option>
          ))}
        </select>
      </Field>
      <Field label="员工级别">
        <select
          value={form.employeeLevelId}
          onChange={(e) => patch({ employeeLevelId: e.target.value })}
          className={selectClass}
        >
          <option value="">未选择</option>
          {org.employeeLevels.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
