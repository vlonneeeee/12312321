import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type Guild,
  type GuildMember,
  PermissionsBitField,
  type TextChannel,
} from "discord.js";
import { prisma } from "@core/db/prisma";
import { withLock } from "@core/locks/distributed-lock";
import { UserFacingError } from "@core/errors/errors";
import { eventBus } from "@core/events/event-bus";
import { successEmbed, infoEmbed } from "@shared/embeds/factory";
import { child } from "@core/logger/logger";
import { t } from "@core/i18n";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  extractAttachmentUrls,
  postTicketClosed,
  postTicketOpened,
} from "./ticket-logger";

const log = child("tickets");

interface TicketCategory {
  key: string;
  label: string;
  emoji?: string;
  categoryId?: string;
  supportRoleIds?: string[];
}

export class TicketService {
  async openTicket(opts: {
    guild: Guild;
    author: GuildMember;
    category: TicketCategory;
    subject?: string;
  }): Promise<{ ticketId: string; channelId: string }> {
    const { guild, author, category } = opts;
    return withLock(`ticket:${guild.id}:${author.id}`, 6000, async () => {
      const existing = await prisma.ticket.findFirst({
        where: {
          guildId: guild.id,
          authorId: author.id,
          status: { not: "closed" },
        },
      });
      if (existing) {
        const existingChannel = await guild.channels
          .fetch(existing.channelId)
          .catch(() => null);
        if (existingChannel) {
          throw new UserFacingError(
            await t(guild.id, "tickets.already_open", {
              channelId: existing.channelId,
            }),
          );
        }
        // Channel was manually deleted but DB row was orphaned. Mark closed and proceed.
        await prisma.ticket.update({
          where: { id: existing.id },
          data: {
            status: "closed",
            closedAt: new Date(),
            closedBy: "system:channel-deleted",
          },
        });
        log.info(
          { ticketId: existing.id, guildId: guild.id, authorId: author.id },
          "reaped orphaned ticket",
        );
      }
      const parentId =
        category.categoryId ?? (await this.defaultCategory(guild.id));
      const channel = await guild.channels.create({
        name: `ticket-${author.user.username.slice(0, 20)}-${Date.now().toString(36).slice(-4)}`,
        type: ChannelType.GuildText,
        parent: parentId ?? undefined,
        topic: `Ticket | ${author.id} | ${category.key}`,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: author.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          ...(category.supportRoleIds?.map((id) => ({
            id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          })) ?? []),
        ],
      });

      const ticket = await prisma.ticket.create({
        data: {
          guildId: guild.id,
          authorId: author.id,
          channelId: channel.id,
          category: category.key,
          subject: opts.subject ?? null,
        },
      });

      eventBus.emit("ticket.created", {
        ticketId: ticket.id,
        guildId: guild.id,
        authorId: author.id,
      });

      void postTicketOpened(guild, {
        ticketId: ticket.id,
        authorId: author.id,
        channelId: channel.id,
        category: category.label,
        subject: opts.subject ?? null,
      });

      const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:claim:${ticket.id}`)
          .setLabel("Claim")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("✋"),
        new ButtonBuilder()
          .setCustomId(`ticket:close:${ticket.id}`)
          .setLabel("Close")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("🔒"),
      );
      const subjectText =
        opts.subject ?? (await t(guild.id, "tickets.subject_none"));
      await channel.send({
        content: `<@${author.id}>`,
        embeds: [
          successEmbed(
            await t(guild.id, "tickets.ticket_opened_title"),
            await t(guild.id, "tickets.ticket_opened_body", {
              category: category.label,
              subject: subjectText,
            }),
          ),
        ],
        components: [controls],
      });
      return { ticketId: ticket.id, channelId: channel.id };
    });
  }

  async claim(ticketId: string, claimer: GuildMember): Promise<void> {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    const gid = claimer.guild.id;
    if (!ticket || ticket.status === "closed") {
      throw new UserFacingError(await t(gid, "tickets.not_found"));
    }
    if (ticket.claimerId) {
      throw new UserFacingError(
        await t(gid, "tickets.already_claimed", {
          claimerId: ticket.claimerId,
        }),
      );
    }
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { claimerId: claimer.id, claimedAt: new Date(), status: "claimed" },
    });
    const channel = (await claimer.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (channel) {
      // Reflect the staff handler in the channel topic so the assignment is
      // visible at a glance without scrolling for the claim message. Best
      // effort — topic edits hit a slow rate limit so we don't block on it.
      const topic = `Ticket | ${ticket.authorId} | ${ticket.category} | claimed by ${claimer.user.username}`;
      channel.setTopic(topic).catch(() => null);
      await channel.send({
        embeds: [
          infoEmbed(
            await t(gid, "tickets.claimed_title"),
            await t(gid, "tickets.claimed_body", { claimerId: claimer.id }),
          ),
        ],
      });
    }
  }

  async close(ticketId: string, closer: GuildMember): Promise<string> {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    const gid = closer.guild.id;
    if (!ticket || ticket.status === "closed") {
      throw new UserFacingError(await t(gid, "tickets.already_closed"));
    }
    const guild = closer.guild;
    const channel = (await guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;

    let transcriptUrl = "";
    let transcriptHtml = "";
    let messageCount = 0;
    let attachmentUrls: string[] = [];
    let channelName = ticket.channelId;
    if (channel) {
      channelName = channel.name;
      const result = await this.generateTranscript(channel, ticket.id);
      transcriptUrl = result.url;
      transcriptHtml = result.html;
      messageCount = result.messageCount;
      attachmentUrls = result.attachmentUrls;
    }
    const closedAt = new Date();
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: "closed",
        closedAt,
        closedBy: closer.id,
        transcriptUrl,
      },
    });
    eventBus.emit("ticket.closed", {
      ticketId,
      guildId: guild.id,
      closedBy: closer.id,
    });

    if (transcriptHtml) {
      void postTicketClosed(guild, {
        ticketId,
        authorId: ticket.authorId,
        channelId: ticket.channelId,
        channelName,
        category: ticket.category,
        subject: ticket.subject,
        closedBy: closer.id,
        claimerId: ticket.claimerId,
        openedAt: ticket.createdAt,
        closedAt,
        transcriptHtml,
        messageCount,
        attachmentUrls,
      });
    }

    if (channel) await channel.delete("Ticket closed").catch(() => null);
    return transcriptUrl;
  }

  async markChannelDeleted(channelId: string, guild?: Guild): Promise<void> {
    const ticket = await prisma.ticket.findUnique({ where: { channelId } });
    if (!ticket || ticket.status === "closed") return;
    const closedAt = new Date();
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "closed", closedAt, closedBy: "system:channel-deleted" },
    });
    log.info(
      { ticketId: ticket.id, channelId },
      "ticket auto-closed: channel deleted",
    );

    if (guild) {
      void postTicketClosed(guild, {
        ticketId: ticket.id,
        authorId: ticket.authorId,
        channelId: ticket.channelId,
        channelName: `ticket-${ticket.id.slice(-6)}`,
        category: ticket.category,
        subject: ticket.subject,
        closedBy: "system:channel-deleted",
        claimerId: ticket.claimerId,
        openedAt: ticket.createdAt,
        closedAt,
        transcriptHtml: `<!doctype html><html><body><p>Channel was deleted manually; transcript unavailable.</p></body></html>`,
        messageCount: 0,
        attachmentUrls: [],
      });
    }
  }

  private async defaultCategory(guildId: string): Promise<string | null> {
    const g = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { ticketCategoryId: true },
    });
    return g?.ticketCategoryId ?? null;
  }

  private async generateTranscript(
    channel: TextChannel,
    ticketId: string,
  ): Promise<{
    url: string;
    html: string;
    messageCount: number;
    attachmentUrls: string[];
  }> {
    try {
      const fetched = await channel.messages.fetch({ limit: 100 });
      const ordered = [...fetched.values()].reverse();
      const attachmentUrls = extractAttachmentUrls(ordered);
      const html = renderTranscript(channel.name, ordered);
      const dir = path.resolve(process.cwd(), "transcripts");
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${ticketId}.html`);
      await writeFile(file, html, "utf8");
      return {
        url: `file://${file}`,
        html,
        messageCount: ordered.length,
        attachmentUrls,
      };
    } catch (err) {
      log.warn({ err, ticketId }, "transcript failed");
      return { url: "", html: "", messageCount: 0, attachmentUrls: [] };
    }
  }
}

