// scores-ui.js — two-axis score display (additive, non-destructive)
(function () {
  const W_COLOR = '#2E5E8C';
  const E_COLOR = '#B5852A';

  function currentTopic() {
    try { return (typeof currentIssue !== 'undefined') ? currentIssue : null; }
    catch (_) { return null; }
  }
  function scoresFor(legId, topic) {
    try {
      if (!window.DATA || !DATA.scores || !topic) return null;
      return (DATA.scores[legId] && DATA.scores[legId][topic]) || null;
    } catch (_) { return null; }
  }

  function bar(label, val, color) {
    const pct = (val == null) ? 0 : Math.max(0, Math.min(100, val));
    const shown = (val == null) ? '—' : val;
    return `
      <div style="display:flex;align-items:center;gap:7px;margin:2px 0;">
        <span style="font-size:10px;font-weight:800;color:${color};width:12px;text-align:center;">${label}</span>
        <span style="flex:1;height:8px;background:#e8e6e1;border-radius:5px;overflow:hidden;">
          <span style="display:block;height:100%;width:${pct}%;background:${color};border-radius:5px;transition:width .4s ease;"></span>
        </span>
        <span style="font-size:13px;font-weight:800;color:${color};width:24px;text-align:right;font-variant-numeric:tabular-nums;">${shown}</span>
      </div>`;
  }

  function widget(ax) {
    const w = ax ? ax.w : null, e = ax ? ax.e : null, q = ax ? ax.q : null;
    const note = q
      ? `<span title="How much record backs these scores" style="font-size:10px;color:#8a8f98;text-align:right;display:block;margin-top:2px;">${q} data</span>`
      : `<span style="font-size:10px;color:#b3b3b8;text-align:right;display:block;margin-top:2px;">not yet scored</span>`;
    return `
      <div style="min-width:150px;">
        ${bar('W', w, W_COLOR)}
        ${bar('E', e, E_COLOR)}
        ${note}
      </div>`;
  }

  function enhance() {
    const topic = currentTopic();
    document.querySelectorAll('#results .card[data-legid]').forEach(card => {
      const col = card.querySelector('.score-col');
      if (!col) return;
      const legId = card.getAttribute('data-legid');
      const ax = scoresFor(legId, topic);
      col.innerHTML = widget(ax);
      const meter = card.querySelector('.meter');
      if (meter) meter.style.display = 'none';
    });
  }

  function install() {
    if (typeof window.render === 'function' && !window.render.__twoAxis) {
      const orig = window.render;
      const wrapped = function () {
        const r = orig.apply(this, arguments);
        setTimeout(enhance, 0);
        return r;
      };
      wrapped.__twoAxis = true;
      window.render = wrapped;
    }
    setTimeout(enhance, 60);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 30));
  } else {
    setTimeout(install, 30);
  }
})();
