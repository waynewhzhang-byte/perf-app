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
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">管理后台</h1>
          <p className="mt-2 text-slate-600">欢迎，{s.fullName}</p>
        </div>
        <LogoutButton isAdmin />
      </div>

      {!cfg && (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-amber-800">
          ⚠️ 系统尚未配置通知渠道，员工注册/找回密码将无法发送验证码。
          <Link href="/admin/notify" className="ml-2 underline">前往配置</Link>
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
        <NavCard href="/admin/export" title="数据导出" desc="按分公司+年度打包 ZIP" />
      </nav>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block rounded-lg border bg-white p-4 hover:shadow">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{desc}</p>
    </Link>
  );
}
