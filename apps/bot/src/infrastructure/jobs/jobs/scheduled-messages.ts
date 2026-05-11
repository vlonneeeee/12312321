import type { Client, TextChannel } from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";

const log = child("jobs:scheduled-messages");

export async function runScheduledMessages(client: Client): Promise<void> {
  const due = await prisma.scheduledMessage.findMany({
    where: { enabled: true, runAt: { lte: new Date(), not: null } },
    take: 50,
  });
  for (const msg of due) {
    try {
      const channel = (await client.channels
        .fetch(msg.channelId)
        .catch(() => null)) as TextChannel | null;
      if (channel?.isTextBased()) {
        await channel.send({ content: msg.content });
      }
    } catch (err) {
      log.warn({ err, id: msg.id }, "scheduled msg failed");
    } finally {
      await prisma.scheduledMessage.update({
        where: { id: msg.id },
        data: msg.cron ? { runAt: null } : { enabled: false, runAt: null },
      });
    }
  }
}
