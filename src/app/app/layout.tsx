import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { DeclarationNoticeGate } from '@/components/declaration-notice-gate';

export default async function EmployeeAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const employee = await getSession(false);
  const staff = await getSession(true);
  // /app/review 走管理端 cookie（REVIEWER_*）；其余员工页走员工 cookie。
  if (!employee && !staff) redirect('/login');
  if (!employee) {
    return <>{children}</>;
  }

  return (
    <DeclarationNoticeGate userId={employee.userId}>
      {children}
    </DeclarationNoticeGate>
  );
}
