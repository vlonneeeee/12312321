import {
  ChannelType,
  Events,
  PermissionsBitField,
  type VoiceState,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { infoEmbed } from "@shared/embeds/factory";
import { child } from "@core/logger/logger";
import { withLock } from "@core/locks/distributed-lock";

const log = child("rooms");

export const event = defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(oldState: VoiceState, newState: VoiceState) {
    const member = newState.member;
    if (!member) return;
    const guild = newState.guild;
    const cfg = await prisma.roomConfig.findUnique({ where: { guildId: guild.id } });
    if (!cfg) return;

    if (newState.channelId === cfg.hubChannelId && oldState.channelId !== cfg.hubChannelId) {
      try {
        await withLock(`rooms:${guild.id}:${member.id}`, 5000, async () => {
          const existing = await prisma.privateRoom.findFirst({
            where: { guildId: guild.id, ownerId: member.id },
          });
          if (existing) {
            await member.voice.setChannel(existing.voiceChannelId).catch(() => null);
            return;
          }
          const name = cfg.defaultName.replace(/{username}/g, member.user.username);
          const voice = await guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: cfg.parentCategoryId ?? undefined,
            userLimit: cfg.defaultLimit,
            permissionOverwrites: [
              {
                id: member.id,
                allow: [
                  PermissionsBitField.Flags.ManageChannels,
                  PermissionsBitField.Flags.MoveMembers,
                  PermissionsBitField.Flags.MuteMembers,
                  PermissionsBitField.Flags.DeafenMembers,
                  PermissionsBitField.Flags.Connect,
                ],
              },
            ],
          });
          const text = await guild.channels.create({
            name: `${name}-chat`,
            type: ChannelType.GuildText,
            parent: cfg.parentCategoryId ?? undefined,
            permissionOverwrites: [
              { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
              {
                id: member.id,
                allow: [
                  PermissionsBitField.Flags.ViewChannel,
                  PermissionsBitField.Flags.SendMessages,
                  PermissionsBitField.Flags.ManageChannels,
                  PermissionsBitField.Flags.ManageMessages,
                ],
              },
            ],
          });

          await prisma.privateRoom.create({
            data: {
              guildId: guild.id,
              ownerId: member.id,
              voiceChannelId: voice.id,
              textChannelId: text.id,
              name,
              userLimit: cfg.defaultLimit,
            },
          });

          await member.voice.setChannel(voice.id).catch(() => null);

          const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`room:lock:${voice.id}`).setStyle(ButtonStyle.Secondary).setLabel("🔒 Lock"),
            new ButtonBuilder().setCustomId(`room:hide:${voice.id}`).setStyle(ButtonStyle.Secondary).setLabel("🕶 Hide"),
            new ButtonBuilder().setCustomId(`room:limit:${voice.id}`).setStyle(ButtonStyle.Secondary).setLabel("👥 Limit"),
            new ButtonBuilder().setCustomId(`room:rename:${voice.id}`).setStyle(ButtonStyle.Secondary).setLabel("✏ Rename"),
            new ButtonBuilder().setCustomId(`room:close:${voice.id}`).setStyle(ButtonStyle.Danger).setLabel("✖ Close"),
          );
          await text.send({
            content: `<@${member.id}>`,
            embeds: [
              infoEmbed(
                "Your room",
                "Use the buttons below to manage your room. The room will auto-close when empty.",
              ),
            ],
            components: [controls],
          });
        });
      } catch (err) {
        log.warn({ err }, "room creation failed");
      }
    }
  },
});
