export interface RateLimitPolicy {
  capacity: number;
  refillRate: number; // tokens per second
}

export interface RateLimitStatus {
  key: string;
  remaining: number;
  capacity: number;
  refillRate: number;
  resetMs: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
  policy: RateLimitPolicy;
}

/**
 * Token-Bucket Rate Limiter for AgentForge integration endpoints and providers.
 * Enforces burst limits and refill rates with non-blocking tryAcquire
 * and queueable acquire methods.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private policies = new Map<string, RateLimitPolicy>();
  private defaultPolicy: RateLimitPolicy;

  constructor(defaultPolicy: RateLimitPolicy = { capacity: 10, refillRate: 5 }) {
    this.defaultPolicy = defaultPolicy;
  }

  /**
   * Set a specific rate limit policy for a key or prefix.
   */
  setPolicy(key: string, policy: RateLimitPolicy): void {
    this.policies.set(key, policy);
  }

  private resolvePolicy(key: string): RateLimitPolicy {
    if (this.policies.has(key)) {
      return this.policies.get(key)!;
    }
    // Prefix match
    for (const [pattern, policy] of this.policies.entries()) {
      if (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1))) {
        return policy;
      }
    }
    return this.defaultPolicy;
  }

  private getBucket(key: string): BucketState {
    let bucket = this.buckets.get(key);
    const now = Date.now();
    if (!bucket) {
      const policy = this.resolvePolicy(key);
      bucket = {
        tokens: policy.capacity,
        lastRefill: now,
        policy,
      };
      this.buckets.set(key, bucket);
    } else {
      // Refill tokens based on elapsed time
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      if (elapsedSeconds > 0) {
        const added = elapsedSeconds * bucket.policy.refillRate;
        bucket.tokens = Math.min(bucket.policy.capacity, bucket.tokens + added);
        bucket.lastRefill = now;
      }
    }
    return bucket;
  }

  /**
   * Immediately attempt to acquire tokens without blocking.
   */
  tryAcquire(key: string, tokens = 1): boolean {
    const bucket = this.getBucket(key);
    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return true;
    }
    return false;
  }

  /**
   * Wait to acquire tokens up to an optional timeout in milliseconds.
   */
  async acquire(key: string, tokens = 1, timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime <= timeoutMs) {
      if (this.tryAcquire(key, tokens)) {
        return true;
      }
      const bucket = this.getBucket(key);
      const needed = tokens - bucket.tokens;
      const waitSeconds = Math.max(0.05, needed / bucket.policy.refillRate);
      const waitMs = Math.min(1000, Math.ceil(waitSeconds * 1000));

      if (Date.now() + waitMs - startTime > timeoutMs) {
        return false;
      }

      await new Promise(r => setTimeout(r, waitMs));
    }

    return false;
  }

  /**
   * Inspect the current rate limit status of a key.
   */
  getStatus(key: string): RateLimitStatus {
    const bucket = this.getBucket(key);
    const missing = bucket.policy.capacity - bucket.tokens;
    const resetMs = missing <= 0 ? 0 : Math.ceil((missing / bucket.policy.refillRate) * 1000);

    return {
      key,
      remaining: Math.floor(bucket.tokens),
      capacity: bucket.policy.capacity,
      refillRate: bucket.policy.refillRate,
      resetMs,
    };
  }

  /**
   * Reset rate limit state for a key or all keys.
   */
  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }
}
