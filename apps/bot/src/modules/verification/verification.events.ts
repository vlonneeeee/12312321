import { Events, type Message } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { redis } from "@core/cache/redis";
import { prisma } from "@core/db/prisma";

/**
 * DM captcha completion handler. When a user types the captcha code in DM, we
 * resolve their pending verification for every guild they have a pending
 * captcha in.
 */
export const event = defineEvent({
  name: Events.MessageCreate,
  async execute(message: Message) {
    if (!message.author || message.author.bot) return;
    if (message.inGuild()) return; // only DMs
    const text = message.content.trim().toUpperCase();
    if (text.length < 4) return;

    const keys = await redis.keys(`verify:cap:${message.author.id}:*`);
    for (const key of keys) {
      const expected = await redis.get(key);
      if (expected === text) {
        const guildId = key.split(":").pop()!;
        const cfg = await prisma.verificationConfig.findUnique({ where: { guildId } });
        if (!cfg?.verifyRoleId) continue;
        const guild = message.client.guilds.cache.get(guildId);
        const member = await guild?.members.fetch(message.author.id).catch(() => null);
        if (member) {
          await member.roles.add(cfg.verifyRoleId, "Verified (captcha)").catch(() => null);
          await prisma.guildMember.update({
            where: { userId_guildId: { userId: member.id, guildId } },
            data: { isVerified: true },
          });
          await message.reply("Verified. Welcome to the server.").catch(() => null);
        }
        await redis.del(key);
      }
    }
  },
});
