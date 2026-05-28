'use client';
// 通知渠道配置
import { useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type Channel = 'SMS' | 'EMAIL';

const inputClass =
  'mt-1 block w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

export default function NotifyConfigPage() {
  const [channel, setChannel] = useState<Channel>('SMS');
  const [existing, setExisting] = useState<{ channel: Channel | null; updatedAt: string | null }>({ channel: null, updatedAt: null });
  const [sms, setSms] = useState({ accessKeyId: '', accessKeySecret: '', signName: '', templateCode: '', noticeTemplateCode: '' });
  const [smtp, setSmtp] = useState({ host: '', port: 465, secure: true, user: '', pass: '', from: '' });
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/notify-config').then((r) => r.json()).then((d) => {
      if (d.channel) { setChannel(d.channel); setExisting(d); }
    });
  }, []);

  async function save() {
    setMsg(null);
    setSaving(true);
    const body = channel === 'SMS'
      ? { channel: 'SMS', config: sms }
      : { channel: 'EMAIL', config: { ...smtp, port: Number(smtp.port) } };
    const r = await fetch('/api/admin/notify-config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setSaving(false);
    setMsg({ type: r.ok ? 'success' : 'error', text: r.ok ? '配置已保存，立即生效' : (d.error || '保存失败') });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">通知渠道设置</h1>
          <p className="mt-1 text-sm text-slate-500">
            当前渠道：{existing.channel || '未配置'}
            {existing.updatedAt && (
              <span className="ml-2 text-slate-400">（最后更新：{new Date(existing.updatedAt).toLocaleString()}）</span>
            )}
          </p>
        </div>
        <AdminPageActions />
      </div>

      <div className="mt-6 flex gap-3">
        <ChannelBtn active={channel === 'SMS'} onClick={() => setChannel('SMS')}>阿里云短信</ChannelBtn>
        <ChannelBtn active={channel === 'EMAIL'} onClick={() => setChannel('EMAIL')}>SMTP 邮件</ChannelBtn>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        {channel === 'SMS' ? (
          <div className="space-y-3">
            <Input label="AccessKey ID" value={sms.accessKeyId} onChange={(v) => setSms({ ...sms, accessKeyId: v })} />
            <Input label="AccessKey Secret" type="password" value={sms.accessKeySecret} onChange={(v) => setSms({ ...sms, accessKeySecret: v })} />
            <Input label="短信签名" value={sms.signName} onChange={(v) => setSms({ ...sms, signName: v })} placeholder="如：企业绩效" />
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Input label="验证码模板 Code" value={sms.templateCode} onChange={(v) => setSms({ ...sms, templateCode: v })} placeholder="SMS_xxxx" />
              <p className="mt-1 text-xs text-slate-400">
                用于注册/登录/找回密码，模板需包含变量 <code className="rounded bg-slate-100 px-1 py-0.5">{'${code}'}</code>
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Input label="通知模板 Code（可选）" value={sms.noticeTemplateCode} onChange={(v) => setSms({ ...sms, noticeTemplateCode: v })} placeholder="SMS_yyyy" />
              <p className="mt-1 text-xs text-slate-400">
                用于申报提交、审核结果等业务通知，模板需包含变量 <code className="rounded bg-slate-100 px-1 py-0.5">{'${content}'}</code>。不填则不发送短信通知
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input label="SMTP 主机" value={smtp.host} onChange={(v) => setSmtp({ ...smtp, host: v })} placeholder="smtp.example.com" />
            <Input label="端口" type="number" value={String(smtp.port)} onChange={(v) => setSmtp({ ...smtp, port: Number(v) })} />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} className="rounded border-slate-300" />
              使用 SSL/TLS（465 端口请勾选）
            </label>
            <Input label="账号" value={smtp.user} onChange={(v) => setSmtp({ ...smtp, user: v })} />
            <Input label="密码 / 授权码" type="password" value={smtp.pass} onChange={(v) => setSmtp({ ...smtp, pass: v })} />
            <Input label="发件人" value={smtp.from} onChange={(v) => setSmtp({ ...smtp, from: v })} placeholder="系统 &lt;noreply@example.com&gt;" />
          </div>
        )}
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

function ChannelBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-4 py-2 text-sm font-medium transition-all cursor-pointer ${
        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
    </label>
  );
}
