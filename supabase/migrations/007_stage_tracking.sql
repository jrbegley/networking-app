-- ============================================================================
-- Migration 007: stage timing for the follow-up engine
-- Created 2026-07-06
--
-- Adds contacts.stage_changed_at so the app can answer "how long has this
-- contact been waiting in this stage" — the input to cadence rules and the
-- Due follow-ups view. A trigger stamps it whenever current_stage changes.
--
-- Apply by pasting into the Supabase SQL editor. The app tolerates the
-- column being missing (aging + due-follow-ups just stay hidden), so deploy
-- order doesn't matter.
-- ============================================================================

alter table contacts
  add column if not exists stage_changed_at timestamptz not null default now();

-- Best available backfill: last row update. Coarse, but only affects
-- contacts that existed before this migration.
update contacts set stage_changed_at = updated_at;

create or replace function set_stage_changed_at()
returns trigger
language plpgsql
as $$
begin
  if new.current_stage is distinct from old.current_stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_stage_changed_at on contacts;
create trigger contacts_stage_changed_at
  before update on contacts
  for each row execute function set_stage_changed_at();
