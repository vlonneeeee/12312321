import { child } from "@core/logger/logger";
import { redis } from "@core/cache/redis";

const log = child("owner");

const CHAOS_KEY = (gid: string) => `owner:chaos:${gid}`;
const MEME_KEY = (gid: string) => `owner:meme:${gid}`;
const LOCKDOWN_KEY = (gid: string) => `owner:lockdown:${gid}`;

/**
 * In-process state for OWNER toggles plus Redis mirror for cross-restart
 * persistence. Use the redis-backed `has*` helpers from listeners; the
 * in-process Set is just a fast cache.
 */
class OwnerStateStore {
  private readonly chaos = new Set<string>();
  private readonly meme = new Set<string>();

  async enableChaos(guildId: string, ttlSec = 1800): Promise<void> {
    this.chaos.add(guildId);
    try {
      await redis.set(CHAOS_KEY(guildId), "1", "EX", ttlSec);
    } catch (err) {
      log.warn({ err, guildId }, "chaos redis write failed");
    }
  }

  async disableChaos(guildId: string): Promise<void> {
    this.chaos.delete(guildId);
    try {
      await redis.del(CHAOS_KEY(guildId));
    } catch (err) {
      log.warn({ err, guildId }, "chaos redis delete failed");
    }
  }

  async hasChaos(guildId: string): Promise<boolean> {
    if (this.chaos.has(guildId)) return true;
    try {
      const v = await redis.get(CHAOS_KEY(guildId));
      if (v) this.chaos.add(guildId);
      return v !== null;
    } catch {
      return false;
    }
  }

  async enableMeme(guildId: string, ttlSec = 1800): Promise<void> {
    this.meme.add(guildId);
    try {
      await redis.set(MEME_KEY(guildId), "1", "EX", ttlSec);
    } catch (err) {
      log.warn({ err, guildId }, "meme redis write failed");
    }
  }

  async disableMeme(guildId: string): Promise<void> {
    this.meme.delete(guildId);
    try {
      await redis.del(MEME_KEY(guildId));
    } catch (err) {
      log.warn({ err, guildId }, "meme redis delete failed");
    }
  }

  async hasMeme(guildId: string): Promise<boolean> {
    if (this.meme.has(guildId)) return true;
    try {
      const v = await redis.get(MEME_KEY(guildId));
      if (v) this.meme.add(guildId);
      return v !== null;
    } catch {
      return false;
    }
  }

  async markLockdown(guildId: string, payload: string): Promise<void> {
    try {
      await redis.set(LOCKDOWN_KEY(guildId), payload, "EX", 60 * 60 * 24 * 7);
    } catch (err) {
      log.warn({ err, guildId }, "lockdown redis write failed");
    }
  }

  async readLockdown(guildId: string): Promise<string | null> {
    try {
      return await redis.get(LOCKDOWN_KEY(guildId));
    } catch {
      return null;
    }
  }

  async clearLockdown(guildId: string): Promise<void> {
    try {
      await redis.del(LOCKDOWN_KEY(guildId));
    } catch (err) {
      log.warn({ err, guildId }, "lockdown redis delete failed");
    }
  }
}

export const ownerState = new OwnerStateStore();

const MEMES = [
  "kekw",
  "Pog",
  "ratio + L",
  "this is fine рџ”Ґ",
  "average chat enjoyer",
  "skill issue",
  "рџ—ї",
  "no thoughts head empty",
  "based",
  "рџ’Ђрџ’Ђрџ’Ђ",
];

export function randomMeme(): string {
  return MEMES[Math.floor(Math.random() * MEMES.length)] ?? "рџ¤–";
}
