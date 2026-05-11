/**
 * Domain error hierarchy. Errors thrown from services that should be rendered
 * to the user as a friendly message should extend `UserFacingError`.
 */
export class AppError extends Error {
  public readonly code: string;
  constructor(message: string, code = "APP_ERROR") {
    super(message);
    this.code = code;
    this.name = this.constructor.name;
  }
}

export class UserFacingError extends AppError {
  constructor(message: string, code = "USER_ERROR") {
    super(message, code);
  }
}

export class PermissionDeniedError extends UserFacingError {
  constructor(message = "You don't have permission to do this.") {
    super(message, "PERMISSION_DENIED");
  }
}

export class RateLimitedError extends UserFacingError {
  constructor(retryAfterSec: number) {
    super(`Rate limited. Try again in ${retryAfterSec}s.`, "RATE_LIMITED");
  }
}

export class NotFoundError extends UserFacingError {
  constructor(what: string) {
    super(`${what} not found.`, "NOT_FOUND");
  }
}

export class InsufficientFundsError extends UserFacingError {
  constructor() {
    super("You don't have enough coins.", "INSUFFICIENT_FUNDS");
  }
}
