import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { t } from "@core/i18n";
import { parseDuration, humanizeDuration } from "@shared/utils/duration";
import { truncate } from "@shared/utils/format";
import { ensureUser } from "@shared/utils/ensure";

const MAX_PER_USER = 25;
const MIN_MS = 10_000; // 10s
const MAX_MS = 365 * 24 * 60 * 60 * 1000; // 1y

async function reply(
  interaction: ChatInputCommandInteraction,
  fn: () => Promise<void>,
) {
  try {
    await fn();
  } catch (err) {
    const title = await t(interaction.guildId, "reminders.title");
    const fallback = await t(
      interaction.guildId,
      "common.something_went_wrong",
    );
    const msg = err instanceof UserFacingError ? err.message : fallback;
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

const remind: SlashCommand = {
  category: "general",
  data: new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Set a reminder. Posts in this channel when due.")
    .addStringOption((o) =>
      o
        .setName("time")
        .setDescription("e.g. 30m, 2h, 1d6h, 1w")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription("What to remind you about")
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o.setName("dm").setDescription("Send the reminder by DM instead"),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const timeStr = interaction.options.getString("time", true);
      const text = interaction.options.getString("text", true).slice(0, 1000);
      const wantsDm = interaction.options.getBoolean("dm", false) ?? false;
      const ms = parseDuration(timeStr);
      if (!ms) {
        throw new UserFacingError(
          await t(interaction.guildId, "reminders.bad_time", {
            input: timeStr,
          }),
        );
      }
      if (ms < MIN_MS) {
        throw new UserFacingError(
          await t(interaction.guildId, "reminders.too_short"),
        );
      }
      if (ms > MAX_MS) {
        throw new UserFacingError(
          await t(interaction.guildId, "reminders.too_long"),
        );
      }

      const existing = await prisma.reminder.count({
        where: { userId: interaction.user.id, fired: false },
      });
      if (existing >= MAX_PER_USER) {
        throw new UserFacingError(
          await t(interaction.guildId, "reminders.limit", {
            limit: MAX_PER_USER,
          }),
        );
      }

      await ensureUser(interaction.user.id, interaction.user.username);

      const remindAt = new Date(Date.now() + ms);
      const r = await prisma.reminder.create({
        data: {
          userId: interaction.user.id,
          guildId: wantsDm ? null : (interaction.guildId ?? null),
          channelId: wantsDm ? null : (interaction.channelId ?? null),
          message: text,
          remindAt,
        },
      });

      const where = wantsDm
        ? await t(interaction.guildId, "reminders.target_dm")
        : await t(interaction.guildId, "reminders.target_channel", {
            channelId: interaction.channelId!,
          });

      await interaction.reply({
        embeds: [
          successEmbed(
            await t(interaction.guildId, "reminders.created_title"),
            await t(interaction.guildId, "reminders.created_body", {
              in: humanizeDuration(ms),
              where,
              id: r.id.slice(-6),
              ts: Math.floor(remindAt.getTime() / 1000),
            }),
          ),
        ],
        ephemeral: true,
      });
    });
  },
};

const list: SlashCommand = {
  category: "general",
  data: new SlashCommandBuilder()
    .setName("reminders")
    .setDescription("Show your active reminders."),
  async execute(interaction) {
    await reply(interaction, async () => {
      const rows = await prisma.reminder.findMany({
        where: { userId: interaction.user.id, fired: false },
        orderBy: { remindAt: "asc" },
        take: 25,
      });
      if (!rows.length) {
        await interaction.reply({
          embeds: [
            infoEmbed(
              await t(interaction.guildId, "reminders.title"),
              await t(interaction.guildId, "reminders.empty"),
            ),
          ],
          ephemeral: true,
        });
        return;
      }
      const lines = rows
        .map((r) => {
          const ts = Math.floor(r.remindAt.getTime() / 1000);
          const target = r.channelId ? `<#${r.channelId}>` : "DM";
          return `\`${r.id.slice(-6)}\` · <t:${ts}:R> · ${target}\n> ${truncate(r.message, 100)}`;
        })
        .join("\n\n");
      await interaction.reply({
        embeds: [
          infoEmbed(await t(interaction.guildId, "reminders.title"), lines),
        ],
        ephemeral: true,
      });
    });
  },
};

const cancel: SlashCommand = {
  category: "general",
  data: new SlashCommandBuilder()
    .setName("reminder-cancel")
    .setDescription("Cancel one of your reminders by its short ID.")
    .addStringOption((o) =>
      o
        .setName("id")
        .setDescription("Short id from /reminders (last 6 chars)")
        .setRequired(true),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const short = interaction.options.getString("id", true).trim();
      const rows = await prisma.reminder.findMany({
        where: { userId: interaction.user.id, fired: false },
      });
      const match = rows.find((r) => r.id.endsWith(short));
      if (!match) {
        throw new UserFacingError(
          await t(interaction.guildId, "reminders.not_found"),
        );
      }
      await prisma.reminder.delete({ where: { id: match.id } });
      await interaction.reply({
        embeds: [
          successEmbed(
            await t(interaction.guildId, "reminders.title"),
            await t(interaction.guildId, "reminders.cancelled", {
              id: match.id.slice(-6),
            }),
          ),
        ],
        ephemeral: true,
      });
    });
  },
};

export const commands = [remind, list, cancel];
