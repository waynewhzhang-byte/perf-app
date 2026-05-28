'use client';

import { useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type AuthConfigForm = {
  registerRequiresVerification: boolean;
  loginRequiresVerification: boolean;
  resetRequiresVerification: boolean;
  enforceStrongPassword: boolean;
};

const defaults: AuthConfigForm = {
  registerRequiresVerification: true,
  loginRequiresVerification: false,
  resetRequiresVerification: true,
  enforceStrongPassword: true,
};

export default function AuthConfigPage() {
  const [cfg, setCfg] = useState<AuthConfigForm>(defaults);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/auth-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.config) {
          setCfg(d.config);
          setUpdatedAt(d.updatedAt);
        }
      });
  }, []);

  async function save() {
    setMsg(null);
    setSaving(true);
    const r = await fetch('/api/admin/auth-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const d = await r.json();
    setSaving(false);
    if (r.ok) {
      setMsg({ type: 'success', text: '认证策略已保存，立即生效' });
      setUpdatedAt(new Date().toISOString());
    } else {
      setMsg({ type: 'error', text: d.error || '保存失败' });
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">登录与验证策略</h1>
          <p className="mt-2 text-sm text-slate-500">
            控制员工注册、登录、找回密码是否必须通过手机/邮件验证码
            {updatedAt && (
              <span className="ml-2 text-slate-400">
                （最后更新：{new Date(updatedAt).toLocaleString()}）
              </span>
            )}
          </p>
        </div>
        <AdminPageActions />
      </div>

      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <Toggle
          label="注册需要验证码"
          desc="关闭后员工注册仅需填写联系方式与密码（须符合强密码规则）"
          checked={cfg.registerRequiresVerification}
          onChange={(v) => setCfg({ ...cfg, registerRequiresVerification: v })}
        />
        <Toggle
          label="登录需要验证码"
          desc="开启后登录需二次验证码（当前默认关闭）"
          checked={cfg.loginRequiresVerification}
          onChange={(v) => setCfg({ ...cfg, loginRequiresVerification: v })}
        />
        <Toggle
          label="找回密码需要验证码"
          desc="关闭后仅凭联系方式即可重置密码，存在安全风险"
          checked={cfg.resetRequiresVerification}
          onChange={(v) => setCfg({ ...cfg, resetRequiresVerification: v })}
        />
        <hr className="border-slate-100" />
        <Toggle
          label="启用强密码规则"
          desc="至少 8 位，须包含大写字母、小写字母和特殊符号"
          checked={cfg.enforceStrongPassword}
          onChange={(v) => setCfg({ ...cfg, enforceStrongPassword: v })}
        />
      </div>

      {!cfg.registerRequiresVerification && !cfg.loginRequiresVerification && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          当前为「仅凭密码」模式：请确保已开启强密码规则，并仅在可信网络环境中关闭找回密码验证码。
        </div>
      )}

      {msg && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
          msg.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {saving ? '保存中…' : '保存配置'}
      </button>
    </main>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-0.5 rounded border-slate-300"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium text-slate-900">{label}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{desc}</span>
      </span>
    </label>
  );
}
