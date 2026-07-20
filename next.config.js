const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '20mb' },
    instrumentationHook: true,
  },
}

module.exports = withSentryConfig(nextConfig, {
  // 上传 sourcemaps 到 Sentry（生产构建时）
  sourcemaps: {
    disable: process.env.NODE_ENV !== 'production',
  },
  // 静默构建时的 telemetry 提示
  telemetry: false,
})
