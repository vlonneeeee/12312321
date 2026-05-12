import { EmbedBuilder } from "discord.js";
import { Colors, type ColorKey } from "./colors";

/**
 * Central embed factory. Every module should build its embeds through one of
 * these helpers so colours, glyphs and footer style stay consistent.
 */
export function makeEmbed(
  type: ColorKey,
  title: string,
  description?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(Colors[type]).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

export function successEmbed(title: string, description?: string) {
  return makeEmbed("success", `вњ“ ${title}`, description);
}

export function errorEmbed(title: string, description?: string) {
  return makeEmbed("danger", `вњ— ${title}`, description);
}

export function warnEmbed(title: string, description?: string) {
  return makeEmbed("warning", `вљ  ${title}`, description);
}

export function infoEmbed(title: string, description?: string) {
  return makeEmbed("primary", title, description);
}

/**
 * Branded embed for OWNER-only output (purple/premium accent so it visually
 * stands out from regular admin replies).
 */
export function ownerEmbed(title: string, description?: string) {
  return makeEmbed("premium", `в… OWN В· ${title}`, description);
}
