'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthConfig } from '@/lib/use-auth-config';

export default function Forgot() {
  const router = useRouter();
  const { config, passwordHint } = useAuthConfig();
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
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
      body: JSON.stringify({ target: contact, purpose: 'RESET_PASSWORD' }),
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
    const r = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact,
        code: config.resetRequiresVerification ? code : undefined,
        newPassword,
      }),
    });
    const d = await r.json();
    setSubmitting(false);
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    alert('密码已重置');
    router.replace('/login');
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

  return (
    <main className="flex min-h-screen items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">找回密码</h1>
          {!config.resetRequiresVerification && (
            <p className="mt-2 text-sm text-slate-500">填写联系方式与新密码即可重置</p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="forgot-contact" className="mb-1.5 block text-sm font-medium text-slate-700">
              联系方式
            </label>
            <input
              id="forgot-contact"
              className={inputClass}
              placeholder="手机号 或 邮箱"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
            />
          </div>

          {config.resetRequiresVerification && (
            <div>
              <label htmlFor="forgot-code" className="mb-1.5 block text-sm font-medium text-slate-700">
                验证码
              </label>
              <div className="flex gap-2">
                <input
                  id="forgot-code"
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
            <label htmlFor="forgot-password" className="mb-1.5 block text-sm font-medium text-slate-700">
              新密码
            </label>
            <input
              id="forgot-password"
              className={inputClass}
              type="password"
              placeholder={passwordHint}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
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
                重置中...
              </span>
            ) : '重置密码'}
          </button>
        </form>
      </div>
    </main>
  );
}
