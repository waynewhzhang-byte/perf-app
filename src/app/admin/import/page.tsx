'use client';
import Link from 'next/link';
import { IMPORT_ITEMS } from './_shared/field-specs';

export default function ImportCenterPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-sm font-medium text-slate-500 hover:text-slate-700">← 返回管理后台</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">数据导入中心</h1>
      <p className="mt-1 text-sm text-slate-500">
        选择导入项，上传文件并映射字段。建议按 ①→⑤ 顺序导入：员工档案最先，其余评分项依赖名册。
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_ITEMS.map((item, idx) => (
          <Link
            key={item.code}
            href={`/admin/import/${item.code}`}
            className="block rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-400 hover:shadow-sm cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                {['①', '②', '③', '④', '⑤'][idx]}
              </span>
              <h2 className="text-sm font-semibold">{item.title}</h2>
            </div>
            <p className="mt-2 text-xs text-slate-500">{item.description}</p>
            <p className="mt-2 text-[11px] text-slate-400">{item.dependsOn}</p>
          </Link>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <h2 className="text-xs font-semibold text-slate-600">查看导入结果</h2>
        <p className="mt-1 text-xs text-slate-400">
          导入完成后，可在原
          <Link href="/admin" className="ml-1 text-primary-600 underline">管理后台</Link>
          查看绩效分表与未匹配记录（查询 API 未变更）。
        </p>
      </section>
    </main>
  );
}
