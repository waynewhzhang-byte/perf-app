'use client';

import { useEffect, useRef, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';
import {
  DEFAULT_DECLARATION_NOTICE_TEXT,
  DEFAULT_NOTICE_SECONDS,
  HOME_NOTICE_BODY_MAX,
  HOME_NOTICE_TITLE_MAX,
} from '@/lib/app-config';

type AppConfigForm = {
  supportPhone: string;
  noticeText: string;
  noticeSeconds: number;
  homeNoticeTitle: string;
  homeNoticeBody: string;
};

const defaults: AppConfigForm = {
  supportPhone: '',
  noticeText: DEFAULT_DECLARATION_NOTICE_TEXT,
  noticeSeconds: DEFAULT_NOTICE_SECONDS,
  homeNoticeTitle: '',
  homeNoticeBody: '',
};

function fromApiConfig(config: Partial<AppConfigForm>): AppConfigForm {
  return {
    supportPhone: config.supportPhone ?? '',
    noticeText: config.noticeText ?? DEFAULT_DECLARATION_NOTICE_TEXT,
    noticeSeconds: config.noticeSeconds ?? DEFAULT_NOTICE_SECONDS,
    homeNoticeTitle: config.homeNoticeTitle ?? '',
    homeNoticeBody: config.homeNoticeBody ?? '',
  };
}

function declarationChanged(before: AppConfigForm, after: AppConfigForm): boolean {
  return (
    before.noticeText.trim() !== after.noticeText.trim()
    || before.noticeSeconds !== after.noticeSeconds
  );
}

export default function AppConfigPage() {
  const [cfg, setCfg] = useState<AppConfigForm>(defaults);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef<AppConfigForm>(defaults);

  useEffect(() => {
    fetch('/api/admin/app-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.config) {
          const next = fromApiConfig(d.config);
          setCfg(next);
          savedRef.current = next;
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
      const reAck = declarationChanged(savedRef.current, cfg);
      setMsg({
        type: 'success',
        text: reAck
          ? '配置已保存。必读弹窗文案或倒计时已变更，员工需重新阅读确认。'
          : '配置已保存。',
      });
      setUpdatedAt(new Date().toISOString());
      if (d.config) {
        const next = fromApiConfig(d.config);
        setCfg(next);
        savedRef.current = next;
      } else {
        savedRef.current = cfg;
      }
    } else {
      setMsg({ type: 'error', text: d.error || '保存失败' });
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">员工端文案与支持</h1>
          <p className="mt-2 text-sm text-slate-500">
            管理员工可见的必读弹窗、填报页电话，以及首页底部提示
            {updatedAt && (
              <span className="ml-2 text-slate-400">
                （最后更新：{new Date(updatedAt).toLocaleString()}）
              </span>
            )}
          </p>
        </div>
        <AdminPageActions />
      </div>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">申报前必读弹窗</h2>
          <p className="mt-1 text-xs text-slate-400">
            员工进入申报相关页面时强制阅读；修改文案或倒计时后需重新确认。
          </p>
        </div>
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
          <span className="font-medium text-slate-600">弹窗文案</span>
          <textarea
            value={cfg.noticeText}
            onChange={(e) => setCfg({ ...cfg, noticeText: e.target.value })}
            rows={14}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </label>
      </section>

      <section className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">技术支持与首页提示</h2>
          <p className="mt-1 text-xs text-slate-400">
            填报页底部显示电话；首页底部显示可编辑提示（正文为空则不显示）。
          </p>
        </div>
        <label className="block text-sm">
          <span className="font-medium text-slate-600">填报页技术支持电话</span>
          <input
            type="text"
            value={cfg.supportPhone}
            onChange={(e) => setCfg({ ...cfg, supportPhone: e.target.value })}
            placeholder="如：0351-1234567"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <p className="mt-1 text-xs text-slate-400">留空则不显示申报页底部电话。</p>
        </label>
        <hr className="border-slate-100" />
        <label className="block text-sm">
          <span className="font-medium text-slate-600">首页提示标题</span>
          <input
            type="text"
            value={cfg.homeNoticeTitle}
            maxLength={HOME_NOTICE_TITLE_MAX}
            onChange={(e) => setCfg({ ...cfg, homeNoticeTitle: e.target.value })}
            placeholder="如：技术支持与提示"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-600">首页提示正文</span>
          <textarea
            value={cfg.homeNoticeBody}
            maxLength={HOME_NOTICE_BODY_MAX}
            onChange={(e) => setCfg({ ...cfg, homeNoticeBody: e.target.value })}
            rows={6}
            placeholder={'可填写技术支持电话、微信、申报须知等\n支持多行'}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <p className="mt-1 text-xs text-slate-400">显示在员工「我的申报」页底部；正文为空则整块不显示。</p>
        </label>
      </section>

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
