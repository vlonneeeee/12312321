import { OwnerConfirmationRequiredError } from "../router/owner-errors";
import type { OwnerContext } from "../router/owner-context";

/**
 * Confirmation guard stub. In Phase 1 we don't have the UI panel yet, so
 * the only way to flag "yes, really do this dangerous action" is to set
 * `context.confirmed = true` from the caller (DM `--yes`, panel dialog,
 * or internal script).
 *
 * Phase 2 will replace this with an actual confirmation dialog flow.
 */
export function requireConfirmation(
  category: string,
  action: string,
  context: OwnerContext,
): void {
  if (context.confirmed !== true) {
    throw new OwnerConfirmationRequiredError(category, action);
  }
}
