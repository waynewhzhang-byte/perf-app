import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAttemptCount,
  isRateLimited,
  recordAttempt,
  resetRateLimitStore,
  setRateLimitStore,
  type RateLimitStore,
} from './rate-limit';

class TestMemoryStore implements RateLimitStore {
  private counts = new Map<string, number>();

  async isLimited(key: string, maxAttempts: number): Promise<boolean> {
    return (this.counts.get(key) ?? 0) >= maxAttempts;
  }

  async record(key: string): Promise<void> {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  async count(key: string): Promise<number> {
    return this.counts.get(key) ?? 0;
  }
}

describe('rate-limit memory store', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('未超限时不阻断', async () => {
    assert.equal(await isRateLimited('k1', 3, 60_000), false);
    await recordAttempt('k1', 60_000);
    assert.equal(await getAttemptCount('k1'), 1);
    assert.equal(await isRateLimited('k1', 3, 60_000), false);
  });

  it('达到上限后阻断', async () => {
    await recordAttempt('k2', 60_000);
    await recordAttempt('k2', 60_000);
    await recordAttempt('k2', 60_000);
    assert.equal(await isRateLimited('k2', 3, 60_000), true);
  });

  it('可注入自定义 store', async () => {
    const store = new TestMemoryStore();
    setRateLimitStore(store);
    await recordAttempt('inject', 1_000);
    assert.equal(await getAttemptCount('inject'), 1);
  });
});
