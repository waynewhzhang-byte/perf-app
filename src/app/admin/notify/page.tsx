'use client';
// 通知渠道配置：短信（阿里云） vs 邮件（SMTP）
import { useEffect, useState } from 'react';
import { AdminPageActions } from '@/components/admin-page-actions';

type Channel = 'SMS' | 'EMAIL';

export default function NotifyConfigPage() {
  const [channel, setChannel] = useState<Channel>('SMS');
  const [existing, setExisting] = useState<{ channel: Channel | null; updatedAt: string | null }>({ channel: null, updatedAt: null });
  const [sms, setSms] = useState({ accessKeyId: '', accessKeySecret: '', signName: '', templateCode: '' });
  const [smtp, setSmtp] = useState({ host: '', port: 465, secure: true, user: '', pass: '', from: '' });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/notify-config').then((r) => r.json()).then((d) => {
      if (d.channel) { setChannel(d.channel); setExisting(d); }
    });
  }, []);

  async function save() {
    setMsg(null);
    const body = channel === 'SMS'
      ? { channel: 'SMS', config: sms }
      : { channel: 'EMAIL', config: { ...smtp, port: Number(smtp.port) } };
    const r = await fetch('/api/admin/notify-config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    setMsg(r.ok ? '✅ 配置已保存，立即生效' : `❌ ${d.error}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">通知渠道设置</h1>
        <AdminPageActions />
      </div>
      <p className="mt-2 text-sm text-slate-600">
        当前渠道：{existing.channel || '未配置'}
        {existing.updatedAt && <span className="ml-2 text-slate-400">（最后更新：{new Date(existing.updatedAt).toLocaleString()}）</span>}
      </p>

      <div className="mt-6 flex gap-3">
        <ChannelBtn active={channel === 'SMS'} onClick={() => setChannel('SMS')}>阿里云短信</ChannelBtn>
        <ChannelBtn active={channel === 'EMAIL'} onClick={() => setChannel('EMAIL')}>SMTP 邮件</ChannelBtn>
      </div>

      <div className="mt-6 rounded-lg border bg-white p-5">
        {channel === 'SMS' ? (
          <div className="space-y-3">
            <Input label="AccessKey ID" value={sms.accessKeyId} onChange={(v) => setSms({ ...sms, accessKeyId: v })} />
            <Input label="AccessKey Secret" type="password" value={sms.accessKeySecret} onChange={(v) => setSms({ ...sms, accessKeySecret: v })} />
            <Input label="短信签名" value={sms.signName} onChange={(v) => setSms({ ...sms, signName: v })} placeholder="如：企业绩效" />
            <Input label="模板 Code" value={sms.templateCode} onChange={(v) => setSms({ ...sms, templateCode: v })} placeholder="SMS_xxxx" />
            <p className="text-xs text-slate-500">
              模板需包含变量 <code>${'{code}'}</code>，例如：「您的验证码为 ${'${code}'}，5 分钟内有效」
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Input label="SMTP 主机" value={smtp.host} onChange={(v) => setSmtp({ ...smtp, host: v })} placeholder="smtp.example.com" />
            <Input label="端口" type="number" value={String(smtp.port)} onChange={(v) => setSmtp({ ...smtp, port: Number(v) })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} />
              使用 SSL/TLS（465 端口请勾选）
            </label>
            <Input label="账号" value={smtp.user} onChange={(v) => setSmtp({ ...smtp, user: v })} />
            <Input label="密码 / 授权码" type="password" value={smtp.pass} onChange={(v) => setSmtp({ ...smtp, pass: v })} />
            <Input label="发件人" value={smtp.from} onChange={(v) => setSmtp({ ...smtp, from: v })} placeholder="系统 <noreply@example.com>" />
          </div>
        )}
      </div>

      {msg && <p className="mt-4 text-sm">{msg}</p>}

      <button onClick={save} className="mt-6 rounded bg-slate-900 px-4 py-2 text-white">保存配置</button>
    </main>
  );
}

function ChannelBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-lg border px-4 py-2 text-sm ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>
      {children}
    </button>
  );
}

function Input({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-700">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-slate-500 focus:outline-none" />
    </label>
  );
}
