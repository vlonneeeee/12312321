import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  PermissionsBitField,
  type TextChannel,
} from "discord.js";
import { prisma } from "@core/db/prisma";
import { withLock } from "@core/locks/distributed-lock";
import { UserFacingError } from "@core/errors/errors";
import { eventBus } from "@core/events/event-bus";
import { infoEmbed, successEmbed } from "@shared/embeds/factory";
import { Colors } from "@shared/embeds/colors";
import { child } from "@core/logger/logger";
import { t } from "@core/i18n";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@core/config/env";
import {
  extractAttachmentUrls,
  postTicketClosed,
  postTicketOpened,
} from "./ticket-logger";

const log = child("tickets");

/**
 * Schema for a single field inside a ticket-open modal. Stored per category on
 * the panel as JSON, so admins can edit forms via slash command without code.
 */
export interface TicketModalField {
  id: string;
  label: string;
  placeholder?: string;
  style: "short" | "paragraph";
  required: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface TicketCategory {
  key: string;
  label: string;
  emoji?: string;
  categoryId?: string;
  supportRoleIds?: string[];
  /** Optional pre-open modal fields (Discord caps at 5). */
  modalFields?: TicketModalField[];
}

/**
 * Resolve a `TicketCategory[]` from the JSON column. Tolerates legacy panels
 * that stored a minimal `{ key, label }`. Never throws — bad shapes are
 * filtered out so a single corrupt entry can't crash the whole flow.
 */
export function normalizeCategories(raw: unknown): TicketCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: TicketCategory[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const rec = c as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key : null;
    const label = typeof rec.label === "string" ? rec.label : null;
    if (!key || !label) continue;
    const modalFields = Array.isArray(rec.modalFields)
      ? (rec.modalFields as unknown[])
          .map((f) => {
            if (!f || typeof f !== "object") return null;
            const fr = f as Record<string, unknown>;
            if (typeof fr.id !== "string" || typeof fr.label !== "string") {
              return null;
            }
            return {
              id: fr.id,
              label: fr.label,
              placeholder:
                typeof fr.placeholder === "string" ? fr.placeholder : undefined,
              style: fr.style === "paragraph" ? "paragraph" : "short",
              required: Boolean(fr.required),
              minLength:
                typeof fr.minLength === "number" ? fr.minLength : undefined,
              maxLength:
                typeof fr.maxLength === "number" ? fr.maxLength : undefined,
            } as TicketModalField;
          })
          .filter((f): f is TicketModalField => f !== null)
      : undefined;
    out.push({
      key,
      label,
      emoji: typeof rec.emoji === "string" ? rec.emoji : undefined,
      categoryId:
        typeof rec.categoryId === "string" ? rec.categoryId : undefined,
      supportRoleIds: Array.isArray(rec.supportRoleIds)
        ? (rec.supportRoleIds as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : undefined,
      modalFields,
    });
  }
  return out;
}

/**
 * Build an HMAC-signed transcript URL that the HTTP route can verify without
 * a DB lookup. Format: `/transcripts/<ticketId>.html?sig=<hex>`.
 */
export function buildTranscriptUrl(ticketId: string): string {
  const sig = createHmac("sha256", env.SESSION_SECRET)
    .update(`transcript:${ticketId}`)
    .digest("hex");
  return `/transcripts/${ticketId}.html?sig=${sig}`;
}

/**
 * Constant-time verification for the transcript URL signature.
 */
export function verifyTranscriptSig(ticketId: string, sig: string): boolean {
  const expected = createHmac("sha256", env.SESSION_SECRET)
    .update(`transcript:${ticketId}`)
    .digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class TicketService {
  async openTicket(opts: {
    guild: Guild;
    author: GuildMember;
    category: TicketCategory;
    subject?: string;
    modalAnswers?: Record<string, string>;
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
          modalAnswers: opts.modalAnswers ?? undefined,
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
        modalAnswers: opts.modalAnswers,
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

      const embeds = [
        successEmbed(
          await t(guild.id, "tickets.ticket_opened_title"),
          await t(guild.id, "tickets.ticket_opened_body", {
            category: category.label,
            subject: subjectText,
          }),
        ),
      ];

      // If the user filled out a modal, attach a second embed with the Q&A so
      // staff can see the context at a glance without scrolling.
      if (opts.modalAnswers && Object.keys(opts.modalAnswers).length > 0) {
        const fields = (category.modalFields ?? [])
          .map((f) => {
            const value = opts.modalAnswers?.[f.id];
            if (!value) return null;
            const truncated =
              value.length > 1024 ? value.slice(0, 1020) + "…" : value;
            return { name: f.label, value: truncated, inline: false };
          })
          .filter(
            (f): f is { name: string; value: string; inline: boolean } =>
              f !== null,
          );
        if (fields.length > 0) {
          const answersEmbed = new EmbedBuilder()
            .setColor(Colors.primary)
            .setTitle(await t(guild.id, "tickets.modal.answers_title"))
            .addFields(fields);
          embeds.push(answersEmbed);
        }
      }

      await channel.send({
        content: `<@${author.id}>`,
        embeds,
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

  /**
   * Close a ticket. Flow:
   *   1. Generate transcript HTML and persist it both to DB (truth source)
   *      and to a local file (admin offline access).
   *   2. Build a signed transcript URL and persist it on the ticket row.
   *   3. Post the close embed (+ HTML attachment) to the admin log channel.
   *   4. If ratings are enabled for the guild, try to DM the author a
   *      1-5 star prompt. If DMs are closed, drop the prompt into the ticket
   *      channel and wait up to 60s before deletion. If ratings are required
   *      we wait up to 5 minutes for the rating before forcing deletion.
   *   5. Delete the channel.
   */
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

    let transcriptHtml = "";
    let messageCount = 0;
    let attachmentUrls: string[] = [];
    let channelName = ticket.channelId;
    if (channel) {
      channelName = channel.name;
      const result = await this.generateTranscript(channel, ticket.id);
      transcriptHtml = result.html;
      messageCount = result.messageCount;
      attachmentUrls = result.attachmentUrls;
    }
    const closedAt = new Date();
    const transcriptUrl = buildTranscriptUrl(ticket.id);

    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: "closed",
        closedAt,
        closedBy: closer.id,
        transcriptUrl,
        transcriptHtml: transcriptHtml || null,
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
        transcriptUrl,
        messageCount,
        attachmentUrls,
      });
    }

    // Ratings flow — best effort, never blocks deletion long.
    const ratingHandled = await this.requestRating(guild, channel, ticket);

    if (channel) {
      // If a required rating is still pending we already waited inside
      // requestRating, so delete is safe to fire now.
      void ratingHandled; // explicit acknowledgement to silence unused warning
      await channel.delete("Ticket closed").catch(() => null);
    }
    return transcriptUrl;
  }

  /**
   * Submit a 1-5 rating on a closed ticket. Returns the updated rating value.
   * Throws UserFacingError if the actor is not the author or the ticket is
   * not in a rateable state.
   */
  async applyRating(
    ticketId: string,
    actorId: string,
    score: number,
    guildIdHint: string | null,
  ): Promise<{ rating: number; guildId: string; authorId: string }> {
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new UserFacingError(
        await t(guildIdHint, "tickets.rating.invalid_score"),
      );
    }
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new UserFacingError(
        await t(guildIdHint, "tickets.not_found"),
      );
    }
    if (ticket.authorId !== actorId) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.rating.only_author"),
      );
    }
    if (ticket.rating !== null && ticket.rating !== undefined) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.rating.already_rated"),
      );
    }
    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: { rating: score, ratedAt: new Date() },
    });
    eventBus.emit("ticket.rated", {
      ticketId,
      guildId: ticket.guildId,
      authorId: ticket.authorId,
      rating: score,
    });
    return {
      rating: updated.rating ?? score,
      guildId: ticket.guildId,
      authorId: ticket.authorId,
    };
  }

  /**
   * Attach an optional free-text comment to an already-rated ticket.
   */
  async applyRatingComment(
    ticketId: string,
    actorId: string,
    comment: string,
  ): Promise<void> {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      throw new UserFacingError(
        await t(null, "tickets.not_found"),
      );
    }
    if (ticket.authorId !== actorId) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.rating.only_author"),
      );
    }
    if (ticket.rating === null || ticket.rating === undefined) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.rating.rate_first"),
      );
    }
    const trimmed = comment.trim().slice(0, 4000);
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { ratingComment: trimmed || null },
    });
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
        transcriptUrl: null,
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

  /**
   * Dispatch a rating prompt for a freshly-closed ticket. Returns `true` if a
   * prompt was successfully delivered (regardless of whether the user clicked).
   * Never throws — failure to ask for a rating must not prevent the ticket
   * from closing.
   */
  private async requestRating(
    guild: Guild,
    channel: TextChannel | null,
    ticket: { id: string; authorId: string; guildId: string },
  ): Promise<boolean> {
    const g = await prisma.guild.findUnique({
      where: { id: ticket.guildId },
      select: { ticketRatingEnabled: true, ticketRatingRequired: true },
    });
    if (!g?.ticketRatingEnabled) return false;

    const gid = ticket.guildId;
    const author = await guild.members
      .fetch(ticket.authorId)
      .catch(() => null);
    if (!author) return false;

    const prompt = await buildRatingPrompt(gid, ticket.id);

    let delivered = false;
    try {
      const dm = await author.createDM();
      await dm.send(prompt);
      delivered = true;
    } catch {
      // DMs closed — fall back to posting in the ticket channel before delete.
    }

    if (!delivered && channel) {
      try {
        await channel.send(prompt);
        delivered = true;
      } catch {
        // ignored — channel may already be unreachable
      }
    }

    if (delivered && g.ticketRatingRequired) {
      // Poll for up to 5 minutes for the author to rate. We sleep in 5s
      // increments so the deletion can fire promptly the moment the rating
      // lands. This still bounds the wait — we never block forever.
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(5_000);
        const fresh = await prisma.ticket.findUnique({
          where: { id: ticket.id },
          select: { rating: true },
        });
        if (fresh?.rating !== null && fresh?.rating !== undefined) break;
      }
    }
    return delivered;
  }

  private async generateTranscript(
    channel: TextChannel,
    ticketId: string,
  ): Promise<{
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
        html,
        messageCount: ordered.length,
        attachmentUrls,
      };
    } catch (err) {
      log.warn({ err, ticketId }, "transcript failed");
      return { html: "", messageCount: 0, attachmentUrls: [] };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the rating prompt payload (5 star buttons + skip).
 * Public so the buttons handler can re-render it cleanly.
 */
export async function buildRatingPrompt(
  guildId: string,
  ticketId: string,
): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}> {
  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle(await t(guildId, "tickets.rating.prompt_title"))
    .setDescription(await t(guildId, "tickets.rating.prompt_body"));

  const stars = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder()
        .setCustomId(`ticket:rate:${ticketId}:${n}`)
        .setLabel("⭐".repeat(n))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components: [stars] };
}

export const ticketService = new TicketService();
