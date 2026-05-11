import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { registry } from "@core/handler/registry";
import { infoEmbed } from "@shared/embeds/factory";

const help: SlashCommand = {
  category: "core",
  data: new SlashCommandBuilder().setName("help").setDescription("Show available commands."),
  async execute(interaction) {
    const byCategory = new Map<string, string[]>();
    for (const cmd of registry.commands.values()) {
      const cat = cmd.category ?? "misc";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(`\`/${cmd.data.name}\` — ${cmd.data.description}`);
    }
    const sorted = [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
    const description = sorted
      .map(([cat, cmds]) => `**${cat}**\n${cmds.slice(0, 12).join("\n")}`)
      .join("\n\n");
    await interaction.reply({ embeds: [infoEmbed("Commands", description)] });
  },
};

const ping: SlashCommand = {
  category: "core",
  data: new SlashCommandBuilder().setName("ping").setDescription("Check bot latency."),
  async execute(interaction) {
    const sent = Date.now();
    await interaction.reply({ embeds: [infoEmbed("Pong", `WS: **${interaction.client.ws.ping}ms**`)] });
    const latency = Date.now() - sent;
    await interaction.editReply({
      embeds: [infoEmbed("Pong", `WS: **${interaction.client.ws.ping}ms**\nReply: **${latency}ms**`)],
    });
  },
};

export const commands = [help, ping];
