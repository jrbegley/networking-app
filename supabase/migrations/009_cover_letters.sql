-- ============================================================================
-- Migration 009: cover-letter generator
-- Created 2026-08-03
--
-- Adds two private storage buckets for the cover-letter generator:
--   cover-letter-templates   one .docx template per user (settings upload)
--   cover-letters            generated/saved .docx letters, one per application
-- plus metadata columns on applications/profiles for display, and RLS
-- policies so users can only access their own files. Mirrors the resume PDF
-- storage pattern from migration 003. Idempotent — safe to re-run.
--
-- Apply by pasting into the Supabase SQL editor. The app tolerates this
-- migration being unapplied (the cover-letter feature shows a "not set up
-- yet" note), so deploy order doesn't matter.
-- ============================================================================

-- ── Buckets ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cover-letter-templates',
  'cover-letter-templates',
  false,
  10 * 1024 * 1024, -- 10MB cap; real templates are <1MB
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cover-letters',
  'cover-letters',
  false,
  10 * 1024 * 1024, -- 10MB cap; generated letters are <1MB
  array['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do nothing;

-- ── Metadata columns ─────────────────────────────────────────────────────
alter table applications
  add column if not exists cover_letter_name text,
  add column if not exists cover_letter_at timestamptz;

alter table profiles
  add column if not exists cover_letter_template_name text,
  add column if not exists cover_letter_template_at timestamptz;

-- ── Storage policies: cover-letter-templates ────────────────────────────
-- File path convention: `<user_id>/template.docx`. The first path segment is
-- the owner's auth uid, which RLS enforces below.

drop policy if exists "Users read own cover letter template" on storage.objects;
create policy "Users read own cover letter template"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'cover-letter-templates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload own cover letter template" on storage.objects;
create policy "Users upload own cover letter template"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'cover-letter-templates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own cover letter template" on storage.objects;
create policy "Users update own cover letter template"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'cover-letter-templates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own cover letter template" on storage.objects;
create policy "Users delete own cover letter template"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'cover-letter-templates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Storage policies: cover-letters ──────────────────────────────────────
-- File path convention: `<user_id>/<application_id>.docx`. The first path
-- segment is the owner's auth uid, which RLS enforces below.

drop policy if exists "Users read own cover letters" on storage.objects;
create policy "Users read own cover letters"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload own cover letters" on storage.objects;
create policy "Users upload own cover letters"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own cover letters" on storage.objects;
create policy "Users update own cover letters"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own cover letters" on storage.objects;
create policy "Users delete own cover letters"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'cover-letters'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
