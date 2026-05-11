import type { Guild, GuildMember, User } from "discord.js";

/**
 * Resolve placeholders in welcome/goodbye/notification templates.
 *
 * Supported tokens (case-insensitive). All return safe strings.
 *
 *   {user}              → <@id> mention (default)
 *   {user.mention}      → <@id>
 *   {user.name}         → display name (member nickname or username)
 *   {user.tag}          → username#discriminator (or just username on new Discord)
 *   {user.id}           → snowflake id
 *   {user.avatar}       → avatar URL (size 512)
 *   {server}            → guild name (default)
 *   {server.name}       → guild name
 *   {server.id}         → guild id
 *   {server.icon}       → guild icon URL
 *   {count}             → guild memberCount
 *   {memberCount}       → alias for {count}
 *
 * Unknown tokens are left untouched so a typo is visible in the preview.
 */
export interface PlaceholderContext {
  user: User;
  guild: Guild;
  member?: GuildMember | null;
}

const TOKEN_RE = /\{([a-z][a-z0-9_.]*)\}/gi;

export function resolvePlaceholders(
  template: string,
  ctx: PlaceholderContext,
): string {
  if (!template) return template;
  return template.replace(TOKEN_RE, (raw, key: string) => {
    const v = resolveToken(key.toLowerCase(), ctx);
    return v ?? raw;
  });
}

function resolveToken(key: string, ctx: PlaceholderContext): string | null {
  const { user, guild, member } = ctx;
  switch (key) {
    case "user":
    case "user.mention":
      return `<@${user.id}>`;
    case "user.name":
      return member?.displayName ?? user.username;
    case "user.tag":
      return user.discriminator && user.discriminator !== "0"
        ? `${user.username}#${user.discriminator}`
        : user.username;
    case "user.id":
      return user.id;
    case "user.avatar":
      return user.displayAvatarURL({ size: 512 });
    case "server":
    case "server.name":
    case "guild":
    case "guild.name":
      return guild.name;
    case "server.id":
    case "guild.id":
      return guild.id;
    case "server.icon":
    case "guild.icon":
      return guild.iconURL({ size: 512 }) ?? "";
    case "count":
    case "membercount":
    case "server.count":
      return String(guild.memberCount);
    default:
      return null;
  }
}
