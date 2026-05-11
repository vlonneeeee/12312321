import { PermissionsBitField, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { infoEmbed, successEmbed } from "@shared/embeds/factory";
import { SUPPORTED_LOCALES, setGuildLocale, getGuildLocale, tWithLocale, type Locale } from "@core/i18n";

const setLanguage: SlashCommand = {
  category: "core",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("language")
    .setDescription("Set the bot language for this server / Изменить язык бота на сервере.")
    .addStringOption((o) =>
      o
        .setName("lang")
        .setDescription("Language code")
        .addChoices(
          { name: "Русский", value: "ru" },
          { name: "English", value: "en" },
        )
        .setRequired(true),
    ),
  async execute(interaction) {
    const currentLang = await getGuildLocale(interaction.guildId);
    const langRaw = interaction.options.getString("lang", true);
    if (!SUPPORTED_LOCALES.includes(langRaw as Locale)) {
      await interaction.reply({
        embeds: [
          infoEmbed(
            tWithLocale(currentLang, "language.title"),
            tWithLocale(currentLang, "language.unsupported"),
          ),
        ],
        ephemeral: true,
      });
      return;
    }
    const lang = langRaw as Locale;
    await setGuildLocale(interaction.guildId!, lang);
    await interaction.reply({
      embeds: [
        successEmbed(
          tWithLocale(lang, "language.title"),
          tWithLocale(lang, "language.changed"),
        ),
      ],
      ephemeral: true,
    });
  },
};

const showLanguage: SlashCommand = {
  category: "core",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("language-show")
    .setDescription("Show the current server language."),
  async execute(interaction) {
    const lang = await getGuildLocale(interaction.guildId);
    await interaction.reply({
      embeds: [
        infoEmbed(
          tWithLocale(lang, "language.title"),
          tWithLocale(lang, "language.current", { lang }),
        ),
      ],
      ephemeral: true,
    });
  },
};

export const commands = [setLanguage, showLanguage];
