-- ============================================================================
-- Migration 011: drop the unused parts of the removed cover-letter generator
-- Created 2026-10-19
--
-- The cover-letter feature was removed from the app. This drops only what
-- held no data when checked: the saved-letters bucket's policies and the
-- per-application letter columns (all null). The bucket had 0 objects.
--
-- Deliberately NOT dropped: the `cover-letter-templates` bucket and
-- profiles.cover_letter_template_* (they hold the user's uploaded template).
-- Remove them later with a separate migration once that file is no longer
-- wanted. Idempotent — safe to re-run.
-- ============================================================================

drop policy if exists "Users read own cover letters" on storage.objects;
drop policy if exists "Users upload own cover letters" on storage.objects;
drop policy if exists "Users update own cover letters" on storage.objects;
drop policy if exists "Users delete own cover letters" on storage.objects;

-- The empty `cover-letters` bucket is left in place (harmless; with its
-- policies gone nothing can read or write it). Delete it from the Supabase
-- dashboard (Storage) if you want it gone.

alter table applications
  drop column if exists cover_letter_name,
  drop column if exists cover_letter_at;
