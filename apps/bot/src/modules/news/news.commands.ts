import { PermissionsBitField, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { successEmbed, infoEmbed } from "@shared/embeds/factory";

const add: SlashCommand = {
  category: "news",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("news-add")
    .setDescription("Add an RSS/Atom feed.")
    .addStringOption((o) => o.setName("url").setDescription("Feed URL").setRequired(true))
    .addChannelOption((o) => o.setName("channel").setDescription("Post channel").setRequired(true)),
  async execute(interaction) {
    const url = interaction.options.getString("url", true);
    const channel = interaction.options.getChannel("channel", true);
    await prisma.newsFeed.create({
      data: { guildId: interaction.guildId!, url, channelId: channel.id },
    });
    await interaction.reply({ embeds: [successEmbed("Feed added")], ephemeral: true });
  },
};

const list: SlashCommand = {
  category: "news",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("news-list").setDescription("List configured feeds."),
  async execute(interaction) {
    const feeds = await prisma.newsFeed.findMany({ where: { guildId: interaction.guildId! } });
    await interaction.reply({
      embeds: [
        infoEmbed(
          "News feeds",
          feeds.length
            ? feeds.map((f) => `• <#${f.channelId}> — ${f.url}`).join("\n")
            : "No feeds.",
        ),
      ],
    });
  },
};

export const commands = [add, list];
