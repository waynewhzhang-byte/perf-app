'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SectionScoreRow } from '@/lib/score-calculation';

export interface SectionRadarChartProps {
  sections: SectionScoreRow[];
  totalScore: number;
  templateMaxScore: number;
  className?: string;
}

function truncateLabel(title: string, max = 8) {
  if (title.length <= max) return title;
  return `${title.slice(0, max)}…`;
}

export function SectionRadarChart({
  sections,
  totalScore,
  templateMaxScore,
  className = '',
}: SectionRadarChartProps) {
  if (sections.length === 0) {
    return (
      <p className={`text-sm text-slate-500 ${className}`}>暂无章节得分数据。</p>
    );
  }

  const chartData = sections.map((s) => ({
    subject: truncateLabel(s.title),
    fullTitle: s.title,
    score: s.score,
    maxScore: s.maxScore,
    completionRate: s.completionRate,
    gap: s.gap,
    scorePct: s.maxScore > 0 ? Math.round((s.score / s.maxScore) * 100) : 0,
    maxPct: 100,
  }));

  const radiusMax = Math.max(1, ...sections.map((s) => s.maxScore));

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-slate-600">
        <span>
          实际总分 <strong className="text-slate-900">{totalScore.toFixed(1)}</strong>
        </span>
        <span>
          理论满分 <strong className="text-slate-900">{templateMaxScore.toFixed(1)}</strong>
        </span>
        {templateMaxScore > 0 && (
          <span>
            总完成率{' '}
            <strong className="text-slate-900">
              {((totalScore / templateMaxScore) * 100).toFixed(1)}%
            </strong>
          </span>
        )}
      </div>

      {sections.length < 3 ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="subject" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, radiusMax]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value ?? 0).toFixed(1)} 分`,
                  name === 'score' ? '实际得分' : '章节满分',
                ]}
                labelFormatter={(_, payload) =>
                  String(payload?.[0]?.payload?.fullTitle ?? '')
                }
              />
              <Legend formatter={(v) => (v === 'score' ? '实际得分' : '章节满分')} />
              <Bar dataKey="score" name="score" fill="#0f766e" radius={[4, 4, 0, 0]} />
              <Bar dataKey="maxScore" name="maxScore" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#475569' }} />
              <PolarRadiusAxis
                angle={90}
                domain={[0, radiusMax]}
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                formatter={(value, name) => [
                  `${Number(value ?? 0).toFixed(1)} 分`,
                  name === 'score' ? '实际得分' : '章节满分',
                ]}
                labelFormatter={(_, payload) =>
                  String(payload?.[0]?.payload?.fullTitle ?? '')
                }
              />
              <Legend formatter={(v) => (v === 'score' ? '实际得分' : '章节满分')} />
              <Radar
                name="score"
                dataKey="score"
                stroke="#0f766e"
                fill="#0f766e"
                fillOpacity={0.35}
              />
              <Radar
                name="maxScore"
                dataKey="maxScore"
                stroke="#64748b"
                fill="#64748b"
                fillOpacity={0.15}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">章节</th>
              <th className="px-3 py-2 font-medium text-right">得分</th>
              <th className="px-3 py-2 font-medium text-right">满分</th>
              <th className="px-3 py-2 font-medium text-right">完成率</th>
              <th className="px-3 py-2 font-medium text-right">差距</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sections.map((s) => (
              <tr key={s.sectionId}>
                <td className="px-3 py-2 font-medium text-slate-800">{s.title}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.score.toFixed(1)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {s.maxScore.toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(s.completionRate * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                  {s.gap.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
