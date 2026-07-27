'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { NOTICE_ACK_STORAGE_PREFIX } from '@/lib/app-config';

type PublicAppConfig = {
  supportPhone: string;
  noticeText: string;
  noticeSeconds: number;
  noticeRevision: string;
};

function ackStorageKey(userId: string) {
  return `${NOTICE_ACK_STORAGE_PREFIX}${userId}`;
}

function readAckRevision(userId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ackStorageKey(userId));
  } catch {
    return null;
  }
}

function writeAckRevision(userId: string, revision: string) {
  try {
    localStorage.setItem(ackStorageKey(userId), revision);
  } catch {
    // ignore quota / private mode
  }
}

export function DeclarationNoticeGate({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const skipGate = pathname.startsWith('/app/review');
  const [config, setConfig] = useState<PublicAppConfig | null>(null);
  const [ackRevision, setAckRevision] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (skipGate) {
      setReady(true);
      return;
    }
    fetch('/api/public/app-config')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.config) {
          setConfig(d.config as PublicAppConfig);
          const stored = readAckRevision(userId);
          setAckRevision(stored);
          if (stored === d.config.noticeRevision) {
            setReady(true);
          } else {
            setSecondsLeft(d.config.noticeSeconds ?? 30);
          }
        } else {
          setReady(true);
        }
      })
      .catch(() => setReady(true));
  }, [skipGate, userId]);

  useEffect(() => {
    if (ready || skipGate || !config) return;
    if (secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [ready, skipGate, config, secondsLeft]);

  const showModal = useMemo(() => {
    if (skipGate || ready || !config) return false;
    return ackRevision !== config.noticeRevision;
  }, [skipGate, ready, config, ackRevision]);

  const confirm = () => {
    if (!config || secondsLeft > 0) return;
    writeAckRevision(userId, config.noticeRevision);
    setAckRevision(config.noticeRevision);
    setReady(true);
  };

  if (!ready && !showModal && !skipGate) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        加载中…
      </div>
    );
  }

  return (
    <>
      {children}
      {showModal && config && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="declaration-notice-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 id="declaration-notice-title" className="text-lg font-semibold text-slate-900">
                申报前必读
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                请认真阅读以下内容，阅读满 {config.noticeSeconds} 秒后方可继续。
              </p>
            </div>
            <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
                {config.noticeText}
              </pre>
            </div>
            <div className="space-y-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <Link
                href="/app/scoring-guide"
                className="inline-block text-sm font-medium text-primary-600 hover:text-primary-700"
              >
                查看 2026 评分规则说明 →
              </Link>
              <button
                type="button"
                onClick={confirm}
                disabled={secondsLeft > 0}
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {secondsLeft > 0
                  ? `我已认真阅读，确认继续填报（${secondsLeft}s）`
                  : '我已认真阅读，确认继续填报'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
