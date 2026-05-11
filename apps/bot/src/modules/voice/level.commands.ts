import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { infoEmbed } from "@shared/embeds/factory";
import { progressBar, formatNumber } from "@shared/utils/format";
import { levelFromXp, xpToLevel } from "./levels.events";

const rank: SlashCommand = {
  category: "levels",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Show your level + XP in this server.")
    .addUserOption((o) => o.setName("user").setDescription("User")),
  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const member = await prisma.guildMember.findUnique({
      where: { userId_guildId: { userId: user.id, guildId: interaction.guildId! } },
    });
    if (!member) {
      await interaction.reply({ embeds: [infoEmbed("No data", "No XP yet.")] });
      return;
    }
    const lvl = levelFromXp(member.xp);
    const need = xpToLevel(lvl);
    // current xp into this level
    let acc = 0n;
    for (let l = 0; l < lvl; l++) acc += BigInt(xpToLevel(l));
    const intoLevel = Number(member.xp - acc);
    const bar = progressBar(intoLevel, need);
    await interaction.reply({
      embeds: [
        infoEmbed(
          `${user.username}'s rank`,
          `**Level ${lvl}** • ${formatNumber(intoLevel)} / ${formatNumber(need)} XP\n${bar}\nMessages: **${member.messages}** • Voice: **${member.voiceMinutes}m**`,
        ),
      ],
    });
  },
};

const top: SlashCommand = {
  category: "levels",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("top").setDescription("Show top members by XP."),
  async execute(interaction) {
    const rows = await prisma.guildMember.findMany({
      where: { guildId: interaction.guildId! },
      orderBy: [{ level: "desc" }, { xp: "desc" }],
      take: 15,
    });
    const lines = rows
      .map((r, i) => `**${i + 1}.** <@${r.userId}> • lvl ${r.level} • ${formatNumber(r.xp)} XP`)
      .join("\n");
    await interaction.reply({ embeds: [infoEmbed("Server top", lines || "No data.")] });
  },
};

export const commands = [rank, top];
