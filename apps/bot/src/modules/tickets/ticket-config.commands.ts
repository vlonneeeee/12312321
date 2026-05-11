import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { infoEmbed, successEmbed } from "@shared/embeds/factory";
import { t } from "@core/i18n";

const ticketsConfig: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("tickets-config")
    .setDescription("Configure tickets for this server.")
    .addSubcommand((sc) =>
      sc
        .setName("log-channel")
        .setDescription(
          "Set the admin channel that receives ticket activity & transcripts.",
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel (leave empty to disable)")
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("auto-close")
        .setDescription(
          "Hours of inactivity before a ticket auto-closes. 0 = disabled.",
        )
        .addIntegerOption((o) =>
          o
            .setName("hours")
            .setDescription("0 disables auto-close. Default 48.")
            .setMinValue(0)
            .setMaxValue(24 * 30)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("warn-before")
            .setDescription(
              "Hours before auto-close to post a warning. 0 = no warn.",
            )
            .setMinValue(0)
            .setMaxValue(24 * 30),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName("show").setDescription("Show current ticket configuration."),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (sub === "log-channel") {
      const channel = interaction.options.getChannel("channel", false);
      const ticketsLogChannelId = channel?.id ?? null;
      await prisma.guild.update({
        where: { id: guildId },
        data: { ticketsLogChannelId },
      });
      const title = await t(guildId, "tickets.title");
      const body = ticketsLogChannelId
        ? await t(guildId, "tickets.config.log_channel_set", {
            channelId: ticketsLogChannelId,
          })
        : await t(guildId, "tickets.config.log_channel_cleared");
      await interaction.reply({
        embeds: [successEmbed(title, body)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "auto-close") {
      const hours = interaction.options.getInteger("hours", true);
      const warnBefore =
        interaction.options.getInteger("warn-before", false) ?? 0;
      if (warnBefore > hours) {
        await interaction.reply({
          embeds: [
            successEmbed(
              await t(guildId, "tickets.title"),
              await t(guildId, "tickets.config.warn_too_late"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      await prisma.guild.update({
        where: { id: guildId },
        data: {
          ticketAutoCloseHours: hours,
          ticketInactivityWarnHours: warnBefore,
        },
      });
      const body =
        hours > 0
          ? await t(guildId, "tickets.config.auto_close_set", {
              hours,
              warn: warnBefore,
            })
          : await t(guildId, "tickets.config.auto_close_off");
      await interaction.reply({
        embeds: [successEmbed(await t(guildId, "tickets.title"), body)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "show") {
      const g = await prisma.guild.findUnique({
        where: { id: guildId },
        select: {
          ticketsLogChannelId: true,
          ticketCategoryId: true,
          modLogChannelId: true,
          logChannelId: true,
          ticketAutoCloseHours: true,
          ticketInactivityWarnHours: true,
        },
      });
      const title = await t(guildId, "tickets.title");
      const autoCloseLine =
        g && g.ticketAutoCloseHours > 0
          ? await t(guildId, "tickets.config.show_auto_close_on", {
              hours: g.ticketAutoCloseHours,
              warn: g.ticketInactivityWarnHours,
            })
          : await t(guildId, "tickets.config.show_auto_close_off");
      const lines = [
        `**${await t(guildId, "tickets.config.show_log_channel")}:** ${formatChannel(g?.ticketsLogChannelId)}`,
        `**${await t(guildId, "tickets.config.show_fallback")}:** ${formatChannel(
          g?.ticketsLogChannelId ?? g?.modLogChannelId ?? g?.logChannelId,
        )}`,
        `**${await t(guildId, "tickets.config.show_category")}:** ${formatChannel(g?.ticketCategoryId)}`,
        `**${await t(guildId, "tickets.config.show_auto_close")}:** ${autoCloseLine}`,
      ];
      await interaction.reply({
        embeds: [infoEmbed(title, lines.join("\n"))],
        ephemeral: true,
      });
      return;
    }
  },
};

function formatChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : "—";
}

export const commands = [ticketsConfig];
