import { Prisma } from "@prisma/client";
import { prisma } from "@core/db/prisma";
import { child } from "@core/logger/logger";
import {
  OwnerAuditStatus,
  type OwnerAuditInput,
  type OwnerAuditRecord,
} from "./owner-audit.types";

const log = child("owner.audit");

/**
 * OwnerAuditService — single funnel for "the owner did X with args Y".
 *
 * Writes are best-effort: a database outage MUST NOT fail the action that
 * was just performed. Every persist also emits a structured pino log so
 * the trail survives even if Postgres is down.
 *
 * Phase 1 deliberately keeps the API tiny:
 *   * `start()`  — register a PENDING row, return id (or null on db error)
 *   * `finish()` — mutate the row with the final status + execution metrics
 *   * `record()` — terminal helper for one-shot writes (no pending phase)
 *
 * Future phases can layer on querying, retention, dashboards, etc. without
 * breaking callers — those just call `start`/`finish`.
 */
class OwnerAuditService {
  async start(input: OwnerAuditInput): Promise<string | null> {
    const status = input.status ?? OwnerAuditStatus.PENDING;
    const payload = this.normaliseJson(input.payload);
    const metadata = this.normaliseJson(input.metadata);

    log.info(
      {
        ownerId: input.ownerId,
        category: input.category,
        action: input.action,
        status,
        target: input.target ?? undefined,
      },
      "owner.audit.start",
    );

    try {
      const row = await prisma.ownerAudit.create({
        data: {
          ownerId: input.ownerId,
          category: input.category,
          action: input.action,
          payload: payload ?? Prisma.JsonNull,
          target: input.target ?? null,
          status,
          errorMessage: input.errorMessage ?? null,
          executionTimeMs: input.executionTimeMs ?? null,
          metadata: metadata ?? Prisma.JsonNull,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      log.error(
        {
          err,
          ownerId: input.ownerId,
          category: input.category,
          action: input.action,
        },
        "owner.audit.start failed — degrading to log-only",
      );
      return null;
    }
  }

  async finish(
    auditId: string | null,
    update: {
      status: OwnerAuditStatus;
      errorMessage?: string | null;
      executionTimeMs?: number | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    log.info(
      {
        auditId,
        status: update.status,
        executionTimeMs: update.executionTimeMs ?? undefined,
        ...(update.errorMessage ? { errorMessage: update.errorMessage } : {}),
      },
      "owner.audit.finish",
    );

    if (!auditId) return;
    try {
      await prisma.ownerAudit.update({
        where: { id: auditId },
        data: {
          status: update.status,
          errorMessage: update.errorMessage ?? null,
          executionTimeMs: update.executionTimeMs ?? null,
          ...(update.metadata !== undefined
            ? { metadata: this.normaliseJson(update.metadata) ?? Prisma.JsonNull }
            : {}),
        },
      });
    } catch (err) {
      log.error({ err, auditId }, "owner.audit.finish failed");
    }
  }

  /** Convenience for callers that already know the final status. */
  async record(input: OwnerAuditInput): Promise<OwnerAuditRecord | null> {
    const payload = this.normaliseJson(input.payload);
    const metadata = this.normaliseJson(input.metadata);

    log.info(
      {
        ownerId: input.ownerId,
        category: input.category,
        action: input.action,
        status: input.status ?? OwnerAuditStatus.OK,
        target: input.target ?? undefined,
        ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      },
      "owner.audit.record",
    );

    try {
      const row = await prisma.ownerAudit.create({
        data: {
          ownerId: input.ownerId,
          category: input.category,
          action: input.action,
          payload: payload ?? Prisma.JsonNull,
          target: input.target ?? null,
          status: input.status ?? OwnerAuditStatus.OK,
          errorMessage: input.errorMessage ?? null,
          executionTimeMs: input.executionTimeMs ?? null,
          metadata: metadata ?? Prisma.JsonNull,
        },
      });
      return row as unknown as OwnerAuditRecord;
    } catch (err) {
      log.error(
        { err, ownerId: input.ownerId, category: input.category, action: input.action },
        "owner.audit.record failed",
      );
      return null;
    }
  }

  /**
   * Strip non-serialisable values (functions, Symbols, undefined fields)
   * so Prisma's Json column never rejects an action's payload.
   * Returns `null` for empty / nullish input so callers can fall through
   * to `Prisma.JsonNull`.
   */
  private normaliseJson(
    value: Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonValue | null {
    if (value == null) return null;
    try {
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      return null;
    }
  }
}

export const ownerAudit = new OwnerAuditService();