interface TranscriptMessage {
  author: { tag: string };
  content: string;
  createdAt: Date;
  attachments: Map<
    string,
    { url: string; name: string | null; contentType: string | null }
  >;
  embeds: ReadonlyArray<{
    image?: { url: string } | null;
    video?: { url: string } | null;
    thumbnail?: { url: string } | null;
  }>;
}

function renderTranscript(name: string, messages: TranscriptMessage[]): string {
  const body = messages
    .map((m) => {
      const text = m.content ? escapeHtml(m.content) : "";
      const attachments: string[] = [];
      for (const a of m.attachments.values()) {
        const isImage =
          a.contentType?.startsWith("image/") ??
          /\.(png|jpe?g|gif|webp)$/i.test(a.url);
        const isVideo =
          a.contentType?.startsWith("video/") ??
          /\.(mp4|webm|mov)$/i.test(a.url);
        if (isImage) {
          attachments.push(
            `<div class="att"><a href="${escapeAttr(a.url)}" target="_blank" rel="noopener"><img src="${escapeAttr(a.url)}" alt="${escapeAttr(a.name ?? "image")}" /></a></div>`,
          );
        } else if (isVideo) {
          attachments.push(
            `<div class="att"><video controls preload="metadata" src="${escapeAttr(a.url)}"></video><br><a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.name ?? a.url)}</a></div>`,
          );
        } else {
          attachments.push(
            `<div class="att file"><a href="${escapeAttr(a.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(a.name ?? a.url)}</a></div>`,
          );
        }
      }
      for (const e of m.embeds) {
        if (e.image?.url) {
          attachments.push(
            `<div class="att"><a href="${escapeAttr(e.image.url)}" target="_blank" rel="noopener"><img src="${escapeAttr(e.image.url)}" alt="embed image" /></a></div>`,
          );
        }
        if (e.video?.url) {
          attachments.push(
            `<div class="att"><a href="${escapeAttr(e.video.url)}" target="_blank" rel="noopener">🎬 ${escapeHtml(e.video.url)}</a></div>`,
          );
        }
      }
      return `<li><div class="hdr"><strong>${escapeHtml(m.author.tag)}</strong> <span class="ts">${m.createdAt.toISOString()}</span></div>${text ? `<div class="msg">${text}</div>` : ""}${attachments.join("")}</li>`;
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#1e1f22;color:#dbdee1;max-width:880px;margin:24px auto;padding:16px;line-height:1.45}
h1{font-size:18px;margin:0 0 16px;padding-bottom:12px;border-bottom:1px solid #2b2d31;color:#fff}
ul{padding:0;margin:0;list-style:none}
li{margin:0 0 14px;padding:10px 12px;background:#2b2d31;border-radius:8px}
.hdr{margin-bottom:4px}
.ts{opacity:.55;font-size:12px;margin-left:8px}
.msg{white-space:pre-wrap;word-break:break-word}
.att{margin-top:8px}
.att img{max-width:100%;max-height:360px;border-radius:6px;border:1px solid #1e1f22;display:block}
.att video{max-width:100%;max-height:360px;border-radius:6px;border:1px solid #1e1f22;display:block}
.att.file a{color:#00a8fc;text-decoration:none}
.att.file a:hover{text-decoration:underline}
a{color:#00a8fc}</style>
</head><body><h1>${escapeHtml(name)}</h1><ul>${body}</ul></body></html>`;
}

function escapeAttr(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

export const ticketService = new TicketService();
