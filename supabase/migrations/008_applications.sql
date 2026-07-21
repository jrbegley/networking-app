-- ============================================================================
-- Migration 008: job application tracker
-- Created 2026-07-21
--
-- The networking pipeline tracks people; this tracks the applications those
-- relationships feed into. Two tables:
--   applications        one row per job you applied (or plan) to
--   application_events  the per-application timeline (applied -> OA -> onsite
--                       -> offer/rejected, plus freeform notes)
--
-- A trigger stamps status_changed_at on status changes, auto-logs a matching
-- event row, and back-fills heard_back_at the first time an application moves
-- past 'applied' (any response — including a rejection — counts as hearing
-- back). Mirrors the migration 007 stage-timing pattern.
--
-- Apply by pasting into the Supabase SQL editor. The app tolerates the tables
-- being absent (the Applications tab shows a "not set up yet" note), so deploy
-- order doesn't matter.
-- ============================================================================

create type application_status as enum (
  'interested',        -- saved, not yet applied
  'applied',
  'online_assessment',
  'phone_screen',
  'interview',
  'final_round',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted'
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- company_id links to the networking side when the name matches an existing
  -- company; company_name is always populated so an application never depends
  -- on a company row existing.
  company_id uuid references companies(id) on delete set null,
  company_name text not null,
  role_title text not null,
  location text,
  posting_url text,
  source text,                          -- 'referral' | 'linkedin' | 'company site' | ...
  referral_contact_id uuid references contacts(id) on delete set null,
  status application_status not null default 'interested',
  status_changed_at timestamptz not null default now(),
  applied_at date,
  deadline date,                        -- application deadline or next-round date
  heard_back_at date,                   -- first response of any kind
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_owner_idx on applications (owner_id);
create index applications_company_idx on applications (company_id);
create index applications_status_idx on applications (owner_id, status);

create table application_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references applications(id) on delete cascade,
  status application_status,            -- null for a plain note
  note text,
  occurred_at date not null default current_date,
  created_at timestamptz not null default now()
);

create index application_events_app_idx
  on application_events (application_id, occurred_at desc, created_at desc);
create index application_events_owner_idx on application_events (owner_id);

-- ── updated_at trigger (reuses set_updated_at from migration 001) ──────────
create trigger applications_set_updated_at
  before update on applications
  for each row execute function set_updated_at();

-- ── status-change bookkeeping ──────────────────────────────────────────────
-- On a status change: stamp status_changed_at, log an event row, and set
-- heard_back_at the first time we move past 'applied'/'interested'.
create or replace function handle_application_status_change()
returns trigger
language plpgsql
as $$
declare
  responded boolean;
begin
  if new.status is distinct from old.status then
    new.status_changed_at = now();

    -- Any status beyond the pre-response ones counts as a first response.
    responded := new.status not in ('interested', 'applied', 'withdrawn');
    if responded and new.heard_back_at is null then
      new.heard_back_at = current_date;
    end if;

    insert into application_events (owner_id, application_id, status, occurred_at)
    values (new.owner_id, new.id, new.status, current_date);
  end if;
  return new;
end;
$$;

drop trigger if exists applications_status_change on applications;
create trigger applications_status_change
  before update on applications
  for each row execute function handle_application_status_change();

-- ── row level security ─────────────────────────────────────────────────────
alter table applications enable row level security;
alter table application_events enable row level security;

create policy applications_owner_all on applications
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy application_events_owner_all on application_events
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
