'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthConfig } from '@/lib/use-auth-config';

export default function EmployeeLogin() {
  const router = useRouter();
  const { config, loaded } = useAuthConfig();
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [counter, setCounter] = useState(0);
  const [err, setErr] = useState<string | null>(null);

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
      body: JSON.stringify({ target: contact, purpose: 'LOGIN' }),
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
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact,
        password,
        code: config.loginRequiresVerification ? code : undefined,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    router.replace('/app');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-bold">员工登录</h1>
      {loaded && !config.loginRequiresVerification && (
        <p className="mt-2 text-sm text-slate-500">当前为账号密码登录，无需短信/邮件验证码</p>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <input
          className="w-full rounded border border-slate-300 px-3 py-2"
          placeholder="联系方式"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
        />
        <input
          type="password"
          className="w-full rounded border border-slate-300 px-3 py-2"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {config.loginRequiresVerification && (
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border border-slate-300 px-3 py-2"
              placeholder="6 位验证码"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <button
              type="button"
              disabled={counter > 0 || !contact}
              onClick={sendCode}
              className="rounded border bg-slate-100 px-3 py-2 text-sm disabled:opacity-50"
            >
              {counter > 0 ? `${counter}s` : '发送验证码'}
            </button>
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="w-full rounded bg-slate-900 px-4 py-2 text-white">登录</button>
      </form>
      <div className="mt-4 flex justify-between text-sm text-slate-500">
        <Link href="/register" className="hover:underline">
          注册账号
        </Link>
        <Link href="/forgot" className="hover:underline">
          忘记密码
        </Link>
      </div>
    </main>
  );
}
