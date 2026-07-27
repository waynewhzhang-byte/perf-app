'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatDeclarationLevelDisplay } from '@/lib/declaration-level';

interface ScoreLine {
  id?: string;
  label: string;
  score: number;
  detail?: string;
}

interface ScoreItem {
  dimensionCode: string;
  title: string;
  maxScore: number;
  score: number;
  source: 'FACT' | 'MANUAL' | 'NONE' | 'DEDUCTION';
  ruleSummary: string;
  hasImportedFacts: boolean;
  lines: ScoreLine[];
}

interface ScoreSection {
  code: string;
  title: string;
  maxScore: number;
  score: number;
  items: ScoreItem[];
}

interface ScoreSheet {
  year: number;
  employeeNo: string;
  employeeName: string;
  declarationTier: string | null;
  positiveMaxScore: number;
  positiveScore: number;
  deductionScore: number;
  totalScore: number;
  sections: ScoreSection[];
}

interface FactResult {
  employeeNo: string;
  employeeName: string;
  branchName: string | null;
  departmentName: string | null;
  declarationTier: string | null;
  ticketRawScore: number | null;
  defectRawScore: number | null;
  sheet: ScoreSheet;
}

const SOURCE_LABEL: Record<ScoreItem['source'], string> = {
  FACT: '事实数据',
  MANUAL: '申报数据',
  NONE: '暂无数据',
  DEDUCTION: '扣分事实',
};

function formatScore(value: number | null | undefined): string {
  if (value == null) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function EmployeeFactPanel({
  employeeNo,
  year,
  compact = false,
}: {
  employeeNo: string;
  year: number;
  compact?: boolean;
}) {
  const [result, setResult] = useState<FactResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!employeeNo) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year), employeeNo });
      const response = await fetch(`/api/admin/import/scores?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '事实数据加载失败');
      const row = body.rows?.[0] as FactResult | undefined;
      if (!row?.sheet) throw new Error('该年度暂无事实绩效数据');
      setResult(row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '事实数据加载失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [employeeNo, year]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <p className="text-xs text-slate-400">正在加载事实绩效明细…</p>;
  }
  if (error) {
    return <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{error}</p>;
  }
  if (!result) return null;

  const factItems = result.sheet.sections.flatMap((section) => section.items);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">事实绩效基础</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {[
              result.branchName,
              result.departmentName,
              result.declarationTier
                ? `${formatDeclarationLevelDisplay(result.declarationTier) ?? result.declarationTier}能级`
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || '基于导入事实与积分规则计算'}
            </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
            事实得分 {formatScore(result.sheet.totalScore)}
          </span>
          <Link
            href={`/admin/employee-score-sheet?employeeNo=${encodeURIComponent(employeeNo)}&year=${year}`}
            className="text-xs font-medium text-primary-700 hover:underline"
          >
            完整绩效表 →
          </Link>
        </div>
      </div>

      {!compact && (
        <div className="grid gap-2 sm:grid-cols-4">
          <MiniMetric label="正向得分" value={`${formatScore(result.sheet.positiveScore)} / ${formatScore(result.sheet.positiveMaxScore)}`} />
          <MiniMetric label="扣分" value={formatScore(result.sheet.deductionScore)} />
          <MiniMetric label="两票原始分" value={formatScore(result.ticketRawScore)} />
          <MiniMetric label="缺陷原始分" value={formatScore(result.defectRawScore)} />
        </div>
      )}

      <div className={`grid gap-2 ${compact ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {factItems.map((item) => (
          <div key={item.dimensionCode} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-800" title={item.title}>{item.title}</p>
                <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  item.hasImportedFacts ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {SOURCE_LABEL[item.source]}
                </span>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatScore(item.score)}</p>
            </div>
            {item.lines.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                {item.lines.slice(0, compact ? 2 : 5).map((line, index) => (
                  <li key={line.id ?? `${item.dimensionCode}-${index}`} className="flex justify-between gap-2 text-[11px] text-slate-600">
                    <span className="truncate" title={line.detail ? `${line.label} · ${line.detail}` : line.label}>
                      {line.label}
                      {line.detail && <span className="text-slate-400"> · {line.detail}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatScore(line.score)}</span>
                  </li>
                ))}
                {item.lines.length > (compact ? 2 : 5) && (
                  <li className="text-[10px] text-slate-400">另有 {item.lines.length - (compact ? 2 : 5)} 条事实…</li>
                )}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
