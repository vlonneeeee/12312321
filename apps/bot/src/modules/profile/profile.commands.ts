import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { infoEmbed, successEmbed, errorEmbed } from "@shared/embeds/factory";
import { formatNumber } from "@shared/utils/format";

const view: SlashCommand = {
  category: "profile",
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show a user's global profile.")
    .addUserOption((o) => o.setName("user").setDescription("User")),
  async execute(interaction) {
    const user = interaction.options.getUser("user") ?? interaction.user;
    const data = await prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true, cosmetics: { include: { cosmetic: true } } },
    });
    if (!data) {
      await interaction.reply({ embeds: [errorEmbed("No profile yet")], ephemeral: true });
      return;
    }
    const equipped = data.cosmetics.filter((c) => c.equipped);
    const equippedDescription = equipped.length
      ? equipped.map((c) => `${c.cosmetic.kind}: **${c.cosmetic.name}** (${c.cosmetic.rarity})`).join("\n")
      : "_No cosmetics equipped._";
    const embed = infoEmbed(
      `${user.username}'s profile`,
      [
        `**Level:** ${data.level}`,
        `**XP:** ${formatNumber(data.xp)}`,
        `**Coins:** ${formatNumber(data.globalBalance)}`,
        `**Reputation:** ${data.reputation}`,
        `**Prestige:** ${data.prestige}`,
        "",
        data.profile?.bio ? `> ${data.profile.bio}` : "",
        "",
        equippedDescription,
      ].join("\n"),
    );
    if (data.profile?.bannerUrl) embed.setImage(data.profile.bannerUrl);
    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
    await interaction.reply({ embeds: [embed] });
  },
};

const setBio: SlashCommand = {
  category: "profile",
  data: new SlashCommandBuilder()
    .setName("bio")
    .setDescription("Set your profile bio.")
    .addStringOption((o) => o.setName("text").setDescription("Bio (max 500 chars)").setRequired(true)),
  async execute(interaction) {
    const bio = interaction.options.getString("text", true).slice(0, 500);
    await prisma.profile.upsert({
      where: { userId: interaction.user.id },
      create: { userId: interaction.user.id, bio },
      update: { bio },
    });
    await interaction.reply({ embeds: [successEmbed("Bio updated")], ephemeral: true });
  },
};

const equip: SlashCommand = {
  category: "profile",
  data: new SlashCommandBuilder()
    .setName("equip")
    .setDescription("Equip a cosmetic from your inventory.")
    .addStringOption((o) => o.setName("cosmetic_id").setDescription("Cosmetic id").setRequired(true)),
  async execute(interaction) {
    const id = interaction.options.getString("cosmetic_id", true);
    const owned = await prisma.ownedCosmetic.findUnique({
      where: { userId_cosmeticId: { userId: interaction.user.id, cosmeticId: id } },
      include: { cosmetic: true },
    });
    if (!owned) {
      await interaction.reply({ embeds: [errorEmbed("You don't own that cosmetic.")], ephemeral: true });
      return;
    }
    await prisma.$transaction([
      prisma.ownedCosmetic.updateMany({
        where: { userId: interaction.user.id, cosmetic: { kind: owned.cosmetic.kind } },
        data: { equipped: false },
      }),
      prisma.ownedCosmetic.update({ where: { id: owned.id }, data: { equipped: true } }),
    ]);
    await interaction.reply({ embeds: [successEmbed(`Equipped ${owned.cosmetic.name}`)] });
  },
};

export const commands = [view, setBio, equip];
