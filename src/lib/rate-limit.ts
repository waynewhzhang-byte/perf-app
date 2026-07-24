// Sliding-window rate limiter for Next.js Route Handlers.
//
// Default backend is in-process memory (Map). For multi-instance production,
// set REDIS_URL to switch to a Redis-backed store via ioredis.

import Redis from 'ioredis';

// ---- Store interface ---------------------------------------------------------

export interface RateLimitStore {
  isLimited(key: string, maxAttempts: number, windowMs: number): Promise<boolean>;
  record(key: string, windowMs: number): Promise<void>;
  count(key: string): Promise<number>;
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

  async isLimited(key: string, maxAttempts: number, _windowMs: number): Promise<boolean> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) return false;
    return entry.count >= maxAttempts;
  }

  async record(key: string, windowMs: number): Promise<void> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      entry.count++;
    }
  }

  async count(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) return 0;
    return entry.count;
  }
}

// ---- Redis backend (multi-instance) ------------------------------------------

const INCR_WITH_TTL = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

class RedisRateLimitStore implements RateLimitStore {
  private redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  async count(key: string): Promise<number> {
    const raw = await this.redis.get(key);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async isLimited(key: string, maxAttempts: number, _windowMs: number): Promise<boolean> {
    const current = await this.count(key);
    return current >= maxAttempts;
  }

  async record(key: string, windowMs: number): Promise<void> {
    await this.redis.eval(INCR_WITH_TTL, 1, key, String(windowMs));
  }
}

// ---- Singleton ---------------------------------------------------------------

let _store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (_store) return _store;

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    _store = new RedisRateLimitStore(redisUrl);
  } else {
    _store = new MemoryRateLimitStore();
  }
  return _store;
}

/** Reset the store singleton (useful in tests). */
export function resetRateLimitStore(): void {
  _store = null;
}

/** Inject a custom store (tests). */
export function setRateLimitStore(store: RateLimitStore): void {
  _store = store;
}

// ---- Public API --------------------------------------------------------------

export async function isRateLimited(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<boolean> {
  return getStore().isLimited(key, maxAttempts, windowMs);
}

export async function recordAttempt(key: string, windowMs: number): Promise<void> {
  await getStore().record(key, windowMs);
}

export async function getAttemptCount(key: string): Promise<number> {
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
