import {
  ActionRowBuilder,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";

async function reply(interaction: import("discord.js").ChatInputCommandInteraction, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof UserFacingError ? err.message : "Something went wrong.";
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Tickets", msg)] });
    else await interaction.reply({ embeds: [errorEmbed("Tickets", msg)], ephemeral: true });
  }
}

const panel: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Send a ticket panel in this channel.")
    .addStringOption((o) => o.setName("title").setDescription("Panel title").setRequired(true))
    .addStringOption((o) =>
      o.setName("description").setDescription("Panel description").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription("Comma-separated category labels (e.g. Support,Billing,Reports)")
        .setRequired(true),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const title = interaction.options.getString("title", true);
      const description = interaction.options.getString("description", true);
      const categoriesRaw = interaction.options.getString("categories", true);
      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new UserFacingError("Use in a text channel.");
      }
      const cats = categoriesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => ({ key: label.toLowerCase().replace(/\s+/g, "_"), label }));
      if (cats.length === 0) throw new UserFacingError("Provide at least 1 category.");

      const select = new StringSelectMenuBuilder()
        .setCustomId("ticket:open")
        .setPlaceholder("Open a ticket…")
        .addOptions(cats.map((c) => ({ label: c.label, value: c.key, description: `Open ${c.label}` })));
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

      const msg = await channel.send({
        embeds: [infoEmbed(title, description)],
        components: [row],
      });

      await prisma.ticketPanel.create({
        data: {
          guildId: interaction.guildId!,
          channelId: channel.id,
          messageId: msg.id,
          title,
          description,
          categories: cats,
        },
      });

      await interaction.reply({ embeds: [successEmbed("Panel deployed")], ephemeral: true });
    });
  },
};

const openCmd: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a ticket without using the panel.")
    .addStringOption((o) => o.setName("subject").setDescription("Subject").setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = interaction.options.getString("subject", true);
      const { ticketService } = await import("./ticket.service");
      const r = await ticketService.openTicket({
        guild: interaction.guild!,
        author: interaction.member as import("discord.js").GuildMember,
        category: { key: "general", label: "General" },
        subject,
      });
      await interaction.reply({
        embeds: [successEmbed("Ticket opened", `<#${r.channelId}>`)],
        ephemeral: true,
      });
    });
  },
};

export const commands = [panel, openCmd];

// --- Button & select interactions ---

import type { ButtonHandler, SelectMenuHandler } from "@core/handler/command";

const ticketClose: ButtonHandler = {
  customId: "ticket:close",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    const { ticketService } = await import("./ticket.service");
    try {
      await ticketService.close(ticketId, interaction.member as import("discord.js").GuildMember);
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed to close.";
      await interaction.reply({ embeds: [errorEmbed("Close", msg)], ephemeral: true }).catch(() => null);
    }
  },
};

const ticketClaim: ButtonHandler = {
  customId: "ticket:claim",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    const { ticketService } = await import("./ticket.service");
    try {
      await ticketService.claim(ticketId, interaction.member as import("discord.js").GuildMember);
      await interaction.deferUpdate();
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed to claim.";
      await interaction.reply({ embeds: [errorEmbed("Claim", msg)], ephemeral: true }).catch(() => null);
    }
  },
};

const ticketOpenSelect: SelectMenuHandler = {
  customId: "ticket:open",
  async execute(interaction) {
    if (!interaction.isStringSelectMenu()) return;
    const key = interaction.values[0]!;
    const panel = await prisma.ticketPanel.findFirst({
      where: { messageId: interaction.message.id },
    });
    if (!panel) return;
    const cats = panel.categories as Array<{ key: string; label: string }>;
    const cat = cats.find((c) => c.key === key);
    if (!cat) return;
    const { ticketService } = await import("./ticket.service");
    try {
      const r = await ticketService.openTicket({
        guild: interaction.guild!,
        author: interaction.member as import("discord.js").GuildMember,
        category: cat,
      });
      await interaction.reply({
        embeds: [successEmbed("Ticket opened", `<#${r.channelId}>`)],
        ephemeral: true,
      });
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed to open ticket.";
      await interaction.reply({ embeds: [errorEmbed("Tickets", msg)], ephemeral: true });
    }
  },
};

export const buttons: ButtonHandler[] = [ticketClose, ticketClaim];
export const select: SelectMenuHandler = ticketOpenSelect;
