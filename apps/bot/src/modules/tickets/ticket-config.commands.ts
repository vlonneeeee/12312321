import {
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
} from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { t } from "@core/i18n";
import {
  normalizeCategories,
  type TicketCategory,
  type TicketModalField,
} from "./ticket.service";

const ticketsConfig: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("tickets-config")
    .setDescription("Configure tickets for this server.")
    .addSubcommand((sc) =>
      sc
        .setName("log-channel")
        .setDescription(
          "Set the admin channel that receives ticket activity & transcripts.",
        )
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("Channel (leave empty to disable)")
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("auto-close")
        .setDescription(
          "Hours of inactivity before a ticket auto-closes. 0 = disabled.",
        )
        .addIntegerOption((o) =>
          o
            .setName("hours")
            .setDescription("0 disables auto-close. Default 48.")
            .setMinValue(0)
            .setMaxValue(24 * 30)
            .setRequired(true),
        )
        .addIntegerOption((o) =>
          o
            .setName("warn-before")
            .setDescription(
              "Hours before auto-close to post a warning. 0 = no warn.",
            )
            .setMinValue(0)
            .setMaxValue(24 * 30),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName("show").setDescription("Show current ticket configuration."),
    )
    .addSubcommand((sc) =>
      sc
        .setName("rating")
        .setDescription("Configure the post-close rating prompt.")
        .addBooleanOption((o) =>
          o
            .setName("enabled")
            .setDescription("Ask the author for a 1-5 rating on close")
            .setRequired(true),
        )
        .addBooleanOption((o) =>
          o
            .setName("required")
            .setDescription(
              "Wait up to 5 minutes for the rating before deleting the channel",
            ),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName("category-modal")
        .setDescription(
          "Manage the modal questions shown before a ticket is opened.",
        )
        .addSubcommand((sc) =>
          sc
            .setName("add")
            .setDescription("Add a question to a panel category.")
            .addStringOption((o) =>
              o.setName("panel").setDescription("Panel ID").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("category")
                .setDescription("Category key")
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("field-id")
                .setDescription("Internal id, eg `summary` or `steps`")
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("label")
                .setDescription("Question label shown to the user")
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("style")
                .setDescription("Single-line or paragraph")
                .addChoices(
                  { name: "short", value: "short" },
                  { name: "paragraph", value: "paragraph" },
                ),
            )
            .addBooleanOption((o) =>
              o.setName("required").setDescription("Is this field required?"),
            )
            .addStringOption((o) =>
              o
                .setName("placeholder")
                .setDescription("Placeholder text inside the input"),
            )
            .addIntegerOption((o) =>
              o
                .setName("min-length")
                .setDescription("Min length")
                .setMinValue(0)
                .setMaxValue(4000),
            )
            .addIntegerOption((o) =>
              o
                .setName("max-length")
                .setDescription("Max length")
                .setMinValue(1)
                .setMaxValue(4000),
            ),
        )
        .addSubcommand((sc) =>
          sc
            .setName("remove")
            .setDescription("Remove a question from a panel category.")
            .addStringOption((o) =>
              o.setName("panel").setDescription("Panel ID").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("category")
                .setDescription("Category key")
                .setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("field-id")
                .setDescription("Internal id of the field to remove")
                .setRequired(true),
            ),
        )
        .addSubcommand((sc) =>
          sc
            .setName("list")
            .setDescription("List configured questions for a category.")
            .addStringOption((o) =>
              o.setName("panel").setDescription("Panel ID").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("category")
                .setDescription("Category key")
                .setRequired(true),
            ),
        )
        .addSubcommand((sc) =>
          sc
            .setName("clear")
            .setDescription("Remove every question from a category.")
            .addStringOption((o) =>
              o.setName("panel").setDescription("Panel ID").setRequired(true),
            )
            .addStringOption((o) =>
              o
                .setName("category")
                .setDescription("Category key")
                .setRequired(true),
            ),
        ),
    ),
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;

    if (group === "category-modal") {
      await handleCategoryModal(interaction, sub, guildId);
      return;
    }

    if (sub === "rating") {
      const enabled = interaction.options.getBoolean("enabled", true);
      const required =
        interaction.options.getBoolean("required", false) ?? undefined;
      await prisma.guild.update({
        where: { id: guildId },
        data: {
          ticketRatingEnabled: enabled,
          ...(required !== undefined
            ? { ticketRatingRequired: required }
            : {}),
        },
      });
      const body = enabled
        ? await t(guildId, "tickets.config.rating_on", {
            required: required
              ? await t(guildId, "common.yes")
              : await t(guildId, "common.no"),
          })
        : await t(guildId, "tickets.config.rating_off");
      await interaction.reply({
        embeds: [successEmbed(await t(guildId, "tickets.title"), body)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "log-channel") {
      const channel = interaction.options.getChannel("channel", false);
      const ticketsLogChannelId = channel?.id ?? null;
      await prisma.guild.update({
        where: { id: guildId },
        data: { ticketsLogChannelId },
      });
      const title = await t(guildId, "tickets.title");
      const body = ticketsLogChannelId
        ? await t(guildId, "tickets.config.log_channel_set", {
            channelId: ticketsLogChannelId,
          })
        : await t(guildId, "tickets.config.log_channel_cleared");
      await interaction.reply({
        embeds: [successEmbed(title, body)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "auto-close") {
      const hours = interaction.options.getInteger("hours", true);
      const warnBefore =
        interaction.options.getInteger("warn-before", false) ?? 0;
      if (warnBefore > hours) {
        await interaction.reply({
          embeds: [
            successEmbed(
              await t(guildId, "tickets.title"),
              await t(guildId, "tickets.config.warn_too_late"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      await prisma.guild.update({
        where: { id: guildId },
        data: {
          ticketAutoCloseHours: hours,
          ticketInactivityWarnHours: warnBefore,
        },
      });
      const body =
        hours > 0
          ? await t(guildId, "tickets.config.auto_close_set", {
              hours,
              warn: warnBefore,
            })
          : await t(guildId, "tickets.config.auto_close_off");
      await interaction.reply({
        embeds: [successEmbed(await t(guildId, "tickets.title"), body)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "show") {
      const g = await prisma.guild.findUnique({
        where: { id: guildId },
        select: {
          ticketsLogChannelId: true,
          ticketCategoryId: true,
          modLogChannelId: true,
          logChannelId: true,
          ticketAutoCloseHours: true,
          ticketInactivityWarnHours: true,
        },
      });
      const title = await t(guildId, "tickets.title");
      const autoCloseLine =
        g && g.ticketAutoCloseHours > 0
          ? await t(guildId, "tickets.config.show_auto_close_on", {
              hours: g.ticketAutoCloseHours,
              warn: g.ticketInactivityWarnHours,
            })
          : await t(guildId, "tickets.config.show_auto_close_off");
      const lines = [
        `**${await t(guildId, "tickets.config.show_log_channel")}:** ${formatChannel(g?.ticketsLogChannelId)}`,
        `**${await t(guildId, "tickets.config.show_fallback")}:** ${formatChannel(
          g?.ticketsLogChannelId ?? g?.modLogChannelId ?? g?.logChannelId,
        )}`,
        `**${await t(guildId, "tickets.config.show_category")}:** ${formatChannel(g?.ticketCategoryId)}`,
        `**${await t(guildId, "tickets.config.show_auto_close")}:** ${autoCloseLine}`,
      ];
      await interaction.reply({
        embeds: [infoEmbed(title, lines.join("\n"))],
        ephemeral: true,
      });
      return;
    }
  },
};

function formatChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : "—";
}

async function handleCategoryModal(
  interaction: import("discord.js").ChatInputCommandInteraction,
  sub: string,
  guildId: string,
): Promise<void> {
  const panelId = interaction.options.getString("panel", true);
  const categoryKey = interaction.options.getString("category", true);
  const panel = await prisma.ticketPanel.findFirst({
    where: { id: panelId, guildId },
  });
  if (!panel) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          await t(guildId, "tickets.title"),
          await t(guildId, "tickets.config.panel_not_found"),
        ),
      ],
      ephemeral: true,
    });
    return;
  }
  const cats = normalizeCategories(panel.categories);
  const idx = cats.findIndex((c) => c.key === categoryKey);
  if (idx === -1) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          await t(guildId, "tickets.title"),
          await t(guildId, "tickets.unknown_category"),
        ),
      ],
      ephemeral: true,
    });
    return;
  }
  const cat = cats[idx]!;
  const existing = cat.modalFields ?? [];

  if (sub === "list") {
    if (existing.length === 0) {
      await interaction.reply({
        embeds: [
          infoEmbed(
            await t(guildId, "tickets.title"),
            await t(guildId, "tickets.config.modal_empty"),
          ),
        ],
        ephemeral: true,
      });
      return;
    }
    const lines = existing.map(
      (f, i) =>
        `**${i + 1}.** \`${f.id}\` — ${f.label}` +
        ` _(style: ${f.style}, required: ${f.required ? "yes" : "no"})_`,
    );
    await interaction.reply({
      embeds: [
        infoEmbed(
          await t(guildId, "tickets.title"),
          lines.join("\n"),
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "clear") {
    const next: TicketCategory[] = cats.map((c, i) =>
      i === idx ? { ...c, modalFields: [] } : c,
    );
    await prisma.ticketPanel.update({
      where: { id: panel.id },
      data: { categories: next as unknown as object },
    });
    await interaction.reply({
      embeds: [
        successEmbed(
          await t(guildId, "tickets.title"),
          await t(guildId, "tickets.config.modal_cleared"),
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "remove") {
    const fieldId = interaction.options.getString("field-id", true);
    const updated: TicketModalField[] = existing.filter(
      (f) => f.id !== fieldId,
    );
    if (updated.length === existing.length) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            await t(guildId, "tickets.title"),
            await t(guildId, "tickets.config.modal_field_not_found"),
          ),
        ],
        ephemeral: true,
      });
      return;
    }
    const next: TicketCategory[] = cats.map((c, i) =>
      i === idx ? { ...c, modalFields: updated } : c,
    );
    await prisma.ticketPanel.update({
      where: { id: panel.id },
      data: { categories: next as unknown as object },
    });
    await interaction.reply({
      embeds: [
        successEmbed(
          await t(guildId, "tickets.title"),
          await t(guildId, "tickets.config.modal_field_removed", { fieldId }),
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  // sub === "add"
  const fieldId = interaction.options.getString("field-id", true);
  const label = interaction.options.getString("label", true);
  const style =
    (interaction.options.getString("style") as TicketModalField["style"] | null) ??
    "short";
  const required = interaction.options.getBoolean("required") ?? false;
  const placeholder =
    interaction.options.getString("placeholder") ?? undefined;
  const minLength = interaction.options.getInteger("min-length") ?? undefined;
  const maxLength = interaction.options.getInteger("max-length") ?? undefined;

  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(fieldId)) {
    throw new UserFacingError(
      await t(guildId, "tickets.config.modal_field_id_invalid"),
    );
  }
  if (existing.some((f) => f.id === fieldId)) {
    throw new UserFacingError(
      await t(guildId, "tickets.config.modal_field_exists"),
    );
  }
  if (existing.length >= 5) {
    throw new UserFacingError(
      await t(guildId, "tickets.config.modal_field_limit"),
    );
  }
  if (
    typeof minLength === "number" &&
    typeof maxLength === "number" &&
    minLength > maxLength
  ) {
    throw new UserFacingError(
      await t(guildId, "tickets.config.modal_field_length_invalid"),
    );
  }
  const newField: TicketModalField = {
    id: fieldId,
    label,
    style,
    required,
    placeholder,
    minLength,
    maxLength,
  };
  const updatedFields = [...existing, newField];
  const next: TicketCategory[] = cats.map((c, i) =>
    i === idx ? { ...c, modalFields: updatedFields } : c,
  );
  await prisma.ticketPanel.update({
    where: { id: panel.id },
    data: { categories: next as unknown as object },
  });
  await interaction.reply({
    embeds: [
      successEmbed(
        await t(guildId, "tickets.title"),
        await t(guildId, "tickets.config.modal_field_added", { fieldId }),
      ),
    ],
    ephemeral: true,
  });
}

export const commands = [ticketsConfig];
