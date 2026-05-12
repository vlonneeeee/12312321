import { PermissionsBitField, type GuildMember } from "discord.js";
import { env } from "@core/config/env";
import { prisma } from "@core/db/prisma";

export function isOwner(userId: string): boolean {
  return env.OWNER_IDS.includes(userId);
}

/**
 * OWNER bypass: returns true if the user can ignore Discord permission checks,
 * cooldowns, DJ-role gates, etc. enforced by the interaction handler.
 *
 * This is the single source of truth вЂ” every higher-level guard should
 * funnel through here so OWNER behaviour stays consistent.
 */
export function canBypassPermissions(userId: string): boolean {
  return isOwner(userId);
}

/**
 * Throws if the caller is not an OWNER. Pure helper for owner-only services.
 */
export function assertOwner(userId: string): void {
  if (!isOwner(userId)) {
    throw new Error("Owner-only operation.");
  }
}

export async function isStaff(member: GuildMember): Promise<boolean> {
  if (isOwner(member.id)) return true;
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true;
  const guild = await prisma.guild.findUnique({
    where: { id: member.guild.id },
    select: { staffRoleIds: true },
  });
  if (!guild?.staffRoleIds.length) return false;
  return member.roles.cache.some((r) => guild.staffRoleIds.includes(r.id));
}

/**
 * Strict ticket-staff check. Only the literal server owner and members of
 * the configured `Guild.staffRoleIds` qualify. Importantly this does NOT
 * accept the ManageGuild permission as a bypass, which means any user
 * (including the ticket author) who happens to be a guild admin can never
 * moderate other people''s tickets unless explicitly granted a staff role.
 *
 * Mirrors how Ticket Tool / Miona-style bots behave: tickets are a separate
 * permission boundary from the rest of the server.
 */
export async function isTicketStaff(member: GuildMember): Promise<boolean> {
  if (member.guild.ownerId === member.id) return true;
  const guild = await prisma.guild.findUnique({
    where: { id: member.guild.id },
    select: { staffRoleIds: true },
  });
  if (!guild?.staffRoleIds.length) return false;
  return member.roles.cache.some((r) => guild.staffRoleIds.includes(r.id));
}

export async function isDj(member: GuildMember): Promise<boolean> {
  if (isOwner(member.id)) return true;
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
