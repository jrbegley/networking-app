-- ============================================================================
-- Migration 010: resume optimizer
-- Created 2026-10-19
--
-- One stored LaTeX resume per user (profiles.resume_tex) and a table of
-- tailored resumes, one row per (application, run) the user chose to save.
-- The PDF lives in the private `tailored-resumes` bucket at
-- `<user_id>/<tailored_resume_id>.pdf`; the .tex, keyword report and bullet
-- diff live in the row so the Resumes tab can re-open them without
-- recomputing. Mirrors migrations 003/009. Idempotent — safe to re-run.
--
-- Apply by pasting into the Supabase SQL editor. The app tolerates this
-- migration being unapplied (Settings and the Resumes tab show a "not set
-- up yet" note), so deploy order doesn't matter.
-- ============================================================================

-- ── Profile columns ──────────────────────────────────────────────────────
alter table profiles
  add column if not exists resume_tex text,
  add column if not exists resume_tex_name text,
  add column if not exists resume_tex_at timestamptz,
  add column if not exists resume_tex_compiler text not null default 'pdflatex',
  add column if not exists resume_tex_pages integer;

-- ── tailored_resumes ─────────────────────────────────────────────────────
create table if not exists tailored_resumes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Nullable + set null so the saved resume outlives a deleted application;
  -- company_name/role_title are copied so the row stays labelled.
  application_id uuid references applications(id) on delete set null,
  company_name text not null,
  role_title text not null,
  compiler text not null default 'pdflatex',
  tex text not null,
  keywords jsonb not null default '[]'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  page_warning boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists tailored_resumes_owner_idx
  on tailored_resumes (owner_id, created_at desc);

alter table tailored_resumes enable row level security;

drop policy if exists "Users read own tailored resumes" on tailored_resumes;
create policy "Users read own tailored resumes"
  on tailored_resumes for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Users insert own tailored resumes" on tailored_resumes;
create policy "Users insert own tailored resumes"
  on tailored_resumes for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Users update own tailored resumes" on tailored_resumes;
create policy "Users update own tailored resumes"
  on tailored_resumes for update to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Users delete own tailored resumes" on tailored_resumes;
create policy "Users delete own tailored resumes"
  on tailored_resumes for delete to authenticated
  using (owner_id = auth.uid());

-- ── Bucket ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tailored-resumes',
  'tailored-resumes',
  false,
  10 * 1024 * 1024, -- 10MB cap; compiled resumes are <1MB
  array['application/pdf']
)
on conflict (id) do nothing;

-- ── Storage policies ─────────────────────────────────────────────────────
-- File path convention: `<user_id>/<tailored_resume_id>.pdf`.

drop policy if exists "Users read own tailored resume pdfs" on storage.objects;
create policy "Users read own tailored resume pdfs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users upload own tailored resume pdfs" on storage.objects;
create policy "Users upload own tailored resume pdfs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own tailored resume pdfs" on storage.objects;
create policy "Users update own tailored resume pdfs"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own tailored resume pdfs" on storage.objects;
create policy "Users delete own tailored resume pdfs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tailored-resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
