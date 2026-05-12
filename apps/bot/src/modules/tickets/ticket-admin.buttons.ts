import {
  ActionRowBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type GuildMember,
  type Interaction,
} from "discord.js";
import type { ButtonHandler } from "@core/handler/command";
import { UserFacingError } from "@core/errors/errors";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { t } from "@core/i18n";
import { child } from "@core/logger/logger";
import { prisma } from "@core/db/prisma";
import { isTicketStaff } from "@shared/utils/perms";

const log = child("tickets:admin-buttons");

/**
 * Pre-flight permission check for any admin-row button. Returns true when
 * the interaction may proceed (modal/select can open). Otherwise replies
 * with an ephemeral error and returns false so the caller stops.
 *
 * Author of the ticket is rejected outright \u2014 they should never be able
 * to add/remove/transfer/freeze/priority/transcript their own ticket,
 * even if they happen to have ManageGuild.
 */
export async function ensureAdminButton(
  interaction: import("discord.js").ButtonInteraction,
  ticketId: string,
): Promise<boolean> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, authorId: true, claimerId: true, status: true, guildId: true },
  });
  if (!ticket || ticket.status === "closed") {
    await interaction
      .reply({
        embeds: [
          errorEmbed(
            await t(interaction.guildId, "tickets.title"),
            await t(interaction.guildId, "tickets.not_found"),
          ),
        ],
        ephemeral: true,
      })
      .catch(() => null);
    return false;
  }
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  if (member.id === ticket.authorId) {
    await interaction
      .reply({
        embeds: [
          errorEmbed(
            await t(interaction.guildId, "tickets.title"),
            await t(interaction.guildId, "tickets.admin.button_not_for_author"),
          ),
        ],
        ephemeral: true,
      })
      .catch(() => null);
    return false;
  }
  if (ticket.claimerId === member.id) return true;
  if (await isTicketStaff(member)) return true;
  await interaction
    .reply({
      embeds: [
        errorEmbed(
          await t(interaction.guildId, "tickets.title"),
          await t(interaction.guildId, "tickets.admin.button_not_for_user"),
        ),
      ],
      ephemeral: true,
    })
    .catch(() => null);
  return false;
}

async function replyError(
  interaction: import("discord.js").ButtonInteraction,
  err: unknown,
): Promise<void> {
  const fallback = await t(
    interaction.guildId,
    "common.something_went_wrong",
  );
  const msg = err instanceof UserFacingError ? err.message : fallback;
  const title = await t(interaction.guildId, "tickets.title");
  if (interaction.replied || interaction.deferred) {
    await interaction
      .editReply({ embeds: [errorEmbed(title, msg)] })
      .catch(() => null);
  } else {
    await interaction
      .reply({ embeds: [errorEmbed(title, msg)], ephemeral: true })
      .catch(() => null);
  }
}

function buildSimpleModal(opts: {
  customId: string;
  title: string;
  inputId: string;
  label: string;
  placeholder?: string;
  style?: TextInputStyle;
  required?: boolean;
  maxLength?: number;
}): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(opts.customId).setTitle(opts.title);
  const input = new TextInputBuilder()
    .setCustomId(opts.inputId)
    .setLabel(opts.label.slice(0, 45))
    .setStyle(opts.style ?? TextInputStyle.Short)
    .setRequired(opts.required ?? true);
  if (opts.placeholder) input.setPlaceholder(opts.placeholder.slice(0, 100));
  if (opts.maxLength) input.setMaxLength(opts.maxLength);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(input),
  );
  return modal;
}

// ---------------------------------------------------------------------------
// Add user — shows modal asking for user ID/mention
// ---------------------------------------------------------------------------
const ticketAddUserBtn: ButtonHandler = {
  customId: "ticket:adduser",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    try {
      await interaction.showModal(
        buildSimpleModal({
          customId: `ticket:adduser:${ticketId}`,
          title: await t(interaction.guildId, "tickets.admin.add_user_modal_title"),
          inputId: "user",
          label: await t(interaction.guildId, "tickets.admin.user_id_label"),
          placeholder: await t(
            interaction.guildId,
            "tickets.admin.user_id_placeholder",
          ),
          maxLength: 64,
        }),
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "adduser modal failed");
      await replyError(interaction, err);
    }
  },
};

const ticketRemoveUserBtn: ButtonHandler = {
  customId: "ticket:remuser",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    try {
      await interaction.showModal(
        buildSimpleModal({
          customId: `ticket:remuser:${ticketId}`,
          title: await t(
            interaction.guildId,
            "tickets.admin.remove_user_modal_title",
          ),
          inputId: "user",
          label: await t(interaction.guildId, "tickets.admin.user_id_label"),
          placeholder: await t(
            interaction.guildId,
            "tickets.admin.user_id_placeholder",
          ),
          maxLength: 64,
        }),
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "remuser modal failed");
      await replyError(interaction, err);
    }
  },
};

const ticketTransferBtn: ButtonHandler = {
  customId: "ticket:transfer",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    try {
      await interaction.showModal(
        buildSimpleModal({
          customId: `ticket:transfer:${ticketId}`,
          title: await t(interaction.guildId, "tickets.admin.transfer_modal_title"),
          inputId: "user",
          label: await t(interaction.guildId, "tickets.admin.user_id_label"),
          placeholder: await t(
            interaction.guildId,
            "tickets.admin.user_id_placeholder",
          ),
          maxLength: 64,
        }),
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "transfer modal failed");
      await replyError(interaction, err);
    }
  },
};

