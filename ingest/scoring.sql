-- ============================================================================
-- SCORING — the two questions a lobbyist actually asks, as separate numbers.
--   WILLINGNESS  : how likely is this member to carry a bill on this topic?
--                  (recency-weighted substantive activity + a lead-sponsor bonus)
--   EFFECTIVENESS: if they carry it, can they move it?
--                  (institutional power + track record on decided substantive bills)
--
-- Run this in the Supabase SQL editor AFTER ingest (and ideally after enrich,
-- so the power flags are populated). Re-run `refresh materialized view …` any
-- time the underlying data changes.
--
-- Tuning: every weight is a literal below. Change a number, re-run this file.
-- NOTE: institutional-power flags (chair, leadership, majority) are legislator-
-- level for the current session, so they lift a member's effectiveness across
-- all topics. That's intentional for a first cut; refine later if you want
-- committee-of-referral–specific weighting.
-- ============================================================================

drop materialized view if exists legislator_topic_scores;

create materialized view legislator_topic_scores as
select
  l.id                       as legislator_id,
  l.name,
  l.party,
  l.chamber,
  l.district,
  t.id                       as topic_id,
  t.code                     as topic_code,
  t.label                    as topic_label,

  -- raw components (exposed so the UI can explain a score)
  coalesce(a.substantive_count, 0)          as substantive_bills,
  coalesce(a.primary_count, 0)              as bills_led,
  round(coalesce(a.weighted_activity, 0))   as weighted_activity,
  coalesce(o.decided_count, 0)              as decided_bills,
  coalesce(o.passed_count, 0)               as passed_bills,
  p.in_majority,
  p.is_committee_chair,
  p.is_committee_vice,
  p.is_leadership,

  -- ── WILLINGNESS (0-100) ──
  least(100,
    (100 * least(1, sqrt(coalesce(a.weighted_activity, 0) / 8.0)))::int
    + case when coalesce(a.primary_count, 0) >= 1 then 8 else 0 end
  ) as willingness,

  -- ── EFFECTIVENESS (0-100) ──
  greatest(0, least(100, (
      40
      + case when p.in_majority        then 18 else 0 end
      + case when p.is_committee_chair  then 25 else 0 end
      + case when p.is_committee_vice   then 10 else 0 end
      + case when p.is_leadership       then 18 else 0 end
      + case when coalesce(o.decided_count, 0) >= 3
             then (((o.passed_count::numeric / o.decided_count) - 0.5) * 2 * 20
                   * least(1, o.decided_count / 4.0))
             else 0 end
    ))::int
  ) as effectiveness,

  -- ── data-quality label: how much to trust the numbers ──
  case
    when coalesce(a.substantive_count,0) >= 3 and coalesce(o.decided_count,0) >= 3 then 'solid'
    when coalesce(a.substantive_count,0) >= 1 then 'thin'
    else 'minimal'
  end as data_quality

from legislators l
join topics t on true                                   -- every legislator × every topic they've touched
join v_leg_topic_activity a on a.legislator_id = l.id and a.topic_id = t.id
left join v_leg_topic_outcomes o on o.legislator_id = l.id and o.topic_id = t.id
left join v_leg_power p on p.legislator_id = l.id;

-- unique index enables `refresh materialized view concurrently`
create unique index if not exists idx_lts_leg_topic
  on legislator_topic_scores (legislator_id, topic_id);

-- Handy: the best champions for a given topic are then just
--   select name, party, willingness, effectiveness, data_quality
--   from legislator_topic_scores
--   where topic_code = 'environment'
--   order by (willingness + effectiveness) desc
--   limit 20;
