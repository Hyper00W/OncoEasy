-- Phase 6.11: introduce the OWNER application role.
--
-- OWNER is the highest-privilege management role (full system access).
-- OPS_ADMIN is unchanged and remains an operational administrator; no
-- existing OPS_ADMIN rows are migrated or modified.
--
-- Follows the same AlterEnum pattern used when DELIVERY_AGENT was added
-- (20260918100936_phase1_7_14_delivery_agent).
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OWNER';
