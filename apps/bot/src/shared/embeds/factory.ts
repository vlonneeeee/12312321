import { EmbedBuilder } from "discord.js";
import { Colors, type ColorKey } from "./colors";

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
  return makeEmbed("success", `✓ ${title}`, description);
}

export function errorEmbed(title: string, description?: string) {
  return makeEmbed("danger", `✗ ${title}`, description);
}

export function warnEmbed(title: string, description?: string) {
  return makeEmbed("warning", `⚠ ${title}`, description);
}

export function infoEmbed(title: string, description?: string) {
  return makeEmbed("primary", title, description);
}
