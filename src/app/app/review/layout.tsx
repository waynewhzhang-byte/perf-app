import { redirect } from 'next/navigation';
import { getSession, getUserRoles } from '@/lib/auth';

export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession(false);
  if (!session) redirect('/login');

  const roles = await getUserRoles(session.userId);
  const isReviewer = roles.includes('REVIEWER_L1') || roles.includes('REVIEWER_L2');
  if (!isReviewer) redirect('/app');

  return <>{children}</>;
}
