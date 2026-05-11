import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { ensureGuild, ensureMember } from "@shared/utils/ensure";
import { child } from "@core/logger/logger";
import {
  buildMemberEventMessage,
  GOODBYE_DEFAULT_COLOR,
  parseWelcomeEmbed,
  WELCOME_DEFAULT_COLOR,
} from "../welcome/welcome.service";

const log = child("lifecycle");

const guildCreate = defineEvent({
  name: Events.GuildCreate,
  async execute(guild) {
    await ensureGuild(guild);
    log.info(
      { guildId: guild.id, name: guild.name, members: guild.memberCount },
      "joined guild",
    );
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
      select: {
        welcomeChannelId: true,
        welcomeMessage: true,
        welcomeEmbed: true,
        autoRoleIds: true,
      },
    });
    if (cfg?.welcomeChannelId && (cfg.welcomeMessage || cfg.welcomeEmbed)) {
      const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
      if (channel?.isTextBased()) {
        const payload = buildMemberEventMessage({
          guild: member.guild,
          member,
          text: cfg.welcomeMessage,
          embed: parseWelcomeEmbed(cfg.welcomeEmbed),
          fallbackColor: WELCOME_DEFAULT_COLOR,
        });
        await channel
          .send({
            content: payload.content || undefined,
            embeds: payload.embeds,
          })
          .catch((err) =>
            log.warn(
              { err: err instanceof Error ? err.message : err, guildId: member.guild.id },
              "welcome send failed",
            ),
          );
      }
    }
    if (cfg?.autoRoleIds.length) {
      for (const roleId of cfg.autoRoleIds) {
        await member.roles
          .add(roleId, "AutoRole on join")
          .catch((err) =>
            log.warn(
              {
                err: err instanceof Error ? err.message : err,
                guildId: member.guild.id,
                roleId,
              },
              "autorole add failed (missing role or perms)",
            ),
          );
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
      select: {
        goodbyeChannelId: true,
        goodbyeMessage: true,
        goodbyeEmbed: true,
      },
    });
    if (cfg?.goodbyeChannelId && (cfg.goodbyeMessage || cfg.goodbyeEmbed)) {
      const channel = member.guild.channels.cache.get(cfg.goodbyeChannelId);
      if (channel?.isTextBased()) {
        const payload = buildMemberEventMessage({
          guild: member.guild,
          member,
          text: cfg.goodbyeMessage,
          embed: parseWelcomeEmbed(cfg.goodbyeEmbed),
          fallbackColor: GOODBYE_DEFAULT_COLOR,
        });
        await channel
          .send({
            content: payload.content || undefined,
            embeds: payload.embeds,
          })
          .catch((err) =>
            log.warn(
              { err: err instanceof Error ? err.message : err, guildId: member.guild.id },
              "goodbye send failed",
            ),
          );
      }
    }
    await prisma.guildMember
      .update({
        where: {
          userId_guildId: { userId: member.id, guildId: member.guild.id },
        },
        data: { leftAt: new Date() },
      })
      .catch(() => null);
  },
});

export const events = [guildCreate, guildDelete, guildMemberAdd, guildMemberRemove];
