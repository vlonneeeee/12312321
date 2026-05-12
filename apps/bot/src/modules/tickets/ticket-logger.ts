import {
  ChannelType,
  type Guild,
  type Message,
  type TextChannel,
  AttachmentBuilder,
  EmbedBuilder,
} from "discord.js";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import { t } from "@core/i18n";
import { Colors } from "@shared/embeds/colors";

const log = child("tickets:logger");

/**
 * Resolve the admin channel where ticket activity should be posted.
 * Priority: Guild.ticketsLogChannelId -> Guild.modLogChannelId -> Guild.logChannelId.
 *
 * Exported as `resolveAdminLogChannel` for sibling modules (ticket service
 * uses it for ad-hoc transcript snapshots).
 */
export async function resolveAdminLogChannel(
  guild: Guild,
): Promise<TextChannel | null> {
  return resolveLogChannel(guild);
}

async function resolveLogChannel(guild: Guild): Promise<TextChannel | null> {
  const g = await prisma.guild.findUnique({
    where: { id: guild.id },
    select: {
      ticketsLogChannelId: true,
      modLogChannelId: true,
      logChannelId: true,
    },
  });
  if (!g) return null;
  const candidates = [g.ticketsLogChannelId, g.modLogChannelId, g.logChannelId];
  for (const id of candidates) {
    if (!id) continue;
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (ch && ch.type === ChannelType.GuildText) return ch as TextChannel;
  }
  return null;
}

interface OpenedPayload {
  ticketId: string;
  authorId: string;
  channelId: string;
  category: string;
  subject?: string | null;
  modalAnswers?: Record<string, string>;
}

export async function postTicketOpened(
  guild: Guild,
  payload: OpenedPayload,
): Promise<void> {
  try {
    const channel = await resolveLogChannel(guild);
    if (!channel) return;
    const gid = guild.id;
    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle(await t(gid, "tickets.log.opened_title"))
      .addFields(
        {
          name: await t(gid, "tickets.log.field_user"),
          value: `<@${payload.authorId}>`,
          inline: true,
        },
        {
          name: await t(gid, "tickets.log.field_channel"),
          value: `<#${payload.channelId}>`,
          inline: true,
        },
        {
          name: await t(gid, "tickets.log.field_category"),
          value: payload.category,
          inline: true,
        },
        {
          name: await t(gid, "tickets.log.field_subject"),
          value: payload.subject ?? (await t(gid, "tickets.subject_none")),
          inline: false,
        },
        {
          name: await t(gid, "tickets.log.field_ticket_id"),
          value: `\`${payload.ticketId}\``,
          inline: false,
        },
      )
      .setTimestamp(new Date());

    // If the open flow used a modal, append a compressed Q&A summary so staff
    // see the form answers in the admin log without leaving the channel.
    if (
      payload.modalAnswers &&
      Object.keys(payload.modalAnswers).length > 0
    ) {
      const lines: string[] = [];
      for (const [fieldId, answer] of Object.entries(payload.modalAnswers)) {
        const oneLine = answer.replace(/\s+/g, " ").slice(0, 200);
        lines.push(`**${fieldId}**: ${oneLine}`);
      }
      const joined = lines.join("\n");
      embed.addFields({
        name: await t(gid, "tickets.log.field_modal_answers"),
        value: joined.length > 1020 ? joined.slice(0, 1020) + "…" : joined,
        inline: false,
      });
    }
    await channel.send({ embeds: [embed] }).catch((err) => {
      log.warn(
        { err: err instanceof Error ? err.message : err },
        "failed to post opened log",
      );
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      "postTicketOpened failed",
    );
  }
}

interface ClosedPayload {
  ticketId: string;
  authorId: string;
  channelId: string;
  channelName: string;
  category: string;
  subject?: string | null;
  closedBy: string;
  claimerId?: string | null;
  openedAt: Date;
  closedAt: Date;
  transcriptHtml: string;
  /** Signed relative transcript URL (`/transcripts/<id>.html?sig=...`) or null. */
  transcriptUrl?: string | null;
  messageCount: number;
  attachmentUrls: string[];
  /** Staff-provided reason at close time. Tickets 2.1 only. */
  reason?: string | null;
}

export async function postTicketClosed(
  guild: Guild,
  payload: ClosedPayload,
): Promise<void> {
  try {
    const channel = await resolveLogChannel(guild);
    if (!channel) return;
    const gid = guild.id;

    const durationMs = payload.closedAt.getTime() - payload.openedAt.getTime();
    const durationStr = humanizeDuration(durationMs);

    const fields = [
      {
        name: await t(gid, "tickets.log.field_user"),
        value: `<@${payload.authorId}>`,
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_closed_by"),
        value: formatCloser(payload.closedBy),
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_category"),
        value: payload.category,
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_subject"),
        value: payload.subject ?? (await t(gid, "tickets.subject_none")),
        inline: false,
      },
      {
        name: await t(gid, "tickets.log.field_duration"),
        value: durationStr,
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_messages"),
        value: String(payload.messageCount),
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_channel"),
        value: `#${payload.channelName}`,
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_ticket_id"),
        value: `\`${payload.ticketId}\``,
        inline: false,
      },
    ];

    if (payload.claimerId) {
      fields.splice(2, 0, {
        name: await t(gid, "tickets.log.field_claimed_by"),
        value: `<@${payload.claimerId}>`,
        inline: true,
      });
    }

    if (payload.reason) {
      const trimmed =
        payload.reason.length > 1020
          ? payload.reason.slice(0, 1020) + "\u2026"
          : payload.reason;
      fields.push({
        name: await t(gid, "tickets.log.field_reason"),
        value: trimmed,
        inline: false,
      });
    }

    // Discord field values max length = 1024. Truncate the attachments list if needed.
    if (payload.attachmentUrls.length > 0) {
      const list = payload.attachmentUrls
        .map((u, i) => `[#${i + 1}](${u})`)
        .join(" • ");
      fields.push({
        name: await t(gid, "tickets.log.field_attachments", {
          count: payload.attachmentUrls.length,
        }),
        value: list.length > 1020 ? list.slice(0, 1020) + "…" : list,
        inline: false,
      });
    }

    if (payload.transcriptUrl) {
      fields.push({
        name: await t(gid, "tickets.log.field_transcript"),
        value: `\`${payload.transcriptUrl}\``,
        inline: false,
      });
    }

    const embed = new EmbedBuilder()
      .setColor(Colors.danger)
      .setTitle(await t(gid, "tickets.log.closed_title"))
      .addFields(fields)
      .setTimestamp(payload.closedAt);

    // Attach the HTML transcript so admins can download and view it (text + media URLs).
    const filename = `transcript-${payload.ticketId}.html`;
    const attachment = new AttachmentBuilder(
      Buffer.from(payload.transcriptHtml, "utf8"),
      {
        name: filename,
        description: `Transcript for ticket ${payload.ticketId}`,
      },
    );

    await channel
      .send({ embeds: [embed], files: [attachment] })
      .catch((err) =>
        log.warn(
          { err: err instanceof Error ? err.message : err },
          "failed to post closed log",
        ),
      );
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      "postTicketClosed failed",
    );
  }
}

