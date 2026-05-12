import { child } from "@core/logger/logger";
import { redis } from "@core/cache/redis";

/**
 * Internal OwnerStateStore. Preserved from the legacy owner module so the
 * chaos / meme / lockdown semantics remain available to any future panel
 * action — but with NO public slash-command exposure.
 *
 * Phase 1 keeps this as plain TS, callable only from within
 * `modules/owner/`. The legacy `MessageCreate` listener that drove the
 * meme-reply behaviour was removed; future phases can re-introduce the
 * behaviour via an owner action that explicitly enables it.
 */

const log = child("owner.state");

const CHAOS_KEY = (gid: string) => `owner:chaos:${gid}`;
const MEME_KEY = (gid: string) => `owner:meme:${gid}`;
const LOCKDOWN_KEY = (gid: string) => `owner:lockdown:${gid}`;

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
  "this is fine 🔥",
  "average chat enjoyer",
  "skill issue",
  "🗿",
  "no thoughts head empty",
  "based",
  "💀💀💀",
];

export function randomMeme(): string {
  return MEMES[Math.floor(Math.random() * MEMES.length)] ?? "🤖";
}
