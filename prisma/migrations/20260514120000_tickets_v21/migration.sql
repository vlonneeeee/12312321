-- Tickets 2.1: priority, close-with-reason, freeze, close-confirm toggle.
-- All additions are nullable / have safe defaults so existing tickets and
-- guilds keep working without any data backfill.

ALTER TABLE "Guild"
  ADD COLUMN IF NOT EXISTS "ticketCloseConfirm" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "priority"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "closeReason" TEXT,
  ADD COLUMN IF NOT EXISTS "frozen"      BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_priority_range') THEN
    ALTER TABLE "Ticket"
      ADD CONSTRAINT "Ticket_priority_range"
      CHECK ("priority" >= -1 AND "priority" <= 2);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Ticket_guildId_priority_idx"
  ON "Ticket"("guildId", "priority");
