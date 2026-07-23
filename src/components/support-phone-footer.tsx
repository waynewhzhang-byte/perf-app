'use client';

import { usePublicAppConfig } from '@/lib/use-app-config';

export function SupportPhoneFooter({ className = '' }: { className?: string }) {
  const config = usePublicAppConfig();
  const phone = config?.supportPhone?.trim();
  if (!phone) return null;

  return (
    <p className={`text-center text-xs text-slate-500 ${className}`.trim()}>
      技术人员 电话：
      <a href={`tel:${phone.replace(/\s/g, '')}`} className="font-medium text-slate-700 hover:text-primary-600">
        {phone}
      </a>
    </p>
  );
}
