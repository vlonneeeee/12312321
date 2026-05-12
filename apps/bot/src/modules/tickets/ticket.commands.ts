import {
  ActionRowBuilder,
  ChannelType,
  PermissionsBitField,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { t } from "@core/i18n";
import { normalizeCategories } from "./ticket.service";
import { presentOpenModal } from "./ticket-modal.modals";

async function reply(
  interaction: import("discord.js").ChatInputCommandInteraction,
  fn: () => Promise<void>,
) {
  try {
    await fn();
  } catch (err) {
    const fallback = await t(
      interaction.guildId,
      "common.something_went_wrong",
    );
    const msg = err instanceof UserFacingError ? err.message : fallback;
    const title = await t(interaction.guildId, "tickets.title");
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ embeds: [errorEmbed(title, msg)] });
    } else {
      await interaction.reply({
        embeds: [errorEmbed(title, msg)],
        ephemeral: true,
      });
    }
  }
}

const panel: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Send a ticket panel in this channel.")
    .addStringOption((o) =>
      o.setName("title").setDescription("Panel title").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("description")
        .setDescription("Panel description")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("categories")
        .setDescription(
          "Comma-separated category labels (e.g. Support,Billing,Reports)",
        )
        .setRequired(true),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const title = interaction.options.getString("title", true);
      const description = interaction.options.getString("description", true);
      const categoriesRaw = interaction.options.getString("categories", true);
      const channel = interaction.channel;
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.use_in_text_channel"),
        );
      }
      const cats = categoriesRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label) => ({
          key: label.toLowerCase().replace(/\s+/g, "_"),
          label,
        }));
      if (cats.length === 0)
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.provide_category"),
        );

      const select = new StringSelectMenuBuilder()
        .setCustomId("ticket:open")
        .setPlaceholder("Open a ticket…")
        .addOptions(
          cats.map((c) => ({
            label: c.label,
            value: c.key,
            description: `Open ${c.label}`,
          })),
        );
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        select,
      );

      const msg = await channel.send({
        embeds: [infoEmbed(title, description)],
        components: [row],
      });

      await prisma.ticketPanel.create({
        data: {
          guildId: interaction.guildId!,
          channelId: channel.id,
          messageId: msg.id,
          title,
          description,
          categories: cats,
        },
      });

      await interaction.reply({
        embeds: [
          successEmbed(await t(interaction.guildId, "tickets.panel_deployed")),
        ],
        ephemeral: true,
      });
    });
  },
};

const openCmd: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("ticket-open")
    .setDescription("Open a ticket without using the panel.")
    .setDescriptionLocalizations({
      ru: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0442\u0438\u043a\u0435\u0442 \u0431\u0435\u0437 \u043f\u0430\u043d\u0435\u043b\u0438 \u0432\u044b\u0431\u043e\u0440\u0430 \u043a\u0430\u0442\u0435\u0433\u043e\u0440\u0438\u0438.",
    })
    .addStringOption((o) =>
      o
        .setName("subject")
        .setDescription("Subject")
        .setDescriptionLocalizations({ ru: "\u0422\u0435\u043c\u0430 \u0442\u0438\u043a\u0435\u0442\u0430" })
        .setRequired(true),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = interaction.options.getString("subject", true);
      const { ticketService } = await import("./ticket.service");
      const r = await ticketService.openTicket({
        guild: interaction.guild!,
        author: interaction.member as import("discord.js").GuildMember,
        category: { key: "general", label: "General" },
        subject,
      });
      await interaction.reply({
        embeds: [
          successEmbed(
            await t(interaction.guildId, "tickets.ticket_opened_title"),
            `<#${r.channelId}>`,
          ),
        ],
        ephemeral: true,
      });
    });
  },
};

export const commands = [panel, openCmd];

// --- Button & select interactions ---

import type { ButtonHandler, SelectMenuHandler } from "@core/handler/command";

