'use client';
// 员工填报页：分章节渲染 → 选择分值档次 → 上传附件 → 保存草稿 / 提交
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
      // 通过公开接口获取已发布模板
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
    // refresh to grab submission id for attachments
    location.reload();
  };

  if (loading) return <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-slate-500">加载中…</main>;
  if (!tpl) return <main className="mx-auto max-w-3xl px-6 py-10 text-sm text-red-600">表单不存在或未发布</main>;

  const editable = !sub?.status || sub.status === 'DRAFT' || sub.status === 'REJECTED';

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/app" className="text-sm text-slate-500 hover:underline">← 返回</Link>
          <h1 className="mt-1 text-2xl font-bold">{tpl.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{tpl.description}</p>
        </div>
        <LogoutButton />
      </div>
      {sub?.status === 'REJECTED' && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          本次申报已被驳回，仅可修改下方标红的项后重新提交。
        </div>
      )}
      {sub?.status && sub.status !== 'DRAFT' && sub.status !== 'REJECTED' && (
        <div className="mt-3 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          当前状态：{(() => { const m: Record<string, string> = { SUBMITTED: '待审核', L1_APPROVED: '一审通过', L2_APPROVED: '终审通过' }; return m[sub.status] ?? sub.status; })()}，已不可编辑。
        </div>
      )}

      <div className="sticky top-0 z-10 -mx-6 mt-4 border-y bg-white/90 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">累计分数</span>
          <span className="text-xl font-bold text-slate-900">{total.toFixed(1)}</span>
        </div>
      </div>

      <div className="mt-5 space-y-6">
        {tpl.sections.map((sec) => (
          <section key={sec.id} className="rounded-lg border bg-white p-4">
            <h2 className="font-semibold">{sec.title}</h2>
            {sec.description && <p className="mt-1 text-xs text-slate-500">{sec.description}</p>}
            <div className="mt-4 space-y-5">
              {sec.items.map((it) => {
                const a = answers[it.id]; const locked = isLocked(it.id);
                const rejected = a?.status === 'REJECTED';
                return (
                  <div key={it.id} className={`rounded border p-3 ${rejected ? 'border-red-300 bg-red-50' : locked ? 'bg-slate-50 opacity-70' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">
                        {it.title}
                        {it.isRequired && <span className="ml-1 text-red-500">*</span>}
                        {locked && <span className="ml-2 text-xs text-slate-500">（已审核通过，锁定）</span>}
                      </p>
                      <span className="text-xs text-slate-500">{it.maxSelections > 1 ? `多选 ≤${it.maxSelections}` : '单选'}</span>
                    </div>
                    {it.hint && <p className="mt-1 text-xs text-slate-500">💡 {it.hint}</p>}
                    {rejected && a?.rejectReason && (
                      <p className="mt-2 text-xs text-red-700">驳回原因：{a.rejectReason}</p>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {it.scoreOptions.map((o, idx) => {
                        const on = a?.selected.some((s) => s.index === idx);
                        return (
                          <button key={idx} type="button" disabled={!editable || locked}
                            onClick={() => toggle(it, idx)}
                            className={`rounded border px-3 py-2 text-left text-sm transition ${
                              on ? 'border-slate-900 bg-slate-900 text-white' : 'bg-white hover:border-slate-400'
                            } disabled:cursor-not-allowed`}>
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{o.label}</span>
                              <span className={on ? 'font-bold' : 'text-slate-500'}>{o.score} 分</span>
                            </div>
                            {o.description && (
                              <p className={`mt-1 text-xs ${on ? 'text-slate-300' : 'text-slate-400'}`}>
                                {o.description}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <textarea value={a?.content ?? ''} onChange={(e) => setContent(it.id, e.target.value)}
                      disabled={!editable || locked} placeholder="备注说明（可选）"
                      rows={2} className="mt-3 w-full rounded border px-2 py-1.5 text-sm disabled:bg-slate-50" />

                    {it.requireAttachment && (
                      <div className="mt-3">
                        <p className="text-xs font-semibold text-slate-600">证明材料</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                          {(a?.attachments ?? []).map((at) => (
                            <li key={at.id}>📎 {at.filename}</li>
                          ))}
                          {(!a?.attachments || a.attachments.length === 0) && <li className="text-slate-400">尚未上传</li>}
                        </ul>
                        {editable && !locked && (
                          <>
                            <p className="mt-2 text-xs text-slate-500">
                              仅支持 PDF、图片、Word/Excel、TXT，单文件 ≤10MB
                            </p>
                            <input
                              type="file"
                              multiple
                              accept={UPLOAD_ACCEPT}
                              onChange={(e) => upload(it.id, e.target.files)}
                              className="mt-1 block text-xs"
                            />
                          </>
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
        <div className="sticky bottom-0 mt-6 -mx-6 border-t bg-white px-6 py-3">
          <div className="flex justify-end gap-2">
            <button onClick={() => save(false)} disabled={busy} className="rounded border px-4 py-2 text-sm">
              {busy ? '保存中…' : '保存草稿'}
            </button>
            <button onClick={() => save(true)} disabled={busy} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">
              {busy ? '提交中…' : '提交审核'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
