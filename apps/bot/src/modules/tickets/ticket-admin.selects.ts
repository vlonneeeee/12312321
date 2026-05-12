import type { GuildMember } from "discord.js";
import type { SelectMenuHandler } from "@core/handler/command";
import { UserFacingError } from "@core/errors/errors";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";
import { t } from "@core/i18n";
import { child } from "@core/logger/logger";

const log = child("tickets:admin-selects");

const priorityPickSelect: SelectMenuHandler = {
  customId: "ticket:prioritypick",
  async execute(interaction, params) {
    if (!interaction.isStringSelectMenu()) return;
    const ticketId = params[0];
    if (!ticketId) return;
    await interaction.deferUpdate().catch(() => null);
    try {
      const value = interaction.values[0]!;
      const { priorityFromString, ticketService } = await import(
        "./ticket.service"
      );
      const level = priorityFromString(value);
      if (level === null) {
        throw new UserFacingError(
          await t(interaction.guildId, "tickets.admin.bad_priority"),
        );
      }
      await ticketService.setPriority(
        ticketId,
        interaction.member as GuildMember,
        level,
      );
      await interaction
        .editReply({
          content: "",
          embeds: [
            successEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.admin.priority_set_ack", {
                level: await t(interaction.guildId, `tickets.priority.${value}`),
              }),
            ),
          ],
          components: [],
        })
        .catch(() => null);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err },
        "priority pick failed",
      );
      const fallback = await t(
        interaction.guildId,
        "common.something_went_wrong",
      );
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(interaction.guildId, "tickets.title");
      await interaction
        .editReply({
          embeds: [errorEmbed(title, msg)],
          components: [],
        })
        .catch(() => null);
    }
  },
};

export const selects = [priorityPickSelect];
