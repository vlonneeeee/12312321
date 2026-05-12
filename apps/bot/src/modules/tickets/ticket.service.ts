import {
  ActionRowBuilder,
  AttachmentBuilder,
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
import { isStaff } from "@shared/utils/perms";
import {
  extractAttachmentUrls,
  postTicketClosed,
  postTicketOpened,
  resolveAdminLogChannel,
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

/**
 * Policy for who can claim a ticket created from this category.
 *   "staff"  — default. Anyone with isStaff() (ManageGuild or staffRoleIds).
 *   "anyone" — any guild member, like Ticket Tool's open-claim mode.
 *   string[] — list of role IDs allowed to claim.
 */
export type ClaimableBy = "staff" | "anyone" | string[];

export interface TicketCategory {
  key: string;
  label: string;
  emoji?: string;
  categoryId?: string;
  supportRoleIds?: string[];
  /** Optional pre-open modal fields (Discord caps at 5). */
  modalFields?: TicketModalField[];
  /** Tickets 2.1: who is allowed to claim tickets from this category. */
  claimableBy?: ClaimableBy;
  /** Tickets 2.1: roles pinged in a side message when a ticket opens. */
  pingRoleIds?: string[];
}

/**
 * Priority levels for a ticket. Stored as a signed int so we can index it.
 *   -1 low / 0 normal / 1 high / 2 urgent
 */
export const PRIORITY = {
  LOW: -1,
  NORMAL: 0,
  HIGH: 1,
  URGENT: 2,
} as const;

export function priorityFromString(s: string): number | null {
  switch (s.toLowerCase()) {
    case "low":
      return PRIORITY.LOW;
    case "normal":
      return PRIORITY.NORMAL;
    case "high":
      return PRIORITY.HIGH;
    case "urgent":
      return PRIORITY.URGENT;
    default:
      return null;
  }
}

export function priorityEmoji(p: number): string {
  switch (p) {
    case PRIORITY.LOW:
      return "\uD83D\uDFE2"; // green circle
    case PRIORITY.HIGH:
      return "\uD83D\uDFE0"; // orange circle
    case PRIORITY.URGENT:
      return "\uD83D\uDD34"; // red circle
    case PRIORITY.NORMAL:
    default:
      return "\uD83D\uDFE1"; // yellow circle
  }
}

export function priorityKey(p: number): string {
  switch (p) {
    case PRIORITY.LOW:
      return "low";
    case PRIORITY.HIGH:
      return "high";
    case PRIORITY.URGENT:
      return "urgent";
    case PRIORITY.NORMAL:
    default:
      return "normal";
  }
}

export function priorityColor(p: number): number {
  switch (p) {
    case PRIORITY.LOW:
      return 0x57f287; // green
    case PRIORITY.HIGH:
      return 0xfaa61a; // orange
    case PRIORITY.URGENT:
      return 0xed4245; // red
    case PRIORITY.NORMAL:
    default:
      return Colors.primary;
  }
}

function sanitizeChannelName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

/**
 * Build the channel name for a ticket. Encodes the priority as an emoji
 * prefix so staff can sort/glance at a glance.
 */
function buildChannelName(
  username: string,
  priority: number,
  suffix: string,
): string {
  const userSlug = sanitizeChannelName(username.slice(0, 20)) || "user";
  const prefix =
    priority === PRIORITY.NORMAL ? "" : `${priorityEmoji(priority)}-`;
  return `${prefix}ticket-${userSlug}-${suffix}`.slice(0, 95);
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

    // tickets 2.1 — claimableBy supports legacy missing field ("staff") and
    // string list (role IDs). Reject any shape we don't recognize.
    let claimableBy: ClaimableBy | undefined;
    if (rec.claimableBy === "anyone" || rec.claimableBy === "staff") {
      claimableBy = rec.claimableBy;
    } else if (Array.isArray(rec.claimableBy)) {
      const ids = (rec.claimableBy as unknown[]).filter(
        (x): x is string => typeof x === "string",
      );
      if (ids.length > 0) claimableBy = ids;
    }

    const pingRoleIds = Array.isArray(rec.pingRoleIds)
      ? (rec.pingRoleIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
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
      claimableBy,
      pingRoleIds: pingRoleIds && pingRoleIds.length > 0 ? pingRoleIds : undefined,
    });
  }
  return out;
}

/**
 * Resolve the category currently associated with a ticket row by walking the
 * panels of the same guild. Used by claim/admin actions that only have the
 * ticket row and need to apply per-category policy.
 */
async function findCategoryForTicket(
  guildId: string,
  categoryKey: string,
): Promise<TicketCategory | null> {
  const panels = await prisma.ticketPanel.findMany({ where: { guildId } });
  for (const p of panels) {
    const cats = normalizeCategories(p.categories);
    const found = cats.find((c) => c.key === categoryKey);
    if (found) return found;
  }
  return null;
}

