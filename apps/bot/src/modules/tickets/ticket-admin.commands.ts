import {
  PermissionsBitField,
  SlashCommandBuilder,
  type GuildMember,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { UserFacingError } from "@core/errors/errors";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";
import { t } from "@core/i18n";
import {
  priorityFromString,
  ticketService,
} from "./ticket.service";

/**
 * `/ticket <subcommand>` — staff actions on the ticket whose channel the
 * command was invoked in. Resolves the ticket via channelId so callers
 * never have to remember the ticket ID.
 */
const ticketAdmin: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageMessages],
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Staff actions inside an open ticket channel.")
    .addSubcommand((sc) =>
      sc
        .setName("add")
        .setDescription("Add a user to this ticket.")
        .addUserOption((o) =>
          o.setName("user").setDescription("User to add").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("remove")
        .setDescription("Remove a user from this ticket.")
        .addUserOption((o) =>
          o.setName("user").setDescription("User to remove").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("transfer")
        .setDescription("Transfer the claim to another staff member.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("New claimer")
            .setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("rename")
        .setDescription("Rename the ticket channel.")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("New name (without priority prefix)")
            .setRequired(true)
            .setMaxLength(80),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("priority")
        .setDescription("Set ticket priority.")
        .addStringOption((o) =>
          o
            .setName("level")
            .setDescription("Priority level")
            .setRequired(true)
            .addChoices(
              { name: "low", value: "low" },
              { name: "normal", value: "normal" },
              { name: "high", value: "high" },
              { name: "urgent", value: "urgent" },
            ),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("freeze")
        .setDescription(
          "Freeze the ticket (only staff/claimer can send messages).",
        )
        .addBooleanOption((o) =>
          o.setName("on").setDescription("true = freeze, false = unfreeze").setRequired(true),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("close")
        .setDescription("Close this ticket with an optional reason.")
        .addStringOption((o) =>
          o.setName("reason").setDescription("Reason shown in the close log").setMaxLength(2000),
        ),
    )
    .addSubcommand((sc) =>
      sc
        .setName("transcript")
        .setDescription(
          "Push a transcript snapshot to the admin log without closing.",
        ),
    ),
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId!;
    const channelId = interaction.channelId;
    const ticket = await prisma.ticket.findUnique({ where: { channelId } });
    if (!ticket || ticket.status === "closed") {
      throw new UserFacingError(
        await t(guildId, "tickets.admin.not_in_ticket"),
      );
    }

    const actor = interaction.member as GuildMember;
    const title = await t(guildId, "tickets.title");

    try {
      if (sub === "add") {
        const target = interaction.options.getUser("user", true);
        await ticketService.addUser(ticket.id, actor, target.id);
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.user_added_ack", {
                userId: target.id,
              }),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "remove") {
        const target = interaction.options.getUser("user", true);
        await ticketService.removeUser(ticket.id, actor, target.id);
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.user_removed_ack", {
                userId: target.id,
              }),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "transfer") {
        const target = interaction.options.getMember("user");
        if (!target || !("guild" in target)) {
          throw new UserFacingError(
            await t(guildId, "tickets.admin.member_not_found"),
          );
        }
        await ticketService.transferClaim(
          ticket.id,
          actor,
          target as GuildMember,
        );
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.transferred_ack", {
                userId: (target as GuildMember).id,
              }),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "rename") {
        const name = interaction.options.getString("name", true);
        await ticketService.renameChannel(ticket.id, actor, name);
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.renamed_ack"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "priority") {
        const raw = interaction.options.getString("level", true);
        const level = priorityFromString(raw);
        if (level === null) {
          throw new UserFacingError(
            await t(guildId, "tickets.admin.bad_priority"),
          );
        }
        await ticketService.setPriority(ticket.id, actor, level);
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.priority_set_ack", {
                level: await t(guildId, `tickets.priority.${raw}`),
              }),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "freeze") {
        const on = interaction.options.getBoolean("on", true);
        await ticketService.setFreeze(ticket.id, actor, on);
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(
                guildId,
                on ? "tickets.admin.frozen_ack" : "tickets.admin.unfrozen_ack",
              ),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      if (sub === "transcript") {
        await interaction.deferReply({ ephemeral: true });
        await ticketService.requestTranscriptNow(ticket.id, actor);
        await interaction.editReply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.snapshot_done"),
            ),
          ],
        });
        return;
      }
      if (sub === "close") {
        const reason = interaction.options.getString("reason") ?? undefined;
        await interaction.reply({
          embeds: [
            successEmbed(
              title,
              await t(guildId, "tickets.admin.closing_with_reason"),
            ),
          ],
          ephemeral: true,
        });
        await ticketService.close(ticket.id, actor, { reason });
        return;
      }
    } catch (err) {
      const fallback = await t(guildId, "common.something_went_wrong");
      const msg = err instanceof UserFacingError ? err.message : fallback;
      if (interaction.replied || interaction.deferred) {
        await interaction
          .followUp({ embeds: [errorEmbed(title, msg)], ephemeral: true })
          .catch(() => null);
      } else {
        await interaction
          .reply({ embeds: [errorEmbed(title, msg)], ephemeral: true })
          .catch(() => null);
      }
    }
  },
};

export const commands = [ticketAdmin];
