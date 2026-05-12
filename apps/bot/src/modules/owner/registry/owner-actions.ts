import { child } from "@core/logger/logger";
import { ownerRouter } from "../router/owner-router";
import { evalService } from "../services/eval.service";

const log = child("owner.registry");

/**
 * Wire all built-in action handlers onto the `ownerRouter`. Phase 1 only
 * registers the `system.eval` stub (so the panel can list it as disabled);
 * Phase 2+ will keep adding handlers here as the migration progresses.
 *
 * Idempotent — safe to call again. Tests can call `ownerRouter.unregister`
 * to roll back between cases.
 */
let bootstrapped = false;

export function bootstrapOwnerRouter(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  ownerRouter.register({
    category: "system",
    action: "eval",
    description: "Execute JavaScript in the bot process (sandbox not yet available).",
    disabled: true,
    disabledReason:
      "Eval is disabled in Phase 1. Re-enabled once a sandboxed runtime ships.",
    async execute(args) {
      // Unreachable in Phase 1 — the router short-circuits on `disabled`.
      // Calling the service directly still throws, which keeps the contract
      // intact for unit tests that exercise the service path.
      return {
        message: (await evalService.executeEval({ code: String(args.code ?? "") })).output,
      };
    },
  });

  log.info({ actions: ownerRouter.list().length }, "owner.router bootstrap complete");
}
