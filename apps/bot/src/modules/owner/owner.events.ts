/**
 * Module-loader entry point for the owner module.
 *
 * The bot's `registry.loadFromModulesDir` walker only picks up files that
 * end with `.commands.ts / .events.ts / .buttons.ts / .selects.ts /
 * .modals.ts`. Since Phase 1 removed every owner slash command, we keep
 * this single events-shaped file as a tiny loader stub so the registry
 * imports `owner.module.ts` at boot — that import is what wires action
 * handlers onto the OwnerRouter (via `bootstrapOwnerRouter`).
 *
 * No Discord events are listened to here. Adding one in the future is
 * fine; just append to `events`.
 */
import "./owner.module";

export const events = [] as const;
