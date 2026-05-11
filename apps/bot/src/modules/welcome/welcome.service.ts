import {
  ColorResolvable,
  EmbedBuilder,
  type Guild,
  type GuildMember,
  type MessageCreateOptions,
} from "discord.js";
import { Colors } from "@shared/embeds/colors";
import { resolvePlaceholders } from "@shared/utils/placeholders";

/**
 * Stored JSON shape for welcome/goodbye embed.
 * Fields are optional so an admin can opt into "plain text + image" too.
 *
 * Stored verbatim in Guild.welcomeEmbed / Guild.goodbyeEmbed (Json?).
 */
export interface WelcomeEmbedPayload {
  title?: string | null;
  description?: string | null;
  color?: string | number | null; // hex like "#5865F2" or decimal
  image?: string | null; // banner
  thumbnail?: string | null;
  footer?: string | null;
}

/**
 * Defensive parser: the column is `Json?` so the runtime type is `unknown`.
 * Returns null for anything that doesn't smell like our payload.
 */
export function parseWelcomeEmbed(raw: unknown): WelcomeEmbedPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: WelcomeEmbedPayload = {};
  if (typeof o.title === "string") out.title = o.title;
  if (typeof o.description === "string") out.description = o.description;
  if (typeof o.color === "string" || typeof o.color === "number")
    out.color = o.color as string | number;
  if (typeof o.image === "string") out.image = o.image;
  if (typeof o.thumbnail === "string") out.thumbnail = o.thumbnail;
  if (typeof o.footer === "string") out.footer = o.footer;
  return out;
}

function resolveColor(
  color: string | number | null | undefined,
  fallback: number,
): ColorResolvable {
  if (typeof color === "number" && Number.isFinite(color)) return color;
  if (typeof color === "string") {
    const m = color.trim().replace(/^#/, "");
    if (/^[0-9a-f]{6}$/i.test(m)) return parseInt(m, 16);
    const n = Number(color);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

interface BuildOpts {
  guild: Guild;
  member: GuildMember;
  /** Plain-text message. May be empty if embed-only. */
  text: string | null;
  embed: WelcomeEmbedPayload | null;
  /** Color used when payload doesn't override it. */
  fallbackColor: number;
}

/**
 * Build a Discord-ready message payload for welcome / goodbye.
 *
 * Behavior:
 *   - placeholders are resolved across both text and embed strings,
 *   - if any embed field is set, a rich embed is attached,
 *   - otherwise we send the plain content only.
 */
export function buildMemberEventMessage(opts: BuildOpts): MessageCreateOptions {
  const { guild, member, text, embed, fallbackColor } = opts;
  const ctx = { user: member.user, guild, member };
  const content = text ? resolvePlaceholders(text, ctx) : undefined;

  const hasEmbed =
    embed &&
    (embed.title || embed.description || embed.image || embed.thumbnail || embed.footer);

  if (!hasEmbed) {
    return content ? { content } : { content: "" };
  }

  const eb = new EmbedBuilder().setColor(
    resolveColor(embed!.color, fallbackColor),
  );
  if (embed!.title) eb.setTitle(resolvePlaceholders(embed!.title, ctx));
  if (embed!.description)
    eb.setDescription(resolvePlaceholders(embed!.description, ctx));
  if (embed!.image) eb.setImage(resolvePlaceholders(embed!.image, ctx));
  if (embed!.thumbnail) eb.setThumbnail(resolvePlaceholders(embed!.thumbnail, ctx));
  if (embed!.footer)
    eb.setFooter({ text: resolvePlaceholders(embed!.footer, ctx) });

  return content ? { content, embeds: [eb] } : { embeds: [eb] };
}

export const WELCOME_DEFAULT_COLOR = Colors.success;
export const GOODBYE_DEFAULT_COLOR = Colors.neutral;
