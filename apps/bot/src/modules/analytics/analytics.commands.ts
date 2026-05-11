import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { infoEmbed } from "@shared/embeds/factory";
import { formatNumber } from "@shared/utils/format";

const stats: SlashCommand = {
  category: "analytics",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show 7d activity for a user.")
    .addUserOption((o) => o.setName("user").setDescription("User")),
  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 6);

    const rows = await prisma.messageMetric.groupBy({
      by: ["date"],
      where: { guildId: interaction.guildId!, userId: user.id, date: { gte: since } },
      _sum: { count: true, chars: true },
      orderBy: { date: "asc" },
    });
    const totalMsg = rows.reduce((a, b) => a + (b._sum.count ?? 0), 0);
    const totalChars = rows.reduce((a, b) => a + (b._sum.chars ?? 0), 0);
    const series = rows.map((r) => `${r.date.toISOString().slice(5, 10)}: ${r._sum.count}`).join("\n");
    await interaction.reply({
      embeds: [
        infoEmbed(
          `${user.username} • 7d activity`,
          `Total messages: **${formatNumber(totalMsg)}**\nTotal chars: **${formatNumber(totalChars)}**\n\n${series || "_No activity._"}`,
        ),
      ],
    });
  },
};

export const commands = [stats];
