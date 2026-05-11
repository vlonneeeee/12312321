import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";

const log = child("tickets:activity");

/**
 * Refresh `Ticket.lastActivityAt` whenever a human posts a message inside
 * a ticket channel. Cheap path:
 *
 *   1. Skip bot messages (transcript boilerplate, system notices).
 *   2. Skip DMs.
 *   3. Use updateMany(where channelId) so we touch DB only if the channel
 *      is actually tracked as a ticket.
 *   4. Also clears `inactivityWarnedAt` so the next inactivity warning can fire
 *      cleanly if the conversation stalls again.
 */
export const event = defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;
    try {
      await prisma.ticket.updateMany({
        where: {
          channelId: message.channelId,
          status: { not: "closed" },
        },
        data: { lastActivityAt: new Date(), inactivityWarnedAt: null },
      });
    } catch (err) {
      log.warn(
        {
          err: err instanceof Error ? err.message : err,
          channelId: message.channelId,
        },
        "failed to bump ticket activity",
      );
    }
  },
});
