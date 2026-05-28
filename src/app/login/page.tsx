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
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      body: JSON.stringify({ target: contact, purpose: 'LOGIN' }),
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
    setSubmitting(false);
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    router.replace('/app');
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">员工登录</h1>
          {loaded && !config.loginRequiresVerification && (
            <p className="mt-2 text-sm text-slate-500">账号密码登录，无需验证码</p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="contact" className="mb-1.5 block text-sm font-medium text-slate-700">
              联系方式
            </label>
            <input
              id="contact"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              placeholder="手机号 或 邮箱"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
              密码
            </label>
            <input
              type="password"
              id="password"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              placeholder="输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {config.loginRequiresVerification && (
            <div>
              <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-slate-700">
                验证码
              </label>
              <div className="flex gap-2">
                <input
                  id="code"
                  className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  placeholder="6 位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <button
                  type="button"
                  disabled={counter > 0 || !contact || sending}
                  onClick={sendCode}
                  className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm font-medium transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? '发送中...' : counter > 0 ? `${counter}s` : '发送验证码'}
                </button>
              </div>
            </div>
          )}

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
                登录中...
              </span>
            ) : '登录'}
          </button>
        </form>

        <div className="mt-5 flex justify-between text-sm">
          <Link href="/register" className="font-medium text-primary-600 transition-colors hover:text-primary-700">
            注册账号
          </Link>
          <Link href="/forgot" className="font-medium text-slate-500 transition-colors hover:text-slate-700">
            忘记密码
          </Link>
        </div>
      </div>
    </main>
  );
}
