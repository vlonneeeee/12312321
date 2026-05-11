import type { Client, TextChannel } from "discord.js";
import axios from "axios";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { infoEmbed } from "@shared/embeds/factory";
import { truncate } from "@shared/utils/format";

const log = child("jobs:news");

// Minimal RSS / Atom parser implemented without extra dependencies.
const ITEM_RX = /<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi;
const TAG_RX = (name: string) =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i");
const LINK_HREF_RX = /<link[^>]*href="([^"]+)"[^>]*\/?>/i;
const CDATA_RX = /<!\[CDATA\[([\s\S]*?)\]\]>/;

function stripHtml(input: string): string {
  const cd = input.match(CDATA_RX);
  const body = cd ? cd[1] : input;
  return body.replace(/<[^>]+>/g, "").trim();
}

interface NewsItem {
  title: string;
  link: string;
  description: string;
  guid: string;
}

function parseFeed(xml: string): NewsItem[] {
  const items = xml.match(ITEM_RX) ?? [];
  return items.map((raw) => {
    const title = stripHtml(raw.match(TAG_RX("title"))?.[1] ?? "");
    const description = stripHtml(
      raw.match(TAG_RX("description"))?.[1] ?? raw.match(TAG_RX("summary"))?.[1] ?? "",
    );
    let link = raw.match(TAG_RX("link"))?.[1]?.trim() ?? "";
    if (!link) link = raw.match(LINK_HREF_RX)?.[1] ?? "";
    const guid =
      raw.match(TAG_RX("guid"))?.[1]?.trim() ??
      raw.match(TAG_RX("id"))?.[1]?.trim() ??
      link;
    return { title, link, description, guid };
  });
}

export async function runNewsFetch(client: Client): Promise<void> {
  const feeds = await prisma.newsFeed.findMany({ where: { enabled: true }, take: 100 });
  for (const feed of feeds) {
    try {
      const res = await axios.get<string>(feed.url, {
        timeout: 10_000,
        responseType: "text",
        headers: { "User-Agent": "discord-bot-news/1.0" },
      });
      const items = parseFeed(res.data).slice(0, 5);
      const seenKey = `news:seen:${feed.id}`;
      const previousGuids = (
        await prisma.scheduledMessage.findFirst({ where: { id: seenKey } }).catch(() => null)
      )?.content;
      const previous = new Set((previousGuids ?? "").split(","));

      const channel = (await client.channels.fetch(feed.channelId).catch(() => null)) as
        | TextChannel
        | null;
      if (!channel?.isTextBased()) continue;

      const fresh: string[] = [];
      for (const item of items) {
        if (previous.has(item.guid)) continue;
        fresh.push(item.guid);
        const embed = infoEmbed(truncate(item.title, 250), truncate(item.description, 1024))
          .setURL(item.link)
          .setFooter({ text: feed.url });
        await channel.send({ embeds: [embed] }).catch(() => null);
      }

      await prisma.newsFeed.update({
        where: { id: feed.id },
        data: { lastFetchedAt: new Date() },
      });
      // Persist guids in a sidecar row (cheap & dependency-free). In a fully
      // scaled deployment, swap this for a dedicated NewsFeedItem table.
      const joined = [...fresh, ...previous].slice(0, 50).join(",");
      await prisma.scheduledMessage
        .upsert({
          where: { id: seenKey },
          create: {
            id: seenKey,
            guildId: feed.guildId,
            channelId: feed.channelId,
            content: joined,
            enabled: false,
          },
          update: { content: joined },
        })
        .catch(() => null);
    } catch (err) {
      log.warn({ err, url: feed.url }, "feed fetch failed");
    }
  }
}
