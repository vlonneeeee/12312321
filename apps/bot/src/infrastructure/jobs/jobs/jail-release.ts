import type { Client } from "discord.js";
import { prisma } from "@core/db/prisma";
import { eventBus } from "@core/events/event-bus";
import { child } from "@core/logger/logger";

const log = child("jobs:jail");

export async function runJailRelease(client: Client): Promise<void> {
  const rows = await prisma.jailRecord.findMany({
    where: { releasedAt: null, endsAt: { lte: new Date() } },
    take: 100,
  });
  for (const row of rows) {
    try {
      // release: by convention, jailed users get a 'jailed' role. The jail
      // module is responsible for assigning/removing it. Here we just mark
      // the record as released and emit an event for downstream listeners.
      await prisma.jailRecord.update({
        where: { id: row.id },
        data: { releasedAt: new Date() },
      });
      eventBus.emit("moderation.case" as const, {
        caseId: row.id,
        guildId: row.guildId,
        subjectId: row.userId,
        action: "UNJAIL",
      });
    } catch (err) {
      log.warn({ err, id: row.id }, "jail release failed");
    }
  }
  void client;
}
