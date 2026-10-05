-- Migration: add_enum_values
--
-- ADD VALUE cannot be used inside a transaction in PostgreSQL.
-- Prisma wraps migrations in transactions by default, so we must NOT put
-- ALTER TYPE ... ADD VALUE inside a BEGIN/COMMIT block.
--
-- This file adds only the new enum values.  The table changes are in the
-- next migration so they can run in a clean transaction after the enum
-- values are committed.

ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "CampaignStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
