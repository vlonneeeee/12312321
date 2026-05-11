import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type {
  ButtonHandler,
  SlashCommand,
} from "@core/handler/command";
import { prisma } from "@core/db/prisma";
import { infoEmbed, errorEmbed } from "@shared/embeds/factory";
import { Colors } from "@shared/embeds/colors";
import { t } from "@core/i18n";
import { child } from "@core/logger/logger";

const log = child("tickets:search");

const PAGE_SIZE = 5;
const MAX_PAGES = 200; // hard cap so we never page through tens of thousands

/** Filter envelope encoded into pagination button custom ids. */
interface SearchFilters {
  author?: string;
  category?: string;
  status?: "open" | "claimed" | "closed";
  text?: string;
  id?: string;
}

const search: SlashCommand = {
  category: "tickets",
  guildOnly: true,
  permissions: [PermissionsBitField.Flags.ManageGuild],
  data: new SlashCommandBuilder()
    .setName("ticket-search")
    .setDescription("Search the ticket archive.")
    .addUserOption((o) =>
      o.setName("author").setDescription("Filter by ticket author"),
    )
    .addStringOption((o) =>
      o.setName("category").setDescription("Filter by category key"),
    )
    .addStringOption((o) =>
      o
        .setName("status")
        .setDescription("Filter by status")
        .addChoices(
          { name: "open", value: "open" },
          { name: "claimed", value: "claimed" },
          { name: "closed", value: "closed" },
        ),
    )
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription(
          "Free-text search across subject, modal answers and transcript",
        ),
    )
    .addStringOption((o) =>
      o.setName("id").setDescription("Look up a specific ticket by ID"),
    ),
  async execute(interaction) {
    const filters: SearchFilters = {
      author: interaction.options.getUser("author")?.id,
      category: interaction.options.getString("category") ?? undefined,
      status: (interaction.options.getString("status") as SearchFilters["status"]) ?? undefined,
      text: interaction.options.getString("text") ?? undefined,
      id: interaction.options.getString("id") ?? undefined,
    };
    await respond(interaction, filters, 0);
  },
};

