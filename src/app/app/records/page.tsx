'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';

interface RecordItem {
  id: string;
  year: number;
  totalScore: number;
  submissionId: string;
  createdAt: string;
}

interface RecordDetail {
  id: string;
  year: number;
  totalScore: number;
  archivedData: {
    submissionId: string;
    userId: string;
    templateId: string;
    items: {
      itemId: string;
      itemTitle: string;
      selected: { index: number; label: string; score: number }[];
      content: string | null;
      score: number;
      attachments: {
        id: string;
        filename: string;
        storageKey: string;
        mimeType: string | null;
      }[];
    }[];
    finalizedAt: string;
  };
}

export default function RecordsPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/records')
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return null; }
        return r.json();
      })
      .then((d) => d && setRecords(d.records ?? []))
      .catch(() => setError('加载失败'));
  }, []);

  async function toggleDetail(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(id);
    setLoading(true);
    try {
      const r = await fetch(`/api/records/${id}`);
      if (!r.ok) { setError('加载详情失败'); return; }
      const d = await r.json();
      setDetail(d.record);
    } finally {
      setLoading(false);
    }
  }

  // 按 itemId 分组，还原章节结构（简化：直接按顺序排列）
  const items = detail?.archivedData?.items ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的绩效档案</h1>
          <p className="mt-1 text-sm text-slate-600">历年绩效申报结果与评价报告</p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/app" className="rounded border px-3 py-1.5 hover:bg-slate-50">← 返回</Link>
          <LogoutButton />
        </div>
      </header>

      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <section className="mt-6">
        {records.length === 0 && !error && (
          <p className="text-sm text-slate-500">暂无绩效档案。</p>
        )}

        <ul className="space-y-3">
          {records.map((rec) => (
            <li key={rec.id} className="rounded-lg border bg-white">
              <button
                type="button"
                onClick={() => toggleDetail(rec.id)}
                className="flex w-full items-center justify-between p-4 text-left hover:bg-slate-50"
              >
                <div>
                  <span className="font-semibold">{rec.year} 年度绩效</span>
                  <span className="ml-3 text-sm text-slate-500">
                    归档时间：{new Date(rec.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-slate-900">{Number(rec.totalScore).toFixed(1)} 分</span>
                  <span className="text-xs text-slate-400">{expandedId === rec.id ? '收起 ▲' : '展开 ▼'}</span>
                </div>
              </button>

              {expandedId === rec.id && (
                <div className="border-t px-4 py-4">
                  {loading ? (
                    <p className="text-sm text-slate-400">加载中...</p>
                  ) : detail ? (
                    <div className="space-y-4">
                      {/* 总分概览 */}
                      <div className="rounded-lg bg-slate-50 p-4 text-center">
                        <p className="text-sm text-slate-500">总分</p>
                        <p className="mt-1 text-3xl font-bold text-slate-900">
                          {Number(detail.totalScore).toFixed(1)}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          归档时间：{new Date(detail.archivedData.finalizedAt).toLocaleString('zh-CN')}
                        </p>
                      </div>

                      {/* 逐项明细 */}
                      {items.length > 0 ? (
                        <div className="divide-y rounded-lg border">
                          {items.map((item, i) => (
                            <div key={i} className="flex items-start justify-between p-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm">{item.itemTitle}</p>
                                {item.selected && item.selected.length > 0 && (
                                  <p className="mt-1 text-xs text-slate-500">
                                    选择：{item.selected.map((s) => s.label).join('、')}
                                  </p>
                                )}
                                {item.content && (
                                  <p className="mt-1 text-xs text-slate-500">备注：{item.content}</p>
                                )}
                                {item.attachments.length > 0 && (
                                  <p className="mt-1 text-xs text-blue-500">
                                    附件 {item.attachments.length} 个
                                  </p>
                                )}
                              </div>
                              <span className="ml-3 shrink-0 rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                                {Number(item.score).toFixed(1)} 分
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">暂无明细</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-red-500">加载详情失败</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
