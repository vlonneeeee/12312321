import type { GuildMember } from "discord.js";
import type { ModalHandler } from "@core/handler/command";
import { UserFacingError } from "@core/errors/errors";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";
import { t } from "@core/i18n";
import { child } from "@core/logger/logger";

const log = child("tickets:admin-modals");

/**
 * Extract a Discord user snowflake from either a raw ID or a `<@id>` /
 * `<@!id>` mention. Returns null when nothing usable was found.
 */
function parseUserId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const mention = /^<@!?(?<id>\d{15,25})>$/.exec(trimmed);
  if (mention?.groups?.id) return mention.groups.id;
  if (/^\d{15,25}$/.test(trimmed)) return trimmed;
  return null;
}

async function replyError(
  interaction: import("discord.js").ModalSubmitInteraction,
  err: unknown,
): Promise<void> {
  const fallback = await t(interaction.guildId, "common.something_went_wrong");
  const msg = err instanceof UserFacingError ? err.message : fallback;
  const title = await t(interaction.guildId, "tickets.title");
  if (interaction.replied || interaction.deferred) {
    await interaction.editReply({ embeds: [errorEmbed(title, msg)] }).catch(() => null);
  } else {
    await interaction
      .reply({ embeds: [errorEmbed(title, msg)], ephemeral: true })
      .catch(() => null);
  }
}

const addUserModal: ModalHandler = {
  customId: "ticket:adduser",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    try {
      const raw = interaction.fields.getTextInputValue("user");
      const id = parseUserId(raw);
      if (!id) {
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.admin.bad_user_input"),
        );
      }
      const { ticketService } = await import("./ticket.service");
      await ticketService.addUser(
        ticketId,
        interaction.member as GuildMember,
        id,
      );
      await interaction
        .editReply({
          embeds: [
            successEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.admin.user_added_ack", {
                userId: id,
              }),
            ),
          ],
        })
        .catch(() => null);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "adduser submit failed");
      await replyError(interaction, err);
    }
  },
};

const remUserModal: ModalHandler = {
  customId: "ticket:remuser",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    try {
      const raw = interaction.fields.getTextInputValue("user");
      const id = parseUserId(raw);
      if (!id) {
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.admin.bad_user_input"),
        );
      }
      const { ticketService } = await import("./ticket.service");
      await ticketService.removeUser(
        ticketId,
        interaction.member as GuildMember,
        id,
      );
      await interaction
        .editReply({
          embeds: [
            successEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.admin.user_removed_ack", {
                userId: id,
              }),
            ),
          ],
        })
        .catch(() => null);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "remuser submit failed");
      await replyError(interaction, err);
    }
  },
};

const transferModal: ModalHandler = {
  customId: "ticket:transfer",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    try {
      const raw = interaction.fields.getTextInputValue("user");
      const id = parseUserId(raw);
      if (!id) {
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.admin.bad_user_input"),
        );
      }
      const member = await interaction.guild?.members.fetch(id).catch(() => null);
      if (!member) {
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.admin.member_not_found"),
        );
      }
      const { ticketService } = await import("./ticket.service");
      await ticketService.transferClaim(
        ticketId,
        interaction.member as GuildMember,
        member,
      );
      await interaction
        .editReply({
          embeds: [
            successEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.admin.transferred_ack", {
                userId: id,
              }),
            ),
          ],
        })
        .catch(() => null);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "transfer submit failed");
      await replyError(interaction, err);
    }
  },
};

const closeReasonModal: ModalHandler = {
  customId: "ticket:closereason",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    // Don't defer ephemerally — the channel will be deleted, no point.
    try {
      const reason = interaction.fields.getTextInputValue("reason");
      await interaction
        .reply({
          embeds: [
            successEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.admin.closing_with_reason"),
            ),
          ],
          ephemeral: true,
        })
        .catch(() => null);
      const { ticketService } = await import("./ticket.service");
      await ticketService.close(
        ticketId,
        interaction.member as GuildMember,
        { reason },
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "close-reason submit failed");
      await replyError(interaction, err);
    }
  },
};

export const modals: ModalHandler[] = [
  addUserModal,
  remUserModal,
  transferModal,
  closeReasonModal,
];

// Exported because the slash-commands file may want to validate input too.
export { parseUserId };
