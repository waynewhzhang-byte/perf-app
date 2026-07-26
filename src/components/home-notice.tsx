import { shouldShowHomeNotice } from '@/lib/app-config';

/** 员工首页底部提示（标题可选，正文非空才渲染）。 */
export function HomeNotice({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  if (!shouldShowHomeNotice(body)) return null;
  const heading = title.trim();

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
      {heading ? (
        <h2 className="text-sm font-semibold text-slate-900">{heading}</h2>
      ) : null}
      <pre
        className={`whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-600 ${
          heading ? 'mt-2' : ''
        }`}
      >
        {body.trim()}
      </pre>
    </section>
  );
}