const ticketCloseReasonBtn: ButtonHandler = {
  customId: "ticket:closereason",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    try {
      await interaction.showModal(
        buildSimpleModal({
          customId: `ticket:closereason:${ticketId}`,
          title: await t(interaction.guildId, "tickets.admin.close_reason_modal_title"),
          inputId: "reason",
          label: await t(interaction.guildId, "tickets.admin.reason_label"),
          placeholder: await t(
            interaction.guildId,
            "tickets.admin.reason_placeholder",
          ),
          style: TextInputStyle.Paragraph,
          maxLength: 2000,
        }),
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "closereason modal failed");
      await replyError(interaction, err);
    }
  },
};

// ---------------------------------------------------------------------------
// Transcript-now — no modal, direct snapshot
// ---------------------------------------------------------------------------
const ticketTranscriptNowBtn: ButtonHandler = {
  customId: "ticket:transcriptnow",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    try {
      const { ticketService } = await import("./ticket.service");
      await ticketService.requestTranscriptNow(
        ticketId,
        interaction.member as GuildMember,
      );
      await interaction
        .editReply({
          embeds: [
            successEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(interaction.guildId, "tickets.admin.snapshot_done"),
            ),
          ],
        })
        .catch(() => null);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "transcriptnow failed");
      await replyError(interaction, err);
    }
  },
};

// ---------------------------------------------------------------------------
// Freeze — direct toggle. We flip based on the current ticket.frozen.
// ---------------------------------------------------------------------------
const ticketFreezeBtn: ButtonHandler = {
  customId: "ticket:freeze",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    try {
      const { prisma } = await import("@core/db/prisma");
      const row = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { frozen: true },
      });
      const next = !(row?.frozen ?? false);
      const { ticketService } = await import("./ticket.service");
      await ticketService.setFreeze(
        ticketId,
        interaction.member as GuildMember,
        next,
      );
      await interaction
        .editReply({
          embeds: [
            infoEmbed(
              await t(interaction.guildId, "tickets.title"),
              await t(
                interaction.guildId,
                next
                  ? "tickets.admin.frozen_ack"
                  : "tickets.admin.unfrozen_ack",
              ),
            ),
          ],
        })
        .catch(() => null);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "freeze failed");
      await replyError(interaction, err);
    }
  },
};

// ---------------------------------------------------------------------------
// Priority — open a string-select for the 4 levels.
// ---------------------------------------------------------------------------
const ticketPriorityBtn: ButtonHandler = {
  customId: "ticket:priority",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    if (!(await ensureAdminButton(interaction, ticketId))) return;
    const select = new StringSelectMenuBuilder()
      .setCustomId(`ticket:prioritypick:${ticketId}`)
      .setPlaceholder(
        await t(interaction.guildId, "tickets.admin.priority_pick_placeholder"),
      )
      .addOptions(
        {
          label: await t(interaction.guildId, "tickets.priority.low"),
          value: "low",
          emoji: "\uD83D\uDFE2",
        },
        {
          label: await t(interaction.guildId, "tickets.priority.normal"),
          value: "normal",
          emoji: "\uD83D\uDFE1",
        },
        {
          label: await t(interaction.guildId, "tickets.priority.high"),
          value: "high",
          emoji: "\uD83D\uDFE0",
        },
        {
          label: await t(interaction.guildId, "tickets.priority.urgent"),
          value: "urgent",
          emoji: "\uD83D\uDD34",
        },
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select,
    );
    await interaction
      .reply({
        content: await t(
          interaction.guildId,
          "tickets.admin.priority_pick_prompt",
        ),
        components: [row],
        ephemeral: true,
      })
      .catch(() => null);
  },
};

// ---------------------------------------------------------------------------
// Close-confirm flow: yes = actually close, no = dismiss the ephemeral prompt
// ---------------------------------------------------------------------------
const ticketCloseYesBtn: ButtonHandler = {
  customId: "ticket:closeyes",
  async execute(interaction, params) {
    const ticketId = params[0];
    if (!ticketId) return;
    await interaction.deferUpdate().catch(() => null);
    try {
      const { ticketService } = await import("./ticket.service");
      await ticketService.close(
        ticketId,
        interaction.member as GuildMember,
      );
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, "closeyes failed");
      const fallback = await t(interaction.guildId, "tickets.close_failed");
      const msg = err instanceof UserFacingError ? err.message : fallback;
      const title = await t(interaction.guildId, "tickets.title");
      await interaction
        .followUp({ embeds: [errorEmbed(title, msg)], ephemeral: true })
        .catch(() => null);
    }
  },
};

const ticketCloseNoBtn: ButtonHandler = {
  customId: "ticket:closeno",
  async execute(interaction) {
    await interaction
      .update({
        content: await t(interaction.guildId, "tickets.close_cancelled"),
        components: [],
      })
      .catch(() => null);
  },
};

export const buttons: ButtonHandler[] = [
  ticketAddUserBtn,
  ticketRemoveUserBtn,
  ticketTransferBtn,
  ticketCloseReasonBtn,
  ticketTranscriptNowBtn,
  ticketFreezeBtn,
  ticketPriorityBtn,
  ticketCloseYesBtn,
  ticketCloseNoBtn,
];

// Re-export helpers in case the modals file wants them later.
export { buildSimpleModal };

// Avoid unused-import warning by re-exporting type for downstream.
export type { Interaction };
