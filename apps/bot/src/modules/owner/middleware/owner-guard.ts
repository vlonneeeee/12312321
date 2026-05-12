import { env } from "@core/config/env";
import { child } from "@core/logger/logger";
import { isOwner } from "@shared/utils/perms";
import { OwnerForbiddenError } from "../router/owner-errors";
import type { OwnerContext } from "../router/owner-context";

const log = child("owner.guard");

let warnedAboutEmptyConfig = false;

/**
 * OWNER_ID guard. The router calls this BEFORE any action handler executes,
 * and panel/DM entry points should call it as well so unauthorised callers
 * never observe handler timing or audit churn.
 *
 * Throws `OwnerForbiddenError` if the caller is not an owner. Also emits a
 * one-time warning at startup if `env.OWNER_IDS` is empty — otherwise the
 * router would silently deny every call.
 */
export function assertOwnerContext(context: OwnerContext): void {
  if (env.OWNER_IDS.length === 0 && !warnedAboutEmptyConfig) {
    warnedAboutEmptyConfig = true;
    log.warn(
      { source: context.source },
      "OWNER_IDS / OWNER_ID is empty — no caller will ever pass the owner guard.",
    );
  }
  if (!isOwner(context.callerId)) {
    log.warn(
      { callerId: context.callerId, source: context.source },
      "owner.guard rejected non-owner caller",
    );
    throw new OwnerForbiddenError(context.callerId);
  }
}