function formatCloser(closedBy: string): string {
  if (closedBy.startsWith("system:")) return `\`${closedBy}\``;
  return `<@${closedBy}>`;
}

function humanizeDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours) parts.push(`${seconds}s`);
  return parts.join(" ") || "0s";
}

/**
 * Post a follow-up embed to the admin log channel when an author submits a
 * 1-5 rating on a closed ticket. Best-effort; failures are swallowed because
 * a missing rating log must never disturb actual ticket flow.
 */
export async function postTicketRated(
  guild: Guild,
  payload: {
    ticketId: string;
    authorId: string;
    rating: number;
    claimerId?: string | null;
    comment?: string | null;
  },
): Promise<void> {
  try {
    const channel = await resolveLogChannel(guild);
    if (!channel) return;
    const gid = guild.id;
    const fields = [
      {
        name: await t(gid, "tickets.log.field_user"),
        value: `<@${payload.authorId}>`,
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_rating"),
        value: `${"⭐".repeat(payload.rating)} (${payload.rating}/5)`,
        inline: true,
      },
      {
        name: await t(gid, "tickets.log.field_ticket_id"),
        value: `\`${payload.ticketId}\``,
        inline: false,
      },
    ];
    if (payload.claimerId) {
      fields.splice(1, 0, {
        name: await t(gid, "tickets.log.field_claimed_by"),
        value: `<@${payload.claimerId}>`,
        inline: true,
      });
    }
    if (payload.comment) {
      const trimmed = payload.comment.slice(0, 1020);
      fields.push({
        name: await t(gid, "tickets.log.field_rating_comment"),
        value: trimmed,
        inline: false,
      });
    }
    const embed = new EmbedBuilder()
      .setColor(Colors.primary)
      .setTitle(await t(gid, "tickets.log.rated_title"))
      .addFields(fields)
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed] }).catch((err) =>
      log.warn(
        { err: err instanceof Error ? err.message : err },
        "failed to post rating log",
      ),
    );
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      "postTicketRated failed",
    );
  }
}

/**
 * Walk the message history of a ticket channel and collect every attachment URL
 * (images, videos, files) so we can surface them in the admin log embed.
 */
export function extractAttachmentUrls(messages: Iterable<Message>): string[] {
  const urls: string[] = [];
  for (const m of messages) {
    for (const a of m.attachments.values()) {
      urls.push(a.url);
    }
    for (const e of m.embeds) {
      if (e.image?.url) urls.push(e.image.url);
      if (e.video?.url) urls.push(e.video.url);
      if (e.thumbnail?.url && e.thumbnail.url !== e.image?.url)
        urls.push(e.thumbnail.url);
    }
  }
  return urls;
}
