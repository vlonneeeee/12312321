-- CreateEnum
CREATE TYPE "OwnerAuditStatus" AS ENUM ('PENDING', 'OK', 'FAILED', 'FORBIDDEN', 'DISABLED', 'CONFIRMATION_REQUIRED');

-- CreateTable
CREATE TABLE "OwnerAudit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "target" TEXT,
    "status" "OwnerAuditStatus" NOT NULL DEFAULT 'PENDING',
    "executionTimeMs" INTEGER,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerAudit_ownerId_idx" ON "OwnerAudit"("ownerId");

-- CreateIndex
CREATE INDEX "OwnerAudit_category_action_idx" ON "OwnerAudit"("category", "action");

-- CreateIndex
CREATE INDEX "OwnerAudit_status_idx" ON "OwnerAudit"("status");

-- CreateIndex
CREATE INDEX "OwnerAudit_createdAt_idx" ON "OwnerAudit"("createdAt");
