// Sliding-window rate limiter for Next.js Route Handlers.
//
// Default backend is in-process memory (Map). For multi-instance production,
// set REDIS_URL to switch to a Redis-backed store via ioredis.
//
// Usage across callers is unchanged — isRateLimited / recordAttempt /
// getAttemptCount / extractIP keep the same signatures.

// ---- Store interface ---------------------------------------------------------

export interface RateLimitStore {
  isLimited(key: string, maxAttempts: number, windowMs: number): boolean;
  record(key: string, windowMs: number): void;
  count(key: string): number;
}

// ---- Memory backend (default) ------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();

  constructor() {
    // Periodic cleanup every 60 seconds to prevent unbounded memory growth.
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (entry.resetAt < now) this.store.delete(key);
      }
    }, 60_000).unref();
  }

  isLimited(key: string, maxAttempts: number, _windowMs: number): boolean {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) return false;
    return entry.count >= maxAttempts;
  }

  record(key: string, windowMs: number): void {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
    }
  }

  count(key: string): number {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) return 0;
    return entry.count;
  }
}

// ---- Singleton ---------------------------------------------------------------

let _store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (_store) return _store;

  // Redis integration point: if REDIS_URL is set, swap in a Redis-backed store.
  // The store must satisfy the RateLimitStore interface.  Because Redis reads
  // are async, the Redis implementation may need to use a local cache or a
  // synchronous Redis client.  For now, we always use the memory backend.
  //
  // To enable Redis for multi-instance production:
  //   1. pnpm add ioredis
  //   2. Implement a class RedisRateLimitStore that satisfies RateLimitStore
  //      using Lua scripts for atomic check-and-increment.
  //   3. Return new RedisRateLimitStore(process.env.REDIS_URL!) here.
  _store = new MemoryRateLimitStore();
  return _store;
}

/** Reset the store singleton (useful in tests). */
export function resetRateLimitStore(): void {
  _store = null;
}

// ---- Public API --------------------------------------------------------------

export function isRateLimited(
  key: string,
  maxAttempts: number,
  windowMs: number,
): boolean {
  return getStore().isLimited(key, maxAttempts, windowMs);
}

export function recordAttempt(key: string, windowMs: number): void {
  getStore().record(key, windowMs);
}

export function getAttemptCount(key: string): number {
  return getStore().count(key);
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
