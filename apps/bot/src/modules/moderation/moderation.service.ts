import {
  type Guild,
  type GuildMember,
  type TextChannel,
  PermissionsBitField,
} from "discord.js";
import { prisma } from "@core/db/prisma";
import { eventBus } from "@core/events/event-bus";
import { UserFacingError, PermissionDeniedError } from "@core/errors/errors";
import { outranks } from "@shared/utils/perms";
import { errorEmbed, infoEmbed } from "@shared/embeds/factory";
import { child } from "@core/logger/logger";
import type { ModerationAction } from "@prisma/client";

const log = child("moderation");

export interface CreateCaseOpts {
  guild: Guild;
  subject: GuildMember;
  actor?: GuildMember | null;
  action: ModerationAction;
  reason?: string;
  durationSec?: number;
}

export class ModerationService {
  async createCase(opts: CreateCaseOpts) {
    const { guild, subject, actor, action, reason, durationSec } = opts;
    if (actor && !outranks(actor, subject)) {
      throw new PermissionDeniedError("Target has a higher or equal role.");
    }
    const expiresAt = durationSec ? new Date(Date.now() + durationSec * 1000) : null;
    const record = await prisma.moderationCase.create({
      data: {
        guildId: guild.id,
        subjectId: subject.id,
        actorId: actor?.id ?? null,
        action,
        reason: reason ?? null,
        durationSec,
        expiresAt,
      },
    });

    eventBus.emit("moderation.case", {
      caseId: record.id,
      guildId: guild.id,
      subjectId: subject.id,
      action,
    });

    await this.logToChannel(guild, record.id, action, subject, actor, reason);
    return record;
  }

  async warn(guild: Guild, subject: GuildMember, actor: GuildMember, reason?: string) {
    const record = await this.createCase({ guild, subject, actor, action: "WARN", reason });
    await prisma.guildMember.update({
      where: { userId_guildId: { userId: subject.id, guildId: guild.id } },
      data: { warnCount: { increment: 1 } },
    });
    return record;
  }

  async mute(
    guild: Guild,
    subject: GuildMember,
    actor: GuildMember,
    durationSec: number,
    reason?: string,
  ) {
    if (durationSec <= 0) throw new UserFacingError("Duration must be positive.");
    const max = 28 * 24 * 60 * 60;
    const seconds = Math.min(durationSec, max);
    await subject.timeout(seconds * 1000, reason ?? "Mute");
    const cfg = await prisma.guild.findUnique({
      where: { id: guild.id },
      select: { muteRoleId: true },
    });
    if (cfg?.muteRoleId) {
      await subject.roles.add(cfg.muteRoleId, reason ?? "Mute role").catch(() => null);
    }
    await prisma.guildMember.update({
      where: { userId_guildId: { userId: subject.id, guildId: guild.id } },
      data: { muteUntil: new Date(Date.now() + seconds * 1000) },
    });
    return this.createCase({
      guild,
      subject,
      actor,
      action: "MUTE",
      reason,
      durationSec: seconds,
    });
  }

  async kick(guild: Guild, subject: GuildMember, actor: GuildMember, reason?: string) {
    await subject.kick(reason ?? "Kicked");
    return this.createCase({ guild, subject, actor, action: "KICK", reason });
  }

  async ban(
    guild: Guild,
    subject: GuildMember,
    actor: GuildMember,
    reason?: string,
    deleteMessageSeconds = 0,
  ) {
    await guild.bans.create(subject.id, { reason, deleteMessageSeconds });
    return this.createCase({ guild, subject, actor, action: "BAN", reason });
  }

  async softban(guild: Guild, subject: GuildMember, actor: GuildMember, reason?: string) {
    await guild.bans.create(subject.id, { reason, deleteMessageSeconds: 7 * 86400 });
    await guild.bans.remove(subject.id, "Softban: lift").catch(() => null);
    return this.createCase({ guild, subject, actor, action: "SOFTBAN", reason });
  }

  async purge(channel: TextChannel, count: number, actor: GuildMember): Promise<number> {
    if (!actor.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      throw new PermissionDeniedError();
    }
    if (count < 1 || count > 100) throw new UserFacingError("Count must be 1–100.");
    const messages = await channel.bulkDelete(count, true);
    await this.createCase({
      guild: channel.guild,
      subject: actor,
      actor,
      action: "PURGE",
      reason: `Purged ${messages.size} in #${channel.name}`,
    });
    return messages.size;
  }

  async getCases(guildId: string, subjectId: string) {
    return prisma.moderationCase.findMany({
      where: { guildId, subjectId },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
  }

  private async logToChannel(
    guild: Guild,
    caseId: string,
    action: ModerationAction,
    subject: GuildMember,
    actor?: GuildMember | null,
    reason?: string,
  ) {
    try {
      const cfg = await prisma.guild.findUnique({
        where: { id: guild.id },
        select: { modLogChannelId: true },
      });
      if (!cfg?.modLogChannelId) return;
      const channel = guild.channels.cache.get(cfg.modLogChannelId);
      if (!channel?.isTextBased()) return;
      const embed =
        action === "BAN" || action === "KICK"
          ? errorEmbed(`${action} • ${subject.user.tag}`, reason ?? "No reason provided")
          : infoEmbed(`${action} • ${subject.user.tag}`, reason ?? "No reason provided");
      embed.setFooter({ text: `Case #${caseId} • Actor: ${actor?.user.tag ?? "system"}` });
      await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (err) {
      log.warn({ err }, "modlog send failed");
    }
  }
}

export const moderationService = new ModerationService();
