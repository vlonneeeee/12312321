import { Events, type Message } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { redis } from "@core/cache/redis";
import { prisma } from "@core/db/prisma";
import { ensureMember } from "@shared/utils/ensure";
import { eventBus } from "@core/events/event-bus";
import { successEmbed } from "@shared/embeds/factory";
import { child } from "@core/logger/logger";

const log = child("levels");

const XP_PER_MESSAGE_MIN = 5;
const XP_PER_MESSAGE_MAX = 15;
const MESSAGE_COOLDOWN_SEC = 60;
const MESSAGE_MIN_LENGTH = 5;

function xpToLevel(level: number) {
  return 5 * level * level + 50 * level + 100;
}

function levelFromXp(xp: bigint): number {
  let lvl = 0;
  let acc = 0n;
  let need = BigInt(xpToLevel(0));
  while (acc + need <= xp) {
    acc += need;
    lvl += 1;
    need = BigInt(xpToLevel(lvl));
  }
  return lvl;
}

export const event = defineEvent({
  name: Events.MessageCreate,
  async execute(message: Message) {
    if (message.author.bot || !message.inGuild()) return;
    if (message.content.length < MESSAGE_MIN_LENGTH) return;

    const cfg = await prisma.guild.findUnique({
      where: { id: message.guildId },
      select: { voiceXpEnabled: true, levelRewards: true },
    });
    if (!cfg) return;

    const key = `xp:cd:${message.guildId}:${message.author.id}`;
    const cd = await redis.set(key, "1", "EX", MESSAGE_COOLDOWN_SEC, "NX");
    if (!cd) return;

    if (!message.member) return;
    await ensureMember(message.member);

    const xpGain =
      XP_PER_MESSAGE_MIN +
      Math.floor(Math.random() * (XP_PER_MESSAGE_MAX - XP_PER_MESSAGE_MIN + 1));

    try {
      const updated = await prisma.guildMember.update({
        where: { userId_guildId: { userId: message.author.id, guildId: message.guildId } },
        data: { xp: { increment: BigInt(xpGain) }, messages: { increment: 1 } },
        select: { xp: true, level: true },
      });
      const newLevel = levelFromXp(updated.xp);
      if (newLevel > updated.level) {
        await prisma.guildMember.update({
          where: { userId_guildId: { userId: message.author.id, guildId: message.guildId } },
          data: { level: newLevel },
        });
        await message
          .channel.send({
            embeds: [
              successEmbed(
                `Level up!`,
                `<@${message.author.id}> reached **level ${newLevel}** ✨`,
              ),
            ],
          })
          .catch(() => null);

        const rewards = await prisma.levelReward.findMany({
          where: { guildId: message.guildId, level: { lte: newLevel } },
        });
        for (const reward of rewards) {
          await message.member.roles.add(reward.roleId, "Level reward").catch(() => null);
        }
        eventBus.emit("xp.gained", {
          userId: message.author.id,
          guildId: message.guildId,
          amount: xpGain,
          newLevel,
        });
      }
    } catch (err) {
      log.warn({ err }, "xp increment failed");
    }
  },
});

export { xpToLevel, levelFromXp };
