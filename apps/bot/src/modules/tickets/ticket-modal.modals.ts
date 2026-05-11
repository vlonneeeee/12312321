import {
  ActionRowBuilder,
  type ModalActionRowComponentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { ModalHandler } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { t } from "@core/i18n";
import { child } from "@core/logger/logger";
import {
  normalizeCategories,
  ticketService,
  type TicketCategory,
} from "./ticket.service";

const log = child("tickets:modal");

const MODAL_PREFIX = "ticket:openmodal";

/**
 * Build and present the open-ticket modal for a category.
 *
 * The Discord modal API caps `customId` at 100 chars and lets us encode up to
 * 5 short fields. We pack the panel id + category key into the customId so
 * the submit handler can re-resolve the category without re-querying the
 * select-menu state. We also serialise the field-id list so we know which
 * inputs to pull on submit even if the admin edited the panel meanwhile.
 *
 * Custom ID format: `ticket:openmodal:<panelId>:<categoryKey>`. We keep the
 * category JSON in the panel row — only `<panelId>` and `<categoryKey>` ride
 * along on the interaction.
 */
export async function presentOpenModal(
  interaction: StringSelectMenuInteraction,
  panelId: string,
  category: TicketCategory,
): Promise<void> {
  const fields = (category.modalFields ?? []).slice(0, 5);
  if (fields.length === 0) {
    throw new UserFacingError(
      await t(interaction.guildId, "tickets.modal.no_fields"),
    );
  }
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}:${panelId}:${category.key}`)
    .setTitle(
      truncate(
        await t(interaction.guildId, "tickets.modal.title", {
          category: category.label,
        }),
        45,
      ),
    );
  for (const field of fields) {
    const input = new TextInputBuilder()
      .setCustomId(field.id)
      .setLabel(truncate(field.label, 45))
      .setRequired(field.required)
      .setStyle(
        field.style === "paragraph"
          ? TextInputStyle.Paragraph
          : TextInputStyle.Short,
      );
    if (field.placeholder)
      input.setPlaceholder(truncate(field.placeholder, 100));
    if (typeof field.minLength === "number")
      input.setMinLength(Math.max(0, Math.min(4000, field.minLength)));
    if (typeof field.maxLength === "number")
      input.setMaxLength(Math.max(1, Math.min(4000, field.maxLength)));
    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        input,
      ),
    );
  }
  await interaction.showModal(modal);
}

const openModalHandler: ModalHandler = {
  customId: MODAL_PREFIX,
  async execute(interaction, params) {
    const [panelId, categoryKey] = params;
    if (!panelId || !categoryKey) return;
    try {
      const panel = await prisma.ticketPanel.findUnique({
        where: { id: panelId },
      });
      if (!panel) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.panel_missing"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      const cats = normalizeCategories(panel.categories);
      const cat = cats.find((c) => c.key === categoryKey);
      if (!cat) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.unknown_category"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }

      const answers: Record<string, string> = {};
      for (const field of cat.modalFields ?? []) {
        const value = interaction.fields
          .getTextInputValue(field.id)
          .trim()
          .slice(0, 4000);
        if (value.length > 0) answers[field.id] = value;
      }

      await interaction.deferReply({ ephemeral: true });
      const subject =
        // Best-effort: if there's a single short field, use it as the topic
        // displayed in the channel header.
        (cat.modalFields ?? []).find((f) => f.style === "short")?.id &&
        answers[(cat.modalFields ?? []).find((f) => f.style === "short")!.id]
          ? answers[
              (cat.modalFields ?? []).find((f) => f.style === "short")!.id
            ]?.slice(0, 100)
          : undefined;

      const r = await ticketService.openTicket({
        guild: interaction.guild!,
        author: interaction.member as import("discord.js").GuildMember,
        category: cat,
        subject,
        modalAnswers: answers,
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
      log.warn(
        {
          err: err instanceof Error ? err.message : err,
          panelId,
          categoryKey,
        },
        "ticket modal submit failed",
      );
      const fallback = await t(
        interaction.guildId,
        "common.something_went_wrong",
      );
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(interaction.guildId, "tickets.title");
      const payload = {
        embeds: [errorEmbed(title, msg)],
        ephemeral: true,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(payload).catch(() => null);
      } else {
        await interaction.reply(payload).catch(() => null);
      }
    }
  },
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export const modals = [openModalHandler];
