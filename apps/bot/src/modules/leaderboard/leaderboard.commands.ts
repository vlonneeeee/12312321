import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { infoEmbed } from "@shared/embeds/factory";
import { formatNumber } from "@shared/utils/format";

const global: SlashCommand = {
  category: "leaderboard",
  data: new SlashCommandBuilder()
    .setName("global-top")
    .setDescription("Top players globally.")
    .addStringOption((o) =>
      o
        .setName("kind")
        .setDescription("Category")
        .addChoices(
          { name: "Level", value: "level" },
          { name: "Coins", value: "coins" },
          { name: "Reputation", value: "rep" },
        ),
    ),
  async execute(interaction) {
    const kind = (interaction.options.getString("kind") as "level" | "coins" | "rep" | null) ?? "level";
    const orderBy =
      kind === "coins" ? [{ globalBalance: "desc" as const }] : kind === "rep" ? [{ reputation: "desc" as const }] : [{ level: "desc" as const }, { xp: "desc" as const }];
    const rows = await prisma.user.findMany({ orderBy, take: 15 });
    const lines = rows
      .map((r, i) => {
        const value =
          kind === "coins" ? formatNumber(r.globalBalance) : kind === "rep" ? formatNumber(r.reputation) : `lvl ${r.level} • ${formatNumber(r.xp)} XP`;
        return `**${i + 1}.** <@${r.id}> — ${value}`;
      })
      .join("\n");
    await interaction.reply({ embeds: [infoEmbed(`Global top — ${kind}`, lines || "No data.")] });
  },
};

const clanTop: SlashCommand = {
  category: "leaderboard",
  data: new SlashCommandBuilder().setName("clan-top").setDescription("Top clans by level."),
  async execute(interaction) {
    const rows = await prisma.clan.findMany({ orderBy: [{ level: "desc" }, { xp: "desc" }], take: 10 });
    const lines = rows
      .map((c, i) => `**${i + 1}.** \`[${c.tag}]\` ${c.name} — lvl ${c.level}`)
      .join("\n");
    await interaction.reply({ embeds: [infoEmbed("Top clans", lines || "No clans yet.")] });
  },
};

export const commands = [global, clanTop];
