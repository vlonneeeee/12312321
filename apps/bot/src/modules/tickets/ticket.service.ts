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
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

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
        where: { guildId: guild.id, authorId: author.id, status: { not: "closed" } },
      });
      if (existing) {
        throw new UserFacingError(`You already have an open ticket: <#${existing.channelId}>`);
      }
      const parentId = category.categoryId ?? (await this.defaultCategory(guild.id));
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
      await channel.send({
        content: `<@${author.id}>`,
        embeds: [
          successEmbed(
            `Ticket opened`,
            `Category: **${category.label}**\nSubject: ${opts.subject ?? "(none)"}\nStaff will be with you shortly.`,
          ),
        ],
        components: [controls],
      });
      return { ticketId: ticket.id, channelId: channel.id };
    });
  }

  async claim(ticketId: string, claimer: GuildMember): Promise<void> {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status === "closed") throw new UserFacingError("Ticket not found.");
    if (ticket.claimerId) throw new UserFacingError(`Ticket already claimed by <@${ticket.claimerId}>.`);
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { claimerId: claimer.id, claimedAt: new Date(), status: "claimed" },
    });
    const channel = (await claimer.guild.channels.fetch(ticket.channelId).catch(() => null)) as
      | TextChannel
      | null;
    await channel?.send({ embeds: [infoEmbed("Claimed", `Claimed by <@${claimer.id}>`)] });
  }

  async close(ticketId: string, closer: GuildMember): Promise<string> {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status === "closed") throw new UserFacingError("Ticket already closed.");
    const guild = closer.guild;
    const channel = (await guild.channels.fetch(ticket.channelId).catch(() => null)) as TextChannel | null;
    if (!channel) throw new UserFacingError("Ticket channel missing.");

    const transcriptUrl = await this.generateTranscript(channel, ticket.id);
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: "closed",
        closedAt: new Date(),
        closedBy: closer.id,
        transcriptUrl,
      },
    });
    eventBus.emit("ticket.closed", { ticketId, guildId: guild.id, closedBy: closer.id });
    await channel.delete("Ticket closed").catch(() => null);
    return transcriptUrl;
  }

  private async defaultCategory(guildId: string): Promise<string | null> {
    const g = await prisma.guild.findUnique({
      where: { id: guildId },
      select: { ticketCategoryId: true },
    });
    return g?.ticketCategoryId ?? null;
  }

  private async generateTranscript(channel: TextChannel, ticketId: string): Promise<string> {
    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      const html = renderTranscript(channel.name, [...messages.values()].reverse());
      const dir = path.resolve(process.cwd(), "transcripts");
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${ticketId}.html`);
      await writeFile(file, html, "utf8");
      return `file://${file}`;
    } catch (err) {
      log.warn({ err, ticketId }, "transcript failed");
      return "";
    }
  }
}

function renderTranscript(
  name: string,
  messages: { author: { tag: string }; content: string; createdAt: Date }[],
): string {
  const body = messages
    .map(
      (m) =>
        `<li><strong>${escapeHtml(m.author.tag)}</strong> · <span style="opacity:.6">${m.createdAt.toISOString()}</span><br>${escapeHtml(m.content)}</li>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(name)}</title>
<style>body{font-family:system-ui;background:#1e1f22;color:#dbdee1;max-width:780px;margin:32px auto;padding:16px}
li{margin:8px 0;border-bottom:1px solid #2b2d31;padding-bottom:8px;list-style:none}</style>
</head><body><h1>${escapeHtml(name)}</h1><ul>${body}</ul></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const ticketService = new TicketService();
