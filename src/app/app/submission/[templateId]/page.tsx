'use client';
// 员工填报页
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { UPLOAD_ACCEPT } from '@/lib/upload-security';

interface ScoreOpt { label: string; score: number; description?: string }
interface FormItem {
  id: string; title: string; hint?: string;
  isRequired: boolean; requireAttachment: boolean; maxSelections: number;
  scoreOptions: ScoreOpt[];
}
interface Section { id: string; title: string; description?: string; items: FormItem[] }
interface Template { id: string; title: string; year: number; description?: string; sections: Section[] }

interface Attachment { id: string; filename: string }
interface SubItem {
  id?: string; itemId: string;
  selected: { index: number; label: string; score: number }[];
  content?: string;
  status?: string; rejectReason?: string | null;
  attachments?: Attachment[];
}

export default function SubmissionPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const router = useRouter();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [sub, setSub] = useState<{ id?: string; status?: string } | null>(null);
  const [answers, setAnswers] = useState<Record<string, SubItem>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [tplRes, subRes] = await Promise.all([
        fetch(`/api/templates/${templateId}`).then((r) => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/submissions?templateId=${templateId}`).then((r) => r.json()),
      ]);
      const template: Template | null = tplRes?.template ?? null;
      let currentTemplate: Template | null = template;
      const existing = subRes.submissions?.[0];

      if (!currentTemplate && existing) {
        currentTemplate = {
          id: existing.template.id, title: existing.template.title,
          year: existing.template.year, description: existing.template.description,
          sections: [{
            id: 's', title: '申报项', items: existing.items.map((si: any) => ({
              id: si.item.id, title: si.item.title, hint: si.item.hint,
              isRequired: si.item.isRequired, requireAttachment: si.item.requireAttachment,
              maxSelections: si.item.maxSelections, scoreOptions: si.item.scoreOptions,
            })),
          }],
        };
      }

      if (!currentTemplate) { setLoading(false); return; }
      setTpl(currentTemplate);
      setSub(existing ? { id: existing.id, status: existing.status } : null);

      const map: Record<string, SubItem> = {};
      currentTemplate.sections.forEach((s) => s.items.forEach((it) => {
        const ex = existing?.items?.find((x: any) => x.itemId === it.id);
        map[it.id] = ex ? {
          id: ex.id, itemId: it.id, selected: ex.selected ?? [], content: ex.content ?? '',
          status: ex.status, rejectReason: ex.rejectReason, attachments: ex.attachments,
        } : { itemId: it.id, selected: [], content: '' };
      }));
      setAnswers(map);
      setLoading(false);
    })();
  }, [templateId]);

  const total = useMemo(
    () => Object.values(answers).reduce((s, a) => s + a.selected.reduce((x, y) => x + y.score, 0), 0),
    [answers],
  );

  const isLocked = (itemId: string): boolean => {
    if (sub?.status !== 'REJECTED') return false;
    return !!(answers[itemId]?.status && answers[itemId]?.status !== 'REJECTED');
  };

  const toggle = (it: FormItem, idx: number) => {
    if (isLocked(it.id)) return;
    setAnswers((prev) => {
      const cur = prev[it.id]; const has = cur.selected.find((s) => s.index === idx);
      let selected = cur.selected;
      if (has) selected = selected.filter((s) => s.index !== idx);
      else {
        const opt = it.scoreOptions[idx];
        selected = it.maxSelections === 1 ? [{ index: idx, ...opt }] : [...selected, { index: idx, ...opt }];
        if (selected.length > it.maxSelections) selected = selected.slice(-it.maxSelections);
      }
      return { ...prev, [it.id]: { ...cur, selected } };
    });
  };

  const setContent = (itemId: string, val: string) => {
    if (isLocked(itemId)) return;
    setAnswers((prev) => ({ ...prev, [itemId]: { ...prev[itemId], content: val } }));
  };

  const upload = async (itemId: string, files: FileList | null) => {
    if (!files || !files.length) return;
    if (!sub?.id) { alert('请先保存草稿后再上传附件'); return; }
    const subItemId = answers[itemId].id;
    if (!subItemId) { alert('请先保存草稿后再上传附件'); return; }
    const fd = new FormData();
    fd.append('submissionItemId', subItemId);
    Array.from(files).forEach((f) => fd.append('files', f));
    const r = await fetch('/api/attachments', { method: 'POST', body: fd });
    if (!r.ok) { alert('上传失败'); return; }
    const d = await r.json();
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], attachments: [...(prev[itemId].attachments ?? []), ...(d.attachments ?? [])] },
    }));
  };

  const save = async (submit: boolean) => {
    if (!tpl) return;
    if (submit) {
      const missing: string[] = [];
      tpl.sections.forEach((s) => s.items.forEach((it) => {
        if (isLocked(it.id)) return;
        const a = answers[it.id];
        if (it.isRequired && !a.selected.length) missing.push(it.title);
        else if (a.selected.length && it.requireAttachment && !(a.attachments?.length)) missing.push(`${it.title}（缺附件）`);
      }));
      if (missing.length) { alert('请补全：\n' + missing.join('\n')); return; }
    }
    setBusy(true);
    const r = await fetch('/api/submissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId, submit,
        items: Object.values(answers).map((a) => ({ itemId: a.itemId, selected: a.selected, content: a.content })),
      }),
    });
    setBusy(false);
    if (!r.ok) { const e = await r.json().catch(() => ({})); alert('保存失败：' + (e.error || r.status)); return; }
    if (submit) { alert('已提交，等待审核'); router.push('/app'); return; }
    alert('草稿已保存');
    location.reload();
  };

  if (loading) return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-6">
            <div className="mb-4 h-6 w-48 rounded bg-slate-200" />
            <div className="space-y-2">
              <div className="h-4 w-full rounded bg-slate-100" />
              <div className="h-4 w-3/4 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
  if (!tpl) return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
      <p className="text-sm text-red-600">表单不存在或未发布</p>
    </main>
  );

  const editable = !sub?.status || sub.status === 'DRAFT' || sub.status === 'REJECTED';
  const statusMap: Record<string, string> = {
    SUBMITTED: '待审核', L1_APPROVED: '一审通过', L2_APPROVED: '终审通过',
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/app" className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 cursor-pointer">
            ← 返回
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{tpl.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{tpl.description}</p>
        </div>
        <LogoutButton />
      </div>

      {sub?.status === 'REJECTED' && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          本次申报已被驳回，仅可修改下方标红的项后重新提交。
        </div>
      )}

      {sub?.status && sub.status !== 'DRAFT' && sub.status !== 'REJECTED' && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          当前状态：{statusMap[sub.status] ?? sub.status}，已不可编辑。
        </div>
      )}

      <div className="sticky top-0 z-10 -mx-4 mt-4 border-y border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-500">累计分数</span>
          <span className="text-2xl font-bold tracking-tight tabular-nums">{total.toFixed(1)}</span>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {tpl.sections.map((sec) => (
          <section key={sec.id} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">{sec.title}</h2>
            {sec.description && <p className="mt-1 text-xs text-slate-400">{sec.description}</p>}
            <div className="mt-4 space-y-5">
              {sec.items.map((it) => {
                const a = answers[it.id]; const locked = isLocked(it.id);
                const rejected = a?.status === 'REJECTED';
                return (
                  <div key={it.id} className={`rounded-lg border p-4 ${
                    rejected ? 'border-red-300 bg-red-50' : locked ? 'bg-slate-50 opacity-70' : 'border-slate-200'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {it.title}
                        {it.isRequired && <span className="ml-1 text-red-500">*</span>}
                        {locked && <span className="ml-2 text-xs text-slate-400">（已审核通过，锁定）</span>}
                      </p>
                      <span className="shrink-0 text-xs text-slate-400">
                        {it.maxSelections > 1 ? `最多选择 ${it.maxSelections} 项` : '单项选择'}
                      </span>
                    </div>

                    {it.hint && (
                      <div className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
                        <svg className="mt-px h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 17.25h.008v.008H12v-.008z" />
                        </svg>
                        <span>{it.hint}</span>
                      </div>
                    )}
                    {rejected && a?.rejectReason && (
                      <p className="mt-2 rounded-md bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700">
                        驳回原因：{a.rejectReason}
                      </p>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {it.scoreOptions.map((o, idx) => {
                        const on = a?.selected.some((s) => s.index === idx);
                        return (
                          <button key={idx} type="button" disabled={!editable || locked}
                            onClick={() => toggle(it, idx)}
                            className={`rounded-lg border px-4 py-3 text-left text-sm transition-all duration-200 ${
                              on
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'bg-white hover:border-slate-400 hover:shadow-sm'
                            } disabled:cursor-not-allowed disabled:opacity-60`}>
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{o.label}</span>
                              <span className={`text-sm ${on ? 'font-bold text-white' : 'font-medium text-slate-500'}`}>
                                {o.score} 分
                              </span>
                            </div>
                            {o.description && (
                              <p className={`mt-1 text-xs leading-relaxed ${on ? 'text-slate-300' : 'text-slate-400'}`}>
                                {o.description}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <textarea value={a?.content ?? ''} onChange={(e) => setContent(it.id, e.target.value)}
                      disabled={!editable || locked}
                      placeholder="备注说明（可选）"
                      rows={2}
                      className="mt-3 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:bg-slate-50" />

                    {it.requireAttachment && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-slate-600">证明材料</p>
                        <ul className="mt-1 space-y-0.5">
                          {(a?.attachments ?? []).map((at) => (
                            <li key={at.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                              <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                              </svg>
                              {at.filename}
                            </li>
                          ))}
                          {(!a?.attachments || a.attachments.length === 0) && (
                            <li className="text-xs text-slate-400">尚未上传</li>
                          )}
                        </ul>
                        {editable && !locked && (
                          <div className="mt-2">
                            <p className="text-xs text-slate-400">
                              仅支持 PDF、图片、Word/Excel、TXT，单文件 ≤10MB
                            </p>
                            <input
                              type="file"
                              multiple
                              accept={UPLOAD_ACCEPT}
                              onChange={(e) => upload(it.id, e.target.files)}
                              className="mt-1 block text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-medium file:text-slate-700 file:transition-colors hover:file:bg-slate-200 cursor-pointer"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editable && (
        <div className="sticky bottom-0 -mx-4 mt-6 border-t border-slate-200 bg-white px-4 py-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex justify-end gap-3">
            <button
              onClick={() => save(false)}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {busy ? '保存中…' : '保存草稿'}
            </button>
            <button
              onClick={() => save(true)}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {busy ? '提交中…' : '提交审核'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
