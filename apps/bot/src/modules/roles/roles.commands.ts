import { PermissionsBitField, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";

const reactionRoleAdd: SlashCommand = {
  category: "roles",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageRoles],
  data: new SlashCommandBuilder()
    .setName("rr-add")
    .setDescription("Bind an emoji on a message to a role.")
    .addStringOption((o) => o.setName("message_id").setDescription("Message id").setRequired(true))
    .addStringOption((o) => o.setName("emoji").setDescription("Emoji or unicode").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role to grant").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("mode")
        .setDescription("Behavior")
        .addChoices(
          { name: "Toggle", value: "toggle" },
          { name: "Add only", value: "add" },
          { name: "Remove on react", value: "remove" },
        ),
    ),
  async execute(interaction) {
    try {
      const messageId = interaction.options.getString("message_id", true);
      const emoji = interaction.options.getString("emoji", true);
      const role = interaction.options.getRole("role", true);
      const mode = (interaction.options.getString("mode") as "toggle" | "add" | "remove" | null) ?? "toggle";
      await prisma.reactionRole.create({
        data: {
          guildId: interaction.guildId!,
          channelId: interaction.channelId,
          messageId,
          emoji,
          roleId: role.id,
          mode,
        },
      });
      await interaction.reply({ embeds: [successEmbed("Reaction role bound")], ephemeral: true });
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed to add reaction role.";
      await interaction.reply({ embeds: [errorEmbed("Roles", msg)], ephemeral: true });
    }
  },
};

const levelRewardAdd: SlashCommand = {
  category: "roles",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageRoles],
  data: new SlashCommandBuilder()
    .setName("level-reward")
    .setDescription("Assign a role automatically at a given level.")
    .addIntegerOption((o) => o.setName("level").setDescription("Level").setMinValue(1).setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  async execute(interaction) {
    const level = interaction.options.getInteger("level", true);
    const role = interaction.options.getRole("role", true);
    await prisma.levelReward.upsert({
      where: { guildId_level: { guildId: interaction.guildId!, level } },
      create: { guildId: interaction.guildId!, level, roleId: role.id },
      update: { roleId: role.id },
    });
    await interaction.reply({ embeds: [successEmbed("Level reward saved")], ephemeral: true });
  },
};

const tempRole: SlashCommand = {
  category: "roles",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageRoles],
  data: new SlashCommandBuilder()
    .setName("temprole")
    .setDescription("Give a user a role that auto-expires.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true))
    .addIntegerOption((o) => o.setName("hours").setDescription("Hours").setMinValue(1).setMaxValue(24 * 365).setRequired(true)),
  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    const role = interaction.options.getRole("role", true);
    const hours = interaction.options.getInteger("hours", true);
    const expiresAt = new Date(Date.now() + hours * 3600_000);
    const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ embeds: [errorEmbed("Not in this server")], ephemeral: true });
      return;
    }
    await member.roles.add(role.id, `Temp role for ${hours}h`).catch(() => null);
    await prisma.temporaryRole.upsert({
      where: { guildId_userId_roleId: { guildId: interaction.guildId!, userId: user.id, roleId: role.id } },
      create: { guildId: interaction.guildId!, userId: user.id, roleId: role.id, expiresAt },
      update: { expiresAt },
    });
    await interaction.reply({
      embeds: [successEmbed("Temp role granted", `Until <t:${Math.floor(expiresAt.getTime() / 1000)}:F>`)],
    });
  },
};

export const commands = [reactionRoleAdd, levelRewardAdd, tempRole];
