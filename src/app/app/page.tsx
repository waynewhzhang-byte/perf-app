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

  // 获取已归档的绩效记录汇总
  const records = await prisma.performanceRecord.findMany({
    where: { userId: s.userId },
    orderBy: { year: 'desc' },
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">我的申报</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/app/profile" className="rounded border px-3 py-1.5 hover:bg-slate-50">个人资料</Link>
          {isReviewer && <Link href="/app/review" className="rounded border px-3 py-1.5 hover:bg-slate-50">审核工作台</Link>}
          {records.length > 0 && <Link href="/app/records" className="rounded border px-3 py-1.5 hover:bg-slate-50">绩效档案</Link>}
          <LogoutButton />
        </div>
      </header>
      <p className="mt-2 text-slate-600">欢迎，{s.fullName}</p>

      {/* 已归档绩效总分概览 */}
      {records.length > 0 && (
        <section className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {records.slice(0, 3).map((rec) => (
              <Link
                key={rec.id}
                href="/app/records"
                className="rounded-lg border bg-white p-4 hover:border-slate-400"
              >
                <p className="text-xs text-slate-500">{rec.year} 年度绩效</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{Number(rec.totalScore).toFixed(1)}</p>
                <p className="mt-0.5 text-xs text-slate-400">分</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold">可申报表单</h2>
        <ul className="mt-3 divide-y rounded border bg-white">
          {templates.length === 0 && <li className="p-4 text-sm text-slate-500">暂无已发布表单。</li>}
          {templates.map((t) => (
            <li key={t.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{t.title} <span className="text-xs text-slate-400">{t.year}</span></p>
                <p className="text-sm text-slate-500">{t.description}</p>
              </div>
              <Link href={`/app/submission/${t.id}`} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">填报 / 续填</Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">我的申报记录</h2>
        <ul className="mt-3 divide-y rounded border bg-white">
          {subs.length === 0 && <li className="p-4 text-sm text-slate-500">暂无记录。</li>}
          {subs.map((s) => {
            const statusLabel: Record<string, string> = {
              DRAFT: '草稿', SUBMITTED: '待审核', L1_APPROVED: '一审通过',
              L2_APPROVED: '终审通过', REJECTED: '已驳回',
            };
            const isRejected = s.status === 'REJECTED';
            return (
            <li key={s.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{s.template.title}</p>
                <p className="text-sm text-slate-500">总分 {s.totalScore.toString()} ｜ 状态 {statusLabel[s.status] ?? s.status}</p>
              </div>
              <Link
                href={`/app/submission/${s.template.id}`}
                className={`rounded px-3 py-1.5 text-sm ${isRejected ? 'bg-amber-600 text-white hover:bg-amber-700' : 'border text-slate-700 hover:bg-slate-50'}`}
              >
                {isRejected ? '查看并修改' : '查看'}
              </Link>
            </li>
          )})}
        </ul>
      </section>
    </main>
  );
}
