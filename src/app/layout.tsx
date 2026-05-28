import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '企业员工绩效申报系统',
  description: '员工绩效材料在线填报与两级审核',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased font-sans">{children}</body>
    </html>
  );
}
