-- Tickets 2.0 migration: modal answers, ratings, in-DB transcripts, archive indexes,
-- per-guild rating toggles. Strictly additive — no DROP/RENAME, every existing
-- ticket row continues to work unchanged.

-- Guild: rating enable + required flags
ALTER TABLE "Guild"
  ADD COLUMN IF NOT EXISTS "ticketRatingEnabled"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "ticketRatingRequired" BOOLEAN NOT NULL DEFAULT false;

-- Ticket: modal answers (JSON), full HTML transcript (TEXT), 1-5 rating + optional comment
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "modalAnswers"   JSONB,
  ADD COLUMN IF NOT EXISTS "transcriptHtml" TEXT,
  ADD COLUMN IF NOT EXISTS "rating"         INTEGER,
  ADD COLUMN IF NOT EXISTS "ratingComment"  TEXT,
  ADD COLUMN IF NOT EXISTS "ratedAt"        TIMESTAMP(3);

-- Constrain rating to a sane range without forcing legacy NULL rows to change.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_rating_range'
  ) THEN
    ALTER TABLE "Ticket"
      ADD CONSTRAINT "Ticket_rating_range"
      CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));
  END IF;
END $$;

-- Archive search indexes
CREATE INDEX IF NOT EXISTS "Ticket_guildId_closedAt_idx" ON "Ticket"("guildId", "closedAt");
CREATE INDEX IF NOT EXISTS "Ticket_authorId_status_idx"  ON "Ticket"("authorId", "status");
CREATE INDEX IF NOT EXISTS "Ticket_guildId_category_idx" ON "Ticket"("guildId", "category");
