import { AdminBackButton } from '@/components/admin-back-button';
import { LogoutButton } from '@/components/logout-button';

export function AdminPageActions() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <AdminBackButton />
      <LogoutButton isAdmin />
    </div>
  );
}
