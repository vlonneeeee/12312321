import { PermissionsBitField, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";

const create: SlashCommand = {
  category: "events",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("event-create")
    .setDescription("Schedule a server event.")
    .addStringOption((o) => o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("type")
        .setDescription("Type")
        .setRequired(true)
        .addChoices(
          { name: "Boss raid", value: "boss" },
          { name: "PvP", value: "pvp" },
          { name: "Seasonal", value: "seasonal" },
          { name: "Custom", value: "custom" },
        ),
    )
    .addStringOption((o) => o.setName("starts").setDescription("ISO datetime").setRequired(true))
    .addStringOption((o) => o.setName("ends").setDescription("ISO datetime").setRequired(true)),
  async execute(interaction) {
    const startsAt = new Date(interaction.options.getString("starts", true));
    const endsAt = new Date(interaction.options.getString("ends", true));
    if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf()) || endsAt <= startsAt) {
      await interaction.reply({ embeds: [errorEmbed("Invalid dates")], ephemeral: true });
      return;
    }
    await prisma.guildEvent.create({
      data: {
        guildId: interaction.guildId!,
        title: interaction.options.getString("title", true),
        type: interaction.options.getString("type", true),
        startsAt,
        endsAt,
      },
    });
    await interaction.reply({ embeds: [successEmbed("Event scheduled")], ephemeral: true });
  },
};

const list: SlashCommand = {
  category: "events",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("events").setDescription("List active/upcoming events."),
  async execute(interaction) {
    const rows = await prisma.guildEvent.findMany({
      where: { guildId: interaction.guildId!, status: { in: ["scheduled", "active"] } },
      orderBy: { startsAt: "asc" },
      take: 10,
    });
    const lines =
      rows.length === 0
        ? "_No events._"
        : rows
            .map(
              (e) =>
                `• **${e.title}** (${e.type}) — <t:${Math.floor(e.startsAt.getTime() / 1000)}:F> → <t:${Math.floor(e.endsAt.getTime() / 1000)}:R>`,
            )
            .join("\n");
    await interaction.reply({ embeds: [infoEmbed("Events", lines)] });
  },
};

export const commands = [create, list];
