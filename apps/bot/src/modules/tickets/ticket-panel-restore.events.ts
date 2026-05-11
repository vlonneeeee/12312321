import {
  ActionRowBuilder,
  ChannelType,
  Events,
  StringSelectMenuBuilder,
  type Client,
  type TextChannel,
} from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { infoEmbed } from "@shared/embeds/factory";

const log = child("tickets:panel-restore");

/**
 * On startup, reconcile every persisted TicketPanel row against the actual
 * messages in Discord. If the panel message is gone (channel/message deleted,
 * mass-purged, etc.) we re-deploy the panel in the original channel and
 * persist the new messageId. This is what makes the ticket button truly
 * restart-safe: customId routing is static, so a redeploy here restores
 * functionality without admin action.
 *
 * Hardened against typical channel/permission errors — every panel is
 * processed independently so one bad guild can't break the rest.
 */
export const event = defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client: Client<true>) {
    const panels = await prisma.ticketPanel.findMany({
      where: { enabled: true },
      select: {
        id: true,
        guildId: true,
        channelId: true,
        messageId: true,
        title: true,
        description: true,
        categories: true,
      },
    });
    if (!panels.length) return;

    let restored = 0;
    let alive = 0;
    let skipped = 0;

    for (const panel of panels) {
      const guild = client.guilds.cache.get(panel.guildId);
      if (!guild) {
        skipped++;
        continue;
      }
      try {
        const channel = await guild.channels.fetch(panel.channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) {
          skipped++;
          continue;
        }
        const text = channel as TextChannel;

        // Try to fetch the original message.
        const existing = panel.messageId
          ? await text.messages.fetch(panel.messageId).catch(() => null)
          : null;
        if (existing) {
          alive++;
          continue;
        }

        // Missing — rebuild and re-send.
        const cats = (panel.categories ?? []) as Array<{
          key: string;
          label: string;
        }>;
        if (!cats.length) {
          skipped++;
          continue;
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId("ticket:open")
          .setPlaceholder("Open a ticket…")
          .addOptions(
            cats.map((c) => ({
              label: c.label,
              value: c.key,
              description: `Open ${c.label}`,
            })),
          );
        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          select,
        );
        const msg = await text
          .send({
            embeds: [
              infoEmbed(panel.title, panel.description ?? undefined),
            ],
            components: [row],
          })
          .catch((err) => {
            log.warn(
              { err: err instanceof Error ? err.message : err, panelId: panel.id },
              "failed to redeploy panel (missing perms?)",
            );
            return null;
          });
        if (!msg) {
          skipped++;
          continue;
        }
        await prisma.ticketPanel.update({
          where: { id: panel.id },
          data: { messageId: msg.id },
        });
        restored++;
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err, panelId: panel.id },
          "panel restore errored",
        );
        skipped++;
      }
    }

    log.info({ alive, restored, skipped }, "ticket panel reconciliation done");
  },
});
