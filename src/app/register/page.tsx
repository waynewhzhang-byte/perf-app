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

const inputClass =
  'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

const selectClass =
  'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors disabled:bg-slate-50 disabled:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

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
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
    setSending(true);
    const r = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: contact, purpose: 'REGISTER' }),
    });
    const d = await r.json();
    setSending(false);
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    setCounter(60);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
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
    setSubmitting(false);
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    alert('注册成功，请登录');
    router.replace('/login');
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">员工注册</h1>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="reg-contact" className="mb-1.5 block text-sm font-medium text-slate-700">
            联系方式 <span className="text-red-500">*</span>
          </label>
          <input
            id="reg-contact"
            className={inputClass}
            placeholder="手机号 或 邮箱"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            required
          />
        </div>

        {config.registerRequiresVerification && (
          <div>
            <label htmlFor="reg-code" className="mb-1.5 block text-sm font-medium text-slate-700">
              验证码 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                id="reg-code"
                className={`flex-1 ${inputClass}`}
                placeholder="6 位验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <button
                type="button"
                disabled={counter > 0 || sending}
                onClick={sendCode}
                className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? '发送中...' : counter > 0 ? `${counter}s` : '发送验证码'}
              </button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="reg-password" className="mb-1.5 block text-sm font-medium text-slate-700">
            密码 <span className="text-red-500">*</span>
          </label>
          <input
            id="reg-password"
            className={inputClass}
            type="password"
            placeholder={passwordHint}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="reg-name" className="mb-1.5 block text-sm font-medium text-slate-700">
            姓名 <span className="text-red-500">*</span>
          </label>
          <input
            id="reg-name"
            className={inputClass}
            placeholder="真实姓名"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div>
          <label htmlFor="reg-eno" className="mb-1.5 block text-sm font-medium text-slate-700">
            工号
          </label>
          <input
            id="reg-eno"
            className={inputClass}
            placeholder="工号（可选）"
            value={employeeNo}
            onChange={(e) => setEmployeeNo(e.target.value)}
          />
        </div>

        {orgLoadError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">
            {orgLoadError}
          </div>
        )}

        <div>
          <label htmlFor="reg-branch" className="mb-1.5 block text-sm font-medium text-slate-700">分公司</label>
          <select
            id="reg-branch"
            className={selectClass}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            disabled={orgs.branches.length === 0}
          >
            <option value="">请选择分公司（可选）</option>
            {orgs.branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reg-dept" className="mb-1.5 block text-sm font-medium text-slate-700">部门</label>
          <select
            id="reg-dept"
            className={selectClass}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            disabled={!branchId || departmentsForBranch.length === 0}
          >
            <option value="">请选择部门（可选）</option>
            {departmentsForBranch.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reg-pos" className="mb-1.5 block text-sm font-medium text-slate-700">岗位</label>
          <select
            id="reg-pos"
            className={selectClass}
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            disabled={orgs.positions.length === 0}
          >
            <option value="">请选择岗位（可选）</option>
            {orgs.positions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reg-job" className="mb-1.5 block text-sm font-medium text-slate-700">工种</label>
          <select
            id="reg-job"
            className={selectClass}
            value={jobTypeId}
            onChange={(e) => setJobTypeId(e.target.value)}
            disabled={orgs.jobTypes.length === 0}
          >
            <option value="">请选择工种（可选）</option>
            {orgs.jobTypes.map((j) => (
              <option key={j.id} value={j.id}>{j.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reg-level" className="mb-1.5 block text-sm font-medium text-slate-700">员工级别</label>
          <select
            id="reg-level"
            className={selectClass}
            value={employeeLevelId}
            onChange={(e) => setEmployeeLevelId(e.target.value)}
            disabled={orgs.employeeLevels.length === 0}
          >
            <option value="">请选择员工级别（可选）</option>
            {orgs.employeeLevels.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          {orgs.employeeLevels.length === 0 && !orgLoadError && (
            <p className="mt-1.5 text-xs text-slate-400">管理员尚未配置员工级别。</p>
          )}
        </div>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              提交中...
            </span>
          ) : '提交注册'}
        </button>
      </form>
    </main>
  );
}
