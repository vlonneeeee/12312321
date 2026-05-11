import type { Client } from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";

const log = child("jobs:temp-roles");

export async function runTempRoleExpiry(client: Client): Promise<void> {
  const expired = await prisma.temporaryRole.findMany({
    where: { expiresAt: { lte: new Date() } },
    take: 200,
  });
  for (const row of expired) {
    try {
      const guild = client.guilds.cache.get(row.guildId);
      const member = await guild?.members.fetch(row.userId).catch(() => null);
      if (member?.roles.cache.has(row.roleId)) {
        await member.roles.remove(row.roleId, "Temporary role expired");
      }
    } catch (err) {
      log.warn({ err, row }, "failed to remove temporary role");
    } finally {
      await prisma.temporaryRole.delete({ where: { id: row.id } }).catch(() => null);
    }
  }
}
