-- Phase A migration: ticket inactivity tracking, welcome/goodbye embeds,
-- ticket auto-close config, reminders system. Safe / additive only — no drops.

-- Guild: welcome/goodbye embeds + ticket auto-close knobs
ALTER TABLE "Guild"
  ADD COLUMN IF NOT EXISTS "welcomeEmbed" JSONB,
  ADD COLUMN IF NOT EXISTS "goodbyeEmbed" JSONB,
  ADD COLUMN IF NOT EXISTS "ticketAutoCloseHours" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS "ticketInactivityWarnHours" INTEGER NOT NULL DEFAULT 0;

-- Ticket: inactivity tracking. Default to createdAt for existing rows so
-- auto-close timer behaves predictably right after the migration runs.
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "inactivityWarnedAt" TIMESTAMP(3);

UPDATE "Ticket" SET "lastActivityAt" = "createdAt" WHERE "lastActivityAt" < "createdAt";

CREATE INDEX IF NOT EXISTS "Ticket_status_lastActivityAt_idx"
  ON "Ticket"("status", "lastActivityAt");

-- Reminder table
CREATE TABLE IF NOT EXISTS "Reminder" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "guildId"    TEXT,
  "channelId"  TEXT,
  "message"    TEXT NOT NULL,
  "remindAt"   TIMESTAMP(3) NOT NULL,
  "recurring"  TEXT,
  "fired"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Reminder_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Reminder_fired_remindAt_idx" ON "Reminder"("fired", "remindAt");
CREATE INDEX IF NOT EXISTS "Reminder_userId_fired_idx"   ON "Reminder"("userId", "fired");
CREATE INDEX IF NOT EXISTS "Reminder_guildId_idx"        ON "Reminder"("guildId");