/** Encode filters into base64url so pagination buttons can survive restarts. */
function encodeFilters(f: SearchFilters): string {
  const j = JSON.stringify({
    a: f.author ?? null,
    c: f.category ?? null,
    s: f.status ?? null,
    t: f.text ?? null,
    i: f.id ?? null,
  });
  return Buffer.from(j, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function decodeFilters(s: string): SearchFilters {
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/");
    const j = Buffer.from(padded, "base64").toString("utf8");
    const o = JSON.parse(j) as {
      a?: string | null;
      c?: string | null;
      s?: SearchFilters["status"] | null;
      t?: string | null;
      i?: string | null;
    };
    return {
      author: o.a ?? undefined,
      category: o.c ?? undefined,
      status: o.s ?? undefined,
      text: o.t ?? undefined,
      id: o.i ?? undefined,
    };
  } catch {
    return {};
  }
}

async function respond(
  interaction:
    | ChatInputCommandInteraction
    | import("discord.js").ButtonInteraction,
  filters: SearchFilters,
  page: number,
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) return;
  const where = buildWhere(guildId, filters);

  const [total, rows] = await Promise.all([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        authorId: true,
        category: true,
        subject: true,
        status: true,
        claimerId: true,
        rating: true,
        createdAt: true,
        closedAt: true,
        transcriptUrl: true,
      },
    }),
  ]);

  if (total === 0) {
    const embed = infoEmbed(
      await t(guildId, "tickets.search.title"),
      await t(guildId, "tickets.search.no_results"),
    );
    if (interaction.isChatInputCommand()) {
      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.update({ embeds: [embed], components: [] });
    }
    return;
  }

  const totalPages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  const embed = new EmbedBuilder()
    .setColor(Colors.primary)
    .setTitle(await t(guildId, "tickets.search.title"))
    .setDescription(
      await t(guildId, "tickets.search.header", {
        total,
        page: safePage + 1,
        pages: totalPages,
      }),
    );

  for (const r of rows) {
    const lines: string[] = [];
    lines.push(
      `**${await t(guildId, "tickets.search.row_author")}:** <@${r.authorId}>`,
    );
    lines.push(
      `**${await t(guildId, "tickets.search.row_category")}:** ${r.category}`,
    );
    if (r.subject) {
      lines.push(
        `**${await t(guildId, "tickets.search.row_subject")}:** ${truncate(r.subject, 200)}`,
      );
    }
    lines.push(
      `**${await t(guildId, "tickets.search.row_status")}:** ${r.status}`,
    );
    if (r.claimerId) {
      lines.push(
        `**${await t(guildId, "tickets.search.row_claimer")}:** <@${r.claimerId}>`,
      );
    }
    if (r.rating !== null && r.rating !== undefined) {
      lines.push(
        `**${await t(guildId, "tickets.search.row_rating")}:** ${"⭐".repeat(r.rating)} (${r.rating}/5)`,
      );
    }
    lines.push(
      `**${await t(guildId, "tickets.search.row_opened")}:** <t:${Math.floor(r.createdAt.getTime() / 1000)}:R>`,
    );
    if (r.closedAt) {
      lines.push(
        `**${await t(guildId, "tickets.search.row_closed")}:** <t:${Math.floor(r.closedAt.getTime() / 1000)}:R>`,
      );
    }
    if (r.transcriptUrl) {
      lines.push(
        `**${await t(guildId, "tickets.search.row_transcript")}:** \`${r.transcriptUrl}\``,
      );
    }
    embed.addFields({
      name: `\`${r.id}\``,
      value: truncate(lines.join("\n"), 1020),
      inline: false,
    });
  }

  const enc = encodeFilters(filters);
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (totalPages > 1) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket-search:page:${enc}:${safePage - 1}`)
        .setLabel(await t(guildId, "tickets.search.prev"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`ticket-search:page:${enc}:${safePage + 1}`)
        .setLabel(await t(guildId, "tickets.search.next"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1),
    );
    components.push(row);
  }

  if (interaction.isChatInputCommand()) {
    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  } else {
    await interaction.update({ embeds: [embed], components });
  }
}

function buildWhere(
  guildId: string,
  filters: SearchFilters,
): import("@prisma/client").Prisma.TicketWhereInput {
  const where: import("@prisma/client").Prisma.TicketWhereInput = { guildId };
  if (filters.id) where.id = filters.id;
  if (filters.author) where.authorId = filters.author;
  if (filters.category) where.category = filters.category;
  if (filters.status) where.status = filters.status;
  if (filters.text) {
    const q = filters.text.trim().slice(0, 200);
    if (q.length > 0) {
      where.OR = [
        { subject: { contains: q, mode: "insensitive" } },
        { transcriptHtml: { contains: q, mode: "insensitive" } },
        // Postgres JSON: cast to text and search. Prisma 5 supports
        // `string_contains`/`path` but on top-level we want a free scan over
        // every value so we use raw JSON-as-text matching via a raw query.
      ];
    }
  }
  return where;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

const pageButton: ButtonHandler = {
  customId: "ticket-search:page",
  async execute(interaction, params) {
    const [enc, pageRaw] = params;
    if (!enc || !pageRaw) return;
    const page = Math.max(0, Number(pageRaw));
    if (!Number.isFinite(page)) return;

    // Permission re-check: pagination buttons are public-clickable so we must
    // never let a non-staff member step through someone else's results.
    const member = interaction.member;
    const perms =
      typeof member?.permissions === "string"
        ? new PermissionsBitField(BigInt(member.permissions))
        : (member?.permissions as PermissionsBitField | undefined);
    if (!perms?.has(PermissionsBitField.Flags.ManageGuild)) {
      await interaction
        .reply({
          embeds: [
            errorEmbed(
              await t(interaction.guildId, "interaction.forbidden_title"),
              await t(interaction.guildId, "common.no_permission"),
            ),
          ],
          ephemeral: true,
        })
        .catch(() => null);
      return;
    }

    try {
      await respond(interaction, decodeFilters(enc), page);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err },
        "ticket-search pagination failed",
      );
    }
  },
};

export const commands = [search];
export const buttons = [pageButton];
