import type { Client } from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { eventBus } from "@core/events/event-bus";

const log = child("jobs:rooms");

export async function runRoomCleanup(client: Client): Promise<void> {
  const rooms = await prisma.privateRoom.findMany({ take: 500 });
  for (const room of rooms) {
    const guild = client.guilds.cache.get(room.guildId);
    if (!guild) continue;
    const voice = guild.channels.cache.get(room.voiceChannelId);
    if (!voice || !voice.isVoiceBased()) {
      await deleteRoom(room.id, room.guildId);
      continue;
    }
    if (voice.members.size === 0) {
      await voice.delete("Room empty").catch(() => null);
      if (room.textChannelId) {
        const text = await guild.channels.fetch(room.textChannelId).catch(() => null);
        if (text) await text.delete("Room empty").catch(() => null);
      }
      await deleteRoom(room.id, room.guildId);
    }
  }
  void log;
}

async function deleteRoom(id: string, guildId: string) {
  await prisma.privateRoom.delete({ where: { id } }).catch(() => null);
  eventBus.emit("room.deleted", { roomId: id, guildId });
}
