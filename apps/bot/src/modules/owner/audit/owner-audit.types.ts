/**
 * OwnerAudit primitive types. The Prisma model is the source of truth; this
 * file mirrors the model shape for TypeScript callers and lets us refer to
 * the enum statically (without pulling the Prisma client into hot paths
 * that just want to assemble an audit payload).
 *
 * The string union mirrors `enum OwnerAuditStatus` in prisma/schema.prisma.
 * If you change one, change the other.
 */

export const OwnerAuditStatus = {
  PENDING: "PENDING",
  OK: "OK",
  FAILED: "FAILED",
  FORBIDDEN: "FORBIDDEN",
  DISABLED: "DISABLED",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
} as const;

export type OwnerAuditStatus = (typeof OwnerAuditStatus)[keyof typeof OwnerAuditStatus];

/** Input accepted by `OwnerAuditService.record`. */
export interface OwnerAuditInput {
  ownerId: string;
  category: string;
  action: string;
  /** Sanitised action arguments. Big blobs / secrets must NOT be passed in. */
  payload?: Record<string, unknown> | null;
  /** Optional target id (user / guild / resource). */
  target?: string | null;
  status?: OwnerAuditStatus;
  /** Pretty error message if the action failed. */
  errorMessage?: string | null;
  /** Action execution time in milliseconds. */
  executionTimeMs?: number | null;
  /** Free-form metadata, e.g. correlation id, source, locale. */
  metadata?: Record<string, unknown> | null;
}

/** Persisted record as returned by Prisma. */
export interface OwnerAuditRecord {
  id: string;
  ownerId: string;
  category: string;
  action: string;
  payload: unknown;
  target: string | null;
  status: OwnerAuditStatus;
  errorMessage: string | null;
  executionTimeMs: number | null;
  metadata: unknown;
  createdAt: Date;
}
