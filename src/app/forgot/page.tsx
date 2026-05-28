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
      body: JSON.stringify({ target: contact, purpose: 'RESET_PASSWORD' }),
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
    if (!r.ok) {
      setErr(d.error);
      return;
    }
    alert('密码已重置');
    router.replace('/login');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-bold">找回密码</h1>
      {!config.resetRequiresVerification && (
        <p className="mt-2 text-sm text-amber-700">
          当前系统未要求验证码，填写联系方式与新密码即可重置。
        </p>
      )}
      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          className="w-full rounded border px-3 py-2"
          placeholder="联系方式"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          required
        />
        {config.resetRequiresVerification && (
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
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button className="w-full rounded bg-slate-900 px-4 py-2 text-white">重置密码</button>
      </form>
    </main>
  );
}
