import type { ScoringGuideContent } from '@/lib/scoring-guide';
import { ruleTypeLabel } from '@/lib/scoring-guide';

interface Props {
  guide: ScoringGuideContent;
  backHref?: string;
  backLabel?: string;
}

export function ScoringGuideContent({ guide, backHref, backLabel = '← 返回' }: Props) {
  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-primary-200 bg-primary-50 p-5">
        <h2 className="text-lg font-semibold text-primary-900">{guide.year} 年能级评价量化积分规则</h2>
        <p className="mt-2 text-sm leading-6 text-primary-800">
          正向积分满分 <b>{guide.positiveMaxScore}</b> 分（基本素质 + 工作业绩 + 工作现场），扣分项从总分扣减。
          全部绩效维度由部门台账导入后系统自动计分；您只需在申报页确认或申诉。
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {guide.sections.map((section) => (
            <div key={section.code} className="rounded-lg border border-primary-100 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">{section.title}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                {section.maxScore}
                <span className="ml-1 text-xs font-normal text-slate-400">分</span>
              </p>
            </div>
          ))}
          <div className="rounded-lg border border-red-100 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">扣分项</p>
            <p className="mt-1 text-xl font-semibold text-red-700">
              −
              <span className="ml-1 text-xs font-normal text-slate-400">从总分扣减</span>
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">数据如何生成</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">
          {guide.dataFlowSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">参评能级（影响两票折算）</h2>
        <p className="mt-1 text-sm text-slate-500">{guide.evaluationCutoffNote}</p>
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5">能级</th>
                <th className="px-4 py-2.5">工作年限（截至 7 月 31 日）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {guide.declarationLevels.map((row) => (
                <tr key={row.level}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{row.level}</td>
                  <td className="px-4 py-2.5 text-slate-600">{row.workYears}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <span className="font-medium text-slate-700">两票折算示例：</span>
          {guide.ticketNormalizeExample}
        </p>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold text-slate-900">11 项绩效计分规则</h2>
        {guide.sections.map((section) => (
          <div key={section.code} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
              <h3 className="font-semibold text-slate-900">{section.title}</h3>
              <p className="mt-0.5 text-xs text-slate-500">满分 {section.maxScore} 分 · {section.items.length} 个计分项</p>
            </div>
            <div className="divide-y divide-slate-100">
              {section.items.map((item) => (
                <ScoringItemCard key={item.code} item={item} />
              ))}
            </div>
          </div>
        ))}

        <div className="overflow-hidden rounded-xl border border-red-200 bg-white">
          <div className="border-b border-red-100 bg-red-50 px-5 py-3">
            <h3 className="font-semibold text-red-900">特殊事项（扣分）</h3>
            <p className="mt-0.5 text-xs text-red-700">{guide.deductionItems.length} 个扣分项 · 从正向积分合计中扣减</p>
          </div>
          <div className="divide-y divide-slate-100">
            {guide.deductionItems.map((item) => (
              <ScoringItemCard key={item.code} item={item} />
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">计分方式说明</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {guide.ruleTypeExplanations.map((rule) => (
            <div key={rule.ruleType} className="rounded-lg border border-slate-200 px-4 py-3">
              <p className="text-sm font-medium text-slate-800">{rule.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{rule.description}</p>
            </div>
          ))}
        </div>
      </section>

      {backHref && (
        <p className="text-sm">
          <a href={backHref} className="font-medium text-primary-600 hover:text-primary-700">
            {backLabel}
          </a>
        </p>
      )}
    </div>
  );
}

function ScoringItemCard({ item }: { item: ScoringGuideContent['sections'][number]['items'][number] }) {
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium text-slate-900">{item.title}</h4>
        {item.maxScore > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            满分 {item.maxScore}
          </span>
        )}
        <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
          {ruleTypeLabel(item.ruleType)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{item.scoringSummary}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>业务责任：{item.ownerDepartment}</span>
      </div>
      {item.notes && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800">备注：{item.notes}</p>
      )}
    </div>
  );
}
