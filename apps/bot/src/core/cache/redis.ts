import { Redis } from "ioredis";
import { env } from "@core/config/env";
import { child } from "@core/logger/logger";

const log = child("redis");

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => log.info("Redis connecting…"));
redis.on("ready", () => log.info("Redis ready"));
redis.on("error", (e) => log.error({ err: e.message }, "Redis error"));
redis.on("end", () => log.warn("Redis connection ended"));

/**
 * Lightweight typed cache wrapper around Redis. Keys are namespaced to avoid
 * collisions between modules.
 */
export class Cache {
  constructor(private readonly client: Redis = redis, private readonly ns = "bot") {}

  private k(key: string): string {
    return `${this.ns}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.k(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
    const data = JSON.stringify(value);
    if (ttlSec) {
      await this.client.set(this.k(key), data, "EX", ttlSec);
    } else {
      await this.client.set(this.k(key), data);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }

  async incr(key: string, ttlSec?: number): Promise<number> {
    const k = this.k(key);
    const val = await this.client.incr(k);
    if (ttlSec && val === 1) await this.client.expire(k, ttlSec);
    return val;
  }

  /** Get-or-compute pattern with optional TTL. */
  async wrap<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const fresh = await fn();
    await this.set(key, fresh, ttlSec);
    return fresh;
  }
}

export const cache = new Cache();
