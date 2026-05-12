import { randomUUID } from "node:crypto";
import { child } from "@core/logger/logger";
import { ownerAudit } from "../audit/owner-audit.service";
import { OwnerAuditStatus } from "../audit/owner-audit.types";
import { assertOwnerContext } from "../middleware/owner-guard";
import { requireConfirmation } from "../middleware/owner-confirm";
import type { OwnerContext } from "./owner-context";
import {
  OwnerActionDisabledError,
  OwnerActionFailedError,
  OwnerActionNotFoundError,
  OwnerConfirmationRequiredError,
  OwnerForbiddenError,
} from "./owner-errors";

const log = child("owner.router");

/* -------------------------------------------------------------------------- */
/*  Public types                                                              */
/* -------------------------------------------------------------------------- */

/** Free-form structured arguments passed to an action handler. */
export type OwnerActionArgs = Readonly<Record<string, unknown>>;

/** Discriminated result the router returns to its caller. */
export type OwnerActionResult<TData = unknown> =
  | {
      ok: true;
      auditId: string | null;
      executionTimeMs: number;
      message?: string;
      data?: TData;
    }
  | {
      ok: false;
      auditId: string | null;
      executionTimeMs: number;
      status: OwnerAuditStatus;
      message: string;
      errorCode?: string;
    };

/** What an action handler returns. `ok: true` and the router fills in the rest. */
export interface OwnerActionHandlerResult<TData = unknown> {
  message?: string;
  data?: TData;
  /** Extra fields appended to the audit record on success. */
  metadata?: Record<string, unknown>;
  /** Optional audit target id (user / guild / resource). */
  target?: string;
}

export interface OwnerActionHandler<
  TArgs extends OwnerActionArgs = OwnerActionArgs,
  TData = unknown,
> {
  category: string;
  action: string;
  /** Human-readable summary for the future Discord UI panel. */
  description?: string;
  /**
   * Mark dangerous actions so the router enforces `context.confirmed === true`
   * before invoking the handler. Phase 1 uses a stub guard; Phase 2 wires
   * an actual confirmation dialog.
   */
  dangerous?: boolean;
  /**
   * If true, the action is registered (so it shows up in `list()` and the
   * UI panel can render it) but the router refuses to invoke it. Used by
   * the eval-service stub in Phase 1.
   */
  disabled?: boolean;
  /** Optional reason exposed when a disabled action is invoked. */
  disabledReason?: string;
  /**
   * Optional argument validator. Throw or return false to reject the input;
   * keep this synchronous and side-effect free.
   */
  validate?(args: TArgs): args is TArgs;
  execute(args: TArgs, context: OwnerContext): Promise<OwnerActionHandlerResult<TData>>;
}

/** Slim descriptor used by panels / `list()`. */
export interface OwnerActionDescriptor {
  category: string;
  action: string;
  description?: string;
  dangerous: boolean;
  disabled: boolean;
  disabledReason?: string;
}

interface InvokeInput<TArgs extends OwnerActionArgs = OwnerActionArgs> {
  category: string;
  action: string;
  args?: TArgs;
  context: OwnerContext;
}

/* -------------------------------------------------------------------------- */
/*  Router                                                                    */
/* -------------------------------------------------------------------------- */

const REDACTED = "[REDACTED]";
const SENSITIVE_ARG_KEYS = new Set([
  "token",
  "password",
  "secret",
  "authorization",
  "apikey",
  "api_key",
]);

function sanitiseArgs(args: OwnerActionArgs | undefined): Record<string, unknown> | null {
  if (!args) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = SENSITIVE_ARG_KEYS.has(k.toLowerCase()) ? REDACTED : v;
  }
  return out;
}

