import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type APIEmbedField,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { registry } from "@core/handler/registry";
import { getGuildLocale, tWithLocale, type Locale } from "@core/i18n";
import { Colors } from "@shared/embeds/colors";
import {
  buildCategoryViews,
  categoryLabel,
  commandShortDescription,
  deriveArgList,
  deriveUsage,
  permissionsLabel,
  resolveViewer,
  OWNER_CATEGORY,
  type HelpCategoryView,
} from "./help-meta";

/** customId scheme. Kept stable so users can keep pressing buttons. */
const SELECT_ID = "help:cat";
const HOME_ID = "help:home";
const OWNER_TOGGLE_ID = "help:owner";

const COMMANDS_PER_FIELD = 10;
const MAX_EMBED_FIELD = 1024;

const help: SlashCommand = {
  category: "core",
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show available commands.")
    .setDescriptionLocalizations({ ru: "РџРѕРєР°Р·Р°С‚СЊ СЃРїРёСЃРѕРє РєРѕРјР°РЅРґ." })
    .addStringOption((o) =>
      o
        .setName("command")
        .setDescription("Inspect a specific command in detail.")
        .setAutocomplete(true)
        .setRequired(false),
    ),
  meta: {
    longDescription:
      "Interactive command catalogue. Use the select menu to browse categories or pass a command name to see arguments, examples and required permissions.",
    examples: ["/help", "/help command:ban"],
  },
  async execute(interaction) {
    const locale = await getGuildLocale(interaction.guildId);
    const viewer = resolveViewer(interaction.user.id);

    const specific = interaction.options.getString("command");
    if (specific) {
      const cmd = registry.commands.get(specific.trim().toLowerCase().replace(/^\//, ""));
      if (!cmd || (cmd.ownerOnly && !viewer.isOwner)) {
        await interaction.reply({
          content: tWithLocale(locale, "help.command_not_found", { name: specific }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply(commandPayload(locale, cmd, viewer.isOwner));
      return;
    }

    await interaction.reply(overviewPayload(locale, viewer.isOwner));
  },
  async autocomplete(interaction: AutocompleteInteraction) {
    const viewer = resolveViewer(interaction.user.id);
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = [...registry.commands.values()]
      .filter((c) => (c.ownerOnly ? viewer.isOwner : true))
      .map((c) => c.data.name)
      .filter((n) => n.includes(focused))
      .sort()
      .slice(0, 25)
      .map((n) => ({ name: n, value: n }));
    await interaction.respond(choices);
  },
};

export const commands = [help];

/* -------------------------------------------------------------------------- */
/*  Embed + component builders                                                */
/* -------------------------------------------------------------------------- */

export function overviewPayload(
  locale: Locale,
  viewerIsOwner: boolean,
): InteractionReplyOptions {
  const views = buildCategoryViews(locale, viewerIsOwner);
  const total = [...registry.commands.values()].filter(
    (c) => !c.ownerOnly || viewerIsOwner,
  ).length;

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle(tWithLocale(locale, "help.title"))
    .setDescription(tWithLocale(locale, "help.intro"));

  for (const view of views) {
    const lines = view.commands
      .slice(0, COMMANDS_PER_FIELD)
      .map((c) => `\`/${c.data.name}\` вЂ” ${commandShortDescription(locale, c)}`);
    if (view.commands.length > COMMANDS_PER_FIELD) {
      lines.push(
        tWithLocale(locale, "help.more_in_category", {
          count: view.commands.length - COMMANDS_PER_FIELD,
        }),
      );
    }
    embed.addFields({
      name: `${view.emoji} ${view.label} В· ${view.commands.length}`,
      value: clamp(lines.join("\n"), MAX_EMBED_FIELD),
      inline: false,
    });
  }

  embed.setFooter({
    text: tWithLocale(locale, "help.footer", {
      lang: tWithLocale(locale, "language.name"),
      count: total,
    }),
  });

  return {
    embeds: [embed],
    components: componentsFor(views, locale, viewerIsOwner, null),
    flags: MessageFlags.Ephemeral,
  };
}

export function categoryPayload(
  locale: Locale,
  viewerIsOwner: boolean,
  key: string,
): InteractionReplyOptions {
  const views = buildCategoryViews(locale, viewerIsOwner);
  const view = views.find((v) => v.key === key);
  if (!view) {
    return overviewPayload(locale, viewerIsOwner);
  }

  const isOwnerCat = key === OWNER_CATEGORY;
  const embed = new EmbedBuilder()
    .setColor(isOwnerCat ? Colors.premium : Colors.primary)
    .setTitle(
      `${view.emoji} ${view.label} В· ${view.commands.length}` +
        (isOwnerCat ? " В· OWNER" : ""),
    )
    .setDescription(
      isOwnerCat
        ? tWithLocale(locale, "help.owner_intro")
        : tWithLocale(locale, "help.category_intro", { category: view.label }),
    );

  // Chunk the commands across multiple fields so we never overflow 1024 chars.
  const fields: APIEmbedField[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const c of view.commands) {
    const line = `\`/${c.data.name}\` вЂ” ${commandShortDescription(locale, c)}`;
    if (currentLen + line.length + 1 > MAX_EMBED_FIELD - 16) {
      fields.push({ name: "В·", value: current.join("\n"), inline: false });
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length) {
    fields.push({ name: "В·", value: current.join("\n"), inline: false });
  }
  embed.addFields(fields);

  embed.setFooter({
    text: tWithLocale(locale, "help.category_footer", { category: view.label }),
  });

  return {
    embeds: [embed],
    components: componentsFor(views, locale, viewerIsOwner, key),
    flags: MessageFlags.Ephemeral,
  };
}

export function commandPayload(
  locale: Locale,
  cmd: SlashCommand,
  viewerIsOwner: boolean,
): InteractionReplyOptions {
  const data = cmd.data.toJSON();
  const cat = cmd.ownerOnly || cmd.category === OWNER_CATEGORY ? OWNER_CATEGORY : cmd.category ?? "misc";
  const isOwnerCat = cat === OWNER_CATEGORY;

  const embed = new EmbedBuilder()
    .setColor(isOwnerCat ? Colors.premium : Colors.primary)
    .setTitle(`${cmd.meta?.emoji ? `${cmd.meta.emoji} ` : ""}/${data.name}`)
    .setDescription(
      cmd.meta?.longDescription ||
        commandShortDescription(locale, cmd),
    );

  embed.addFields({
    name: tWithLocale(locale, "help.field.usage"),
    value: "`" + deriveUsage(cmd) + "`",
    inline: false,
  });

  const args = deriveArgList(cmd);
  if (args.length) {
    embed.addFields({
      name: tWithLocale(locale, "help.field.arguments"),
      value: clamp(
        args
          .map(
            (a) =>
              `вЂў \`${a.name}\` ${a.required ? "**(required)**" : "(optional)"} вЂ” ${a.description}`,
          )
          .join("\n"),
        MAX_EMBED_FIELD,
      ),
      inline: false,
    });
  }

  if (cmd.meta?.examples?.length) {
    embed.addFields({
      name: tWithLocale(locale, "help.field.examples"),
      value: cmd.meta.examples.map((e) => `\`${e}\``).join("\n"),
      inline: false,
    });
  }

  const permLabel = permissionsLabel(cmd);
  embed.addFields(
    {
      name: tWithLocale(locale, "help.field.category"),
      value: `${categoryLabel(locale, cat)}${isOwnerCat ? " В· OWNER" : ""}`,
      inline: true,
    },
    {
      name: tWithLocale(locale, "help.field.permissions"),
      value: permLabel ?? tWithLocale(locale, "help.field.permissions_none"),
      inline: true,
    },
    {
      name: tWithLocale(locale, "help.field.cooldown"),
      value: cmd.cooldownSec ? `${cmd.cooldownSec}s` : "вЂ”",
      inline: true,
    },
  );

  embed.setFooter({
    text: tWithLocale(locale, "help.command_footer", { name: data.name }),
  });

  const views = buildCategoryViews(locale, viewerIsOwner);
  return {
    embeds: [embed],
    components: componentsFor(views, locale, viewerIsOwner, cat),
    flags: MessageFlags.Ephemeral,
  };
}

/* -------------------------------------------------------------------------- */
/*  Components                                                                */
/* -------------------------------------------------------------------------- */

function componentsFor(
  views: HelpCategoryView[],
  locale: Locale,
  viewerIsOwner: boolean,
  selectedKey: string | null,
): InteractionReplyOptions["components"] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder(tWithLocale(locale, "help.select_placeholder"))
    .setMinValues(1)
    .setMaxValues(1);

  for (const view of views.slice(0, 25)) {
    select.addOptions({
      label: view.label.slice(0, 100),
      value: view.key,
      emoji: view.emoji,
      description: tWithLocale(locale, "help.select_option_description", {
        count: view.commands.length,
      }).slice(0, 100),
      default: view.key === selectedKey,
    });
  }

  const homeBtn = new ButtonBuilder()
    .setCustomId(HOME_ID)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(tWithLocale(locale, "help.button.home"))
    .setEmoji("рџЏ ");

  // The "show OWNER" toggle is only meaningful for OWNERS вЂ” hidden otherwise.
  const ownerBtn = new ButtonBuilder()
    .setCustomId(OWNER_TOGGLE_ID)
    .setStyle(ButtonStyle.Primary)
    .setLabel(tWithLocale(locale, "help.button.owner"))
    .setEmoji("рџ‘‘");

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(homeBtn);
  if (viewerIsOwner) buttons.addComponents(ownerBtn);

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    buttons,
  ];
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + "вЂ¦" : value;
}

export const HELP_CUSTOM_IDS = {
  SELECT: SELECT_ID,
  HOME: HOME_ID,
  OWNER_TOGGLE: OWNER_TOGGLE_ID,
} as const;

/* -------------------------------------------------------------------------- */
/*  /ping (unchanged, kept here for module locality)                          */
/* -------------------------------------------------------------------------- */

const ping: SlashCommand = {
  category: "core",
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency.")
    .setDescriptionLocalizations({ ru: "РџСЂРѕРІРµСЂРёС‚СЊ Р·Р°РґРµСЂР¶РєСѓ Р±РѕС‚Р°." }),
  meta: {
    longDescription: "Reports the websocket ping and the round-trip reply latency.",
    examples: ["/ping"],
  },
  async execute(interaction: ChatInputCommandInteraction) {
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

commands.push(ping);
