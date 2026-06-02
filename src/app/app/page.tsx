import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, getUserRoles } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LogoutButton } from '@/components/logout-button';

export default async function EmployeeHome() {
  const s = await getSession(false);
  if (!s) redirect('/login');
  const roles = await getUserRoles(s.userId);
  const isReviewer = roles.includes('REVIEWER_L1') || roles.includes('REVIEWER_L2');

  const templates = await prisma.formTemplate.findMany({ where: { status: 'PUBLISHED' } });
  const subs = await prisma.submission.findMany({
    where: { userId: s.userId }, include: { template: true },
  });

  const records = await prisma.performanceRecord.findMany({
    where: { userId: s.userId },
    orderBy: { year: 'desc' },
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">我的申报</h1>
          <p className="mt-1.5 text-sm text-slate-500">欢迎，{s.fullName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/app/profile" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition-colors hover:bg-slate-50 cursor-pointer">个人资料</Link>
          {isReviewer && (
            <Link href="/app/review" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition-colors hover:bg-slate-50 cursor-pointer">审核工作台</Link>
          )}
          {records.length > 0 && (
            <Link href="/app/records" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium transition-colors hover:bg-slate-50 cursor-pointer">绩效档案</Link>
          )}
          <LogoutButton />
        </div>
      </header>

      {records.length > 0 && (
        <section className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {records.slice(0, 3).map((rec) => (
              <Link
                key={rec.id}
                href="/app/records"
                className="group rounded-xl border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-primary-300 hover:shadow-md cursor-pointer"
              >
                <p className="text-xs font-medium text-slate-400">{rec.year} 年度绩效</p>
                <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{Number(rec.totalScore).toFixed(1)}</p>
                <p className="mt-0.5 text-xs text-slate-400">分</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">可申报表单</h2>
        <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {templates.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">暂无已发布表单</li>
          )}
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {t.title}
                  <span className="ml-2 text-xs text-slate-400">{t.year}</span>
                </p>
                <p className="mt-0.5 text-sm text-slate-500 truncate">{t.description}</p>
              </div>
              <Link
                href={`/app/submission/${t.id}`}
                className="shrink-0 rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 cursor-pointer"
              >
                去填报
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">我的申报记录</h2>
        <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {subs.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-slate-400">暂无记录</li>
          )}
          {subs.map((s) => {
            const statusConfig: Record<string, { label: string; className: string }> = {
              DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-600' },
              SUBMITTED: { label: '待审核', className: 'bg-blue-50 text-blue-700' },
              L1_APPROVED: { label: '一审通过', className: 'bg-emerald-50 text-emerald-700' },
              L2_APPROVED: { label: '终审通过', className: 'bg-emerald-100 text-emerald-800' },
              PRE_REVIEW_REJECTED: { label: '预审未通过', className: 'bg-red-50 text-red-700' },
              REJECTED: { label: '已驳回', className: 'bg-amber-50 text-amber-700' },
            };
            const sc = statusConfig[s.status] ?? { label: s.status, className: 'bg-slate-100 text-slate-600' };
            const isRejected = s.status === 'REJECTED' || s.status === 'PRE_REVIEW_REJECTED';
            return (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{s.template.title}</p>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <span className="tabular-nums font-medium">{Number(s.totalScore).toFixed(1)} 分</span>
                    <span className={`inline-block rounded-full px-2 py-px text-xs font-medium ${sc.className}`}>
                      {sc.label}
                    </span>
                  </div>
                </div>
                <Link
                  href={`/app/submission/${s.template.id}`}
                  className={`shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                    isRejected
                      ? 'bg-amber-600 text-white hover:bg-amber-700'
                      : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {isRejected ? '修改重提' : '查看'}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
