import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { ticketService } from "./ticket.service";
import { child } from "@core/logger/logger";

const log = child("tickets:events");

/**
 * Auto-close a ticket whose channel was deleted manually so the author
 * can open a new ticket without the orphaned DB row blocking them.
 */
export const event = defineEvent({
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!("guildId" in channel) || !channel.guildId) return;
    try {
      await ticketService.markChannelDeleted(channel.id);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err, channelId: channel.id },
        "failed to reap ticket on channel delete",
      );
    }
  },
});
