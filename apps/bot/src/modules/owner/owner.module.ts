// =============================================================================
//  Owner system — internal infrastructure layer.
//
//  Phase 1 deliverables:
//    * Owner is invoked via the internal OwnerRouter ONLY. No slash commands.
//    * Every action is gated behind the OWNER_ID guard.
//    * Every action is audited (Prisma `OwnerAudit` + structured pino logs).
//    * Action handlers are registered with categories so a future UI panel
//      can list / dispatch them without re-implementing the router.
//
//  This barrel exports the public surface for callers that just want to ask
//  "is there an owner router I can dispatch a command on?" — without diving
//  into the file layout. The directory layout under `modules/owner/` is:
//
//    router/      — OwnerRouter + context + error types
//    middleware/  — OWNER_ID guard + confirmation guard
//    audit/       — OwnerAudit Prisma writer + pino structured logger
//    services/    — internal action services (no slash exposure)
//    internal/    — utilities preserved from the legacy slash layer
//                   (chaos / meme / lockdown state, message helpers, ...)
//    registry/    — central place where action handlers are wired into the
//                   router on bot boot
// =============================================================================

export { ownerRouter, OwnerRouter } from "./router/owner-router";
export type {
  OwnerActionDescriptor,
  OwnerActionHandler,
  OwnerActionResult,
  OwnerActionArgs,
} from "./router/owner-router";
export {
  OwnerForbiddenError,
  OwnerActionNotFoundError,
  OwnerActionDisabledError,
  OwnerConfirmationRequiredError,
  OwnerActionFailedError,
} from "./router/owner-errors";
export type { OwnerContext, OwnerContextSource } from "./router/owner-context";

export { assertOwnerContext } from "./middleware/owner-guard";
export { requireConfirmation } from "./middleware/owner-confirm";

export { ownerAudit } from "./audit/owner-audit.service";
export { OwnerAuditStatus } from "./audit/owner-audit.types";
export type { OwnerAuditRecord, OwnerAuditInput } from "./audit/owner-audit.types";

export { ownerState, randomMeme } from "./internal/owner-state";
export { evalService } from "./services/eval.service";
export type { EvalService, EvalRequest, EvalResult } from "./services/eval.service";

import { bootstrapOwnerRouter } from "./registry/owner-actions";

/**
 * Initialise the owner router so it is ready by the time the bot finishes
 * loading modules. Invoked once by the module loader. Safe to call again —
 * the bootstrap is idempotent.
 */
bootstrapOwnerRouter();
