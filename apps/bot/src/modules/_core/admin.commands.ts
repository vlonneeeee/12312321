import { PermissionsBitField, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { successEmbed, infoEmbed } from "@shared/embeds/factory";

const config: SlashCommand = {
  category: "admin",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("config")
    .setDescription("Toggle module features for this server.")
    .addSubcommand((s) =>
      s
        .setName("show")
        .setDescription("Show current configuration."),
    )
    .addSubcommand((s) =>
      s
        .setName("set")
        .setDescription("Toggle a feature.")
        .addStringOption((o) =>
          o
            .setName("key")
            .setDescription("Feature")
            .setRequired(true)
            .addChoices(
              { name: "Music", value: "musicEnabled" },
              { name: "Moderation", value: "moderationEnabled" },
              { name: "Economy", value: "economyEnabled" },
              { name: "Tickets", value: "ticketsEnabled" },
              { name: "Rooms", value: "roomsEnabled" },
              { name: "Verification", value: "verificationEnabled" },
              { name: "News", value: "newsEnabled" },
              { name: "Clans", value: "clansEnabled" },
              { name: "Voting", value: "votingEnabled" },
              { name: "Voice XP", value: "voiceXpEnabled" },
              { name: "Analytics", value: "analyticsEnabled" },
            ),
        )
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enabled").setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName("staff-role")
        .setDescription("Add or remove a staff role.")
        .addStringOption((o) =>
          o
            .setName("op")
            .setDescription("Add / remove")
            .setRequired(true)
            .addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }),
        )
        .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === "show") {
      const g = await prisma.guild.findUnique({ where: { id: interaction.guildId! } });
      if (!g) {
        await interaction.reply({ embeds: [infoEmbed("Not registered yet")] });
        return;
      }
      const flags = (
        [
          ["Music", g.musicEnabled],
          ["Moderation", g.moderationEnabled],
          ["Economy", g.economyEnabled],
          ["Tickets", g.ticketsEnabled],
          ["Rooms", g.roomsEnabled],
          ["Verification", g.verificationEnabled],
          ["News", g.newsEnabled],
          ["Clans", g.clansEnabled],
          ["Voting", g.votingEnabled],
          ["Voice XP", g.voiceXpEnabled],
          ["Analytics", g.analyticsEnabled],
        ] as const
      )
        .map(([label, v]) => `${v ? "✓" : "✗"} ${label}`)
        .join("\n");
      await interaction.reply({ embeds: [infoEmbed("Config", flags)] });
    } else if (sub === "set") {
      const key = interaction.options.getString("key", true);
      const enabled = interaction.options.getBoolean("enabled", true);
      await prisma.guild.update({ where: { id: interaction.guildId! }, data: { [key]: enabled } });
      await interaction.reply({ embeds: [successEmbed("Updated", `${key} = ${enabled}`)] });
    } else if (sub === "staff-role") {
      const op = interaction.options.getString("op", true);
      const role = interaction.options.getRole("role", true);
      const g = await prisma.guild.findUnique({ where: { id: interaction.guildId! } });
      if (!g) return;
      const next =
        op === "add"
          ? Array.from(new Set([...g.staffRoleIds, role.id]))
          : g.staffRoleIds.filter((id) => id !== role.id);
      await prisma.guild.update({ where: { id: interaction.guildId! }, data: { staffRoleIds: next } });
      await interaction.reply({ embeds: [successEmbed("Staff roles updated")] });
    }
  },
};

export const commands = [config];
