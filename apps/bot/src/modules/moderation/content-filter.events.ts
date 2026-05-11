import { Events, type Message } from "discord.js";
import { defineEvent } from "@core/handler/event";
import { prisma } from "@core/db/prisma";
import { moderationService } from "./moderation.service";
import { child } from "@core/logger/logger";

const log = child("contentfilter");

// Lightweight phishing host list. In production load from configured remote
// sources (e.g. phishfort) at boot and refresh periodically.
const PHISHING_HOSTS: ReadonlySet<string> = new Set([
  "steamcommunlty.com",
  "discordgift.gift",
  "dlsccrd.com",
  "discоrd.com", // cyrillic look-alike
]);

const URL_RX = /https?:\/\/([^\s/]+)/gi;

export const event = defineEvent({
  name: Events.MessageCreate,
  async execute(message: Message) {
    if (message.author.bot || !message.inGuild()) return;

    // 1. Built-in phishing detection (always on)
    const hosts = [...message.content.matchAll(URL_RX)].map((m) => m[1]!.toLowerCase());
    if (hosts.some((h) => PHISHING_HOSTS.has(h))) {
      await message.delete().catch(() => null);
      if (message.member) {
        await moderationService.warn(
          message.guild,
          message.member,
          message.member,
          "Phishing link",
        );
      }
      return;
    }

    // 2. Per-guild content filters
    const filters = await prisma.contentFilter.findMany({
      where: { guildId: message.guildId, enabled: true },
    });
    for (const f of filters) {
      try {
        let triggered = false;
        switch (f.type) {
          case "invite":
            triggered = /discord\.gg\/|discord(?:app)?\.com\/invite\//i.test(message.content);
            break;
          case "link":
            triggered = /https?:\/\//i.test(message.content);
            break;
          case "word":
            triggered = new RegExp(`\\b${escape(f.pattern)}\\b`, "i").test(message.content);
            break;
          case "regex":
            triggered = new RegExp(f.pattern, "i").test(message.content);
            break;
          case "mediaext":
            triggered = message.attachments.some((a) =>
              a.name?.toLowerCase().endsWith(`.${f.pattern.toLowerCase()}`),
            );
            break;
          case "mention":
            triggered = message.mentions.users.size + message.mentions.roles.size >= Number(f.pattern);
            break;
        }
        if (triggered) {
          await message.delete().catch(() => null);
          if (!message.member) return;
          switch (f.action) {
            case "warn":
              await moderationService.warn(message.guild, message.member, message.member, `Filter: ${f.type}`);
              break;
            case "mute":
              await moderationService.mute(message.guild, message.member, message.member, 600, `Filter: ${f.type}`);
              break;
            case "ban":
              await moderationService.ban(message.guild, message.member, message.member, `Filter: ${f.type}`);
              break;
            default:
              break;
          }
          return;
        }
      } catch (err) {
        log.warn({ err, filterId: f.id }, "filter eval failed");
      }
    }
  },
});

function escape(s: string) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}
