import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { buildScoringGuideContent } from '@/lib/scoring-guide';
import { ScoringGuideContent } from '@/components/scoring-guide-content';
import { LogoutButton } from '@/components/logout-button';

export default async function ScoringGuidePage() {
  const session = await getSession(false);
  if (!session) redirect('/login');

  const guide = buildScoringGuideContent(2026);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/app" className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700">
            ← 返回我的申报
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">评分规则说明</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            了解 {guide.year} 年量化积分如何构成，以及 11 项绩效计分规则
          </p>
        </div>
        <LogoutButton />
      </header>

      <div className="mt-6">
        <ScoringGuideContent guide={guide} />
      </div>
    </main>
  );
}
