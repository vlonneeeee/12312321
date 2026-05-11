import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { withLock } from "@core/locks/distributed-lock";
import { UserFacingError, InsufficientFundsError } from "@core/errors/errors";
import { formatCoins } from "@shared/utils/format";

const BUY_COST = 2000n;
const UPGRADE_BASE = 1000n;
const INCOME_PER_LEVEL_PER_HOUR = 100n;

const buy: SlashCommand = {
  category: "housing",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("house-buy").setDescription("Buy a starter house (2000 coins)."),
  async execute(interaction) {
    try {
      await withLock(`house:${interaction.user.id}`, 4000, async () => {
        const existing = await prisma.housing.findFirst({
          where: { ownerId: interaction.user.id, guildId: interaction.guildId! },
        });
        if (existing) throw new UserFacingError("You already own a house here.");
        const member = await prisma.guildMember.findUnique({
          where: { userId_guildId: { userId: interaction.user.id, guildId: interaction.guildId! } },
        });
        if (!member || member.coins < BUY_COST) throw new InsufficientFundsError();
        await prisma.$transaction([
          prisma.guildMember.update({
            where: { userId_guildId: { userId: interaction.user.id, guildId: interaction.guildId! } },
            data: { coins: { decrement: BUY_COST } },
          }),
          prisma.housing.create({
            data: { ownerId: interaction.user.id, guildId: interaction.guildId!, level: 1 },
          }),
        ]);
      });
      await interaction.reply({ embeds: [successEmbed("House purchased")] });
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed.";
      await interaction.reply({ embeds: [errorEmbed("Housing", msg)], ephemeral: true });
    }
  },
};

const view: SlashCommand = {
  category: "housing",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("house").setDescription("View your house."),
  async execute(interaction) {
    const h = await prisma.housing.findFirst({
      where: { ownerId: interaction.user.id, guildId: interaction.guildId! },
    });
    if (!h) {
      await interaction.reply({ embeds: [infoEmbed("No house", "Buy one with `/house-buy`.")] });
      return;
    }
    const hourly = INCOME_PER_LEVEL_PER_HOUR * BigInt(h.level);
    await interaction.reply({
      embeds: [
        infoEmbed(
          h.name,
          `Level: **${h.level}**\nRooms: **${h.rooms}**\nIncome: **${formatCoins(hourly)} / hr**\nTotal earned: ${formatCoins(h.income)}`,
        ),
      ],
    });
  },
};

const upgrade: SlashCommand = {
  category: "housing",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("house-upgrade").setDescription("Upgrade your house."),
  async execute(interaction) {
    try {
      await withLock(`house:${interaction.user.id}`, 4000, async () => {
        const h = await prisma.housing.findFirst({
          where: { ownerId: interaction.user.id, guildId: interaction.guildId! },
        });
        if (!h) throw new UserFacingError("You don't own a house.");
        const cost = UPGRADE_BASE * BigInt((h.level + 1) ** 2);
        const member = await prisma.guildMember.findUnique({
          where: { userId_guildId: { userId: interaction.user.id, guildId: interaction.guildId! } },
        });
        if (!member || member.coins < cost) throw new InsufficientFundsError();
        await prisma.$transaction([
          prisma.guildMember.update({
            where: { userId_guildId: { userId: interaction.user.id, guildId: interaction.guildId! } },
            data: { coins: { decrement: cost } },
          }),
          prisma.housing.update({
            where: { id: h.id },
            data: { level: { increment: 1 }, rooms: { increment: 1 } },
          }),
        ]);
      });
      await interaction.reply({ embeds: [successEmbed("Upgraded")] });
    } catch (err) {
      const msg = err instanceof UserFacingError ? err.message : "Failed.";
      await interaction.reply({ embeds: [errorEmbed("Housing", msg)], ephemeral: true });
    }
  },
};

export const commands = [buy, view, upgrade];
