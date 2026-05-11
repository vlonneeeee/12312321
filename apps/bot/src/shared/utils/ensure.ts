import { Guild, GuildMember } from "discord.js";
import { prisma } from "@core/db/prisma";

/**
 * Idempotent helpers to ensure DB rows for a guild / member exist before
 * services touch them. These are intentionally cheap (upsert with select).
 */
export async function ensureGuild(guild: Guild): Promise<void> {
  await prisma.guild.upsert({
    where: { id: guild.id },
    create: {
      id: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      iconHash: guild.icon ?? null,
    },
    update: { name: guild.name, ownerId: guild.ownerId, iconHash: guild.icon ?? null },
    select: { id: true },
  });
}

export async function ensureUser(userId: string, username: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, username },
    update: { username, lastSeenAt: new Date() },
    select: { id: true },
  });
}

export async function ensureMember(member: GuildMember): Promise<void> {
  await ensureUser(member.id, member.user.username);
  await ensureGuild(member.guild);
  await prisma.guildMember.upsert({
    where: { userId_guildId: { userId: member.id, guildId: member.guild.id } },
    create: {
      userId: member.id,
      guildId: member.guild.id,
      nickname: member.nickname ?? null,
    },
    update: { nickname: member.nickname ?? null, leftAt: null },
    select: { id: true },
  });
}
