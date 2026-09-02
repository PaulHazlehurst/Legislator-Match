-- ============================================================================
-- READ ACCESS FOR THE WEB APP (public read, writes locked)
--
-- Your existing app reads many tables (roster, bills, sponsorships, stats,
-- coalition, feed). Maryland legislative data is public, so we allow the
-- browser's anon key to READ every table, but never write. All writes go
-- through your Vercel functions using the service-role key, which bypasses RLS.
--
-- Run once in the Supabase SQL editor, AFTER scoring.sql and allies.sql.
-- ============================================================================

-- 1. Enable RLS on every table (no policy = no access until we add read policies)
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname='public'
  loop
    execute format('alter table public.%I enable row level security;', t);
    -- public read policy
    execute format('drop policy if exists anon_read on public.%I;', t);
    execute format('create policy anon_read on public.%I for select to anon, authenticated using (true);', t);
  end loop;
end $$;

-- 2. Block all writes through the public keys (belt and suspenders)
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon, authenticated;

-- 3. Expose the derived views the scoring + coalition use
grant select on legislator_topic_scores to anon, authenticated;
grant select on legislator_allies       to anon, authenticated;
