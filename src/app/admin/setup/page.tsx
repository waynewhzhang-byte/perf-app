'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [contact, setContact] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/setup').then((r) => r.json()).then((d) => {
      if (!d.needSetup) router.replace('/admin/login');
      else setChecked(true);
    });
  }, [router]);

  if (!checked) return <div className="p-8">加载中...</div>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact, fullName, password }),
    });
    const d = await res.json();
    setLoading(false);
    if (!res.ok) { setErr(d.error || '创建失败'); return; }
    alert('管理员创建成功！请登录后配置通知渠道。');
    router.replace('/admin/login');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold">系统初始化</h1>
      <p className="mt-2 text-sm text-slate-600">创建首个超级管理员。此页面仅在系统无管理员时可访问。</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="联系方式（手机号或邮箱）" value={contact} onChange={setContact} />
        <Field label="姓名" value={fullName} onChange={setFullName} />
        <Field label="登录密码（至少 8 位）" type="password" value={password} onChange={setPassword} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={loading} className="w-full rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
          {loading ? '创建中...' : '创建管理员'}
        </button>
      </form>
    </main>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-700">{label}</span>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} required
        className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none"
      />
    </label>
  );
}
