import type { Client } from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";

const log = child("jobs:mute-expiry");

export async function runMuteExpiry(client: Client): Promise<void> {
  const rows = await prisma.guildMember.findMany({
    where: { muteUntil: { lte: new Date(), not: null } },
    take: 200,
    select: { guildId: true, userId: true },
  });
  for (const r of rows) {
    try {
      const guild = client.guilds.cache.get(r.guildId);
      const cfg = await prisma.guild.findUnique({
        where: { id: r.guildId },
        select: { muteRoleId: true },
      });
      const member = await guild?.members.fetch(r.userId).catch(() => null);
      if (member && cfg?.muteRoleId && member.roles.cache.has(cfg.muteRoleId)) {
        await member.roles.remove(cfg.muteRoleId, "Mute expired");
      }
      if (member?.communicationDisabledUntilTimestamp) {
        await member.timeout(null, "Mute expired").catch(() => null);
      }
    } catch (err) {
      log.warn({ err }, "failed to unmute");
    } finally {
      await prisma.guildMember.update({
        where: { userId_guildId: { userId: r.userId, guildId: r.guildId } },
        data: { muteUntil: null },
      });
    }
  }
}
