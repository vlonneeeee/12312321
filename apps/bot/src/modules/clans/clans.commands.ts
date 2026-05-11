import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { clanService } from "./clans.service";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { prisma } from "@core/db/prisma";
import { formatCoins } from "@shared/utils/format";

async function reply(interaction: import("discord.js").ChatInputCommandInteraction, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof UserFacingError ? err.message : "Something went wrong.";
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Clans", msg)] });
    else await interaction.reply({ embeds: [errorEmbed("Clans", msg)], ephemeral: true });
  }
}

const create: SlashCommand = {
  category: "clans",
  data: new SlashCommandBuilder()
    .setName("clan-create")
    .setDescription("Create a clan (cost: 5000 global coins).")
    .addStringOption((o) => o.setName("name").setDescription("Name").setRequired(true))
    .addStringOption((o) => o.setName("tag").setDescription("Short tag (2-5 chars)").setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const name = interaction.options.getString("name", true);
      const tag = interaction.options.getString("tag", true);
      const clan = await clanService.create(interaction.user.id, name, tag, interaction.guildId ?? undefined);
      await interaction.reply({ embeds: [successEmbed("Clan founded", `**[${clan.tag}]** ${clan.name}`)] });
    });
  },
};

const leave: SlashCommand = {
  category: "clans",
  data: new SlashCommandBuilder().setName("clan-leave").setDescription("Leave your clan."),
  async execute(interaction) {
    await reply(interaction, async () => {
      await clanService.leave(interaction.user.id);
      await interaction.reply({ embeds: [successEmbed("You left your clan.")] });
    });
  },
};

const info: SlashCommand = {
  category: "clans",
  data: new SlashCommandBuilder()
    .setName("clan")
    .setDescription("Show clan info.")
    .addStringOption((o) => o.setName("tag").setDescription("Clan tag")),
  async execute(interaction) {
    await reply(interaction, async () => {
      const tagOrSelf = interaction.options.getString("tag");
      let clan;
      if (tagOrSelf) {
        clan = await prisma.clan.findUnique({ where: { tag: tagOrSelf.toUpperCase() }, include: { members: true } });
      } else {
        const member = await prisma.clanMember.findUnique({ where: { userId: interaction.user.id } });
        if (!member) throw new UserFacingError("You're not in a clan.");
        clan = await prisma.clan.findUnique({ where: { id: member.clanId }, include: { members: true } });
      }
      if (!clan) throw new UserFacingError("Clan not found.");
      await interaction.reply({
        embeds: [
          infoEmbed(
            `[${clan.tag}] ${clan.name}`,
            `Level: **${clan.level}**\nTreasury: **${formatCoins(clan.treasury)}**\nMembers: **${clan.members.length} / ${clan.maxMembers}**\nOwner: <@${clan.ownerId}>`,
          ),
        ],
      });
    });
  },
};

const deposit: SlashCommand = {
  category: "clans",
  data: new SlashCommandBuilder()
    .setName("clan-deposit")
    .setDescription("Deposit coins to clan treasury.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const amt = BigInt(interaction.options.getInteger("amount", true));
      await clanService.deposit(interaction.user.id, amt);
      await interaction.reply({ embeds: [successEmbed("Deposited", formatCoins(amt))] });
    });
  },
};

const upgrade: SlashCommand = {
  category: "clans",
  data: new SlashCommandBuilder()
    .setName("clan-upgrade")
    .setDescription("Buy a clan upgrade.")
    .addStringOption((o) =>
      o
        .setName("key")
        .setDescription("Upgrade")
        .setRequired(true)
        .addChoices(
          { name: "Treasury cap", value: "treasury" },
          { name: "Member cap", value: "members" },
          { name: "Income boost", value: "income" },
        ),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const key = interaction.options.getString("key", true);
      const lvl = await clanService.upgrade(interaction.user.id, key);
      await interaction.reply({ embeds: [successEmbed(`Upgrade purchased`, `${key} → lvl ${lvl}`)] });
    });
  },
};

export const commands = [create, leave, info, deposit, upgrade];
