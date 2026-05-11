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
