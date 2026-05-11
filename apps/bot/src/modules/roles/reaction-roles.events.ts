import { Events, type MessageReaction, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";

async function resolveReaction(reaction: MessageReaction | PartialMessageReaction) {
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  return reaction;
}

const add = defineEvent({
  name: Events.MessageReactionAdd,
  async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    if (user.bot) return;
    const r = await resolveReaction(reaction);
    if (!r.message.guildId) return;
    const emoji = r.emoji.id ?? r.emoji.name;
    if (!emoji) return;
    const rr = await prisma.reactionRole.findUnique({ where: { messageId_emoji: { messageId: r.message.id, emoji } } });
    if (!rr) return;
    const member = await r.message.guild?.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (rr.mode === "remove") {
      await member.roles.remove(rr.roleId, "Reaction role").catch(() => null);
    } else {
      await member.roles.add(rr.roleId, "Reaction role").catch(() => null);
    }
  },
});

const remove = defineEvent({
  name: Events.MessageReactionRemove,
  async execute(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
    if (user.bot) return;
    const r = await resolveReaction(reaction);
    if (!r.message.guildId) return;
    const emoji = r.emoji.id ?? r.emoji.name;
    if (!emoji) return;
    const rr = await prisma.reactionRole.findUnique({ where: { messageId_emoji: { messageId: r.message.id, emoji } } });
    if (!rr) return;
    if (rr.mode === "add") return; // add-only does not remove
    const member = await r.message.guild?.members.fetch(user.id).catch(() => null);
    if (!member) return;
    if (rr.mode === "remove") {
      await member.roles.add(rr.roleId, "Reaction role (re-add)").catch(() => null);
    } else {
      await member.roles.remove(rr.roleId, "Reaction role").catch(() => null);
    }
  },
});

export const events = [add, remove];
