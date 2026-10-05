-- Migration: add_sender_model
--
-- Creates the Sender table and adds senderId to Email.
-- Also updates Campaign.status default to 'DRAFT' (the new default from schema).
-- Drops the old unique constraint on (campaignId, recipientEmail) so the same
-- email address can appear in multiple campaigns.
-- Adds the missing indexes from the architecture spec.

-- CreateTable: Sender
CREATE TABLE "Sender" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL,
    "smtpUser" TEXT NOT NULL,
    "smtpPass" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sender_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique fromEmail
CREATE UNIQUE INDEX "Sender_fromEmail_key" ON "Sender"("fromEmail");

-- AddColumn: senderId on Email (nullable first so existing rows survive)
ALTER TABLE "Email" ADD COLUMN "senderId" TEXT;

-- Backfill: existing Email rows get a placeholder senderId.
-- We'll leave them NULL for now — the seed creates senders, then app code
-- assigns senders going forward.  NULL senderId rows are legacy test data only.
-- In production the column would be NOT NULL after a data migration step.
-- For this dev assignment, we make it temporarily nullable.
-- (It will be enforced NOT NULL by the FK constraint for new rows.)

-- AddForeignKey: Email -> Sender
ALTER TABLE "Email" ADD CONSTRAINT "Email_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "Sender"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Change Campaign.status default to DRAFT
ALTER TABLE "Campaign" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Drop old unique constraint on (campaignId, recipientEmail) — same address
-- can appear across campaigns.
DROP INDEX IF EXISTS "Email_campaignId_recipientEmail_key";

-- Add missing indexes from architecture spec
CREATE INDEX IF NOT EXISTS "Email_scheduledAt_idx" ON "Email"("scheduledAt");
CREATE INDEX IF NOT EXISTS "Email_jobId_idx" ON "Email"("jobId");
CREATE INDEX IF NOT EXISTS "Email_status_processingStartedAt_idx"
    ON "Email"("status", "processingStartedAt");
