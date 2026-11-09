-- ============================================================================
-- v2 MIGRATION — run once in the Supabase SQL editor, then run the
-- "reclassify-all" step of the Data ingest workflow.
--
-- Safe to re-run: every statement is idempotent.
--
-- What it adds
--   1. bills: secondary topic + classifier provenance (score, evidence, version)
--   2. staff + staff_relationships: the Pinnacle relationship web. These are
--      NOT readable with the public anon key. The browser reads and writes them
--      only through /api/relationships, which checks the team passcode and uses
--      the service-role key.
--   3. read grants for the new bill columns
-- ============================================================================

-- 1. bills ─────────────────────────────────────────────────────────────────────
alter table public.bills add column if not exists secondary_topic_id uuid references public.topics(id) on delete set null;
alter table public.bills add column if not exists classification_score numeric;
alter table public.bills add column if not exists classification_evidence jsonb;
alter table public.bills add column if not exists classifier_version text;
create index if not exists idx_bills_topic on public.bills (topic_id);
create index if not exists idx_bills_secondary_topic on public.bills (secondary_topic_id);

-- 2. staff relationship web ───────────────────────────────────────────────────
create table if not exists public.staff (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  title       text,
  color       text,
  created_at  timestamptz not null default now(),
  unique (name)
);

create table if not exists public.staff_relationships (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references public.staff(id) on delete cascade,
  legislator_id  uuid not null references public.legislators(id) on delete cascade,
  strength       smallint not null default 2 check (strength between 1 and 3),  -- 1 acquaintance · 2 working · 3 close
  kind           text,          -- e.g. 'former staffer', 'campaign', 'personal', 'district', 'client work'
  notes          text,
  last_contact   date,
  updated_by     text,
  updated_at     timestamptz not null default now(),
  unique (staff_id, legislator_id)
);
create index if not exists idx_staff_rel_leg on public.staff_relationships (legislator_id);

alter table public.staff enable row level security;
alter table public.staff_relationships enable row level security;
-- No anon/authenticated policies on purpose: these tables are private to the
-- firm. (rls.sql skips them too.) The service role bypasses RLS.
drop policy if exists anon_read on public.staff;
drop policy if exists anon_read on public.staff_relationships;
revoke all on public.staff, public.staff_relationships from anon, authenticated;

-- 3. grants ───────────────────────────────────────────────────────────────────
grant select on public.bills to anon, authenticated;

-- sanity
select
  (select count(*) from public.bills where secondary_topic_id is not null) as bills_with_secondary,
  (select count(*) from public.staff) as staff_rows,
  (select count(*) from public.staff_relationships) as relationship_rows;
