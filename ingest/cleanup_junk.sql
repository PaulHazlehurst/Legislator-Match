-- ============================================================================
-- Remove committee-name / caucus-header rows wrongly stored as legislators.
-- Safe: matches known non-person name patterns. Their mis-attributed
-- sponsorships cascade away; real bills keep their real sponsors.
-- Run AFTER relink.js.
-- ============================================================================
delete from legislators
where name ~* '(^|\s)(committee|senators|appropriations|finance|judiciary|judicial proceedings|ways and means|economic matters|health and government|environment and transportation|education, energy|government, labor|budget and taxation|audit and evaluation|management of public funds|pensions|rules)($|\s)'
   or name ~* 'county senators$';

-- rebuild derived views with the repaired roster
refresh materialized view legislator_topic_scores;
refresh materialized view legislator_allies;

-- sanity: chamber split should now be a real House/Senate division
select chamber::text, count(*) from legislators group by chamber::text;
