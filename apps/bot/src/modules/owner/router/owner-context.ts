/**
 * OwnerContext — everything the router needs to know about WHO invoked an
 * action and WHERE the invocation came from. Carried through guards, the
 * router itself, and into action handlers + audit records.
 *
 * The context is intentionally narrow: it carries only fields that make
 * sense for audit, guards, and i18n. Action handlers may carry additional
 * action-specific data via `args`, NOT here.
 */
export type OwnerContextSource =
  /** Invoked from a future Discord UI panel (buttons / selects). */
  | "panel"
  /** Invoked from a DM fallback channel. */
  | "dm"
  /** Internal call from a background job or scheduler. */
  | "internal"
  /** Invoked from a script / one-off tool. */
  | "script";

export interface OwnerContext {
  /** Discord user id of the caller. Must be a member of env.OWNER_IDS. */
  callerId: string;
  /** Where the call originated from — used for audit + UX hints. */
  source: OwnerContextSource;
  /** Optional Discord guild id when the action targets a specific guild. */
  guildId?: string;
  /** Optional Discord channel id where the invocation happened. */
  channelId?: string;
  /** Locale to use for any user-facing strings in the result. */
  locale?: string;
  /**
   * For dangerous actions: caller has explicitly confirmed via a UI dialog
   * or `--yes` flag. The router rejects dangerous actions when this is
   * `false`.
   */
  confirmed?: boolean;
  /** Free-form correlation id for tying audit + log entries together. */
  correlationId?: string;
}