const ticketClose: ButtonHandler = {
  customId: "ticket:close",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    // tickets 2.1: optional confirm prompt before the channel disappears
    const guildRow = await prisma.guild.findUnique({
      where: { id: interaction.guildId ?? "" },
      select: { ticketCloseConfirm: true },
    });
    if (guildRow?.ticketCloseConfirm !== false) {
      const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = await import(
        "discord.js"
      );
      const row = new ActionRowBuilder<import("discord.js").ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:closeyes:${ticketId}`)
          .setLabel(await t(interaction.guildId, "tickets.close_confirm_yes"))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket:closeno")
          .setLabel(await t(interaction.guildId, "tickets.close_confirm_no"))
          .setStyle(ButtonStyle.Secondary),
      );
      await interaction
        .reply({
          content: await t(interaction.guildId, "tickets.close_confirm_prompt"),
          components: [row],
          ephemeral: true,
        })
        .catch(() => null);
      return;
    }
    const { ticketService } = await import("./ticket.service");
    try {
      await ticketService.close(
        ticketId,
        interaction.member as import("discord.js").GuildMember,
      );
    } catch (err) {
      const fallback = await t(interaction.guildId, "tickets.close_failed");
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(interaction.guildId, "tickets.title");
      await interaction
        .reply({ embeds: [errorEmbed(title, msg)], ephemeral: true })
        .catch(() => null);
    }
  },
};

const ticketClaim: ButtonHandler = {
  customId: "ticket:claim",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    const { ticketService } = await import("./ticket.service");
    try {
      await ticketService.claim(
        ticketId,
        interaction.member as import("discord.js").GuildMember,
      );
      await interaction.deferUpdate();
    } catch (err) {
      const fallback = await t(
        interaction.guildId,
        "common.something_went_wrong",
      );
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(interaction.guildId, "tickets.title");
      await interaction
        .reply({ embeds: [errorEmbed(title, msg)], ephemeral: true })
        .catch(() => null);
    }
  },
};

const ticketOpenSelect: SelectMenuHandler = {
  customId: "ticket:open",
  async execute(interaction) {
    if (!interaction.isStringSelectMenu()) return;

    // Note: we do NOT deferReply here because some categories trigger a modal
    // and Discord requires the modal to be sent on a fresh, undeferred
    // interaction. We defer later via safeDeferAndReply() for the non-modal path.

    const key = interaction.values[0]!;
    const panel = await prisma.ticketPanel.findFirst({
      where: { messageId: interaction.message.id },
    });

    // Rebuild the panel select once we know whether it survived this round so
    // the dropdown is not visually "stuck" on the previous choice. Repeating
    // the same category otherwise wouldn't fire a new interaction.
    const rebuildPanel = async () => {
      if (!panel) return;
      const cats = normalizeCategories(panel.categories);
      const fresh = new StringSelectMenuBuilder()
        .setCustomId("ticket:open")
        .setPlaceholder("Open a ticket…")
        .addOptions(
          cats.map((c) => ({
            label: c.label,
            value: c.key,
            description: `Open ${c.label}`,
            ...(c.emoji ? { emoji: c.emoji } : {}),
          })),
        );
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        fresh,
      );
      await interaction.message.edit({ components: [row] }).catch(() => null);
    };

    if (!panel) {
      await safeDeferAndReply(interaction);
      await interaction.editReply({
        embeds: [
          errorEmbed(
            await t(interaction.guildId, "tickets.title"),
            await t(interaction.guildId, "tickets.panel_missing"),
          ),
        ],
      });
      return;
    }
    const cats = normalizeCategories(panel.categories);
    const cat = cats.find((c) => c.key === key);
    if (!cat) {
      await safeDeferAndReply(interaction);
      await rebuildPanel();
      await interaction.editReply({
        embeds: [
          errorEmbed(
            await t(interaction.guildId, "tickets.title"),
            await t(interaction.guildId, "tickets.unknown_category"),
          ),
        ],
      });
      return;
    }

    // If this category has a modal, surface it BEFORE deferring so Discord
    // accepts the showModal call (it can't follow a deferReply). The modal
    // submit handler is responsible for opening the channel after submission.
    if (cat.modalFields && cat.modalFields.length > 0) {
      try {
        await presentOpenModal(interaction, panel.id, cat);
        // Rebuild the select asynchronously so the dropdown un-sticks even if
        // the user dismisses the modal.
        void rebuildPanel();
        return;
      } catch (err) {
        const fallback = await t(
          interaction.guildId,
          "common.something_went_wrong",
        );
        const msg = err instanceof UserFacingError ? err.message : fallback;
        const title = await t(interaction.guildId, "tickets.title");
        await interaction
          .reply({ embeds: [errorEmbed(title, msg)], ephemeral: true })
          .catch(() => null);
        void rebuildPanel();
        return;
      }
    }

    await safeDeferAndReply(interaction);
    const { ticketService } = await import("./ticket.service");
    try {
      const r = await ticketService.openTicket({
        guild: interaction.guild!,
        author: interaction.member as import("discord.js").GuildMember,
        category: cat,
      });
      await interaction.editReply({
        embeds: [
          successEmbed(
            await t(interaction.guildId, "tickets.ticket_opened_title"),
            `<#${r.channelId}>`,
          ),
        ],
      });
    } catch (err) {
      const fallback = await t(
        interaction.guildId,
        "common.something_went_wrong",
      );
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(interaction.guildId, "tickets.title");
      await interaction.editReply({ embeds: [errorEmbed(title, msg)] });
    } finally {
      await rebuildPanel();
    }
  },
};

async function safeDeferAndReply(
  interaction: import("discord.js").StringSelectMenuInteraction,
) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
  }
}

export const buttons: ButtonHandler[] = [ticketClose, ticketClaim];
export const select: SelectMenuHandler = ticketOpenSelect;
