'use client';

type LogoutButtonProps = {
  isAdmin?: boolean;
  className?: string;
};

export function LogoutButton({
  isAdmin = false,
  className = 'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer',
}: LogoutButtonProps) {
  async function logout() {
    await fetch(`/api/auth/logout${isAdmin ? '?admin=1' : ''}`, { method: 'POST' });
    globalThis.location.href = isAdmin ? '/admin/login' : '/login';
  }

  return (
    <button type="button" onClick={logout} className={className}>
      退出登录
    </button>
  );
}
