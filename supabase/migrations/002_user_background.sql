-- ============================================================================
-- Migration 002: user background fields on profiles
-- Created 2026-06-04
--
-- Adds optional self-description fields that the drafting prompt uses to
-- personalize outreach (your background, your resume, your goal,
-- your LinkedIn). Idempotent so it's safe to re-run.
-- ============================================================================

alter table profiles
  add column if not exists bio text,
  add column if not exists resume_text text,
  add column if not exists outreach_goal text,
  add column if not exists linkedin_url text;
