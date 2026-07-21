import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // 只在生产环境启用追踪
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // 会话重放配置
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // 开发环境关闭 Sentry 以避免噪音
  enabled: process.env.NODE_ENV !== 'development',
})
