export async function register() {
  // 仅在 Node.js 运行时初始化 server-side 监控
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@sentry/nextjs/import')
  }
}
