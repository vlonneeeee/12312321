import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import type { ButtonHandler, SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { redis } from "@core/cache/redis";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { randomBytes } from "node:crypto";

const setup: SlashCommand = {
  category: "verification",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("verify-setup")
    .setDescription("Set up verification.")
    .addRoleOption((o) => o.setName("role").setDescription("Role granted on verify").setRequired(true))
    .addChannelOption((o) => o.setName("channel").setDescription("Channel for the verify button").setRequired(true))
    .addStringOption((o) => o.setName("mode").setDescription("Mode").addChoices({ name: "Button", value: "button" }, { name: "Captcha", value: "captcha" })),
  async execute(interaction) {
    const role = interaction.options.getRole("role", true);
    const channel = interaction.options.getChannel("channel", true);
    const mode = (interaction.options.getString("mode") as "button" | "captcha" | null) ?? "button";
    await prisma.verificationConfig.upsert({
      where: { guildId: interaction.guildId! },
      create: {
        guildId: interaction.guildId!,
        enabled: true,
        verifyRoleId: role.id,
        verifyChannelId: channel.id,
        mode,
      },
      update: { enabled: true, verifyRoleId: role.id, verifyChannelId: channel.id, mode },
    });

    const resolved = channel.id
      ? await interaction.guild!.channels.fetch(channel.id).catch(() => null)
      : null;
    if (resolved?.isTextBased() && "send" in resolved) {
      const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("verify:start").setLabel("✓ Verify").setStyle(ButtonStyle.Success),
      );
      await resolved.send({
        embeds: [infoEmbed("Verification required", "Click the button to verify and gain access.")],
        components: [button],
      });
    }
    await interaction.reply({ embeds: [successEmbed("Verification configured")], ephemeral: true });
  },
};

const verifyStart: ButtonHandler = {
  customId: "verify:start",
  async execute(interaction) {
    if (!interaction.inGuild()) return;
    const cfg = await prisma.verificationConfig.findUnique({ where: { guildId: interaction.guildId! } });
    if (!cfg?.enabled || !cfg.verifyRoleId) return;

    const member = interaction.member as import("discord.js").GuildMember;
    const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
    if (accountAgeDays < cfg.minAccountAgeDays) {
      await interaction.reply({
        embeds: [errorEmbed("Account too new", `Account must be at least ${cfg.minAccountAgeDays} days old.`)],
        ephemeral: true,
      });
      return;
    }

    if (cfg.mode === "captcha") {
      const captcha = randomBytes(3).toString("hex").toUpperCase();
      await redis.set(`verify:cap:${interaction.user.id}:${interaction.guildId}`, captcha, "EX", 180);
      await interaction.reply({
        embeds: [
          infoEmbed(
            "Solve to verify",
            `Type this exact code in DM with me within 3 minutes:\n\`\`\`${captcha}\`\`\``,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    await member.roles.add(cfg.verifyRoleId, "Verified").catch(() => null);
    await prisma.guildMember.update({
      where: { userId_guildId: { userId: member.id, guildId: member.guild.id } },
      data: { isVerified: true },
    });
    await interaction.reply({ embeds: [successEmbed("Verified")], ephemeral: true });
  },
};

export const commands = [setup];
export const button = verifyStart;
