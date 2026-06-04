-- ============================================================================
-- Migration 004: contact-level research notes
-- Created 2026-06-04
--
-- Free-form text field on contacts where the user can add their own
-- research that Apollo/Tavily missed — mutual connections, recent posts
-- they saw, news articles, hunches. Goes into the draft prompt verbatim.
-- ============================================================================

alter table contacts
  add column if not exists research_notes text;
