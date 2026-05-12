import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  PermissionResolvable,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | SlashCommandOptionsOnlyBuilder
  | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;

/**
 * Optional rich metadata shown by `/help`. When omitted, /help falls back
 * to the Discord slash builder's own description and options.
 */
export interface SlashCommandMeta {
  /** Long human description for the per-command help page. */
  longDescription?: string;
  /** "/ban <user> [reason]" вЂ” overrides auto-derived usage. */
  usage?: string;
  /** Realistic invocation examples. */
  examples?: string[];
  /** Free-form per-arg explanations for the help page. */
  args?: { name: string; description: string; required?: boolean }[];
  /** Human-readable required permissions label, e.g. "Manage Server". */
  permissionsLabel?: string;
  /** Optional emoji shown next to the command name in /help. */
  emoji?: string;
}

export interface SlashCommand {
  data: SlashCommandData;
  /** Optional category for help / docs. */
  category?: string;
  /** Optional cooldown in seconds per-user. */
  cooldownSec?: number;
  /** Required member permissions. */
  permissions?: PermissionResolvable[];
  /** Restrict to bot owner. */
  ownerOnly?: boolean;
  /** Restrict to guild only. */
  guildOnly?: boolean;
  /** DJ role required to use this command. */
  djOnly?: boolean;
  /** Rich metadata for /help. */
  meta?: SlashCommandMeta;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export interface ButtonHandler {
  /** Custom id prefix. Example: `ticket:close` matches `ticket:close:<id>`. */
  customId: string;
  execute(interaction: import("discord.js").ButtonInteraction, params: string[]): Promise<void>;
}

export interface SelectMenuHandler {
  customId: string;
  execute(
    interaction: import("discord.js").AnySelectMenuInteraction,
    params: string[],
  ): Promise<void>;
}

export interface ModalHandler {
  customId: string;
  execute(
    interaction: import("discord.js").ModalSubmitInteraction,
    params: string[],
  ): Promise<void>;
}
