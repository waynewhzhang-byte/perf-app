'use client';

import { useEffect, useState } from 'react';

export type PublicAppConfig = {
  supportPhone: string;
  noticeText: string;
  noticeSeconds: number;
  noticeRevision: string;
  homeNoticeTitle: string;
  homeNoticeBody: string;
};

export function usePublicAppConfig() {
  const [config, setConfig] = useState<PublicAppConfig | null>(null);

  useEffect(() => {
    fetch('/api/public/app-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.config) setConfig(d.config as PublicAppConfig);
      })
      .catch(() => {});
  }, []);

  return config;
}
