-- ============================================================================
-- Migration 006: per-contact email draft
-- Created 2026-06-04
--
-- One current, editable draft per contact (subject + body). Survives
-- navigation and reload. Generating, refining, or manually saving all write
-- here. No history kept by design (single current draft).
--
-- RLS: contacts already has contacts_owner_all, which covers these columns.
-- ============================================================================

alter table contacts
  add column draft_subject text,
  add column draft_body text,
  add column draft_updated_at timestamptz;
