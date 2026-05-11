-- Add per-guild admin log channel for tickets
ALTER TABLE "Guild" ADD COLUMN "ticketsLogChannelId" TEXT;
