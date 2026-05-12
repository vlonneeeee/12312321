/**
 * Typed errors raised by the OwnerRouter / its guards.
 *
 * Action handlers should NOT throw raw `Error`s — they should let the
 * router surface a structured result. These error types are the contract
 * for callers (e.g. the future panel) that want to distinguish "forbidden"
 * from "action does not exist".
 */

export class OwnerError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "OwnerError";
  }
}

/** Caller is not a member of env.OWNER_IDS. */
export class OwnerForbiddenError extends OwnerError {
  constructor(callerId: string) {
    super(`Caller ${callerId} is not an OWNER`, "OWNER_FORBIDDEN");
    this.name = "OwnerForbiddenError";
  }
}

/** Requested category/action pair is not registered on the router. */
export class OwnerActionNotFoundError extends OwnerError {
  constructor(category: string, action: string) {
    super(`Owner action ${category}.${action} is not registered`, "OWNER_ACTION_NOT_FOUND");
    this.name = "OwnerActionNotFoundError";
  }
}

/**
 * Action exists but is explicitly disabled (e.g. the eval-service stub:
 * registered for discoverability but refuses to run in Phase 1).
 */
export class OwnerActionDisabledError extends OwnerError {
  constructor(category: string, action: string, reason?: string) {
    super(
      `Owner action ${category}.${action} is disabled${reason ? `: ${reason}` : ""}`,
      "OWNER_ACTION_DISABLED",
    );
    this.name = "OwnerActionDisabledError";
  }
}

/** Action is marked `dangerous` but the context didn't carry a confirmation. */
export class OwnerConfirmationRequiredError extends OwnerError {
  constructor(category: string, action: string) {
    super(
      `Owner action ${category}.${action} requires confirmation`,
      "OWNER_CONFIRMATION_REQUIRED",
    );
    this.name = "OwnerConfirmationRequiredError";
  }
}

/** The handler threw — wrap so callers can pattern-match on it. */
export class OwnerActionFailedError extends OwnerError {
  override readonly cause?: unknown;
  constructor(category: string, action: string, cause: unknown) {
    super(`Owner action ${category}.${action} failed`, "OWNER_ACTION_FAILED");
    this.name = "OwnerActionFailedError";
    this.cause = cause;
  }
}
