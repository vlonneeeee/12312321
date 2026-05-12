import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { ownerEmbed, errorEmbed, successEmbed, infoEmbed } from "@shared/embeds/factory";
import { prisma } from "@core/db/prisma";
import { ensureMember } from "@shared/utils/ensure";
import { child } from "@core/logger/logger";
import { formatNumber } from "@shared/utils/format";

const log = child("owner.economy");

function parseAmount(raw: string): bigint | null {
  if (!/^-?\d{1,18}$/.test(raw)) return null;
  return BigInt(raw);
}

const addMoney: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription:
      "Credit coins to a member. Recorded as an ADMIN transaction. Scope chooses wallet or bank, server-local or global.",
    examples: ["/add-money user:@u amount:1000", "/add-money user:@u amount:5000 scope:global"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("add-money")
    .setDescription("Owner: credit coins to a user.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("amount").setDescription("Amount (integer)").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("scope")
        .setDescription("Where to credit")
        .addChoices(
          { name: "wallet (server)", value: "wallet" },
          { name: "bank (server)", value: "bank" },
          { name: "global wallet", value: "global" },
          { name: "global bank", value: "globalbank" },
        ),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Audit reason")),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const user = interaction.options.getUser("user", true);
      const amount = parseAmount(interaction.options.getString("amount", true));
      if (!amount || amount === 0n) {
        await interaction.reply({
          embeds: [errorEmbed("Bad amount", "Amount must be a non-zero integer.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const scope = interaction.options.getString("scope") ?? "wallet";
      const reason = interaction.options.getString("reason") ?? "OWNER /add-money";
      await applyEconomyChange(interaction.guild.id, user.id, user.username, scope, amount, reason);
      await interaction.reply({
        embeds: [
          ownerEmbed(
            "Coins credited",
            `${user.tag} в†ђ ${formatNumber(amount)} В· scope: \`${scope}\``,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      log.error({ err }, "add-money failed");
      await replyErr(interaction, err);
    }
  },
};

const removeMoney: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Debit coins from a member.",
    examples: ["/remove-money user:@u amount:500"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("remove-money")
    .setDescription("Owner: debit coins from a user.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("amount").setDescription("Amount (positive)").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("scope")
        .setDescription("Where to debit")
        .addChoices(
          { name: "wallet (server)", value: "wallet" },
          { name: "bank (server)", value: "bank" },
          { name: "global wallet", value: "global" },
          { name: "global bank", value: "globalbank" },
        ),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Audit reason")),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const user = interaction.options.getUser("user", true);
      const amount = parseAmount(interaction.options.getString("amount", true));
      if (!amount || amount <= 0n) {
        await interaction.reply({
          embeds: [errorEmbed("Bad amount", "Amount must be a positive integer.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const scope = interaction.options.getString("scope") ?? "wallet";
      const reason = interaction.options.getString("reason") ?? "OWNER /remove-money";
      await applyEconomyChange(interaction.guild.id, user.id, user.username, scope, -amount, reason);
      await interaction.reply({
        embeds: [
          ownerEmbed(
            "Coins debited",
            `${user.tag} в€’ ${formatNumber(amount)} В· scope: \`${scope}\``,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      log.error({ err }, "remove-money failed");
      await replyErr(interaction, err);
    }
  },
};

const setBalance: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Set a user's coin balance to a specific value.",
    examples: ["/set-balance user:@u amount:1000", "/set-balance user:@u amount:0 scope:bank"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("set-balance")
    .setDescription("Owner: overwrite a user's balance.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("amount").setDescription("New balance (>= 0)").setRequired(true))
    .addStringOption((o) =>
      o
        .setName("scope")
        .setDescription("Which balance")
        .addChoices(
          { name: "wallet (server)", value: "wallet" },
          { name: "bank (server)", value: "bank" },
          { name: "global wallet", value: "global" },
          { name: "global bank", value: "globalbank" },
        ),
    ),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      const user = interaction.options.getUser("user", true);
      const amount = parseAmount(interaction.options.getString("amount", true));
      if (amount === null || amount < 0n) {
        await interaction.reply({
          embeds: [errorEmbed("Bad amount", "Amount must be a non-negative integer.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const scope = interaction.options.getString("scope") ?? "wallet";
      await applyEconomySet(interaction.guild.id, user.id, user.username, scope, amount);
      await interaction.reply({
        embeds: [
          ownerEmbed(
            "Balance set",
            `${user.tag} в†’ ${formatNumber(amount)} В· scope: \`${scope}\``,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      log.error({ err }, "set-balance failed");
      await replyErr(interaction, err);
    }
  },
};

const resetEconomy: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Wipe every member's coin balance and bank balance for THIS guild only. Requires confirmation.",
    examples: ["/reset-economy confirm:RESET"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("reset-economy")
    .setDescription("Owner: wipe economy state for this guild.")
    .addStringOption((o) =>
      o
        .setName("confirm")
        .setDescription("Type RESET to confirm")
        .setRequired(true),
    ),
  async execute(interaction) {
    try {
      if (!interaction.guild) return;
      if (interaction.options.getString("confirm", true) !== "RESET") {
        await interaction.reply({
          embeds: [errorEmbed("Confirmation failed", "Pass `confirm:RESET` exactly.")],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await prisma.guildMember.updateMany({
        where: { guildId: interaction.guild.id },
        data: { coins: 0n, bank: 0n, lastDaily: null, lastWeekly: null, lastWork: null, lastCrime: null },
      });
      await interaction.editReply({
        embeds: [successEmbed("Economy reset", `Affected rows: ${r.count}`)],
      });
    } catch (err) {
      log.error({ err }, "reset-economy failed");
      await replyErr(interaction, err);
    }
  },
};

const giveItem: SlashCommand = {
  category: "owner",
  ownerOnly: true,
  guildOnly: true,
  meta: {
    longDescription: "Grant an inventory item to a user. The item must already exist in the ShopItem table.",
    examples: ["/give-item user:@u item_id:itm_abc quantity:1"],
    permissionsLabel: "OWNER",
  },
  data: new SlashCommandBuilder()
    .setName("give-item")
    .setDescription("Owner: give an inventory item to a user.")
    .addUserOption((o) => o.setName("user").setDescription("User").setRequired(true))
    .addStringOption((o) => o.setName("item_id").setDescription("ShopItem id").setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName("quantity")
        .setDescription("How many (default 1)")
        .setMinValue(1)
        .setMaxValue(1000),
    ),
  async execute(interaction) {
    try {
      const user = interaction.options.getUser("user", true);
      const itemId = interaction.options.getString("item_id", true);
      const qty = interaction.options.getInteger("quantity") ?? 1;
      const shopItem = await prisma.shopItem.findUnique({ where: { id: itemId } });
      if (!shopItem) {
        await interaction.reply({
          embeds: [errorEmbed("Unknown item", `No ShopItem with id \`${itemId}\`.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await prisma.user.upsert({
        where: { id: user.id },
        create: { id: user.id, username: user.username },
        update: { username: user.username },
        select: { id: true },
      });
      await prisma.inventoryItem.create({
        data: { userId: user.id, shopItemId: itemId, quantity: qty },
      });
      await interaction.reply({
        embeds: [
          ownerEmbed("Item granted", `${user.tag} в†ђ **${shopItem.name}** Г— ${qty}`),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      log.error({ err }, "give-item failed");
      await replyErr(interaction, err);
    }
  },
};

export const commands: SlashCommand[] = [addMoney, removeMoney, setBalance, resetEconomy, giveItem];

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

async function ensureMemberShallow(guildId: string, userId: string, username: string) {
  await prisma.user.upsert({
    where: { id: userId },
    create: { id: userId, username },
    update: { username },
    select: { id: true },
  });
  await prisma.guildMember.upsert({
    where: { userId_guildId: { userId, guildId } },
    create: { userId, guildId },
    update: {},
    select: { id: true },
  });
}

async function applyEconomyChange(
  guildId: string,
  userId: string,
  username: string,
  scope: string,
  delta: bigint,
  reason: string,
): Promise<void> {
  await ensureMemberShallow(guildId, userId, username);
  if (scope === "wallet" || scope === "bank") {
    const data = scope === "wallet" ? { coins: { increment: delta } } : { bank: { increment: delta } };
    const updated = await prisma.guildMember.update({
      where: { userId_guildId: { userId, guildId } },
      data,
      select: { coins: true, bank: true },
    });
    await prisma.transaction.create({
      data: {
        userId,
        guildId,
        type: "ADMIN",
        amount: delta,
        balance: scope === "wallet" ? updated.coins : updated.bank,
        reason,
      },
    });
  } else {
    const data =
      scope === "global"
        ? { globalBalance: { increment: delta } }
        : { globalBank: { increment: delta } };
    const updated = await prisma.user.update({
      where: { id: userId },
      data,
      select: { globalBalance: true, globalBank: true },
    });
    await prisma.transaction.create({
      data: {
        userId,
        guildId: null,
        type: "ADMIN",
        amount: delta,
        balance: scope === "global" ? updated.globalBalance : updated.globalBank,
        reason,
      },
    });
  }
}

async function applyEconomySet(
  guildId: string,
  userId: string,
  username: string,
  scope: string,
  value: bigint,
): Promise<void> {
  await ensureMemberShallow(guildId, userId, username);
  if (scope === "wallet") {
    await prisma.guildMember.update({
      where: { userId_guildId: { userId, guildId } },
      data: { coins: value },
    });
  } else if (scope === "bank") {
    await prisma.guildMember.update({
      where: { userId_guildId: { userId, guildId } },
      data: { bank: value },
    });
  } else if (scope === "global") {
    await prisma.user.update({ where: { id: userId }, data: { globalBalance: value } });
  } else {
    await prisma.user.update({ where: { id: userId }, data: { globalBank: value } });
  }
  await prisma.transaction.create({
    data: {
      userId,
      guildId: scope === "wallet" || scope === "bank" ? guildId : null,
      type: "ADMIN",
      amount: 0n,
      balance: value,
      reason: `OWNER /set-balance В· ${scope}`,
    },
  });
}

async function replyErr(interaction: import("discord.js").ChatInputCommandInteraction, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const payload = {
    embeds: [errorEmbed("Operation failed", msg)],
    flags: MessageFlags.Ephemeral,
  } as const;
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => null);
  } else {
    await interaction.reply(payload).catch(() => null);
  }
}

// Re-export to satisfy linter (used in case future modules need ensureMember from this file)
export { ensureMember, infoEmbed };
