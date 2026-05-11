import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { child } from "@core/logger/logger";

const log = child("antiraid");

const joinTracker = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.partial) return;
    const cfg = await prisma.antiRaidConfig.findUnique({
      where: { guildId: member.guild.id },
    });
    if (!cfg?.enabled) return;

    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
    if (cfg.minAccountAge > 0 && accountAgeDays < cfg.minAccountAge) {
      await member.kick(`Account too new (${accountAgeDays.toFixed(1)}d < ${cfg.minAccountAge}d)`).catch(() => null);
      return;
    }

    const key = `antiraid:${member.guild.id}:joins`;
    const now = Date.now();
    await redis
      .multi()
      .zremrangebyscore(key, 0, now - cfg.joinWindowSec * 1000)
      .zadd(key, now, `${member.id}-${now}`)
      .expire(key, cfg.joinWindowSec + 5)
      .exec();
    const burst = await redis.zcard(key);

    if (burst >= cfg.joinThreshold) {
      log.warn({ guildId: member.guild.id, joins: burst }, "raid burst detected");
      if (cfg.notifyChannelId) {
        const channel = member.guild.channels.cache.get(cfg.notifyChannelId);
        if (channel?.isTextBased() && "send" in channel) {
          await channel
            .send({
              content: `⚠ Raid detected: **${burst}** joins in **${cfg.joinWindowSec}s**.\nActivated mode: **${cfg.action}**`,
            })
            .catch(() => null);
        }
      }
      if (cfg.action === "kick_new" || cfg.action === "ban_new") {
        const isBan = cfg.action === "ban_new";
        try {
          if (isBan) await member.ban({ reason: "Anti-raid burst" });
          else await member.kick("Anti-raid burst");
        } catch (err) {
          log.warn({ err }, "antiraid auto-mod failed");
        }
      }
      if (cfg.action === "lockdown") {
        await lockdownGuild(member.guild.id, true);
      }
    }
  },
});

async function lockdownGuild(guildId: string, on: boolean) {
  await redis.set(`lockdown:${guildId}`, on ? "1" : "0", "EX", 1800);
}

export const events = [joinTracker];
