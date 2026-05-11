import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} from "discord.js";
import type { ButtonHandler, SlashCommand } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, infoEmbed, successEmbed } from "@shared/embeds/factory";

const create: SlashCommand = {
  category: "polls",
  guildOnly: true,
  data: new SlashCommandBuilder()
    .setName("poll")
    .setDescription("Create a poll.")
    .addStringOption((o) => o.setName("question").setDescription("Question").setRequired(true))
    .addStringOption((o) => o.setName("options").setDescription("Comma-separated options (2-10)").setRequired(true))
    .addBooleanOption((o) => o.setName("multiple").setDescription("Allow multiple selections")),
  async execute(interaction) {
    const question = interaction.options.getString("question", true);
    const raw = interaction.options.getString("options", true);
    const multiple = interaction.options.getBoolean("multiple") ?? false;
    const opts = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (opts.length < 2) {
      await interaction.reply({ embeds: [errorEmbed("Need at least 2 options")], ephemeral: true });
      return;
    }
    const poll = await prisma.poll.create({
      data: {
        guildId: interaction.guildId!,
        channelId: interaction.channelId,
        authorId: interaction.user.id,
        question,
        multiple,
        options: opts.map((label, i) => ({ key: `${i}`, label })),
      },
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...opts.slice(0, 5).map((label, i) =>
        new ButtonBuilder().setCustomId(`poll:vote:${poll.id}:${i}`).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Primary),
      ),
    );
    const components = [row];
    if (opts.length > 5) {
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          ...opts.slice(5).map((label, i) =>
            new ButtonBuilder().setCustomId(`poll:vote:${poll.id}:${i + 5}`).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Primary),
          ),
        ),
      );
    }
    const message = await interaction.reply({
      embeds: [infoEmbed(`Poll: ${question}`, opts.map((o, i) => `**${i + 1}.** ${o}`).join("\n"))],
      components,
      fetchReply: true,
    });
    await prisma.poll.update({ where: { id: poll.id }, data: { messageId: message.id } });
  },
};

const vote: ButtonHandler = {
  customId: "poll:vote",
  async execute(interaction, params) {
    const [pollId, optKey] = params;
    if (!pollId || !optKey) return;
    const poll = await prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll || poll.closed) {
      await interaction.reply({ embeds: [errorEmbed("Poll closed.")], ephemeral: true });
      return;
    }
    if (!poll.multiple) {
      await prisma.pollVote.deleteMany({ where: { pollId, userId: interaction.user.id } });
    }
    try {
      await prisma.pollVote.create({
        data: { pollId, userId: interaction.user.id, option: optKey },
      });
      await interaction.reply({ embeds: [successEmbed("Vote recorded")], ephemeral: true });
    } catch {
      await interaction.reply({ embeds: [errorEmbed("Already voted")], ephemeral: true });
    }
  },
};

export const commands = [create];
export const button = vote;
