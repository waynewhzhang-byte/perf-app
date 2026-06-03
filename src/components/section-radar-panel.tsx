'use client';

import { useEffect, useState } from 'react';
import { SectionRadarChart } from '@/components/section-radar-chart';
import type { SectionRadarData } from '@/lib/section-radar';

interface SectionRadarPanelProps {
  /** 完整 API 路径，如 /api/records/xxx/radar */
  fetchUrl: string | null;
  title?: string;
}

export function SectionRadarPanel({ fetchUrl, title = '章节得分雷达图' }: SectionRadarPanelProps) {
  const [radar, setRadar] = useState<SectionRadarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fetchUrl) {
      setRadar(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(fetchUrl)
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = fetchUrl.includes('/admin/') ? '/admin/login' : '/login';
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (!d) return;
        if (!d.success) {
          setError(d.error || '加载雷达图失败');
          setRadar(null);
          return;
        }
        setRadar(d.radar);
      })
      .catch(() => {
        if (!cancelled) setError('加载雷达图失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  if (!fetchUrl) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      {loading && <p className="mt-3 text-sm text-slate-400">加载雷达图…</p>}
      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && radar && (
        <SectionRadarChart
          className="mt-3"
          sections={radar.sections}
          totalScore={radar.totalScore}
          templateMaxScore={radar.templateMaxScore}
        />
      )}
    </div>
  );
}