function actionKey(category: string, action: string): string {
  return `${category}.${action}`;
}

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export class OwnerRouter {
  private readonly handlers = new Map<string, OwnerActionHandler>();

  /**
   * Register a handler. Throws if (category, action) is already taken —
   * keeps double-registration bugs loud rather than silent.
   */
  register<TArgs extends OwnerActionArgs, TData>(
    handler: OwnerActionHandler<TArgs, TData>,
  ): void {
    const key = actionKey(handler.category, handler.action);
    if (this.handlers.has(key)) {
      throw new Error(`OwnerRouter: action ${key} is already registered`);
    }
    this.handlers.set(key, handler as unknown as OwnerActionHandler);
    log.debug(
      {
        category: handler.category,
        action: handler.action,
        dangerous: !!handler.dangerous,
        disabled: !!handler.disabled,
      },
      "owner.router action registered",
    );
  }

  /** Remove a handler (useful for tests / hot-reload). */
  unregister(category: string, action: string): boolean {
    return this.handlers.delete(actionKey(category, action));
  }

  /** Lookup without invoking. */
  has(category: string, action: string): boolean {
    return this.handlers.has(actionKey(category, action));
  }

  /** List handlers, optionally filtered by category. */
  list(category?: string): OwnerActionDescriptor[] {
    const out: OwnerActionDescriptor[] = [];
    for (const h of this.handlers.values()) {
      if (category && h.category !== category) continue;
      out.push({
        category: h.category,
        action: h.action,
        description: h.description,
        dangerous: !!h.dangerous,
        disabled: !!h.disabled,
        disabledReason: h.disabledReason,
      });
    }
    return out;
  }

  /**
   * Invoke an action. Wraps the handler in:
   *   1. Owner guard (env.OWNER_IDS check)
   *   2. Action lookup
   *   3. `disabled` short-circuit (e.g. /eval stub)
   *   4. Confirmation guard for dangerous actions
   *   5. Audit start (PENDING row)
   *   6. Handler execution + timing
   *   7. Audit finish with status + executionTimeMs + error message
   *
   * Returns a discriminated `OwnerActionResult` so callers don't need
   * try/catch for any of the structured failure modes.
   */
  async run<TArgs extends OwnerActionArgs = OwnerActionArgs, TData = unknown>(
    input: InvokeInput<TArgs>,
  ): Promise<OwnerActionResult<TData>> {
    const started = Date.now();
    const correlationId = input.context.correlationId ?? randomUUID();
    const context: OwnerContext = { ...input.context, correlationId };
    const { category, action } = input;
    const args = input.args;

    // 1. Owner guard ---------------------------------------------------------
    try {
      assertOwnerContext(context);
    } catch (err) {
      if (err instanceof OwnerForbiddenError) {
        const record = await ownerAudit.record({
          ownerId: context.callerId,
          category,
          action,
          payload: sanitiseArgs(args),
          status: OwnerAuditStatus.FORBIDDEN,
          errorMessage: err.message,
          executionTimeMs: Date.now() - started,
          metadata: this.contextMetadata(context),
        });
        return {
          ok: false,
          auditId: record?.id ?? null,
          executionTimeMs: Date.now() - started,
          status: OwnerAuditStatus.FORBIDDEN,
          message: err.message,
          errorCode: err.code,
        };
      }
      throw err;
    }

    // 2. Lookup --------------------------------------------------------------
    const handler = this.handlers.get(actionKey(category, action));
    if (!handler) {
      const err = new OwnerActionNotFoundError(category, action);
      const record = await ownerAudit.record({
        ownerId: context.callerId,
        category,
        action,
        payload: sanitiseArgs(args),
        status: OwnerAuditStatus.FAILED,
        errorMessage: err.message,
        executionTimeMs: Date.now() - started,
        metadata: this.contextMetadata(context),
      });
      return {
        ok: false,
        auditId: record?.id ?? null,
        executionTimeMs: Date.now() - started,
        status: OwnerAuditStatus.FAILED,
        message: err.message,
        errorCode: err.code,
      };
    }

    // 3. Disabled actions ----------------------------------------------------
    if (handler.disabled) {
      const err = new OwnerActionDisabledError(category, action, handler.disabledReason);
      const record = await ownerAudit.record({
        ownerId: context.callerId,
        category,
        action,
        payload: sanitiseArgs(args),
        status: OwnerAuditStatus.DISABLED,
        errorMessage: err.message,
        executionTimeMs: Date.now() - started,
        metadata: this.contextMetadata(context),
      });
      return {
        ok: false,
        auditId: record?.id ?? null,
        executionTimeMs: Date.now() - started,
        status: OwnerAuditStatus.DISABLED,
        message: err.message,
        errorCode: err.code,
      };
    }

    // 4. Confirmation --------------------------------------------------------
    if (handler.dangerous) {
      try {
        requireConfirmation(category, action, context);
      } catch (err) {
        if (err instanceof OwnerConfirmationRequiredError) {
          const record = await ownerAudit.record({
            ownerId: context.callerId,
            category,
            action,
            payload: sanitiseArgs(args),
            status: OwnerAuditStatus.CONFIRMATION_REQUIRED,
            errorMessage: err.message,
            executionTimeMs: Date.now() - started,
            metadata: this.contextMetadata(context),
          });
          return {
            ok: false,
            auditId: record?.id ?? null,
            executionTimeMs: Date.now() - started,
            status: OwnerAuditStatus.CONFIRMATION_REQUIRED,
            message: err.message,
            errorCode: err.code,
          };
        }
        throw err;
      }
    }

    // 5. Validation ----------------------------------------------------------
    if (handler.validate) {
      const validated = handler.validate(args as never);
      if (!validated) {
        const message = `Invalid arguments for owner action ${category}.${action}`;
        const record = await ownerAudit.record({
          ownerId: context.callerId,
          category,
          action,
          payload: sanitiseArgs(args),
          status: OwnerAuditStatus.FAILED,
          errorMessage: message,
          executionTimeMs: Date.now() - started,
          metadata: this.contextMetadata(context),
        });
        return {
          ok: false,
          auditId: record?.id ?? null,
          executionTimeMs: Date.now() - started,
          status: OwnerAuditStatus.FAILED,
          message,
          errorCode: "OWNER_ACTION_INVALID_ARGS",
        };
      }
    }

    // 6. Execute -------------------------------------------------------------
    const auditId = await ownerAudit.start({
      ownerId: context.callerId,
      category,
      action,
      payload: sanitiseArgs(args),
      status: OwnerAuditStatus.PENDING,
      metadata: this.contextMetadata(context),
    });

    try {
      const handlerResult = await (handler.execute as OwnerActionHandler<TArgs, TData>["execute"])(
        (args ?? ({} as TArgs)),
        context,
      );
      const executionTimeMs = Date.now() - started;
      await ownerAudit.finish(auditId, {
        status: OwnerAuditStatus.OK,
        executionTimeMs,
        metadata: {
          ...this.contextMetadata(context),
          ...(handlerResult.metadata ?? {}),
          ...(handlerResult.target ? { target: handlerResult.target } : {}),
        },
      });
      log.info(
        {
          category,
          action,
          callerId: context.callerId,
          executionTimeMs,
          correlationId,
        },
        "owner.action ok",
      );
      return {
        ok: true,
        auditId,
        executionTimeMs,
        message: handlerResult.message,
        data: handlerResult.data,
      };
    } catch (err) {
      const executionTimeMs = Date.now() - started;
      const failure = new OwnerActionFailedError(category, action, err);
      const message = errorToMessage(err);
      await ownerAudit.finish(auditId, {
        status: OwnerAuditStatus.FAILED,
        errorMessage: message,
        executionTimeMs,
      });
      log.error(
        {
          err,
          category,
          action,
          callerId: context.callerId,
          executionTimeMs,
          correlationId,
        },
        "owner.action failed",
      );
      return {
        ok: false,
        auditId,
        executionTimeMs,
        status: OwnerAuditStatus.FAILED,
        message,
        errorCode: failure.code,
      };
    }
  }

  private contextMetadata(context: OwnerContext): Record<string, unknown> {
    return {
      source: context.source,
      ...(context.guildId ? { guildId: context.guildId } : {}),
      ...(context.channelId ? { channelId: context.channelId } : {}),
      ...(context.locale ? { locale: context.locale } : {}),
      ...(context.correlationId ? { correlationId: context.correlationId } : {}),
    };
  }
}

export const ownerRouter = new OwnerRouter();
