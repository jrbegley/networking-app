-- ============================================================================
-- Migration 001: initial schema
-- Created 2026-06-02
--
-- Tables:
--   profiles            extends auth.users with app-level data + Outlook tokens
--   companies           auto-grouped from Apollo enrichment
--   contacts            people in the networking pipeline
--   research_artifacts  cached Apollo/Tavily responses (Apollo free tier survival)
--   interactions        timeline of every email, meeting, note
--   cadence_rules       user-defined follow-up rules
--   scheduled_actions   queue of pending follow-ups
--
-- All non-profile tables have owner_id + RLS. Multi-tenant isolation enforced
-- at the DB level — even shared databases keep users invisible to each other.
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

create type pipeline_stage as enum (
  'identified',
  'researched',
  'drafted',
  'sent',
  'replied',
  'meeting_scheduled',
  'meeting_held',
  'nurture',
  'dormant'
);

create type interaction_type as enum (
  'email_sent',
  'email_received',
  'meeting',
  'note',
  'enrichment'   -- audit log entry for when we hit Apollo/Tavily
);

create type research_source as enum (
  'apollo',
  'tavily',
  'manual'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- profiles: extends auth.users. The Outlook token fields are populated once
-- the user connects their inbox (task 12+).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  outlook_email text,
  outlook_access_token text,
  outlook_refresh_token text,
  outlook_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- companies: one row per company the user has at least one contact at.
create table companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  domain text,
  industry text,
  size_range text,
  linkedin_url text,
  apollo_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

create index companies_owner_idx on companies (owner_id);
create index companies_apollo_id_idx on companies (apollo_id) where apollo_id is not null;

-- contacts: people in the pipeline.
create table contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  name text not null,
  title text,
  email text,
  linkedin_url text,
  current_stage pipeline_stage not null default 'identified',
  source text,                   -- 'linkedin_url' | 'manual' | 'csv' | 'apollo_search'
  apollo_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_owner_idx on contacts (owner_id);
create index contacts_company_idx on contacts (company_id);
create index contacts_stage_idx on contacts (owner_id, current_stage);
create unique index contacts_linkedin_url_owner_idx
  on contacts (owner_id, linkedin_url)
  where linkedin_url is not null;

-- research_artifacts: raw API payloads, cached aggressively.
create table research_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  source research_source not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index research_artifacts_contact_idx on research_artifacts (contact_id);
create index research_artifacts_company_idx on research_artifacts (company_id);
create index research_artifacts_owner_idx on research_artifacts (owner_id);

-- interactions: timeline of every contact-related event.
create table interactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  type interaction_type not null,
  subject text,
  body text,
  outlook_message_id text,
  outlook_thread_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index interactions_contact_idx on interactions (contact_id, occurred_at desc);
create index interactions_owner_idx on interactions (owner_id, occurred_at desc);

-- cadence_rules: simple rule = "after stage X, wait N days, suggest follow-up".
create table cadence_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  trigger_stage pipeline_stage not null,
  wait_days integer not null check (wait_days > 0),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index cadence_rules_owner_idx on cadence_rules (owner_id);

-- scheduled_actions: queue for the background worker.
create table scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  cadence_rule_id uuid references cadence_rules(id) on delete set null,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'cancelled')),
  payload jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create index scheduled_actions_pending_idx
  on scheduled_actions (scheduled_for)
  where status = 'pending';

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

create trigger companies_set_updated_at
  before update on companies
  for each row execute function set_updated_at();

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- ============================================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================================
-- When a new user signs up via Supabase Auth, automatically create their
-- profile row. display_name defaults to the part of email before @ if not set.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table companies enable row level security;
alter table contacts enable row level security;
alter table research_artifacts enable row level security;
alter table interactions enable row level security;
alter table cadence_rules enable row level security;
alter table scheduled_actions enable row level security;

-- profiles: user can see and edit only their own profile.
create policy profiles_select_own on profiles
  for select using (auth.uid() = id);
create policy profiles_update_own on profiles
  for update using (auth.uid() = id);

-- Everything else: full per-owner isolation.
create policy companies_owner_all on companies
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy contacts_owner_all on contacts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy research_artifacts_owner_all on research_artifacts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy interactions_owner_all on interactions
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy cadence_rules_owner_all on cadence_rules
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy scheduled_actions_owner_all on scheduled_actions
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
