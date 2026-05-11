import { redis } from "@core/cache/redis";
import { prisma } from "@core/db/prisma";
import { eventBus } from "@core/events/event-bus";

const XP_PER_MINUTE = 5;

/**
 * Drains the per-user voice timer keys written by the voice tracker and grants
 * XP in batched DB writes. This minimises hot-row contention compared to
 * writing on every voice state change.
 */
export async function runVoiceXpFlush(): Promise<void> {
  const keys = await redis.keys("voice:active:*");
  for (const key of keys) {
    const data = await redis.hgetall(key);
    if (!data.guildId || !data.userId || !data.startedAt) continue;
    const startedAt = Number(data.startedAt);
    const elapsedMin = Math.floor((Date.now() - startedAt) / 60000);
    if (elapsedMin <= 0) continue;
    const xpAward = elapsedMin * XP_PER_MINUTE;

    await prisma.guildMember.update({
      where: { userId_guildId: { userId: data.userId, guildId: data.guildId } },
      data: {
        voiceMinutes: { increment: elapsedMin },
        xp: { increment: BigInt(xpAward) },
      },
    });
    await prisma.user.update({
      where: { id: data.userId },
      data: { xp: { increment: BigInt(xpAward) } },
    });
    await redis.hset(key, "startedAt", String(Date.now()));
    eventBus.emit("xp.gained", {
      userId: data.userId,
      guildId: data.guildId,
      amount: xpAward,
      newLevel: null,
    });
  }
}