async function memberHasAnyRole(
  member: GuildMember,
  roleIds: string[],
): Promise<boolean> {
  return member.roles.cache.some((r) => roleIds.includes(r.id));
}

/**
 * Returns true if `member` is allowed to claim a ticket from the given
 * category. Defaults to staff-only when `claimableBy` is missing or
 * malformed (legacy panels).
 */
async function canClaim(
  category: TicketCategory | null,
  member: GuildMember,
): Promise<boolean> {
  const policy = category?.claimableBy ?? "staff";
  if (policy === "anyone") return true;
  if (Array.isArray(policy)) {
    if (await isStaff(member)) return true;
    return memberHasAnyRole(member, policy);
  }
  return isStaff(member);
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

/**
 * Build the two action rows attached to the in-channel ticket welcome
 * message: the first row carries the original Claim / Close pair, the
 * second row is the staff admin toolkit added in 2.1. Both share the
 * `ticket:<action>:<ticketId>` customId convention so handlers can
 * extract the ticketId without lookups.
 */
export function buildTicketControlRows(
  ticketId: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const primary = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:claim:${ticketId}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("\u270B"),
    new ButtonBuilder()
      .setCustomId(`ticket:close:${ticketId}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("\uD83D\uDD12"),
    new ButtonBuilder()
      .setCustomId(`ticket:closereason:${ticketId}`)
      .setLabel("Close with reason")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\uD83D\uDDD2\uFE0F"),
    new ButtonBuilder()
      .setCustomId(`ticket:transcriptnow:${ticketId}`)
      .setLabel("Transcript")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\uD83D\uDCC4"),
  );
  const admin = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:adduser:${ticketId}`)
      .setLabel("Add user")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\u2795"),
    new ButtonBuilder()
      .setCustomId(`ticket:remuser:${ticketId}`)
      .setLabel("Remove user")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\u2796"),
    new ButtonBuilder()
      .setCustomId(`ticket:transfer:${ticketId}`)
      .setLabel("Transfer")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\uD83D\uDD01"),
    new ButtonBuilder()
      .setCustomId(`ticket:freeze:${ticketId}`)
      .setLabel("Freeze")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\u2744\uFE0F"),
    new ButtonBuilder()
      .setCustomId(`ticket:priority:${ticketId}`)
      .setLabel("Priority")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("\uD83D\uDEA9"),
  );
  return [primary, admin];
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
      const initialPriority = PRIORITY.NORMAL;
      const channelName = buildChannelName(
        author.user.username,
        initialPriority,
        Date.now().toString(36).slice(-4),
      );
      const channel = await guild.channels.create({
        name: channelName,
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
          priority: initialPriority,
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

      const controls = buildTicketControlRows(ticket.id);
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

      const welcome = await channel.send({
        content: `<@${author.id}>`,
        embeds,
        components: controls,
      });
      // Pin the welcome message so it's anchored at the top of the channel
      // regardless of scroll position. Best effort — ManageMessages may be
      // absent on the bot in some servers.
      void welcome.pin().catch(() => null);

      // Side-channel ping for the support roles configured on this category.
      // Sent as a separate plain message because pings inside an embed don't
      // actually trigger notifications.
      if (category.pingRoleIds && category.pingRoleIds.length > 0) {
        const mentions = category.pingRoleIds.map((id) => `<@&${id}>`).join(" ");
        await channel
          .send({
            content: mentions,
            allowedMentions: { roles: category.pingRoleIds },
          })
          .catch(() => null);
      }

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
    // tickets 2.1: enforce the per-category claim policy. Default "staff"
    // keeps the previous behaviour intact for legacy panels.
    const category = await findCategoryForTicket(ticket.guildId, ticket.category);
    if (!(await canClaim(category, claimer))) {
      throw new UserFacingError(await t(gid, "tickets.claim_forbidden"));
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
  async close(
    ticketId: string,
    closer: GuildMember,
    opts: { reason?: string } = {},
  ): Promise<string> {
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
    const reason = opts.reason?.trim().slice(0, 2000) || null;

    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: "closed",
        closedAt,
        closedBy: closer.id,
        transcriptUrl,
        transcriptHtml: transcriptHtml || null,
        closeReason: reason,
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
        reason,
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

  // ------------------------------------------------------------------
  // Tickets 2.1 admin actions
  // ------------------------------------------------------------------

  /**
   * Throws UserFacingError if `member` may not run an admin/moderation
   * action on `ticket`.
   *
   * Rules:
   *   - The ticket author is NEVER allowed to moderate their own ticket,
   *     even if they are the guild owner or have ManageGuild. Otherwise
   *     anyone who opens a ticket would be able to add/remove arbitrary
   *     members to it.
   *   - The current claimer is always allowed.
   *   - Server staff (isStaff: guild owner / ManageGuild perm /
   *     Guild.staffRoleIds) are allowed.
   */
  async assertCanModerate(
    ticket: {
      id: string;
      guildId: string;
      authorId: string;
      claimerId: string | null;
    },
    member: GuildMember,
  ): Promise<void> {
    if (member.id === ticket.authorId) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.author_cannot_moderate"),
      );
    }
    if (ticket.claimerId && ticket.claimerId === member.id) return;
    if (await isStaff(member)) return;
    throw new UserFacingError(
      await t(ticket.guildId, "tickets.admin.forbidden"),
    );
  }

  private async loadActiveTicket(ticketId: string) {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status === "closed") {
      throw new UserFacingError(await t(ticket?.guildId ?? null, "tickets.not_found"));
    }
    return ticket;
  }

  /** Add another guild member into the ticket channel's allow-list. */
  async addUser(
    ticketId: string,
    actor: GuildMember,
    targetId: string,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (!channel) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.channel_missing"),
      );
    }
    const targetMember = await actor.guild.members
      .fetch(targetId)
      .catch(() => null);
    if (!targetMember) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.member_not_found"),
      );
    }
    await channel.permissionOverwrites.edit(targetId, {
      ViewChannel: true,
      SendMessages: true,
      AttachFiles: true,
      ReadMessageHistory: true,
    });
    await channel.send({
      embeds: [
        infoEmbed(
          await t(ticket.guildId, "tickets.admin.user_added_title"),
          await t(ticket.guildId, "tickets.admin.user_added_body", {
            userId: targetId,
            actorId: actor.id,
          }),
        ),
      ],
    });
  }

  /** Remove a user from the ticket channel's allow-list. */
  async removeUser(
    ticketId: string,
    actor: GuildMember,
    targetId: string,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    if (targetId === ticket.authorId) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.cannot_remove_author"),
      );
    }
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (!channel) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.channel_missing"),
      );
    }
    await channel.permissionOverwrites.delete(targetId).catch(() => null);
    await channel.send({
      embeds: [
        infoEmbed(
          await t(ticket.guildId, "tickets.admin.user_removed_title"),
          await t(ticket.guildId, "tickets.admin.user_removed_body", {
            userId: targetId,
            actorId: actor.id,
          }),
        ),
      ],
    });
  }

  /**
   * Transfer the claim to another staff member. Resets claimedAt and
   * refreshes the channel topic so the new owner is obvious.
   */
  async transferClaim(
    ticketId: string,
    actor: GuildMember,
    newClaimer: GuildMember,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    const category = await findCategoryForTicket(ticket.guildId, ticket.category);
    if (!(await canClaim(category, newClaimer))) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.transfer_forbidden"),
      );
    }
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        claimerId: newClaimer.id,
        claimedAt: new Date(),
        status: "claimed",
      },
    });
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (channel) {
      const topic = `Ticket | ${ticket.authorId} | ${ticket.category} | claimed by ${newClaimer.user.username}`;
      channel.setTopic(topic).catch(() => null);
      await channel.send({
        embeds: [
          infoEmbed(
            await t(ticket.guildId, "tickets.admin.transferred_title"),
            await t(ticket.guildId, "tickets.admin.transferred_body", {
              fromId: actor.id,
              toId: newClaimer.id,
            }),
          ),
        ],
      });
    }
  }

  /** Set the priority (-1..2) on a ticket and rename the channel to match. */
  async setPriority(
    ticketId: string,
    actor: GuildMember,
    level: number,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    if (![PRIORITY.LOW, PRIORITY.NORMAL, PRIORITY.HIGH, PRIORITY.URGENT].includes(level as -1 | 0 | 1 | 2)) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.bad_priority"),
      );
    }
    if (ticket.priority === level) return; // no-op
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { priority: level },
    });
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (channel) {
      // Strip any existing priority emoji prefix and reapply the new one.
      const rawName = channel.name.replace(/^.{1,3}-/, "");
      const author = await actor.guild.members
        .fetch(ticket.authorId)
        .catch(() => null);
      const usernamePart = author?.user.username ?? rawName;
      // Channel rename is rate-limited (twice per 10 min); ignore failure.
      const newName = buildChannelName(
        usernamePart,
        level,
        ticket.id.slice(-4),
      );
      channel.setName(newName).catch(() => null);
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(priorityColor(level))
            .setTitle(
              await t(ticket.guildId, "tickets.admin.priority_title", {
                emoji: priorityEmoji(level),
              }),
            )
            .setDescription(
              await t(ticket.guildId, "tickets.admin.priority_body", {
                level: await t(
                  ticket.guildId,
                  `tickets.priority.${priorityKey(level)}`,
                ),
                actorId: actor.id,
              }),
            ),
        ],
      });
    }
  }

  /**
   * Freeze (or unfreeze) the ticket. While frozen the author cannot send
   * messages \u2014 only staff and the claimer can. Useful when the staff need
   * the requester to wait for a decision without spamming.
   */
  async setFreeze(
    ticketId: string,
    actor: GuildMember,
    frozen: boolean,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    if (ticket.frozen === frozen) return;
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { frozen },
    });
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (channel) {
      await channel.permissionOverwrites
        .edit(ticket.authorId, {
          SendMessages: frozen ? false : true,
        })
        .catch(() => null);
      await channel.send({
        embeds: [
          infoEmbed(
            await t(
              ticket.guildId,
              frozen
                ? "tickets.admin.frozen_title"
                : "tickets.admin.unfrozen_title",
            ),
            await t(
              ticket.guildId,
              frozen
                ? "tickets.admin.frozen_body"
                : "tickets.admin.unfrozen_body",
              { actorId: actor.id },
            ),
          ),
        ],
      });
    }
  }

  /** Rename the underlying Discord channel for the ticket. */
  async renameChannel(
    ticketId: string,
    actor: GuildMember,
    name: string,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    const slug = sanitizeChannelName(name);
    if (!slug) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.bad_name"),
      );
    }
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (!channel) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.channel_missing"),
      );
    }
    const prefix =
      ticket.priority === PRIORITY.NORMAL
        ? ""
        : `${priorityEmoji(ticket.priority)}-`;
    const finalName = `${prefix}${slug}`.slice(0, 95);
    try {
      await channel.setName(finalName);
    } catch {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.rename_rate_limited"),
      );
    }
    await channel.send({
      embeds: [
        infoEmbed(
          await t(ticket.guildId, "tickets.admin.renamed_title"),
          await t(ticket.guildId, "tickets.admin.renamed_body", {
            name: finalName,
            actorId: actor.id,
          }),
        ),
      ],
    });
  }

  /**
   * Snapshot the current transcript without closing the ticket. The HTML
   * is regenerated, persisted, and pushed to the admin log channel as a
   * file attachment. Useful for long-running tickets that staff want to
   * archive periodically.
   */
  async requestTranscriptNow(
    ticketId: string,
    actor: GuildMember,
  ): Promise<void> {
    const ticket = await this.loadActiveTicket(ticketId);
    await this.assertCanModerate(ticket, actor);
    const channel = (await actor.guild.channels
      .fetch(ticket.channelId)
      .catch(() => null)) as TextChannel | null;
    if (!channel) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.channel_missing"),
      );
    }
    const result = await this.generateTranscript(channel, ticket.id);
    if (!result.html) {
      throw new UserFacingError(
        await t(ticket.guildId, "tickets.admin.transcript_failed"),
      );
    }
    const transcriptUrl = buildTranscriptUrl(ticket.id);
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { transcriptHtml: result.html, transcriptUrl },
    });

    // Side-channel snapshot to the admin log: a slim embed + the HTML file.
    const logChannel = await resolveAdminLogChannel(actor.guild);
    if (logChannel) {
      const attachment = new AttachmentBuilder(
        Buffer.from(result.html, "utf8"),
        {
          name: `transcript-${ticket.id}-snapshot.html`,
          description: `Snapshot transcript for ${ticket.id}`,
        },
      );
      const embed = new EmbedBuilder()
        .setColor(Colors.primary)
        .setTitle(await t(ticket.guildId, "tickets.admin.snapshot_title"))
        .addFields(
          {
            name: await t(ticket.guildId, "tickets.log.field_ticket_id"),
            value: `\`${ticket.id}\``,
            inline: false,
          },
          {
            name: await t(ticket.guildId, "tickets.log.field_channel"),
            value: `<#${ticket.channelId}>`,
            inline: true,
          },
          {
            name: await t(ticket.guildId, "tickets.admin.snapshot_by"),
            value: `<@${actor.id}>`,
            inline: true,
          },
          {
            name: await t(ticket.guildId, "tickets.log.field_messages"),
            value: String(result.messageCount),
            inline: true,
          },
          {
            name: await t(ticket.guildId, "tickets.log.field_transcript"),
            value: `\`${transcriptUrl}\``,
            inline: false,
          },
        )
        .setTimestamp(new Date());
      await logChannel
        .send({ embeds: [embed], files: [attachment] })
        .catch(() => null);
    }
    await channel.send({
      embeds: [
        infoEmbed(
          await t(ticket.guildId, "tickets.admin.snapshot_ok_title"),
          await t(ticket.guildId, "tickets.admin.snapshot_ok_body", {
            actorId: actor.id,
          }),
        ),
      ],
    });
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
