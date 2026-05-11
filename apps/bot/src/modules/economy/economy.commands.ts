import { SlashCommandBuilder } from "discord.js";
import { economyService } from "./economy.service";
import type { SlashCommand } from "@core/handler/command";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";
import { ensureMember } from "@shared/utils/ensure";
import { formatCoins, formatNumber } from "@shared/utils/format";
import { UserFacingError } from "@core/errors/errors";

async function reply(interaction: import("discord.js").ChatInputCommandInteraction, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof UserFacingError ? err.message : "Something went wrong.";
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Economy", msg)] });
    else await interaction.reply({ embeds: [errorEmbed("Economy", msg)], ephemeral: true });
  }
}

const balance: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your balance.")
    .addUserOption((o) => o.setName("user").setDescription("Whose balance to check")),
  async execute(interaction) {
    await reply(interaction, async () => {
      const user = interaction.options.getUser("user") ?? interaction.user;
      const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
      if (member) await ensureMember(member);
      const bal = await economyService.getBalance(user.id, interaction.guildId!);
      await interaction.reply({
        embeds: [
          infoEmbed(
            `${user.username}'s wallet`,
            `**Wallet:** ${formatCoins(bal.wallet)}\n**Bank:** ${formatCoins(bal.bank)}\n**Global wallet:** ${formatCoins(bal.globalWallet)}`,
          ),
        ],
      });
    });
  },
};

const daily: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("daily").setDescription("Claim daily reward."),
  async execute(interaction) {
    await reply(interaction, async () => {
      await ensureMember(interaction.member as import("discord.js").GuildMember);
      const earned = await economyService.daily(interaction.user.id, interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Daily claimed", `+${formatCoins(earned)}`)] });
    });
  },
};

const weekly: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("weekly").setDescription("Claim weekly reward."),
  async execute(interaction) {
    await reply(interaction, async () => {
      await ensureMember(interaction.member as import("discord.js").GuildMember);
      const earned = await economyService.weekly(interaction.user.id, interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Weekly claimed", `+${formatCoins(earned)}`)] });
    });
  },
};

const work: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("work").setDescription("Work for coins."),
  async execute(interaction) {
    await reply(interaction, async () => {
      await ensureMember(interaction.member as import("discord.js").GuildMember);
      const earned = await economyService.work(interaction.user.id, interaction.guildId!);
      await interaction.reply({ embeds: [successEmbed("Hard day's work", `You earned **${formatCoins(earned)}**`)] });
    });
  },
};

const crime: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder().setName("crime").setDescription("Commit a crime for risky money."),
  async execute(interaction) {
    await reply(interaction, async () => {
      await ensureMember(interaction.member as import("discord.js").GuildMember);
      const res = await economyService.crime(interaction.user.id, interaction.guildId!);
      if (res.ok) {
        await interaction.reply({ embeds: [successEmbed("Crime success", `+${formatCoins(res.amount)}`)] });
      } else {
        await interaction.reply({ embeds: [errorEmbed("Caught", `Fine: -${formatCoins(res.amount)}`)] });
      }
    });
  },
};

const transfer: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Transfer coins to another user.")
    .addUserOption((o) => o.setName("user").setDescription("Receiver").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const to = interaction.options.getUser("user", true);
      const amount = interaction.options.getInteger("amount", true);
      await economyService.transfer(interaction.user.id, to.id, interaction.guildId!, BigInt(amount));
      await interaction.reply({ embeds: [successEmbed("Transferred", `Sent ${formatCoins(amount)} to ${to}`)] });
    });
  },
};

const deposit: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("deposit")
    .setDescription("Move coins from wallet to bank.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const amount = interaction.options.getInteger("amount", true);
      await economyService.deposit(interaction.user.id, interaction.guildId!, BigInt(amount));
      await interaction.reply({ embeds: [successEmbed("Deposited", formatCoins(amount))] });
    });
  },
};

const withdraw: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Move coins from bank to wallet.")
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const amount = interaction.options.getInteger("amount", true);
      await economyService.withdraw(interaction.user.id, interaction.guildId!, BigInt(amount));
      await interaction.reply({ embeds: [successEmbed("Withdrawn", formatCoins(amount))] });
    });
  },
};

const rob: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("rob")
    .setDescription("Try to rob another user.")
    .addUserOption((o) => o.setName("user").setDescription("Target").setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const target = interaction.options.getUser("user", true);
      const res = await economyService.rob(interaction.user.id, target.id, interaction.guildId!);
      await interaction.reply({
        embeds: res.ok
          ? [successEmbed("Successful heist", `Stole ${formatCoins(res.amount)} from ${target}`)]
          : [errorEmbed("Failed heist", `Lost ${formatCoins(res.amount)} in the chase`)],
      });
    });
  },
};

const leaderboard: SlashCommand = {
  category: "economy",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("rich")
    .setDescription("Show the richest members of this server."),
  async execute(interaction) {
    await reply(interaction, async () => {
      const top = await economyService.leaderboard(interaction.guildId!);
      const lines = top
        .map(
          (m, i) =>
            `**${i + 1}.** <@${m.userId}> — ${formatNumber(m.coins)} 💰 / ${formatNumber(m.bank)} 🏦`,
        )
        .join("\n");
      await interaction.reply({ embeds: [infoEmbed("Richest", lines || "No data yet.")] });
    });
  },
};

export const commands = [balance, daily, weekly, work, crime, transfer, deposit, withdraw, rob, leaderboard];
