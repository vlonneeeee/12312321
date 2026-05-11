import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionsBitField,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { moderationService } from "./moderation.service";
import type { SlashCommand } from "@core/handler/command";
import { errorEmbed, successEmbed, infoEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";

async function reply(interaction: ChatInputCommandInteraction, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof UserFacingError ? err.message : "Something went wrong.";
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Moderation", msg)] });
    else await interaction.reply({ embeds: [errorEmbed("Moderation", msg)], ephemeral: true });
  }
}

async function fetchTarget(
  interaction: ChatInputCommandInteraction,
  required = true,
): Promise<GuildMember> {
  const user = interaction.options.getUser("user", required);
  if (!user) throw new UserFacingError("No target specified.");
  const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
  if (!member) throw new UserFacingError("Target not in this server.");
  return member;
}

const warn: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = await fetchTarget(interaction);
      const actor = interaction.member as GuildMember;
      const reason = interaction.options.getString("reason") ?? undefined;
      const record = await moderationService.warn(interaction.guild!, subject, actor, reason);
      await interaction.reply({ embeds: [successEmbed(`Warned ${subject.user.tag}`, `Case **${record.id}**`)] });
    });
  },
};

const mute: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Timeout a member.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName("seconds")
        .setDescription("Duration in seconds")
        .setMinValue(1)
        .setMaxValue(28 * 24 * 60 * 60)
        .setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = await fetchTarget(interaction);
      const seconds = interaction.options.getInteger("seconds", true);
      const reason = interaction.options.getString("reason") ?? undefined;
      const actor = interaction.member as GuildMember;
      await moderationService.mute(interaction.guild!, subject, actor, seconds, reason);
      await interaction.reply({ embeds: [successEmbed(`Muted ${subject.user.tag}`, `${seconds}s`)] });
    });
  },
};

const kick: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.KickMembers],
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = await fetchTarget(interaction);
      const reason = interaction.options.getString("reason") ?? undefined;
      const actor = interaction.member as GuildMember;
      await moderationService.kick(interaction.guild!, subject, actor, reason);
      await interaction.reply({ embeds: [successEmbed(`Kicked ${subject.user.tag}`)] });
    });
  },
};

const ban: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.BanMembers],
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason"))
    .addIntegerOption((o) =>
      o
        .setName("delete_days")
        .setDescription("Delete N days of messages (0-7)")
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = await fetchTarget(interaction);
      const reason = interaction.options.getString("reason") ?? undefined;
      const days = interaction.options.getInteger("delete_days") ?? 0;
      const actor = interaction.member as GuildMember;
      await moderationService.ban(interaction.guild!, subject, actor, reason, days * 86_400);
      await interaction.reply({ embeds: [successEmbed(`Banned ${subject.user.tag}`)] });
    });
  },
};

const softban: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.BanMembers],
  data: new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Softban a member (ban+unban, deletes 7d msgs).")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async execute(interaction) {
    await reply(interaction, async () => {
      const subject = await fetchTarget(interaction);
      const reason = interaction.options.getString("reason") ?? undefined;
      const actor = interaction.member as GuildMember;
      await moderationService.softban(interaction.guild!, subject, actor, reason);
      await interaction.reply({ embeds: [successEmbed(`Softbanned ${subject.user.tag}`)] });
    });
  },
};

const purge: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageMessages],
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete messages from this channel.")
    .addIntegerOption((o) =>
      o.setName("count").setDescription("Number of messages (1-100)").setMinValue(1).setMaxValue(100).setRequired(true),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const channel = interaction.channel as TextChannel;
      const count = interaction.options.getInteger("count", true);
      const deleted = await moderationService.purge(channel, count, interaction.member as GuildMember);
      await interaction.reply({ embeds: [successEmbed(`Purged ${deleted} messages`)], ephemeral: true });
    });
  },
};

const cases: SlashCommand = {
  category: "moderation",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName("cases")
    .setDescription("Show moderation history for a user.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const user = interaction.options.getUser("user", true);
      const records = await moderationService.getCases(interaction.guildId!, user.id);
      const lines = records.length
        ? records
            .map(
              (c) =>
                `• \`${c.action}\` — ${c.reason ?? "-"} <t:${Math.floor(c.createdAt.getTime() / 1000)}:R>`,
            )
            .join("\n")
        : "No cases.";
      await interaction.reply({ embeds: [infoEmbed(`Cases for ${user.tag}`, lines)] });
    });
  },
};

export const commands = [warn, mute, kick, ban, softban, purge, cases];
