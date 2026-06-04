-- ============================================================================
-- Migration 003: resume PDF storage
-- Created 2026-06-04
--
-- Adds a private storage bucket for resume PDFs, RLS policies so users can
-- only access their own resume, and metadata columns on profiles for
-- display. Idempotent — safe to re-run.
-- ============================================================================

-- ── Bucket ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10 * 1024 * 1024, -- 10MB cap; real resumes are <2MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ── Profile columns ──────────────────────────────────────────────────────
alter table profiles
  add column if not exists resume_pdf_name text,
  add column if not exists resume_pdf_uploaded_at timestamptz;

-- ── Storage policies ─────────────────────────────────────────────────────
-- File path convention: `<user_id>/resume.pdf`. The first path segment is
-- the owner's auth uid, which RLS enforces below.

drop policy if exists "Users read own resume" on storage.objects;
create policy "Users read own resume"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload own resume" on storage.objects;
create policy "Users upload own resume"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own resume" on storage.objects;
create policy "Users update own resume"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own resume" on storage.objects;
create policy "Users delete own resume"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
