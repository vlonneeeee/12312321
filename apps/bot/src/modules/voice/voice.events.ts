import { Events, type VoiceState } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { redis } from "@core/cache/redis";
import { prisma } from "@core/db/prisma";
import { ensureMember } from "@shared/utils/ensure";
import { child } from "@core/logger/logger";

const log = child("voice");

/**
 * Voice tracking strategy:
 *   - On channel join: start a Redis hash with startedAt + channelId.
 *   - On channel leave / move: close out the session, write VoiceSession row.
 *   - The voice-xp-flush job grants XP on a recurring interval so users get XP
 *     while still in voice without us writing on every state event.
 */
export const event = defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(oldState: VoiceState, newState: VoiceState) {
    const guildId = (newState.guild ?? oldState.guild).id;
    const userId = newState.id;
    if (!userId) return;
    if (newState.member) await ensureMember(newState.member);

    const enabled = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { voiceXpEnabled: true },
    });
    if (!enabled?.voiceXpEnabled) return;

    const key = `voice:active:${guildId}:${userId}`;

    const leftChannel = oldState.channelId && oldState.channelId !== newState.channelId;
    const joinedChannel = newState.channelId && oldState.channelId !== newState.channelId;

    if (leftChannel) {
      const data = await redis.hgetall(key);
      if (data.startedAt && data.channelId) {
        const started = Number(data.startedAt);
        const durationSec = Math.floor((Date.now() - started) / 1000);
        try {
          await prisma.voiceSession.create({
            data: {
              guildId,
              userId,
              channelId: data.channelId,
              startedAt: new Date(started),
              endedAt: new Date(),
              durationSec,
              xpAwarded: 0, // awarded by flush job
            },
          });
        } catch (err) {
          log.warn({ err }, "failed to write voice session");
        }
      }
      await redis.del(key);
    }

    if (joinedChannel && newState.channelId) {
      // skip AFK channel
      const isAfk = newState.guild.afkChannelId === newState.channelId;
      if (isAfk) return;
      await redis.hset(key, {
        guildId,
        userId,
        channelId: newState.channelId,
        startedAt: String(Date.now()),
      });
      await redis.expire(key, 12 * 3600);
    }
  },
});
