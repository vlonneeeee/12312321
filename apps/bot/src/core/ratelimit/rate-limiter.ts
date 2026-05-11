import { redis } from "@core/cache/redis";

/**
 * Sliding window rate limiter implemented with Redis sorted sets.
 * Each call records a hit and trims entries outside the window.
 */
export class RateLimiter {
  constructor(
    private readonly bucket: string,
    private readonly limit: number,
    private readonly windowSec: number,
  ) {}

  async hit(id: string): Promise<{ ok: boolean; remaining: number; resetAt: number }> {
    const key = `rl:${this.bucket}:${id}`;
    const now = Date.now();
    const windowStart = now - this.windowSec * 1000;

    const pipeline = redis.multi();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, this.windowSec);
    const result = await pipeline.exec();
    const count = (result?.[2]?.[1] as number) ?? 0;
    return {
      ok: count <= this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt: now + this.windowSec * 1000,
    };
  }
}
