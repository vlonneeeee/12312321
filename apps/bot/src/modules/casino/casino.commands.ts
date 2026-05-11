import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { economyService } from "../economy/economy.service";
import { successEmbed, errorEmbed, infoEmbed } from "@shared/embeds/factory";
import { UserFacingError } from "@core/errors/errors";
import { prisma } from "@core/db/prisma";
import { withLock } from "@core/locks/distributed-lock";
import { formatCoins } from "@shared/utils/format";

async function reply(interaction: import("discord.js").ChatInputCommandInteraction, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const msg = err instanceof UserFacingError ? err.message : "Something went wrong.";
    if (interaction.replied || interaction.deferred) await interaction.editReply({ embeds: [errorEmbed("Casino", msg)] });
    else await interaction.reply({ embeds: [errorEmbed("Casino", msg)], ephemeral: true });
  }
}

async function debitBet(userId: string, guildId: string, amount: bigint) {
  const m = await prisma.guildMember.findUnique({
    where: { userId_guildId: { userId, guildId } },
  });
  if (!m || m.coins < amount) throw new UserFacingError("Not enough coins.");
  await prisma.guildMember.update({
    where: { userId_guildId: { userId, guildId } },
    data: { coins: { decrement: amount } },
  });
}

async function creditWin(userId: string, guildId: string, amount: bigint, type: "GAMBLE_WIN" | "GAMBLE_LOSS") {
  await prisma.$transaction([
    prisma.guildMember.update({
      where: { userId_guildId: { userId, guildId } },
      data: { coins: { increment: amount } },
    }),
    prisma.transaction.create({
      data: { userId, guildId, type, amount, balance: 0n },
    }),
  ]);
}

const slots: SlashCommand = {
  category: "casino",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Play slots.")
    .addIntegerOption((o) => o.setName("bet").setDescription("Bet").setMinValue(10).setMaxValue(10_000).setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const bet = BigInt(interaction.options.getInteger("bet", true));
      await withLock(`casino:${interaction.user.id}`, 4000, async () => {
        await economyService.getBalance(interaction.user.id, interaction.guildId!); // ensure registered
        await debitBet(interaction.user.id, interaction.guildId!, bet);
        const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
        const r = () => symbols[Math.floor(Math.random() * symbols.length)]!;
        const a = r(), b = r(), c = r();
        let mult = 0;
        if (a === b && b === c) mult = a === "💎" ? 10 : a === "7️⃣" ? 7 : 4;
        else if (a === b || b === c) mult = 1;
        const payout = bet * BigInt(mult);
        const net = payout - bet;
        if (payout > 0n) {
          await creditWin(interaction.user.id, interaction.guildId!, payout, "GAMBLE_WIN");
        } else {
          await creditWin(interaction.user.id, interaction.guildId!, 0n, "GAMBLE_LOSS");
        }
        await interaction.reply({
          embeds: [
            (net >= 0n ? successEmbed : errorEmbed)(
              `${a} ${b} ${c}`,
              net >= 0n ? `You won **${formatCoins(net)}**` : `You lost **${formatCoins(-net)}**`,
            ),
          ],
        });
      });
    });
  },
};

const coinflip: SlashCommand = {
  category: "casino",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Flip a coin.")
    .addIntegerOption((o) => o.setName("bet").setDescription("Bet").setMinValue(10).setMaxValue(50_000).setRequired(true))
    .addStringOption((o) =>
      o.setName("side").setDescription("Heads/Tails").addChoices({ name: "Heads", value: "h" }, { name: "Tails", value: "t" }).setRequired(true),
    ),
  async execute(interaction) {
    await reply(interaction, async () => {
      const bet = BigInt(interaction.options.getInteger("bet", true));
      const side = interaction.options.getString("side", true);
      await withLock(`casino:${interaction.user.id}`, 4000, async () => {
        await debitBet(interaction.user.id, interaction.guildId!, bet);
        const result = Math.random() < 0.5 ? "h" : "t";
        const won = result === side;
        if (won) await creditWin(interaction.user.id, interaction.guildId!, bet * 2n, "GAMBLE_WIN");
        else await creditWin(interaction.user.id, interaction.guildId!, 0n, "GAMBLE_LOSS");
        await interaction.reply({
          embeds: [
            (won ? successEmbed : errorEmbed)(
              `${result === "h" ? "🪙 Heads" : "🪙 Tails"}`,
              won ? `+${formatCoins(bet)}` : `-${formatCoins(bet)}`,
            ),
          ],
        });
      });
    });
  },
};

const blackjack: SlashCommand = {
  category: "casino",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Auto-played blackjack (simplified).")
    .addIntegerOption((o) => o.setName("bet").setDescription("Bet").setMinValue(50).setMaxValue(20_000).setRequired(true)),
  async execute(interaction) {
    await reply(interaction, async () => {
      const bet = BigInt(interaction.options.getInteger("bet", true));
      const draw = () => Math.floor(Math.random() * 11) + 1;
      const player = [draw(), draw()];
      const dealer = [draw(), draw()];
      while (sum(player) < 17) player.push(draw());
      while (sum(dealer) < 17) dealer.push(draw());
      const ps = sum(player), ds = sum(dealer);
      let payout = 0n;
      const result =
        ps > 21 ? "bust" : ds > 21 ? "win" : ps > ds ? "win" : ps < ds ? "lose" : "push";
      if (result === "win") payout = bet * 2n;
      else if (result === "push") payout = bet;
      await withLock(`casino:${interaction.user.id}`, 4000, async () => {
        await debitBet(interaction.user.id, interaction.guildId!, bet);
        if (payout > 0n) await creditWin(interaction.user.id, interaction.guildId!, payout, "GAMBLE_WIN");
        else await creditWin(interaction.user.id, interaction.guildId!, 0n, "GAMBLE_LOSS");
      });
      const ok = result === "win";
      await interaction.reply({
        embeds: [
          (ok ? successEmbed : result === "push" ? infoEmbed : errorEmbed)(
            `You: ${ps} (${player.join("+")}) — Dealer: ${ds} (${dealer.join("+")})`,
            result.toUpperCase(),
          ),
        ],
      });
    });
  },
};

function sum(cards: number[]) {
  return cards.reduce((a, b) => a + b, 0);
}

export const commands = [slots, coinflip, blackjack];
