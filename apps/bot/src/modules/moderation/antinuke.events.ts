import { AuditLogEvent, Events, type Guild } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { child } from "@core/logger/logger";

const log = child("antinuke");

async function track(
  guild: Guild,
  executorId: string,
  kind: "channelDelete" | "roleDelete" | "ban" | "kick" | "webhookSpam",
  windowSec: number,
): Promise<number> {
  const key = `antinuke:${guild.id}:${executorId}:${kind}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  return count;
}

async function maybeStripOrBan(guild: Guild, executorId: string) {
  const cfg = await prisma.antiNukeConfig.findUnique({ where: { guildId: guild.id } });
  if (!cfg?.enabled) return null;
  if (cfg.whitelistedUsers.includes(executorId)) return null;
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return null;
  if (member.id === guild.ownerId) return null;
  if (member.roles.cache.some((r) => cfg.whitelistedRoles.includes(r.id))) return null;
  return { cfg, member };
}

const channelDelete = defineEvent({
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!("guild" in channel) || !channel.guild) return;
    const guild = channel.guild as Guild;
    const cfg = await prisma.antiNukeConfig.findUnique({ where: { guildId: guild.id } });
    if (!cfg?.enabled) return;
    const audit = await guild
      .fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 })
      .catch(() => null);
    const exec = audit?.entries.first()?.executorId;
    if (!exec) return;
    const count = await track(guild, exec, "channelDelete", cfg.windowSeconds);
    if (count >= cfg.channelDelLimit) {
      const target = await maybeStripOrBan(guild, exec);
      if (!target) return;
      log.warn({ executorId: exec, count }, "channel-delete nuke detected");
      if (cfg.punishment === "ban") {
        await target.member.ban({ reason: "Anti-nuke: mass channel delete" }).catch(() => null);
      } else {
        await Promise.all(
          target.member.roles.cache.map((r) =>
            r.editable ? target.member.roles.remove(r, "Anti-nuke strip").catch(() => null) : null,
          ),
        );
      }
    }
  },
});

const roleDelete = defineEvent({
  name: Events.GuildRoleDelete,
  async execute(role) {
    const cfg = await prisma.antiNukeConfig.findUnique({ where: { guildId: role.guild.id } });
    if (!cfg?.enabled) return;
    const audit = await role.guild
      .fetchAuditLogs({ type: AuditLogEvent.RoleDelete, limit: 1 })
      .catch(() => null);
    const exec = audit?.entries.first()?.executorId;
    if (!exec) return;
    const count = await track(role.guild, exec, "roleDelete", cfg.windowSeconds);
    if (count >= cfg.roleDelLimit) {
      const target = await maybeStripOrBan(role.guild, exec);
      if (target?.member) {
        if (cfg.punishment === "ban") await target.member.ban({ reason: "Anti-nuke: mass role delete" }).catch(() => null);
      }
    }
  },
});

const ban = defineEvent({
  name: Events.GuildBanAdd,
  async execute(banEntry) {
    const cfg = await prisma.antiNukeConfig.findUnique({ where: { guildId: banEntry.guild.id } });
    if (!cfg?.enabled) return;
    const audit = await banEntry.guild
      .fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 })
      .catch(() => null);
    const exec = audit?.entries.first()?.executorId;
    if (!exec) return;
    const count = await track(banEntry.guild, exec, "ban", cfg.windowSeconds);
    if (count >= cfg.banLimit) {
      const target = await maybeStripOrBan(banEntry.guild, exec);
      if (target?.member && cfg.punishment === "ban") {
        await target.member.ban({ reason: "Anti-nuke: mass ban" }).catch(() => null);
      }
    }
  },
});

export const events = [channelDelete, roleDelete, ban];
