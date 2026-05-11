import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";

/**
 * Lightweight per-day message counter. Aggregated to a single row per
 * (guild, user, channel, date) using a unique upsert.
 */
export const event = defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot || !message.inGuild()) return;
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    try {
      await prisma.messageMetric.upsert({
        where: {
          guildId_userId_channelId_date: {
            guildId: message.guildId,
            userId: message.author.id,
            channelId: message.channelId,
            date,
          },
        },
        create: {
          guildId: message.guildId,
          userId: message.author.id,
          channelId: message.channelId,
          date,
          count: 1,
          chars: message.content.length,
        },
        update: { count: { increment: 1 }, chars: { increment: message.content.length } },
      });
    } catch {
      // optimistic; on race we lose at most one increment per partition
    }
  },
});
