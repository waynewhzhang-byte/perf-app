import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, getUserRoles } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { LogoutButton } from '@/components/logout-button';

export default async function AdminHome() {
  const s = await getSession(true);
  if (!s) redirect('/admin/login');
  const roles = await getUserRoles(s.userId);
  if (!roles.includes('ADMIN')) redirect('/admin/login');

  const cfg = await prisma.notifyConfig.findUnique({ where: { id: 1 } });
  const [userCount, tplCount, subCount] = await Promise.all([
    prisma.user.count(),
    prisma.formTemplate.count(),
    prisma.submission.count(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">管理后台</h1>
          <p className="mt-1.5 text-sm text-slate-500">欢迎，{s.fullName}</p>
        </div>
        <LogoutButton isAdmin />
      </div>

      {!cfg && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <svg className="h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span>系统尚未配置通知渠道，员工注册/找回密码将无法发送验证码。</span>
          <Link href="/admin/notify" className="ml-auto shrink-0 font-medium underline underline-offset-2 hover:text-amber-900">前往配置</Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat label="用户总数" value={userCount} />
        <Stat label="申报模板" value={tplCount} />
        <Stat label="申报记录" value={subCount} />
      </div>

      <nav className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NavCard href="/admin/notify" title="通知渠道" desc="短信 / 邮件 切换与配置" />
        <NavCard href="/admin/auth" title="登录验证策略" desc="验证码开关与强密码规则" />
        <NavCard href="/admin/organization" title="组织架构" desc="分公司 / 部门 / 岗位 / 工种" />
        <NavCard href="/admin/templates" title="申报表配置" desc="设计与发布申报模板" />
        <NavCard href="/admin/users" title="用户与角色" desc="审核员分配、角色管理" />
        <NavCard href="/admin/review-audit" title="审核审计" desc="审核进度、结果与评价报告" />
        <NavCard href="/admin/reports" title="报表分析" desc="已通过员工分值按表单统计" />
        <NavCard href="/admin/export" title="数据导出" desc="按分公司+年度打包 ZIP" />
      </nav>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1.5 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-slate-200 bg-white p-5 transition-all duration-200 hover:border-primary-300 hover:shadow-md cursor-pointer"
    >
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{desc}</p>
    </Link>
  );
}
