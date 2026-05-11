import type { Client, TextChannel } from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { warnEmbed } from "@shared/embeds/factory";

const log = child("jobs:tickets-auto-close");

const SCAN_LIMIT = 200;

/**
 * Auto-close inactive tickets and (optionally) warn before closing.
 *
 * Driven by per-guild config:
 *   - Guild.ticketAutoCloseHours        → 0 disables auto-close entirely
 *   - Guild.ticketInactivityWarnHours   → 0 disables the warning phase
 *
 * Activity is tracked by `Ticket.lastActivityAt`, updated whenever a
 * message is sent in the ticket channel (see ticket-activity.events.ts).
 */
export async function runTicketAutoClose(client: Client): Promise<void> {
  const candidates = await prisma.ticket.findMany({
    where: { status: { not: "closed" } },
    take: SCAN_LIMIT,
    orderBy: { lastActivityAt: "asc" },
  });
  if (!candidates.length) return;

  const guildIds = [...new Set(candidates.map((t) => t.guildId))];
  const guilds = await prisma.guild.findMany({
    where: { id: { in: guildIds } },
    select: {
      id: true,
      ticketAutoCloseHours: true,
      ticketInactivityWarnHours: true,
    },
  });
  const cfg = new Map(guilds.map((g) => [g.id, g]));

  const now = Date.now();

  for (const t of candidates) {
    const c = cfg.get(t.guildId);
    if (!c || c.ticketAutoCloseHours <= 0) continue;

    const inactiveMs = now - t.lastActivityAt.getTime();
    const closeMs = c.ticketAutoCloseHours * 3600_000;
    const warnMs = c.ticketInactivityWarnHours * 3600_000;

    // Phase 1: closing time
    if (inactiveMs >= closeMs) {
      try {
        const guild = client.guilds.cache.get(t.guildId);
        if (!guild) continue;
        const channel = (await guild.channels
          .fetch(t.channelId)
          .catch(() => null)) as TextChannel | null;
        // Pull the service lazily to avoid circular module deps.
        const { ticketService } = await import(
          "../../../modules/tickets/ticket.service"
        );
        // Synthesize a "system" closer. Channel may already be gone; service
        // handles that gracefully via markChannelDeleted.
        if (!channel) {
          await ticketService.markChannelDeleted(t.channelId, guild);
          continue;
        }
        const me = guild.members.me;
        if (!me) continue;
        await ticketService.close(t.id, me);
        log.info(
          { ticketId: t.id, guildId: t.guildId, inactiveMs },
          "ticket auto-closed for inactivity",
        );
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err, ticketId: t.id },
          "auto-close failed",
        );
      }
      continue;
    }

    // Phase 2: warning time (only once)
    if (
      warnMs > 0 &&
      inactiveMs >= warnMs &&
      !t.inactivityWarnedAt
    ) {
      try {
        const guild = client.guilds.cache.get(t.guildId);
        if (!guild) continue;
        const channel = (await guild.channels
          .fetch(t.channelId)
          .catch(() => null)) as TextChannel | null;
        if (!channel) continue;
        const closesInH = c.ticketAutoCloseHours - c.ticketInactivityWarnHours;
        await channel
          .send({
            embeds: [
              warnEmbed(
                "⏰ Inactivity",
                `This ticket will auto-close in **${closesInH}h** if no one replies.`,
              ),
            ],
          })
          .catch(() => null);
        await prisma.ticket.update({
          where: { id: t.id },
          data: { inactivityWarnedAt: new Date() },
        });
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err, ticketId: t.id },
          "auto-close warn failed",
        );
      }
    }
  }
}
