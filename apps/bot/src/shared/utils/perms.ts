import { PermissionsBitField, type GuildMember } from "discord.js";
import { env } from "@core/config/env";
import { prisma } from "@core/db/prisma";

export function isOwner(userId: string): boolean {
  return env.OWNER_IDS.includes(userId);
}

export async function isStaff(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
  const guild = await prisma.guild.findUnique({
    where: { id: member.guild.id },
    select: { staffRoleIds: true },
  });
  if (!guild?.staffRoleIds.length) return false;
  return member.roles.cache.some((r) => guild.staffRoleIds.includes(r.id));
}

export async function isDj(member: GuildMember): Promise<boolean> {
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
  const guild = await prisma.guild.findUnique({
    where: { id: member.guild.id },
    select: { djRoleIds: true },
  });
  if (!guild?.djRoleIds.length) return true; // no DJ role means everyone is a DJ
  return member.roles.cache.some((r) => guild.djRoleIds.includes(r.id));
}

/**
 * Returns true if `actor` has a strictly higher role than `target`. Used to
 * protect role hierarchy in mod commands.
 */
export function outranks(actor: GuildMember, target: GuildMember): boolean {
  if (actor.guild.ownerId === actor.id) return true;
  if (target.guild.ownerId === target.id) return false;
  return actor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}
