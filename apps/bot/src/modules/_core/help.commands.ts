import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { registry } from "@core/handler/registry";
import { getGuildLocale, tWithLocale, type Locale } from "@core/i18n";
import { Colors } from "@shared/embeds/colors";

const help: SlashCommand = {
  category: "core",
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show available commands.")
    .setDescriptionLocalizations({ ru: "Показать список команд." }),
  async execute(interaction) {
    const locale = await getGuildLocale(interaction.guildId);

    const byCategory = new Map<string, SlashCommand[]>();
    for (const cmd of registry.commands.values()) {
      const cat = cmd.category ?? "misc";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(cmd);
    }

    const sorted = [...byCategory.entries()].sort(([a], [b]) =>
      catLabel(locale, a).localeCompare(catLabel(locale, b)),
    );

    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle(tWithLocale(locale, "help.title"))
      .setDescription(tWithLocale(locale, "help.intro"));

    const HARD_LIMIT_PER_FIELD = 1024;
    const MAX_PER_CATEGORY = 12;
    let total = 0;
    for (const [cat, cmds] of sorted) {
      total += cmds.length;
      cmds.sort((a, b) => a.data.name.localeCompare(b.data.name));
      const visible = cmds.slice(0, MAX_PER_CATEGORY);
      const lines = visible.map((c) => `\`/${c.data.name}\` — ${cmdDesc(locale, c)}`);
      if (cmds.length > MAX_PER_CATEGORY) {
        lines.push(
          tWithLocale(locale, "help.more_in_category", {
            count: cmds.length - MAX_PER_CATEGORY,
          }),
        );
      }
      let value = lines.join("\n");
      if (value.length > HARD_LIMIT_PER_FIELD) {
        value = value.slice(0, HARD_LIMIT_PER_FIELD - 1) + "…";
      }
      embed.addFields({ name: catLabel(locale, cat), value, inline: false });
    }

    embed.setFooter({
      text: tWithLocale(locale, "help.footer", {
        lang: tWithLocale(locale, "language.name"),
        count: total,
      }),
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

function catLabel(locale: Locale, cat: string): string {
  const key = `help.category.${cat}`;
  const v = tWithLocale(locale, key);
  return v === key ? cat : v;
}

function cmdDesc(locale: Locale, cmd: SlashCommand): string {
  const key = `help.cmd.${cmd.data.name}`;
  const v = tWithLocale(locale, key);
  return v === key ? cmd.data.description : v;
}

const ping: SlashCommand = {
  category: "core",
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency.")
    .setDescriptionLocalizations({ ru: "Проверить задержку бота." }),
  async execute(interaction) {
    const locale = await getGuildLocale(interaction.guildId);
    const sent = Date.now();
    const unit = tWithLocale(locale, "ping.unit_ms");
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.primary)
          .setTitle(tWithLocale(locale, "ping.title"))
          .addFields({
            name: tWithLocale(locale, "ping.ws"),
            value: `**${interaction.client.ws.ping}** ${unit}`,
            inline: true,
          }),
      ],
    });
    const latency = Date.now() - sent;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(Colors.primary)
          .setTitle(tWithLocale(locale, "ping.title"))
          .addFields(
            {
              name: tWithLocale(locale, "ping.ws"),
              value: `**${interaction.client.ws.ping}** ${unit}`,
              inline: true,
            },
            {
              name: tWithLocale(locale, "ping.reply"),
              value: `**${latency}** ${unit}`,
              inline: true,
            },
          ),
      ],
    });
  },
};

export const commands = [help, ping];
