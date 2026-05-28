import Link from 'next/link';

export function AdminBackButton() {
  return (
    <Link
      href="/admin"
      className="inline-flex items-center rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
    >
      ← 返回主菜单
    </Link>
  );
}
