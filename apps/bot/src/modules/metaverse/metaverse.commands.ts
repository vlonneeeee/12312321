import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { formatCoins } from "@shared/utils/format";
import { withLock } from "@core/locks/distributed-lock";
import { InsufficientFundsError, UserFacingError } from "@core/errors/errors";

const rep: SlashCommand = {
  category: "metaverse",
  data: new SlashCommandBuilder()
    .setName("rep")
    .setDescription("Give 1 reputation to a user (once per 24h).")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)),
  async execute(interaction) {
    const target = interaction.options.getUser("user", true);
    if (target.id === interaction.user.id) {
      await interaction.reply({ embeds: [errorEmbed("Cannot rep yourself")], ephemeral: true });
      return;
    }
    const { redis } = await import("@core/cache/redis");
    const key = `rep:${interaction.user.id}`;
    const ok = await redis.set(key, "1", "EX", 86_400, "NX");
    if (!ok) {
      await interaction.reply({ embeds: [errorEmbed("You've already given rep today.")], ephemeral: true });
      return;
    }
    await prisma.user.update({ where: { id: target.id }, data: { reputation: { increment: 1 } } });
    await interaction.reply({ embeds: [successEmbed(`+1 rep to ${target.username}`)] });
  },
};

const globalProfile: SlashCommand = {
  category: "metaverse",
  data: new SlashCommandBuilder()
    .setName("global")
    .setDescription("Show global cross-server stats.")
    .addUserOption((o) => o.setName("user").setDescription("User")),
  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      include: { _count: { select: { members: true } } },
    });
    if (!u) {
      await interaction.reply({ embeds: [errorEmbed("No data")], ephemeral: true });
      return;
    }
    await interaction.reply({
      embeds: [
        infoEmbed(
          `${user.username} • global`,
          `Servers: **${u._count.members}**\nLevel: **${u.level}**\nXP: **${u.xp}**\nReputation: **${u.reputation}**\nWallet: **${formatCoins(u.globalBalance)}**\nBank: **${formatCoins(u.globalBank)}**`,
        ),
      ],
    });
  },
};

const transferGlobal: SlashCommand = {
  category: "metaverse",
  data: new SlashCommandBuilder()
    .setName("global-pay")
    .setDescription("Transfer global coins to another user.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true)),
  async execute(interaction) {
    const target = interaction.options.getUser("user", true);
    const amount = BigInt(interaction.options.getInteger("amount", true));
    try {
      await withLock(`global:tx:${interaction.user.id}`, 5000, async () => {
        const from = await prisma.user.findUnique({ where: { id: interaction.user.id } });
        if (!from || from.globalBalance < amount) throw new InsufficientFundsError();
        if (target.id === interaction.user.id) throw new UserFacingError("Cannot send to yourself.");
        await prisma.$transaction([
          prisma.user.update({ where: { id: interaction.user.id }, data: { globalBalance: { decrement: amount } } }),
          prisma.user.upsert({
            where: { id: target.id },
            create: { id: target.id, username: target.username, globalBalance: amount },
            update: { globalBalance: { increment: amount } },
          }),
        ]);
      });
      await interaction.reply({ embeds: [successEmbed("Sent", `${formatCoins(amount)} → ${target}`)] });
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed.";
      await interaction.reply({ embeds: [errorEmbed("Transfer", msg)], ephemeral: true });
    }
  },
};

export const commands = [rep, globalProfile, transferGlobal];
