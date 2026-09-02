// ============================================================================
// supabase-data.js
// Builds the exact DATA object your app already expects — but from Supabase
// instead of data.json. Include this BEFORE app.js. Your existing code (all
// tabs, scoring, sidebar) then runs unchanged on the live database.
//
//   DATA = {
//     states:  { MD: { name, legislators: [ { id,name,party,chamber,district, bills:[…] } ] } },
//     topics:  { code: { label, subtopics: { subcode: sublabel } } },
//     sponsors:{ legislatorId: { notes } },
//     scores:  { legislatorId: { topicCode: { w, e, q } } }   // two-axis, for display
//   }
// ============================================================================

// ─── CONFIG ─────────────────────────────────────────────────────────────────
// Project URL + PUBLIC anon key (Settings → API). Safe in the browser:
// rls.sql makes the anon key read-only.
const SB_URL  = "PASTE_YOUR_SUPABASE_URL";
const SB_ANON = "PASTE_YOUR_ANON_KEY";
// ────────────────────────────────────────────────────────────────────────────

const _sb = window.supabase.createClient(SB_URL, SB_ANON);

// Page through result sets larger than Supabase's 1000-row cap.
async function _pageAll(makeQuery) {
  const size = 1000; let from = 0; const all = [];
  for (;;) {
    const { data, error } = await makeQuery().range(from, from + size - 1);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

async function loadDataFromSupabase() {
  const DATA = { states: {}, topics: {}, sponsors: {}, scores: {} };

  // 1. taxonomy → DATA.topics
  const [{ data: topics, error: te }, { data: subs, error: se }] = await Promise.all([
    _sb.from('topics').select('code,label').order('label'),
    _sb.from('subtopics').select('code,label,topics(code)'),
  ]);
  if (te) throw new Error('topics: ' + te.message);
  if (se) throw new Error('subtopics: ' + se.message);
  topics.forEach(t => DATA.topics[t.code] = { label: t.label, subtopics: {} });
  subs.forEach(s => { const tc = s.topics?.code; if (tc && DATA.topics[tc]) DATA.topics[tc].subtopics[s.code] = s.label; });

  // 2. legislators → shells with empty bills
  const legs = await _pageAll(() =>
    _sb.from('legislators').select('id,name,party,chamber,district').eq('state_code', 'MD').order('id'));
  const byId = {};
  legs.forEach(l => byId[l.id] = {
    id: l.id, name: l.name, party: l.party, chamber: l.chamber,
    district: l.district || '', bills: [],
  });

  // 3. classified bills with their sponsors, topic/subtopic codes, and year.
  //    Each sponsorship becomes one bill entry under that legislator (matching
  //    the old per-legislator bills[] shape). role: primary → 'sponsor'.
  const bills = await _pageAll(() =>
    _sb.from('bills')
      .select('legiscan_bill_id,bill_number,title,description,outcome,status_stage,' +
              'significance,classification_confidence,classified_by,' +
              'topics(code),subtopics(code),sessions(year_end,name),' +
              'sponsorships(role,legislator_id)')
      .not('topic_id', 'is', null)
      .order('legiscan_bill_id'));

  bills.forEach(b => {
    const topic = b.topics?.code || null;
    const subtopic = b.subtopics?.code || null;
    const year = b.sessions?.year_end || null;
    (b.sponsorships || []).forEach(sp => {
      const leg = byId[sp.legislator_id];
      if (!leg) return;
      leg.bills.push({
        id: b.legiscan_bill_id,
        billNumber: b.bill_number,
        title: b.title,
        description: b.description || '',
        topic, subtopic,
        outcome: b.outcome,            // passed | failed | pending
        year,
        role: sp.role === 'cosponsor' ? 'cosponsor' : 'sponsor',
        statusStage: b.status_stage || null,
        significance: b.significance || null,
        dataset: b.sessions?.name || null,
        confidence: b.classification_confidence || null,
        needsReview: b.classified_by === 'gemini_no_match',
      });
    });
  });

  DATA.states['MD'] = { name: 'Maryland', legislators: Object.values(byId) };

  // 4. firm sponsor relationships → DATA.sponsors
  const { data: os } = await _sb.from('our_sponsors').select('legislator_id,notes');
  (os || []).forEach(s => DATA.sponsors[s.legislator_id] = { notes: s.notes || '' });

  // 5. two-axis scores → DATA.scores (for the upgraded card display)
  try {
    const scores = await _pageAll(() =>
      _sb.from('legislator_topic_scores')
        .select('legislator_id,topic_code,willingness,effectiveness,data_quality')
        .order('legislator_id'));
    scores.forEach(s => {
      (DATA.scores[s.legislator_id] ||= {})[s.topic_code] =
        { w: s.willingness, e: s.effectiveness, q: s.data_quality };
    });
  } catch (_) { /* scores optional; app still works without them */ }

  return DATA;
}

window.loadDataFromSupabase = loadDataFromSupabase;
