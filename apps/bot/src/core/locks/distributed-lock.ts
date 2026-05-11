import { redis } from "@core/cache/redis";
import { randomBytes } from "node:crypto";

/**
 * Single-instance Redis-based distributed lock (Redlock-lite).
 * Suitable for shard-safe critical sections: economy transactions, role rewards,
 * ticket creation, room cleanup, etc.
 *
 * Usage:
 *   await withLock(`econ:${userId}`, 5000, async () => { ... });
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<T> {
  const { retries = 25, retryDelayMs = 100 } = opts;
  const token = randomBytes(16).toString("hex");
  const lockKey = `lock:${key}`;
  let acquired = false;

  for (let i = 0; i <= retries; i++) {
    const result = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (result === "OK") {
      acquired = true;
      break;
    }
    if (i < retries) await sleep(retryDelayMs);
  }

  if (!acquired) {
    throw new Error(`Failed to acquire lock: ${key}`);
  }

  try {
    return await fn();
  } finally {
    // Safe release: only release if we still hold the lock.
    await redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      lockKey,
      token,
    );
  }
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
