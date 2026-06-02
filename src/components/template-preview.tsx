'use client';

export interface ScoreOpt {
  optionId?: string;
  label: string;
  score: number;
  description?: string;
}

export interface PreviewItem {
  title: string;
  hint?: string;
  isRequired: boolean;
  requireAttachment: boolean;
  maxSelections: number;
  scoreMode?: 'TIERS' | 'COUNTED';
  maxScore?: number | null;
  scoreOptions: ScoreOpt[];
  sortOrder?: number;
}

export interface PreviewSection {
  title: string;
  description?: string;
  sortOrder?: number;
  items: PreviewItem[];
}

export interface PreviewTemplate {
  year: number;
  title: string;
  description?: string;
  sections: PreviewSection[];
}

function sortSections(sections: PreviewSection[]) {
  return [...sections]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((s) => ({
      ...s,
      items: [...s.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    }));
}

function totalMaxScore(sections: PreviewSection[]) {
  return sections.reduce(
    (sum, sec) =>
      sum +
      sec.items.reduce((is, it) => {
        if (it.scoreMode === 'COUNTED') {
          return is + Number(it.maxScore ?? 0); // 封顶分即理论满分（Decimal 可能为字符串）
        }
        const scores = it.scoreOptions.map((o) => o.score);
        if (scores.length === 0) return is;
        const maxPerItem =
          it.maxSelections === 1
            ? Math.max(...scores)
            : [...scores].sort((a, b) => b - a).slice(0, it.maxSelections).reduce((a, b) => a + b, 0);
        return is + maxPerItem;
      }, 0),
    0,
  );
}

export function TemplatePreviewBody({ template }: { template: PreviewTemplate }) {
  const sections = sortSections(template.sections);
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  const maxScore = totalMaxScore(sections);

  return (
    <div className="space-y-6">
      <header className="border-b pb-4">
        <p className="text-xs text-slate-500">{template.year} 年度</p>
        <h2 className="mt-1 text-xl font-bold text-slate-900">{template.title}</h2>
        {template.description && (
          <p className="mt-2 text-sm text-slate-600">{template.description}</p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {sections.length} 个章节 · {itemCount} 个申报项
          {maxScore > 0 && ` · 理论满分约 ${maxScore.toFixed(1)} 分`}
        </p>
      </header>

      {sections.map((sec, sIdx) => (
        <section key={sIdx} className="rounded-lg border bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-slate-900">{sec.title}</h3>
          {sec.description && <p className="mt-1 text-xs text-slate-500">{sec.description}</p>}
          <div className="mt-4 space-y-4">
            {sec.items.map((it, iIdx) => (
              <div key={iIdx} className="rounded-md border border-slate-200 bg-slate-50/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-slate-800">
                    {it.title}
                    {it.isRequired && <span className="ml-1 text-red-500">*</span>}
                  </p>
                  <span className="shrink-0 text-xs text-slate-500">
                    {it.scoreMode === 'COUNTED'
                      ? `按次数计分 · 上限 ${it.maxScore ?? 0} 分`
                      : it.maxSelections > 1 ? `多选 ≤${it.maxSelections}` : '单选'}
                  </span>
                </div>
                {it.hint && <p className="mt-1 text-xs text-slate-500">{it.hint}</p>}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {it.scoreOptions.map((o, oi) => (
                    <div
                      key={`${o.label}-${oi}`}
                      className="rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{o.label || '（未命名）'}</span>
                        <span className="font-bold">
                          {o.score} 分{it.scoreMode === 'COUNTED' ? ' / 次' : ''}
                        </span>
                      </div>
                      {o.description && (
                        <p className="mt-1 text-xs text-slate-400">{o.description}</p>
                      )}
                    </div>
                  ))}
                </div>
                {it.requireAttachment && (
                  <p className="mt-2 text-xs text-slate-500">需上传证明材料</p>
                )}
                <textarea
                  disabled
                  placeholder="备注说明（员工填写）"
                  rows={2}
                  className="mt-3 w-full rounded border border-dashed border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-400"
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TemplatePreviewModal({
  template,
  onClose,
}: {
  template: PreviewTemplate;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="relative w-full max-w-3xl rounded-xl bg-slate-100 shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-xl border-b bg-white px-5 py-3">
          <span className="text-sm font-medium text-slate-700">申报表预览（员工端样式）</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            关闭
          </button>
        </div>
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-5">
          <TemplatePreviewBody template={template} />
        </div>
      </div>
    </div>
  );
}
