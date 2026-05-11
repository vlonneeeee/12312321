import { Events, type Message, MessageType } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { redis } from "@core/cache/redis";
import { prisma } from "@core/db/prisma";
import { moderationService } from "./moderation.service";
import { child } from "@core/logger/logger";

const log = child("antispam");

const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i;
const URL_REGEX = /https?:\/\/[^\s]+/i;
// Identical content sent in rapid succession threshold.
const DUP_WINDOW_MS = 30_000;

export const event = defineEvent({
  name: Events.MessageCreate,
  async execute(message: Message) {
    if (message.author.bot || !message.inGuild()) return;
    if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;

    const cfg = await prisma.antiSpamConfig.findUnique({ where: { guildId: message.guildId } });
    if (!cfg?.enabled) return;
    if (cfg.ignoreRoles.length && message.member?.roles.cache.some((r) => cfg.ignoreRoles.includes(r.id))) {
      return;
    }

    const baseKey = `antispam:${message.guildId}:${message.author.id}`;
    const sliding = `${baseKey}:slide`;
    const now = Date.now();
    const windowStart = now - cfg.perSeconds * 1000;
    await redis
      .multi()
      .zremrangebyscore(sliding, 0, windowStart)
      .zadd(sliding, now, `${message.id}-${Math.random()}`)
      .expire(sliding, cfg.perSeconds + 5)
      .exec();
    const count = await redis.zcard(sliding);

    // duplicate content detection
    const dupKey = `${baseKey}:last`;
    const last = await redis.get(dupKey);
    let isDuplicate = false;
    if (last === message.content && message.content.length > 5) isDuplicate = true;
    await redis.set(dupKey, message.content.slice(0, 256), "PX", DUP_WINDOW_MS);

    // mention spam
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    const mentionSpam = mentionCount >= 5;

    // invites + suspicious links handled below by ContentFilter; here we trigger
    // the spam path if message is heavy and matches both criteria.
    const inviteSpam = INVITE_REGEX.test(message.content) && count >= 3;
    const linkSpam = URL_REGEX.test(message.content) && count >= cfg.maxMessages;

    if (count > cfg.maxMessages || isDuplicate || mentionSpam || inviteSpam || linkSpam) {
      try {
        await message.delete().catch(() => null);
        const reason = mentionSpam
          ? "Mention spam"
          : isDuplicate
            ? "Duplicate flood"
            : `Spam (${count} msgs / ${cfg.perSeconds}s)`;
        if (!message.member) return;
        switch (cfg.punishment) {
          case "warn":
            await moderationService.warn(message.guild, message.member, message.member, reason);
            break;
          case "mute":
            await moderationService.mute(
              message.guild,
              message.member,
              message.member,
              cfg.punishSeconds,
              reason,
            );
            break;
          case "kick":
            await moderationService.kick(message.guild, message.member, message.member, reason);
            break;
          case "ban":
            await moderationService.ban(message.guild, message.member, message.member, reason);
            break;
        }
      } catch (err) {
        log.warn({ err }, "antispam action failed");
      }
    }
  },
});
