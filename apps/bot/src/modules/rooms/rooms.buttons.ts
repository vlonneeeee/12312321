import {
  ActionRowBuilder,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { ButtonHandler, ModalHandler } from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { errorEmbed, successEmbed } from "@shared/embeds/factory";

async function assertOwner(channelId: string, userId: string) {
  const room = await prisma.privateRoom.findUnique({ where: { voiceChannelId: channelId } });
  if (!room) return null;
  if (room.ownerId !== userId) return null;
  return room;
}

const lock: ButtonHandler = {
  customId: "room:lock",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const room = await assertOwner(channelId, interaction.user.id);
    if (!room) {
      await interaction.reply({ embeds: [errorEmbed("You don't own this room.")], ephemeral: true });
      return;
    }
    const channel = await interaction.guild!.channels.fetch(channelId).catch(() => null);
    if (!channel?.isVoiceBased()) return;
    const everyone = interaction.guild!.roles.everyone;
    const newLocked = !room.isLocked;
    await channel.permissionOverwrites.edit(everyone, {
      Connect: newLocked ? false : null,
    });
    await prisma.privateRoom.update({ where: { voiceChannelId: channelId }, data: { isLocked: newLocked } });
    await interaction.reply({ embeds: [successEmbed(newLocked ? "Locked" : "Unlocked")], ephemeral: true });
  },
};

const hide: ButtonHandler = {
  customId: "room:hide",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const room = await assertOwner(channelId, interaction.user.id);
    if (!room) {
      await interaction.reply({ embeds: [errorEmbed("Not your room.")], ephemeral: true });
      return;
    }
    const channel = await interaction.guild!.channels.fetch(channelId).catch(() => null);
    if (!channel?.isVoiceBased()) return;
    const everyone = interaction.guild!.roles.everyone;
    const newHidden = !room.isHidden;
    await channel.permissionOverwrites.edit(everyone, { ViewChannel: newHidden ? false : null });
    await prisma.privateRoom.update({ where: { voiceChannelId: channelId }, data: { isHidden: newHidden } });
    await interaction.reply({ embeds: [successEmbed(newHidden ? "Hidden" : "Visible")], ephemeral: true });
  },
};

const limitBtn: ButtonHandler = {
  customId: "room:limit",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`room:limit:modal:${channelId}`)
      .setTitle("Set user limit");
    const input = new TextInputBuilder()
      .setCustomId("limit")
      .setLabel("User limit (0 = no limit)")
      .setMinLength(1)
      .setMaxLength(3)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  },
};

const renameBtn: ButtonHandler = {
  customId: "room:rename",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const modal = new ModalBuilder()
      .setCustomId(`room:rename:modal:${channelId}`)
      .setTitle("Rename room");
    const input = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("New name")
      .setMinLength(2)
      .setMaxLength(80)
      .setRequired(true)
      .setStyle(TextInputStyle.Short);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  },
};

const closeBtn: ButtonHandler = {
  customId: "room:close",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const room = await assertOwner(channelId, interaction.user.id);
    if (!room) {
      await interaction.reply({ embeds: [errorEmbed("Not your room.")], ephemeral: true });
      return;
    }
    const voice = await interaction.guild!.channels.fetch(channelId).catch(() => null);
    await voice?.delete("Closed by owner").catch(() => null);
    if (room.textChannelId) {
      const text = await interaction.guild!.channels.fetch(room.textChannelId).catch(() => null);
      await text?.delete("Closed by owner").catch(() => null);
    }
    await prisma.privateRoom.delete({ where: { id: room.id } }).catch(() => null);
    await interaction.reply({ embeds: [successEmbed("Room closed")], ephemeral: true }).catch(() => null);
  },
};

const limitModal: ModalHandler = {
  customId: "room:limit:modal",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const room = await assertOwner(channelId, interaction.user.id);
    if (!room) {
      await interaction.reply({ embeds: [errorEmbed("Not your room.")], ephemeral: true });
      return;
    }
    const limit = Math.max(0, Math.min(99, Number(interaction.fields.getTextInputValue("limit"))));
    const channel = await interaction.guild!.channels.fetch(channelId).catch(() => null);
    if (channel?.isVoiceBased()) await channel.setUserLimit(limit);
    await prisma.privateRoom.update({ where: { voiceChannelId: channelId }, data: { userLimit: limit } });
    await interaction.reply({ embeds: [successEmbed(`Limit → ${limit}`)], ephemeral: true });
  },
};

const renameModal: ModalHandler = {
  customId: "room:rename:modal",
  async execute(interaction, params) {
    const channelId = params[0]!;
    const room = await assertOwner(channelId, interaction.user.id);
    if (!room) {
      await interaction.reply({ embeds: [errorEmbed("Not your room.")], ephemeral: true });
      return;
    }
    const name = interaction.fields.getTextInputValue("name").slice(0, 80);
    const channel = await interaction.guild!.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.setName(name);
    if (room.textChannelId) {
      const text = await interaction.guild!.channels.fetch(room.textChannelId).catch(() => null);
      if (text) await text.setName(`${name}-chat`);
    }
    await prisma.privateRoom.update({ where: { voiceChannelId: channelId }, data: { name } });
    await interaction.reply({ embeds: [successEmbed(`Renamed → ${name}`)], ephemeral: true });
  },
};

export const buttons: ButtonHandler[] = [lock, hide, limitBtn, renameBtn, closeBtn];
export const modals: ModalHandler[] = [limitModal, renameModal];
void PermissionsBitField;
