// ============================================================================
// scores-ui.js  —  two-axis score display (v2: rings + badges)
//
// Load AFTER app.js. Replaces the single "Interest" ring on each Matcher card
// with two labeled rings — Willingness and Effectiveness — styled like the old
// ring, and adds Committee chair / Leadership / Majority badges. The existing
// bills / passage-rate / data-quality line on the card is left in place.
//
// Self-contained: it reuses the Supabase client the adapter already created
// (_sb) to pull the full score rows once, so you don't need to touch the
// adapter. Degrades quietly if anything is unavailable; base app unaffected.
// ============================================================================

(function () {
  const W_COLOR = '#2E5E8C', E_COLOR = '#B5852A';
  let AX = null; // AX[legId][topicCode] = full score row

  function currentTopic() {
    try { return (typeof currentIssue !== 'undefined') ? currentIssue : null; } catch (_) { return null; }
  }

  async function loadAX() {
    try {
      if (typeof _sb === 'undefined') return null;
      const size = 1000; let from = 0; const all = [];
      for (;;) {
        const { data, error } = await _sb.from('legislator_topic_scores')
          .select('legislator_id,topic_code,willingness,effectiveness,data_quality,' +
                  'is_committee_chair,is_committee_vice,is_leadership,in_majority,' +
                  'bills_led,decided_bills,passed_bills')
          .order('legislator_id').range(from, from + size - 1);
        if (error) throw error;
        all.push(...data);
        if (data.length < size) break;
        from += size;
      }
      const m = {};
      all.forEach(s => { (m[s.legislator_id] || (m[s.legislator_id] = {}))[s.topic_code] = s; });
      return m;
    } catch (_) { return null; }
  }

  const ringClass = (v) => v == null ? null : v <= 50 ? 'score-low' : v <= 80 ? 'score-mid' : 'score-high';

  function ring(val, color, label, tip) {
    const cls = ringClass(val);
    const shown = (val == null) ? '\u2014' : val;
    const styleAttr = cls ? '' : ' style="background:#ebe9e4;color:#9aa0ab;"';
    return `<div style="text-align:center;">
      <div class="score-ring ${cls || ''}"${styleAttr} title="${tip}">${shown}</div>
      <span class="score-label" style="color:${val == null ? '#9aa0ab' : color};font-weight:700;">${label}</span>
    </div>`;
  }

  function twoRings(row) {
    const w = row ? row.willingness : null, e = row ? row.effectiveness : null;
    return `<div style="display:flex;gap:16px;align-items:flex-start;justify-content:flex-end;">
      ${ring(w, W_COLOR, 'Willingness', 'Willingness \u2014 how likely this member is to carry a bill on this topic')}
      ${ring(e, E_COLOR, 'Effectiveness', 'Effectiveness \u2014 institutional power and track record to pass it')}
    </div>`;
  }

  function pill(text, fg, bg) {
    return `<span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;background:${bg};color:${fg};">${text}</span>`;
  }

  function badges(row) {
    if (!row) return '';
    const b = [];
    if (row.is_committee_chair) b.push(pill('Committee chair', '#7a5a16', '#f1e6cb'));
    else if (row.is_committee_vice) b.push(pill('Vice chair', '#7a5a16', '#f1e6cb'));
    if (row.is_leadership) b.push(pill('Leadership', '#7a5a16', '#f1e6cb'));
    if (row.in_majority) b.push(pill('Majority party', '#4a4a4a', '#eeebe4'));
    if (!b.length) return '';
    return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 2px;">${b.join('')}</div>`;
  }

  function enhance() {
    const topic = currentTopic();
    document.querySelectorAll('#results .card[data-legid]').forEach(card => {
      const col = card.querySelector('.score-col');
      if (!col) return;
      const legId = card.getAttribute('data-legid');
      const row = (AX && AX[legId] && AX[legId][topic]) || null;

      col.innerHTML = twoRings(row);

      const meter = card.querySelector('.meter');
      if (meter) meter.style.display = 'none';

      let badgeRow = card.querySelector('.ax-badges');
      if (!badgeRow) {
        badgeRow = document.createElement('div');
        badgeRow.className = 'ax-badges';
        const stats = card.querySelector('.stats-row');
        if (stats) stats.parentNode.insertBefore(badgeRow, stats);
        else card.querySelector('.card-top') && card.querySelector('.card-top').after(badgeRow);
      }
      badgeRow.innerHTML = badges(row);
    });
  }

  function install() {
    if (typeof window.render === 'function' && !window.render.__twoAxis) {
      const orig = window.render;
      const wrapped = function () { const r = orig.apply(this, arguments); setTimeout(enhance, 0); return r; };
      wrapped.__twoAxis = true;
      window.render = wrapped;
    }
    loadAX().then(m => { AX = m; enhance(); });
    setTimeout(enhance, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 30));
  } else {
    setTimeout(install, 30);
  }
})();
