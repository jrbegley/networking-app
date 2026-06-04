-- ============================================================================
-- Migration 005: add 'linkedin' to the research_source enum
-- Created 2026-06-04
--
-- Used to tag research_artifacts produced by the Apify HarvestAPI scraper
-- ('apollo' and 'tavily' remain reserved for those sources).
-- ============================================================================

alter type research_source add value if not exists 'linkedin';
