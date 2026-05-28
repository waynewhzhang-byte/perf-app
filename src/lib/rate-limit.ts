// Simple in-memory sliding-window rate limiter for Next.js Route Handlers.
// NOTE: In-memory store resets on restart. For multi-instance production, replace
// with Redis/Upstash or a database-backed limiter.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup every 60 seconds to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 60_000).unref();

export function isRateLimited(
  key: string,
  maxAttempts: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) return false;
  return entry.count >= maxAttempts;
}

export function recordAttempt(key: string, windowMs: number): void {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count++;
  }
}

export function getAttemptCount(key: string): number {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) return 0;
  return entry.count;
}

/** Extract the client IP from standard proxy / CDN headers.
 * IMPORTANT: Only trusts X-Forwarded-For when the app is behind a trusted
 * reverse proxy that strips spoofed headers. In direct-exposure deployments,
 * prefer X-Real-IP (set by nginx/Caddy) or the socket remote address.
 */
export function extractIP(req: Request): string {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}
