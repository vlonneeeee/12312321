import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { ensureGuild, ensureMember } from "@shared/utils/ensure";
import { child } from "@core/logger/logger";

const log = child("lifecycle");

const guildCreate = defineEvent({
  name: Events.GuildCreate,
  async execute(guild) {
    await ensureGuild(guild);
    log.info({ guildId: guild.id, name: guild.name, members: guild.memberCount }, "joined guild");
  },
});

const guildDelete = defineEvent({
  name: Events.GuildDelete,
  async execute(guild) {
    log.info({ guildId: guild.id }, "left guild");
  },
});

const guildMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.partial) return;
    await ensureMember(member);
    const cfg = await prisma.guild.findUnique({
      where: { id: member.guild.id },
      select: { welcomeChannelId: true, welcomeMessage: true, autoRoleIds: true },
    });
    if (cfg?.welcomeChannelId && cfg.welcomeMessage) {
      const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
      if (channel?.isTextBased()) {
        await channel
          .send({
            content: cfg.welcomeMessage
              .replace(/{user}/g, `<@${member.id}>`)
              .replace(/{guild}/g, member.guild.name),
          })
          .catch(() => null);
      }
    }
    if (cfg?.autoRoleIds.length) {
      for (const roleId of cfg.autoRoleIds) {
        await member.roles.add(roleId, "AutoRole on join").catch(() => null);
      }
    }
  },
});

const guildMemberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async execute(member) {
    if (member.partial) return;
    const cfg = await prisma.guild.findUnique({
      where: { id: member.guild.id },
      select: { goodbyeChannelId: true, goodbyeMessage: true },
    });
    if (cfg?.goodbyeChannelId && cfg.goodbyeMessage) {
      const channel = member.guild.channels.cache.get(cfg.goodbyeChannelId);
      if (channel?.isTextBased()) {
        await channel
          .send({
            content: cfg.goodbyeMessage
              .replace(/{user}/g, member.user.tag)
              .replace(/{guild}/g, member.guild.name),
          })
          .catch(() => null);
      }
    }
    await prisma.guildMember
      .update({
        where: { userId_guildId: { userId: member.id, guildId: member.guild.id } },
        data: { leftAt: new Date() },
      })
      .catch(() => null);
  },
});

export const events = [guildCreate, guildDelete, guildMemberAdd, guildMemberRemove];
