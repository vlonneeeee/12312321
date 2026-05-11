import { ActivityType, Events, type Client } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { getLavalink } from "@infra/lavalink/manager";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { infoEmbed } from "@shared/embeds/factory";

const log = child("music:events");

const ready = defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(client: Client) {
    getLavalink(client); // initialize lazily on ready

    const manager = getLavalink(client);
    manager.on("trackStart", async (player, track) => {
      if (!track) return;
      log.info({ guildId: player.guildId, title: track.info.title }, "trackStart");
      await prisma.musicHistoryItem
        .create({
          data: {
            guildId: player.guildId,
            userId: (track.requester as { id?: string } | undefined)?.id ?? "unknown",
            title: track.info.title,
            uri: track.info.uri ?? "",
            source: track.info.sourceName,
            duration: track.info.duration,
          },
        })
        .catch(() => null);
      const channelId = player.textChannelId;
      if (!channelId) return;
      const channel = client.channels.cache.get(channelId);
      if (channel?.isTextBased() && "send" in channel) {
        await channel
          .send({
            embeds: [
              infoEmbed("Now playing", `**${track.info.title}**\n${track.info.author}`).setURL(
                track.info.uri ?? null,
              ),
            ],
          })
          .catch(() => null);
      }
    });

    manager.on("queueEnd", async (player) => {
      const cfg = await prisma.musicQueue
        .findUnique({ where: { guildId: player.guildId } })
        .catch(() => null);
      if (cfg?.is24x7) return;
      // Player auto-destroys after 30s of empty queue (see manager.ts).
    });

    manager.on("trackError", (player, _track, error) => {
      log.error({ guildId: player.guildId, err: error }, "trackError");
    });

    client.user?.setActivity({ name: `Music | ${client.guilds.cache.size} servers`, type: ActivityType.Listening });
  },
});

export const events = [ready];
