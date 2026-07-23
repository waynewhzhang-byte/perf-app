'use client';

import { useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';
import {
  DEFAULT_DECLARATION_NOTICE_TEXT,
  DEFAULT_NOTICE_SECONDS,
} from '@/lib/app-config';

type AppConfigForm = {
  supportPhone: string;
  noticeText: string;
  noticeSeconds: number;
};

const defaults: AppConfigForm = {
  supportPhone: '',
  noticeText: DEFAULT_DECLARATION_NOTICE_TEXT,
  noticeSeconds: DEFAULT_NOTICE_SECONDS,
};

export default function AppConfigPage() {
  const [cfg, setCfg] = useState<AppConfigForm>(defaults);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/app-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.config) {
          setCfg({
            supportPhone: d.config.supportPhone ?? '',
            noticeText: d.config.noticeText ?? DEFAULT_DECLARATION_NOTICE_TEXT,
            noticeSeconds: d.config.noticeSeconds ?? DEFAULT_NOTICE_SECONDS,
          });
          setUpdatedAt(d.updatedAt);
        }
      });
  }, []);

  async function save() {
    setMsg(null);
    setSaving(true);
    const r = await fetch('/api/admin/app-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    const d = await r.json();
    setSaving(false);
    if (r.ok) {
      setMsg({
        type: 'success',
        text: '配置已保存。员工若已确认过旧版弹窗，修改文案后将需重新阅读。',
      });
      setUpdatedAt(new Date().toISOString());
    } else {
      setMsg({ type: 'error', text: d.error || '保存失败' });
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">申报合规与技术支持</h1>
          <p className="mt-2 text-sm text-slate-500">
            配置员工登录后强制阅读弹窗与申报页技术支持电话
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
        <label className="block text-sm">
          <span className="font-medium text-slate-600">技术支持电话</span>
          <input
            type="text"
            value={cfg.supportPhone}
            onChange={(e) => setCfg({ ...cfg, supportPhone: e.target.value })}
            placeholder="如：0351-1234567"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <p className="mt-1 text-xs text-slate-400">留空则不显示申报页底部技术支持信息。</p>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">强制阅读倒计时（秒）</span>
          <input
            type="number"
            min={0}
            max={300}
            value={cfg.noticeSeconds}
            onChange={(e) => setCfg({ ...cfg, noticeSeconds: Number(e.target.value) || 0 })}
            className="mt-1 w-32 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium text-slate-600">申报前必读弹窗文案</span>
          <textarea
            value={cfg.noticeText}
            onChange={(e) => setCfg({ ...cfg, noticeText: e.target.value })}
            rows={16}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </label>
      </div>

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
        onClick={save}
        disabled={saving}
        className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        {saving ? '保存中…' : '保存配置'}
      </button>
    </main>
  );
}
