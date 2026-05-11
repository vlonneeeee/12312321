import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import type { ButtonHandler, ModalHandler } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { t } from "@core/i18n";
import { child } from "@core/logger/logger";
import { ticketService } from "./ticket.service";
import { postTicketRated } from "./ticket-logger";

const log = child("tickets:rating");

const RATE_PREFIX = "ticket:rate";
const COMMENT_BUTTON_PREFIX = "ticket:ratecomment";
const COMMENT_MODAL_PREFIX = "ticket:ratecommentsubmit";

/**
 * Handler for `ticket:rate:<ticketId>:<n>` (n = 1..5).
 * Stores the rating, then prompts the user to optionally leave a comment.
 */
const ratingButton: ButtonHandler = {
  customId: RATE_PREFIX,
  async execute(interaction, params) {
    const [ticketId, scoreRaw] = params;
    if (!ticketId || !scoreRaw) return;
    const score = Number(scoreRaw);
    try {
      const result = await ticketService.applyRating(
        ticketId,
        interaction.user.id,
        score,
        interaction.guildId,
      );

      // Replace the star buttons with a "leave comment / skip" row.
      const commentRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${COMMENT_BUTTON_PREFIX}:${ticketId}`)
          .setLabel(
            await t(interaction.guildId, "tickets.rating.add_comment_button"),
          )
          .setStyle(ButtonStyle.Primary),
      );

      await interaction.update({
        embeds: [
          successEmbed(
            await t(interaction.guildId, "tickets.rating.thanks_title"),
            await t(interaction.guildId, "tickets.rating.thanks_body", {
              score,
            }),
          ),
        ],
        components: [commentRow],
      });

      // Post a follow-up to the admin log channel right away. The optional
      // comment is logged separately if/when the user submits it.
      try {
        const guild = await interaction.client.guilds
          .fetch(result.guildId)
          .catch(() => null);
        if (guild) {
          const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { claimerId: true },
          });
          await postTicketRated(guild, {
            ticketId,
            authorId: result.authorId,
            rating: result.rating,
            claimerId: ticket?.claimerId,
            comment: null,
          });
        }
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err, ticketId },
          "post-rating log failed",
        );
      }
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

/**
 * Handler for `ticket:ratecomment:<ticketId>` — shows the comment modal.
 */
const commentButton: ButtonHandler = {
  customId: COMMENT_BUTTON_PREFIX,
  async execute(interaction, params) {
    const [ticketId] = params;
    if (!ticketId) return;
    const modal = new ModalBuilder()
      .setCustomId(`${COMMENT_MODAL_PREFIX}:${ticketId}`)
      .setTitle(await t(interaction.guildId, "tickets.rating.comment_title"));
    const input = new TextInputBuilder()
      .setCustomId("comment")
      .setLabel(
        await t(interaction.guildId, "tickets.rating.comment_label"),
      )
      .setRequired(false)
      .setMaxLength(1000)
      .setStyle(TextInputStyle.Paragraph);
    modal.addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        input,
      ),
    );
    await interaction.showModal(modal);
  },
};

/**
 * Handler for `ticket:ratecommentsubmit:<ticketId>` — modal submit.
 */
const commentModalSubmit: ModalHandler = {
  customId: COMMENT_MODAL_PREFIX,
  async execute(interaction, params) {
    const [ticketId] = params;
    if (!ticketId) return;
    const comment = interaction.fields
      .getTextInputValue("comment")
      .trim()
      .slice(0, 1000);
    try {
      await ticketService.applyRatingComment(
        ticketId,
        interaction.user.id,
        comment,
      );
      await interaction.reply({
        embeds: [
          successEmbed(
            await t(interaction.guildId, "tickets.rating.thanks_title"),
            await t(interaction.guildId, "tickets.rating.comment_saved"),
          ),
        ],
        ephemeral: true,
      });

      // Re-post the rating log with the comment now attached.
      try {
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: {
            guildId: true,
            authorId: true,
            rating: true,
            claimerId: true,
          },
        });
        if (ticket?.rating) {
          const guild = await interaction.client.guilds
            .fetch(ticket.guildId)
            .catch(() => null);
          if (guild) {
            await postTicketRated(guild, {
              ticketId,
              authorId: ticket.authorId,
              rating: ticket.rating,
              claimerId: ticket.claimerId,
              comment: comment || null,
            });
          }
        }
      } catch (err) {
        log.warn(
          { err: err instanceof Error ? err.message : err, ticketId },
          "post-rating-comment log failed",
        );
      }
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

export const buttons: ButtonHandler[] = [ratingButton, commentButton];
export const modals: ModalHandler[] = [commentModalSubmit];
