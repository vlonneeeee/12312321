import {
  ApplicationCommandOptionType,
  PermissionsBitField,
  type PermissionResolvable,
} from "discord.js";
import type { SlashCommand } from "@core/handler/command";
import { registry } from "@core/handler/registry";
import { tWithLocale, type Locale } from "@core/i18n";
import { isOwner } from "@shared/utils/perms";

export const OWNER_CATEGORY = "owner";

export const CATEGORY_EMOJIS: Record<string, string> = {
  core: "рџЏ ",
  admin: "рџ› пёЏ",
  moderation: "рџ›ЎпёЏ",
  music: "рџЋµ",
  economy: "рџ’°",
  casino: "рџЋ°",
  tickets: "рџЋ«",
  clans: "вљ”пёЏ",
  events: "рџ“…",
  profile: "рџ‘¤",
  leaderboard: "рџЏ†",
  news: "рџ“°",
  polls: "рџ“Љ",
  roles: "рџЋЁ",
  housing: "рџЏпёЏ",
  metaverse: "рџЊЊ",
  analytics: "рџ“€",
  verification: "вњ…",
  levels: "в­ђ",
  general: "рџ§©",
  misc: "рџ“¦",
  [OWNER_CATEGORY]: "рџ‘‘",
};

/**
 * A "category card" used by the /help embeds and the select menu.
 */
export interface HelpCategoryView {
  key: string;
  label: string;
  emoji: string;
  commands: SlashCommand[];
}

/**
 * Returns the curated view of help categories. The OWNER category is included
 * only when `viewerIsOwner` is true (or when `includeOwner` is forced on).
 */
export function buildCategoryViews(
  locale: Locale,
  viewerIsOwner: boolean,
  includeOwner = false,
): HelpCategoryView[] {
  const buckets = new Map<string, SlashCommand[]>();
  for (const cmd of registry.commands.values()) {
    const cat = cmd.category ?? "misc";
    const isOwnerCmd = cmd.ownerOnly === true || cat === OWNER_CATEGORY;
    if (isOwnerCmd && !(viewerIsOwner || includeOwner)) continue;
    const key = isOwnerCmd ? OWNER_CATEGORY : cat;
    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(cmd);
  }

  const views: HelpCategoryView[] = [];
  for (const [key, cmds] of buckets) {
    cmds.sort((a, b) => a.data.name.localeCompare(b.data.name));
    views.push({
      key,
      label: categoryLabel(locale, key),
      emoji: CATEGORY_EMOJIS[key] ?? "рџ“¦",
      commands: cmds,
    });
  }

  views.sort((a, b) => {
    // OWNER category is always pinned to the bottom for visual hierarchy.
    if (a.key === OWNER_CATEGORY) return 1;
    if (b.key === OWNER_CATEGORY) return -1;
    return a.label.localeCompare(b.label);
  });
  return views;
}

export function categoryLabel(locale: Locale, key: string): string {
  const i18nKey = `help.category.${key}`;
  const translated = tWithLocale(locale, i18nKey);
  return translated === i18nKey ? defaultCategoryLabel(key) : translated;
}

function defaultCategoryLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function commandShortDescription(locale: Locale, cmd: SlashCommand): string {
  const key = `help.cmd.${cmd.data.name}`;
  const translated = tWithLocale(locale, key);
  return translated === key ? cmd.data.description : translated;
}

/** Build a deterministic "/foo <user> [reason]" usage from the slash builder. */
export function deriveUsage(cmd: SlashCommand): string {
  const data = cmd.data.toJSON();
  if (cmd.meta?.usage) return cmd.meta.usage;
  const parts: string[] = [`/${data.name}`];
  for (const opt of data.options ?? []) {
    if (
      opt.type === ApplicationCommandOptionType.Subcommand ||
      opt.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      parts.push(`<${opt.name}>`);
      continue;
    }
    // discord-api-types BasicApplicationCommandOptionBase has `required`.
    const required = (opt as { required?: boolean }).required ?? false;
    parts.push(required ? `<${opt.name}>` : `[${opt.name}]`);
  }
  return parts.join(" ");
}

export function deriveArgList(
  cmd: SlashCommand,
): { name: string; description: string; required: boolean }[] {
  if (cmd.meta?.args && cmd.meta.args.length > 0) {
    return cmd.meta.args.map((a) => ({
      name: a.name,
      description: a.description,
      required: a.required ?? false,
    }));
  }
  const data = cmd.data.toJSON();
  const out: { name: string; description: string; required: boolean }[] = [];
  for (const opt of data.options ?? []) {
    if (
      opt.type === ApplicationCommandOptionType.Subcommand ||
      opt.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      out.push({
        name: opt.name,
        description: (opt as { description?: string }).description ?? "вЂ”",
        required: false,
      });
      continue;
    }
    const o = opt as { description?: string; required?: boolean };
    out.push({
      name: opt.name,
      description: o.description ?? "вЂ”",
      required: o.required ?? false,
    });
  }
  return out;
}

export function permissionsLabel(cmd: SlashCommand): string | null {
  if (cmd.meta?.permissionsLabel) return cmd.meta.permissionsLabel;
  if (cmd.ownerOnly) return "OWNER";
  if (!cmd.permissions || cmd.permissions.length === 0) return null;
  return cmd.permissions.map(formatPermission).join(", ");
}

function formatPermission(p: PermissionResolvable): string {
  try {
    const bf = new PermissionsBitField(p);
    return bf
      .toArray()
      .map((s) => s.replace(/([A-Z])/g, " $1").trim())
      .join(", ");
  } catch {
    return String(p);
  }
}

/**
 * Resolve a viewer for the help interaction. Owners see hidden categories.
 */
export function resolveViewer(userId: string): { isOwner: boolean } {
  return { isOwner: isOwner(userId) };
}
