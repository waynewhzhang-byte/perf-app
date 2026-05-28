'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthConfig } from '@/lib/use-auth-config';

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

const emptyOrgs: OrgData = {
  branches: [],
  departments: [],
  positions: [],
  jobTypes: [],
  employeeLevels: [],
};

export default function Register() {
  const router = useRouter();
  const { config, passwordHint } = useAuthConfig();
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [jobTypeId, setJobTypeId] = useState('');
  const [employeeLevelId, setEmployeeLevelId] = useState('');
  const [orgs, setOrgs] = useState<OrgData>(emptyOrgs);
  const [orgLoadError, setOrgLoadError] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/public/organization')
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setOrgLoadError(d.error || '组织信息加载失败');
          return;
        }
        const next: OrgData = {
          branches: d.branches ?? [],
          departments: d.departments ?? [],
          positions: d.positions ?? [],
          jobTypes: d.jobTypes ?? [],
          employeeLevels: d.employeeLevels ?? [],
        };
        setOrgs(next);
        setBranchId((prev) => prev || next.branches[0]?.id || '');
      })
      .catch(() => setOrgLoadError('组织信息加载失败'));
  }, []);

  const departmentsForBranch = useMemo(
    () => orgs.departments.filter((d) => d.branchId === branchId),
    [orgs.departments, branchId],
  );

  useEffect(() => {
    if (!departmentId) return;
    if (!departmentsForBranch.some((d) => d.id === departmentId)) {
      setDepartmentId('');
    }
  }, [branchId, departmentId, departmentsForBranch]);

  useEffect(() => {
    if (counter <= 0) return;
    const t = setTimeout(() => setCounter(counter - 1), 1000);
    return () => clearTimeout(t);
  }, [counter]);

  async function sendCode() {
    setErr(null);
    const r = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: contact, purpose: 'REGISTER' }),
    });
    const d = await r.json();
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    setCounter(60);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact,
        code: config.registerRequiresVerification ? code : undefined,
        password,
        fullName,
        employeeNo: employeeNo || undefined,
        branchId: branchId || undefined,
        departmentId: departmentId || undefined,
        positionId: positionId || undefined,
        jobTypeId: jobTypeId || undefined,
        employeeLevelId: employeeLevelId || undefined,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    alert('注册成功，请登录');
    router.replace('/login');
  }

  const selectClass =
    'w-full rounded border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-bold">员工注册</h1>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="手机号 / 邮箱"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
        />
        {config.registerRequiresVerification && (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border px-3 py-2"
              placeholder="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <button
              type="button"
              disabled={counter > 0}
              onClick={sendCode}
              className="rounded border bg-slate-100 px-3 py-2 text-sm disabled:opacity-50"
            >
              {counter > 0 ? `${counter}s` : '发送验证码'}
            </button>
          </div>
        )}
        <input
          className="w-full rounded border px-3 py-2"
          type="password"
          placeholder={passwordHint}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="姓名"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="工号（可选）"
          value={employeeNo}
          onChange={(e) => setEmployeeNo(e.target.value)}
        />

        {orgLoadError && <p className="text-sm text-amber-700">{orgLoadError}</p>}

        <label className="block text-sm text-slate-600">分公司</label>
        <select
          className={selectClass}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          disabled={orgs.branches.length === 0}
        >
          <option value="">请选择分公司（可选）</option>
          {orgs.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <label className="block text-sm text-slate-600">部门</label>
        <select
          className={selectClass}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          disabled={!branchId || departmentsForBranch.length === 0}
        >
          <option value="">请选择部门（可选）</option>
          {departmentsForBranch.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <label className="block text-sm text-slate-600">岗位</label>
        <select
          className={selectClass}
          value={positionId}
          onChange={(e) => setPositionId(e.target.value)}
          disabled={orgs.positions.length === 0}
        >
          <option value="">请选择岗位（可选）</option>
          {orgs.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label className="block text-sm text-slate-600">工种</label>
        <select
          className={selectClass}
          value={jobTypeId}
          onChange={(e) => setJobTypeId(e.target.value)}
          disabled={orgs.jobTypes.length === 0}
        >
          <option value="">请选择工种（可选）</option>
          {orgs.jobTypes.map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>

        <label className="block text-sm text-slate-600">员工级别</label>
        <select
          className={selectClass}
          value={employeeLevelId}
          onChange={(e) => setEmployeeLevelId(e.target.value)}
          disabled={orgs.employeeLevels.length === 0}
        >
          <option value="">请选择员工级别（可选）</option>
          {orgs.employeeLevels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {orgs.employeeLevels.length === 0 && !orgLoadError && (
          <p className="text-xs text-slate-500">管理员尚未配置员工级别，请联系管理员在「组织架构」中添加。</p>
        )}

        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="w-full rounded bg-slate-900 px-4 py-2 text-white">提交注册</button>
      </form>
    </main>
  );
}
