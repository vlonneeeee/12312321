import { Events } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { ownerState, randomMeme } from "./owner.service";

/**
 * Listener that produces a random meme reply with a low probability when the
 * /random-meme-reply OWNER toggle is enabled for the message's guild.
 */
const memeReply = defineEvent({
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (!message.inGuild()) return;
    // ~1% chance of replying.
    if (Math.random() > 0.01) return;
    if (!(await ownerState.hasMeme(message.guild.id))) return;
    await message.reply({ content: randomMeme(), allowedMentions: { repliedUser: false } }).catch(() => null);
  },
});

export const events = [memeReply];
