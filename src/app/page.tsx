import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-bold">企业员工绩效申报系统</h1>
      <p className="mt-3 text-slate-600">
        请选择对应入口登录。员工与管理员入口独立。
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link href="/login" className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md">
          <h2 className="text-xl font-semibold">员工入口</h2>
          <p className="mt-2 text-sm text-slate-500">申报材料、查看审核状态、个人中心</p>
        </Link>
        <Link href="/admin/login" className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md">
          <h2 className="text-xl font-semibold">管理员入口</h2>
          <p className="mt-2 text-sm text-slate-500">组织架构、表单配置、审核员分配、数据导出</p>
        </Link>
      </div>
    </main>
  );
}
