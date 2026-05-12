import { OwnerActionDisabledError } from "../router/owner-errors";

/**
 * Eval service — Phase 1 stub.
 *
 * The previous `/eval` slash command shipped a raw `new Function(code)` runner
 * with no sandbox. That was unsafe and is intentionally removed from the
 * Discord registry.
 *
 * What survives is the internal **contract** for an eval service so a future
 * sandboxed implementation can slot in without re-plumbing the router:
 *
 *   * `EvalRequest`  — what callers pass in
 *   * `EvalResult`   — what they get back
 *   * `executeEval`  — current implementation throws `OwnerActionDisabledError`
 *
 * Until a proper sandbox lands, the eval action is registered on the router
 * with `disabled: true` so the panel can render it greyed-out, and the
 * router refuses to invoke it. No code is ever executed in Phase 1.
 */

export interface EvalRequest {
  code: string;
  /** Optional timeout in milliseconds for the sandboxed evaluation. */
  timeoutMs?: number;
  /** Optional context vars exposed to the script (none in Phase 1). */
  vars?: Readonly<Record<string, unknown>>;
}

export interface EvalResult {
  /** Stringified script result (or error message). */
  output: string;
  /** Wall-clock execution time of the script body. */
  executionTimeMs: number;
}

export interface EvalService {
  /** Run a piece of code in a sandbox. Phase 1: always throws disabled. */
  executeEval(request: EvalRequest): Promise<EvalResult>;
}

/**
 * Concrete instance. Future phases (advanced) will replace the body with
 * an isolated-vm / vm2 implementation. Until then this throws so any caller
 * that bypasses the router still fails loudly.
 */
class DisabledEvalService implements EvalService {
  async executeEval(_request: EvalRequest): Promise<EvalResult> {
    throw new OwnerActionDisabledError(
      "system",
      "eval",
      "Eval is disabled in Phase 1. A sandboxed runtime will land in a future phase.",
    );
  }
}

export const evalService: EvalService = new DisabledEvalService();
