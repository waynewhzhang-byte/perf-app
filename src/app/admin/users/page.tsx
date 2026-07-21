'use client';

import { AdminPageActions } from '@/components/admin-page-actions';
import {
  HQ_BRANCH_NAME,
  isSecondLevelReviewDepartment,
} from '@/lib/review-departments';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

type AppRole = 'EMPLOYEE' | 'REVIEWER_L1' | 'REVIEWER_L2' | 'ADMIN';
type CreateMode = 'reviewer' | 'employee';

interface UserRole {
  id: string;
  role: AppRole;
  scopeBranchId: string | null;
  scopeDepartmentId: string | null;
  branch?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
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

interface Branch { id: string; name: string }
interface Department { id: string; name: string; branchId: string }
interface NamedEntity { id: string; name: string }
interface OrgData {
  branches: Branch[];
  departments: Department[];
  positions: NamedEntity[];
  jobTypes: NamedEntity[];
  employeeLevels: NamedEntity[];
}

interface EmployeeForm {
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

interface ReviewerForm {
  contact: string;
  password: string;
  fullName: string;
  reviewerRole: 'REVIEWER_L1' | 'REVIEWER_L2';
  scopeBranchId: string;
  scopeDepartmentId: string;
}

interface L1ScopeDraft { branchId: string; departmentId: string }

const emptyOrg: OrgData = {
  branches: [], departments: [], positions: [], jobTypes: [], employeeLevels: [],
};
const emptyEmployee: EmployeeForm = {
  contact: '', password: '', fullName: '', employeeNo: '', branchId: '', departmentId: '',
  positionId: '', jobTypeId: '', employeeLevelId: '',
};
const emptyReviewer: ReviewerForm = {
  contact: '', password: '', fullName: '', reviewerRole: 'REVIEWER_L1',
  scopeBranchId: '', scopeDepartmentId: '',
};

const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';
const selectClass = `${inputClass} disabled:bg-slate-50 disabled:text-slate-400`;
const btnPrimary = 'rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/30 disabled:cursor-not-allowed disabled:opacity-50';

function isReviewer(user: UserRow) {
  return user.roles.some(({ role }) => role === 'REVIEWER_L1' || role === 'REVIEWER_L2');
}

function profileFromUser(user: UserRow): EmployeeForm {
  return {
    contact: user.contact,
    password: '',
    fullName: user.fullName,
    employeeNo: user.employeeNo ?? '',
    branchId: user.branchId ?? '',
    departmentId: user.departmentId ?? '',
    positionId: user.positionId ?? '',
    jobTypeId: user.jobTypeId ?? '',
    employeeLevelId: user.employeeLevelId ?? '',
  };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [org, setOrg] = useState<OrgData>(emptyOrg);
  const [mode, setMode] = useState<CreateMode>('reviewer');
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployee);
  const [reviewerForm, setReviewerForm] = useState<ReviewerForm>(emptyReviewer);
  const [l1ScopeByUser, setL1ScopeByUser] = useState<Record<string, L1ScopeDraft>>({});
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EmployeeForm>(emptyEmployee);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      if (!usersRes.ok || !orgRes.ok) {
        setLoadError(usersData.error || orgData.error || '加载账号信息失败');
        return;
      }
      const nextUsers: UserRow[] = usersData.users ?? [];
      const nextOrg: OrgData = {
        branches: orgData.branches ?? [],
        departments: orgData.departments ?? [],
        positions: orgData.positions ?? [],
        jobTypes: orgData.jobTypes ?? [],
        employeeLevels: orgData.employeeLevels ?? [],
      };
      const defaultBranch = nextOrg.branches.find(({ name }) => name !== HQ_BRANCH_NAME)
        ?? nextOrg.branches[0];
      setUsers(nextUsers);
      setOrg(nextOrg);
      setEmployeeForm((prev) => ({ ...prev, branchId: prev.branchId || defaultBranch?.id || '' }));
      setReviewerForm((prev) => ({
        ...prev,
        scopeBranchId: prev.scopeBranchId || defaultBranch?.id || '',
      }));
      setL1ScopeByUser((prev) => Object.fromEntries(nextUsers.map((user) => [
        user.id,
        prev[user.id] ?? { branchId: defaultBranch?.id ?? '', departmentId: '' },
      ])));
    } catch {
      setLoadError('加载失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const employees = useMemo(() => users.filter(({ employeeNo }) => Boolean(employeeNo)), [users]);
  const reviewers = useMemo(
    () => users.filter((user) => !user.employeeNo && isReviewer(user)),
    [users],
  );
  const managementAccounts = useMemo(
    () => users.filter((user) => !user.employeeNo && !isReviewer(user)),
    [users],
  );
  const hqBranch = org.branches.find(({ name }) => name === HQ_BRANCH_NAME);
  const departmentsForBranch = useCallback(
    (branchId: string) => org.departments.filter((department) => department.branchId === branchId),
    [org.departments],
  );
  const reviewerDepartments = reviewerForm.reviewerRole === 'REVIEWER_L2'
    ? org.departments.filter((department) =>
        department.branchId === hqBranch?.id && isSecondLevelReviewDepartment(department.name))
    : departmentsForBranch(reviewerForm.scopeBranchId);

  async function postAdmin(body: Record<string, unknown>) {
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      window.location.href = '/admin/login';
      return null;
    }
    return { ok: response.ok, data: await response.json() };
  }

  async function submit(body: Record<string, unknown>, successText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const response = await postAdmin(body);
      if (!response) return false;
      if (!response.ok) {
        setMsg({ type: 'error', text: response.data.error || '操作失败' });
        return false;
      }
      setMsg({ type: 'success', text: successText });
      await load();
      return true;
    } catch {
      setMsg({ type: 'error', text: '网络错误' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createEmployee(event: React.FormEvent) {
    event.preventDefault();
    if (!employeeForm.contact.trim() || !employeeForm.fullName.trim() || !employeeForm.employeeNo.trim()) {
      setMsg({ type: 'error', text: '请填写登录账号、姓名和工号' });
      return;
    }
    const created = await submit({
      action: 'create',
      accountType: 'employee',
      ...employeeForm,
      contact: employeeForm.contact.trim(),
      fullName: employeeForm.fullName.trim(),
      employeeNo: employeeForm.employeeNo.trim(),
      branchId: employeeForm.branchId || null,
      departmentId: employeeForm.departmentId || null,
      positionId: employeeForm.positionId || null,
      jobTypeId: employeeForm.jobTypeId || null,
      employeeLevelId: employeeForm.employeeLevelId || null,
    }, '员工账号已创建');
    if (created) setEmployeeForm({ ...emptyEmployee, branchId: org.branches[0]?.id ?? '' });
  }

  async function createReviewer(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewerForm.contact.trim() || !reviewerForm.fullName.trim()) {
      setMsg({ type: 'error', text: '请填写登录账号与姓名' });
      return;
    }
    const selectedBranch = reviewerForm.reviewerRole === 'REVIEWER_L2'
      ? hqBranch?.id ?? ''
      : reviewerForm.scopeBranchId;
    if (!selectedBranch) {
      setMsg({ type: 'error', text: '请选择审核范围' });
      return;
    }
    const branch = org.branches.find(({ id }) => id === selectedBranch);
    if ((reviewerForm.reviewerRole === 'REVIEWER_L2' || branch?.name === HQ_BRANCH_NAME) && !reviewerForm.scopeDepartmentId) {
      setMsg({ type: 'error', text: '请选择总部部门' });
      return;
    }
    const created = await submit({
      action: 'create',
      accountType: 'reviewer',
      contact: reviewerForm.contact.trim(),
      password: reviewerForm.password,
      fullName: reviewerForm.fullName.trim(),
      reviewerRole: reviewerForm.reviewerRole,
      scopeBranchId: selectedBranch,
      scopeDepartmentId: reviewerForm.scopeDepartmentId || null,
    }, '审核员账号已创建，不计入员工人数');
    if (created) {
      const defaultBranch = org.branches.find(({ name }) => name !== HQ_BRANCH_NAME) ?? org.branches[0];
      setReviewerForm({ ...emptyReviewer, scopeBranchId: defaultBranch?.id ?? '' });
    }
  }

  async function mutateRole(
    userId: string,
    role: AppRole,
    action: 'add' | 'remove',
    scopeBranchId: string | null = null,
    scopeDepartmentId: string | null = null,
  ) {
    await submit({ userId, role, action, scopeBranchId, scopeDepartmentId }, '审核权限已更新');
  }

  async function addL1Scope(user: UserRow) {
    const draft = l1ScopeByUser[user.id];
    if (!draft?.branchId) return;
    const branch = org.branches.find(({ id }) => id === draft.branchId);
    if (branch?.name === HQ_BRANCH_NAME && !draft.departmentId) {
      setMsg({ type: 'error', text: '请选择总部部门' });
      return;
    }
    await mutateRole(
      user.id,
      'REVIEWER_L1',
      'add',
      draft.branchId,
      branch?.name === HQ_BRANCH_NAME ? draft.departmentId : null,
    );
  }

  function startEdit(user: UserRow) {
    setPasswordUserId(null);
    setEditingUserId(user.id);
    setEditForm(profileFromUser(user));
  }

  async function saveEdit(event: React.FormEvent, user: UserRow) {
    event.preventDefault();
    if (!editForm.fullName.trim()) return;
    const reviewerAccount = !user.employeeNo && isReviewer(user);
    const updated = await submit(reviewerAccount
      ? { action: 'update', userId: user.id, fullName: editForm.fullName.trim() }
      : {
          action: 'update', userId: user.id, fullName: editForm.fullName.trim(),
          employeeNo: editForm.employeeNo.trim() || null,
          branchId: editForm.branchId || null,
          departmentId: editForm.departmentId || null,
          positionId: editForm.positionId || null,
          jobTypeId: editForm.jobTypeId || null,
          employeeLevelId: editForm.employeeLevelId || null,
        }, '资料已更新');
    if (updated) setEditingUserId(null);
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (!passwordUserId) return;
    const updated = await submit(
      { action: 'setPassword', userId: passwordUserId, password: newPassword },
      '登录密码已更新',
    );
    if (updated) {
      setPasswordUserId(null);
      setNewPassword('');
    }
  }

  function renderAccounts(list: UserRow[], kind: 'employee' | 'reviewer' | 'management') {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">姓名</th>
              <th className="px-4 py-3 font-medium">登录账号</th>
              <th className="px-4 py-3 font-medium">{kind === 'reviewer' ? '审核范围' : '组织'}</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((user) => (
              <Fragment key={user.id}>
                <tr className="align-top transition-colors hover:bg-slate-50/70">
                  <td className="px-4 py-3.5">
                    <div className="font-medium text-slate-900">{user.fullName}</div>
                    {user.employeeNo && <div className="mt-0.5 text-xs text-slate-400">工号 {user.employeeNo}</div>}
                  </td>
                  <td className="px-4 py-3.5 text-slate-700">{user.contact}</td>
                  <td className="px-4 py-3.5 text-slate-600">
                    {[user.branch?.name, user.department?.name, kind === 'employee' ? user.employeeLevel?.name : null]
                      .filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex max-w-xs flex-wrap gap-1.5">
                      {user.roles.map((role) => {
                        const label = role.role === 'REVIEWER_L1'
                          ? `一级 · ${[role.branch?.name, role.department?.name].filter(Boolean).join(' · ')}`
                          : role.role === 'REVIEWER_L2' ? '二级审核' : role.role === 'EMPLOYEE' ? '员工' : '管理员';
                        return (
                          <span key={role.id} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                            role.role.startsWith('REVIEWER')
                              ? 'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}>
                            {label}
                            {kind === 'reviewer' && role.role.startsWith('REVIEWER') && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => mutateRole(user.id, role.role, 'remove', role.scopeBranchId, role.scopeDepartmentId)}
                                className="ml-0.5 text-red-500 hover:text-red-700 disabled:opacity-50"
                                title="移除审核权限"
                              >×</button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-3 text-xs font-medium">
                      <button type="button" disabled={busy} onClick={() => editingUserId === user.id ? setEditingUserId(null) : startEdit(user)} className="text-primary-600 hover:text-primary-800 disabled:opacity-50">
                        {editingUserId === user.id ? '取消编辑' : '编辑资料'}
                      </button>
                      <button type="button" disabled={busy} onClick={() => {
                        setEditingUserId(null);
                        setPasswordUserId(passwordUserId === user.id ? null : user.id);
                        setNewPassword('');
                      }} className="text-primary-600 hover:text-primary-800 disabled:opacity-50">
                        {passwordUserId === user.id ? '取消改密' : '重置密码'}
                      </button>
                    </div>
                  </td>
                </tr>
                {kind === 'reviewer' && user.roles.some(({ role }) => role === 'REVIEWER_L1') && (
                  <tr>
                    <td colSpan={5} className="bg-primary-50/40 px-4 py-3">
                      <div className="flex flex-wrap items-end gap-2 text-xs">
                        <Field label="增加一级审核范围" compact>
                          <select value={l1ScopeByUser[user.id]?.branchId ?? ''} onChange={(event) => {
                            const branchId = event.target.value;
                            setL1ScopeByUser((prev) => ({ ...prev, [user.id]: { branchId, departmentId: '' } }));
                          }} className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs">
                            {org.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                          </select>
                        </Field>
                        {org.branches.find(({ id }) => id === l1ScopeByUser[user.id]?.branchId)?.name === HQ_BRANCH_NAME && (
                          <Field label="总部部门" compact>
                            <select value={l1ScopeByUser[user.id]?.departmentId ?? ''} onChange={(event) => setL1ScopeByUser((prev) => ({ ...prev, [user.id]: { ...prev[user.id], departmentId: event.target.value } }))} className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs">
                              <option value="">请选择</option>
                              {departmentsForBranch(l1ScopeByUser[user.id]?.branchId ?? '').map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                            </select>
                          </Field>
                        )}
                        <button type="button" disabled={busy} onClick={() => addL1Scope(user)} className="rounded-lg border border-primary-200 bg-white px-3 py-2 font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50">添加范围</button>
                      </div>
                    </td>
                  </tr>
                )}
                {editingUserId === user.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-4 py-4">
                      <form onSubmit={(event) => saveEdit(event, user)}>
                        <p className="mb-3 text-sm font-semibold">编辑资料 · {user.fullName}</p>
                        {kind === 'employee' ? (
                          <EmployeeFields form={editForm} setForm={setEditForm} org={org} departments={departmentsForBranch(editForm.branchId)} showContact contactReadOnly />
                        ) : (
                          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
                            <Field label="登录账号"><input value={editForm.contact} readOnly className={`${inputClass} bg-slate-100 text-slate-500`} /></Field>
                            <Field label="姓名"><input value={editForm.fullName} onChange={(event) => setEditForm({ ...editForm, fullName: event.target.value })} className={inputClass} /></Field>
                          </div>
                        )}
                        <button type="submit" disabled={busy} className={`mt-3 ${btnPrimary}`}>保存资料</button>
                      </form>
                    </td>
                  </tr>
                )}
                {passwordUserId === user.id && (
                  <tr>
                    <td colSpan={5} className="bg-amber-50 px-4 py-4">
                      <form onSubmit={savePassword} className="flex flex-wrap items-end gap-3">
                        <Field label={`新密码 · ${user.contact}`} compact>
                          <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={`${inputClass} min-w-64`} placeholder="至少 8 位并符合密码策略" />
                        </Field>
                        <button type="submit" disabled={busy} className={btnPrimary}>更新密码</button>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {list.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">暂无账号</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">用户与角色</h1>
          <p className="mt-1.5 text-sm text-slate-500">435 名员工与独立审核员账号分开管理</p>
        </div>
        <AdminPageActions />
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="border-l-4 border-slate-700 bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">员工账号</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{loading ? '—' : employees.length}</p>
          <p className="mt-1 text-xs text-slate-500">以工号识别，计入员工总数</p>
        </div>
        <div className="border-l-4 border-primary-600 bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">审核员账号</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-primary-700">{loading ? '—' : reviewers.length}</p>
          <p className="mt-1 text-xs text-slate-500">独立登录账号，不计入 435 名员工</p>
        </div>
      </section>

      {loadError && <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}
      {msg && <div className={`mb-4 border px-4 py-3 text-sm ${msg.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{msg.text}</div>}

      <section className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex border-b border-slate-200 bg-slate-50 p-1.5">
          {([['reviewer', '添加审核员'], ['employee', '添加员工']] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setMode(value)} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${mode === value ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>
          ))}
        </div>
        <div className="p-5 sm:p-6">
          {mode === 'reviewer' ? (
            <form onSubmit={createReviewer}>
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">创建独立审核员账号</h2>
                  <p className="mt-1 text-xs text-slate-500">一级审核按工区或总部部门授权；二级审核仅限三个总部审核部门。</p>
                </div>
                <span className="rounded-md bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 ring-1 ring-inset ring-primary-200">不计入员工人数</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="姓名"><input value={reviewerForm.fullName} onChange={(event) => setReviewerForm({ ...reviewerForm, fullName: event.target.value })} className={inputClass} /></Field>
                <Field label="登录账号"><input value={reviewerForm.contact} onChange={(event) => setReviewerForm({ ...reviewerForm, contact: event.target.value })} className={inputClass} placeholder="手机号、邮箱或管理账号" /></Field>
                <Field label="初始密码"><input type="password" autoComplete="new-password" value={reviewerForm.password} onChange={(event) => setReviewerForm({ ...reviewerForm, password: event.target.value })} className={inputClass} placeholder="至少 8 位并符合密码策略" /></Field>
                <Field label="审核级别">
                  <select value={reviewerForm.reviewerRole} onChange={(event) => {
                    const reviewerRole = event.target.value as ReviewerForm['reviewerRole'];
                    const department = reviewerRole === 'REVIEWER_L2'
                      ? org.departments.find((item) => item.branchId === hqBranch?.id && isSecondLevelReviewDepartment(item.name))
                      : undefined;
                    setReviewerForm({ ...reviewerForm, reviewerRole, scopeBranchId: reviewerRole === 'REVIEWER_L2' ? hqBranch?.id ?? '' : reviewerForm.scopeBranchId, scopeDepartmentId: department?.id ?? '' });
                  }} className={selectClass}>
                    <option value="REVIEWER_L1">一级审核员</option>
                    <option value="REVIEWER_L2">二级审核员</option>
                  </select>
                </Field>
                {reviewerForm.reviewerRole === 'REVIEWER_L1' && (
                  <Field label="审核工区">
                    <select value={reviewerForm.scopeBranchId} onChange={(event) => setReviewerForm({ ...reviewerForm, scopeBranchId: event.target.value, scopeDepartmentId: '' })} className={selectClass}>
                      <option value="">请选择工区</option>
                      {org.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                    </select>
                  </Field>
                )}
                {(reviewerForm.reviewerRole === 'REVIEWER_L2' || org.branches.find(({ id }) => id === reviewerForm.scopeBranchId)?.name === HQ_BRANCH_NAME) && (
                  <Field label={reviewerForm.reviewerRole === 'REVIEWER_L2' ? '二级审核部门' : '总部二级部门'}>
                    <select value={reviewerForm.scopeDepartmentId} onChange={(event) => setReviewerForm({ ...reviewerForm, scopeDepartmentId: event.target.value })} className={selectClass}>
                      <option value="">请选择部门</option>
                      {reviewerDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              <button type="submit" disabled={busy || loading} className={`mt-5 ${btnPrimary}`}>创建审核员账号</button>
            </form>
          ) : (
            <form onSubmit={createEmployee}>
              <h2 className="font-semibold text-slate-900">添加员工账号</h2>
              <p className="mt-1 text-xs text-slate-500">员工必须填写唯一工号，创建后计入员工账号总数。</p>
              <EmployeeFields form={employeeForm} setForm={setEmployeeForm} org={org} departments={departmentsForBranch(employeeForm.branchId)} showContact showPassword />
              <button type="submit" disabled={busy || loading} className={`mt-5 ${btnPrimary}`}>创建员工账号</button>
            </form>
          )}
        </div>
      </section>

      <section className="mb-7 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">审核员账号 <span className="ml-1 text-sm font-normal text-slate-400">{reviewers.length}</span></h2>
          <p className="mt-1 text-xs text-slate-500">管理审核范围、基础资料和独立登录密码。</p>
        </div>
        {renderAccounts(reviewers, 'reviewer')}
      </section>

      <section className="mb-7 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-900">员工账号 <span className="ml-1 text-sm font-normal text-slate-400">{employees.length}</span></h2>
          <p className="mt-1 text-xs text-slate-500">仅维护员工资料和密码，不在此授予审核角色。</p>
        </div>
        {renderAccounts(employees, 'employee')}
      </section>

      {managementAccounts.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="font-semibold text-slate-900">其他管理账号 <span className="ml-1 text-sm font-normal text-slate-400">{managementAccounts.length}</span></h2>
            <p className="mt-1 text-xs text-slate-500">管理员账号不计入员工或审核员人数。</p>
          </div>
          {renderAccounts(managementAccounts, 'management')}
        </section>
      )}
    </main>
  );
}

function EmployeeFields({ form, setForm, org, departments, showContact = false, showPassword = false, contactReadOnly = false }: {
  form: EmployeeForm;
  setForm: (form: EmployeeForm) => void;
  org: OrgData;
  departments: Department[];
  showContact?: boolean;
  showPassword?: boolean;
  contactReadOnly?: boolean;
}) {
  const patch = (partial: Partial<EmployeeForm>) => setForm({ ...form, ...partial });
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {showContact && <Field label="登录账号"><input value={form.contact} onChange={(event) => patch({ contact: event.target.value })} readOnly={contactReadOnly} className={`${inputClass} ${contactReadOnly ? 'bg-slate-100 text-slate-500' : ''}`} /></Field>}
      {showPassword && <Field label="初始密码"><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => patch({ password: event.target.value })} className={inputClass} placeholder="至少 8 位并符合密码策略" /></Field>}
      <Field label="姓名"><input value={form.fullName} onChange={(event) => patch({ fullName: event.target.value })} className={inputClass} /></Field>
      <Field label="工号"><input value={form.employeeNo} onChange={(event) => patch({ employeeNo: event.target.value })} className={inputClass} /></Field>
      <Field label="工区"><select value={form.branchId} onChange={(event) => patch({ branchId: event.target.value, departmentId: '' })} className={selectClass}><option value="">未选择</option>{org.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="部门"><select value={form.departmentId} onChange={(event) => patch({ departmentId: event.target.value })} disabled={!form.branchId} className={selectClass}><option value="">未选择</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="岗位"><select value={form.positionId} onChange={(event) => patch({ positionId: event.target.value })} className={selectClass}><option value="">未选择</option>{org.positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="工种"><select value={form.jobTypeId} onChange={(event) => patch({ jobTypeId: event.target.value })} className={selectClass}><option value="">未选择</option>{org.jobTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label="员工级别"><select value={form.employeeLevelId} onChange={(event) => patch({ employeeLevelId: event.target.value })} className={selectClass}><option value="">未选择</option>{org.employeeLevels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    </div>
  );
}

function Field({ label, children, compact = false }: { label: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <label className={`block text-sm ${compact ? 'w-auto' : ''}`}>
      <span className="font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
