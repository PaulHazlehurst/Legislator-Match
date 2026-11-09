import { STATE } from '../store.js';
import { scoreTopic } from '../../shared/scoring.js';
import { setPasscode } from '../api.js';
import { $, esc, partyChip, memberMeta, topicLabel, on, toast, store, lastName } from '../ui.js';
import { REL, STRENGTH, STAFF_COLORS, loadRelationships, saveStaff, deleteStaff, saveRel, deleteRel, staffColor, exportLocal, importLocal } from '../relationships.js';
import { openLegislator } from './legislator.js';

const KINDS = ['Former staffer', 'Campaign', 'District / constituent', 'Personal', 'Client work', 'Coalition partner', 'Other'];
const N = { topic: '', staffFilter: '', sim: null };

export async function renderNetwork(addFor) {
  if (REL.mode === 'loading') await loadRelationships();
  renderStatus(); renderStaff(); renderForm(addFor); renderGraph(); renderTable(); renderCoverage();
  if (addFor) setTimeout(() => $('rel-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
}

function renderStatus() {
  const el = $('n-status');
  if (REL.mode === 'team') { el.className = 'status ok'; el.innerHTML = 'Synced for the whole team. Only people with the team passcode can see this page’s data.'; return; }
  if (REL.mode === 'locked') {
    el.className = 'status lock';
    el.innerHTML = `<form id="pass-form"><label>Team passcode <input type="password" name="p" autocomplete="current-password" required></label><button class="btn">Unlock</button></form>${REL.error ? `<p class="err">${esc(REL.error)}</p>` : '<p class="fine">Relationships are private to Pinnacle. Ask a colleague for the passcode.</p>'}`;
    return;
  }
  el.className = 'status local';
  el.innerHTML = `<b>Saved in this browser only.</b> ${REL.error === 'not_configured' ? 'Team sync is deployed but not configured.' : 'Team sync is not deployed on this server.'} An admin can turn it on (see README, “Relationship web”). Until then, export your list and share the file.
    <span class="acts"><button class="btn btn-quiet" id="n-export">Export</button><label class="btn btn-quiet">Import<input type="file" id="n-import" accept="application/json" hidden></label></span>`;
}

function renderStaff() {
  const counts = {}; REL.rels.forEach(r => counts[r.staff_id] = (counts[r.staff_id] || 0) + 1);
  $('n-staff').innerHTML = (REL.staff.length ? `<ul class="staff">${REL.staff.map(s => `<li class="${N.staffFilter === s.id ? 'on' : ''}">
      <button class="staff-btn" data-staff="${s.id}" aria-pressed="${N.staffFilter === s.id}"><span class="sw" style="background:${staffColor(s)}"></span><b>${esc(s.name)}</b>${s.title ? `<span class="muted">${esc(s.title)}</span>` : ''}<span class="cnt">${counts[s.id] || 0}</span></button>
      <button class="x-btn" data-del-staff="${s.id}" title="Remove ${esc(s.name)}"><span class="sr">Remove ${esc(s.name)}</span>×</button></li>`).join('')}</ul>` : '<p class="muted">Add yourself and your colleagues to start mapping who knows whom.</p>')
    + (REL.mode === 'locked' ? '' : `<form id="staff-form" class="inline"><input name="name" placeholder="Colleague’s name" required aria-label="Colleague’s name"><input name="title" placeholder="Title (optional)" aria-label="Title"><button class="btn btn-quiet">Add colleague</button></form>`);
}

function renderForm(addFor) {
  const el = $('n-form');
  if (REL.mode === 'locked') { el.innerHTML = ''; return; }
  if (!REL.staff.length) { el.innerHTML = '<p class="muted">Add a colleague first, then record who they know.</p>'; return; }
  const me = store('pinnacle_user');
  const legOpts = STATE.legislators.map(l => `<option value="${esc(l.name)} (${l.party}, ${l.chamber === 'senate' ? 'Senate' : 'House'})" data-id="${l.id}"></option>`).join('');
  const pre = addFor && STATE.legById[addFor];
  el.innerHTML = `<form id="rel-form" class="relform">
    <h3>Record a relationship</h3>
    <label>Colleague<select name="staff_id" required>${REL.staff.map(s => `<option value="${s.id}" ${me && s.name === me ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label>Legislator<input name="leg" list="leg-list" required placeholder="Start typing a name" value="${pre ? esc(`${pre.name} (${pre.party}, ${pre.chamber === 'senate' ? 'Senate' : 'House'})`) : ''}" autocomplete="off"></label>
    <datalist id="leg-list">${legOpts}</datalist>
    <fieldset class="strength"><legend>How well do they know each other?</legend>${[1, 2, 3].map(v => `<label><input type="radio" name="strength" value="${v}" ${v === 2 ? 'checked' : ''}> ${STRENGTH[v]}</label>`).join('')}</fieldset>
    <label>Connection<select name="kind"><option value="">Choose…</option>${KINDS.map(k => `<option>${k}</option>`).join('')}</select></label>
    <label>Last contact<input type="date" name="last_contact"></label>
    <label class="wide">Notes<textarea name="notes" rows="2" placeholder="Context a colleague would need before reaching out"></textarea></label>
    <button class="btn">Save relationship</button>
  </form>`;
}

function legFromInput(v) {
  const opt = [...document.querySelectorAll('#leg-list option')].find(o => o.value === v);
  if (opt) return opt.dataset.id;
  const l = STATE.legislators.find(x => x.name.toLowerCase() === String(v).trim().toLowerCase());
  return l?.id || null;
}

function champions() {
  if (!N.topic) return null;
  return scoreTopic(STATE.index, N.topic).filter(r => r.bills_led > 0).slice(0, 15);
}

function renderGraph() {
  const host = $('n-graph');
  const rels = REL.rels.filter(r => STATE.legById[r.legislator_id] && REL.staff.some(s => s.id === r.staff_id));
  if (!rels.length) { host.innerHTML = `<div class="empty graph-empty">${REL.mode === 'locked' ? 'Unlock with the team passcode to see the relationship web.' : 'The web appears here once you record a relationship.'}</div>`; return; }
  if (!window.d3) { host.innerHTML = '<div class="empty">The graph library did not load. Check your connection and reload.</div>'; return; }
  const champ = champions(); const champBy = new Map((champ || []).map((r, i) => [r.legislator_id, { ...r, rank: i + 1 }]));
  const staff = REL.staff.filter(s => rels.some(r => r.staff_id === s.id));
  const legIds = [...new Set(rels.map(r => r.legislator_id))];
  const nodes = [...staff.map(s => ({ id: 's:' + s.id, kind: 'staff', s })), ...legIds.map(id => ({ id: 'l:' + id, kind: 'leg', l: STATE.legById[id], c: champBy.get(id) }))];
  const links = rels.map(r => ({ source: 's:' + r.staff_id, target: 'l:' + r.legislator_id, strength: r.strength, color: staffColor(REL.staff.find(s => s.id === r.staff_id)) }));
  const W = host.clientWidth || 800, H = Math.max(380, Math.min(620, 220 + nodes.length * 9));
  host.innerHTML = '';
  const svg = d3.select(host).append('svg').attr('viewBox', [0, 0, W, H]).attr('role', 'img')
    .attr('aria-label', `${staff.length} colleagues connected to ${legIds.length} legislators`);
  const link = svg.append('g').attr('class', 'links').selectAll('line').data(links).join('line')
    .attr('stroke', d => d.color).attr('stroke-width', d => [0, 1.2, 2.6, 4.4][d.strength]).attr('stroke-opacity', d => [0, .45, .6, .8][d.strength]);
  const node = svg.append('g').selectAll('g').data(nodes).join('g').attr('class', d => `nd nd-${d.kind}${d.c ? ' nd-champ' : ''}`).attr('tabindex', 0)
    .attr('aria-label', d => d.kind === 'staff' ? d.s.name : `${d.l.name}, ${d.l.party}${d.c ? `, champion number ${d.c.rank} on ${topicLabel(N.topic)}` : ''}`);
  node.filter(d => d.kind === 'staff').append('circle').attr('r', 17).attr('fill', d => staffColor(d.s));
  node.filter(d => d.kind === 'staff').append('text').attr('class', 'nd-init').attr('dy', 4).attr('text-anchor', 'middle').text(d => d.s.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
  node.filter(d => d.kind === 'staff').append('text').attr('class', 'nd-name').attr('dy', 32).attr('text-anchor', 'middle').text(d => d.s.name.split(' ')[0]);
  node.filter(d => d.kind === 'leg').append('circle').attr('r', d => d.c ? 9 + d.c.champion / 14 : 7).attr('class', d => `lg-dot party-fill-${d.l.party || 'I'}`);
  node.filter(d => d.c).append('text').attr('class', 'nd-rank').attr('dy', 3.5).attr('text-anchor', 'middle').text(d => d.c.rank);
  node.filter(d => d.kind === 'leg').append('text').attr('class', 'nd-lname').attr('dx', d => d.c ? 18 : 11).attr('dy', 4).text(d => lastName(d.l.name));
  node.append('title').text(d => d.kind === 'staff' ? d.s.name : `${d.l.name} (${d.l.party}), ${memberMeta(d.l)}${d.c ? `\n#${d.c.rank} champion on ${topicLabel(N.topic)} (${d.c.champion})` : ''}`);

  N.sim?.stop();
  const sim = N.sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => 70 + (3 - d.strength) * 25).strength(.7))
    .force('charge', d3.forceManyBody().strength(d => d.kind === 'staff' ? -520 : -140))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide(d => d.kind === 'staff' ? 34 : 18))
    .force('x', d3.forceX(W / 2).strength(.05)).force('y', d3.forceY(H / 2).strength(.08));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); }
  const clampX = x => Math.max(24, Math.min(W - 60, x)), clampY = y => Math.max(24, Math.min(H - 36, y));
  const draw = () => {
    link.attr('x1', d => clampX(d.source.x)).attr('y1', d => clampY(d.source.y)).attr('x2', d => clampX(d.target.x)).attr('y2', d => clampY(d.target.y));
    node.attr('transform', d => `translate(${clampX(d.x)},${clampY(d.y)})`);
  };
  sim.on('tick', draw); draw();
  node.call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(.25).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
  const focus = (d) => {
    const near = new Set([d.id]); links.forEach(l => { if (l.source.id === d.id) near.add(l.target.id); if (l.target.id === d.id) near.add(l.source.id); });
    node.classed('dim', n => !near.has(n.id)); link.classed('dim', l => l.source.id !== d.id && l.target.id !== d.id);
  };
  const blur = () => { node.classed('dim', false); link.classed('dim', false); };
  node.on('mouseenter focus', (e, d) => focus(d)).on('mouseleave blur', blur)
    .on('click', (e, d) => d.kind === 'leg' ? openLegislator(d.l.id, N.topic || null) : setStaffFilter(d.s.id))
    .on('keydown', (e, d) => { if (e.key === 'Enter') d.kind === 'leg' ? openLegislator(d.l.id, N.topic || null) : setStaffFilter(d.s.id); });
}

function renderCoverage() {
  const el = $('n-coverage'); const champ = champions();
  if (!champ) { el.innerHTML = '<p class="fine">Pick a policy area to see which of its top champions someone on the team already knows.</p>'; return; }
  const known = champ.filter(r => REL.rels.some(x => x.legislator_id === r.legislator_id));
  const gaps = champ.filter(r => !REL.rels.some(x => x.legislator_id === r.legislator_id));
  el.innerHTML = `<p><b>${known.length} of ${champ.length}</b> top champions on ${esc(topicLabel(N.topic))} are known to the team. Ranked dots in the web are champions.</p>
    ${gaps.length ? `<h4>No one knows yet</h4><ol class="gaps">${gaps.map(r => `<li value="${r.rank}"><button class="linkish" data-leg="${r.legislator_id}">${partyChip(r.party)} ${esc(r.name)}</button><span class="muted">champion ${r.champion}</span><a class="mini-link" href="#/relationships/add/${r.legislator_id}">Record</a></li>`).join('')}</ol>` : '<p>Every top champion here has a relationship on file.</p>'}`;
}

function renderTable() {
  const rows = REL.rels.filter(r => !N.staffFilter || r.staff_id === N.staffFilter)
    .map(r => ({ r, s: REL.staff.find(x => x.id === r.staff_id), l: STATE.legById[r.legislator_id] })).filter(x => x.s && x.l)
    .sort((a, b) => b.r.strength - a.r.strength || a.l.name.localeCompare(b.l.name));
  $('n-table').innerHTML = rows.length ? `<table class="reltable"><thead><tr><th scope="col">Colleague</th><th scope="col">Legislator</th><th scope="col">Strength</th><th scope="col">Connection</th><th scope="col">Last contact</th><th scope="col">Notes</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>
    ${rows.map(({ r, s, l }) => `<tr><td><span class="sw" style="background:${staffColor(s)}"></span>${esc(s.name)}</td><td><button class="linkish" data-leg="${l.id}">${partyChip(l.party)} ${esc(l.name)}</button></td><td><span class="str str-${r.strength}">${STRENGTH[r.strength]}</span></td><td>${esc(r.kind || '')}</td><td>${esc(r.last_contact || '')}</td><td class="notes">${esc(r.notes || '')}</td><td><button class="x-btn" data-del-rel="${r.id}" title="Delete"><span class="sr">Delete relationship</span>×</button></td></tr>`).join('')}</tbody></table>`
    : (REL.rels.length ? '<p class="muted">No relationships for this colleague yet.</p>' : '');
}

function setStaffFilter(id) { N.staffFilter = N.staffFilter === id ? '' : id; renderStaff(); renderTable(); }
const rerender = () => { renderStaff(); renderGraph(); renderTable(); renderCoverage(); };

export function setupNetwork() {
  $('n-topic').innerHTML = '<option value="">No policy area</option>' + STATE.topics.filter(t => !t.legacy).map(t => `<option value="${t.code}">${esc(t.label)}</option>`).join('');
  $('n-topic').addEventListener('change', e => { N.topic = e.target.value; renderGraph(); renderCoverage(); });
  const root = $('view-relationships');
  on(root, 'click', '[data-staff]', el => setStaffFilter(el.dataset.staff));
  on(root, 'click', '[data-leg]', el => openLegislator(el.dataset.leg, N.topic || null));
  on(root, 'click', '[data-del-staff]', async el => {
    const s = REL.staff.find(x => x.id === el.dataset.delStaff);
    if (!confirm(`Remove ${s?.name} and all of their relationships?`)) return;
    try { await deleteStaff(s.id); rerender(); toast(`Removed ${s.name}.`); } catch (e) { toast(e.message, 'error'); }
  });
  on(root, 'click', '[data-del-rel]', async el => {
    if (!confirm('Delete this relationship?')) return;
    try { await deleteRel(el.dataset.delRel); rerender(); toast('Relationship deleted.'); } catch (e) { toast(e.message, 'error'); }
  });
  on(root, 'click', '#n-export', () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportLocal()], { type: 'application/json' }));
    a.download = `pinnacle-relationships-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  on(root, 'change', '#n-import', async el => {
    try { importLocal(await el.files[0].text()); rerender(); toast('Relationships imported.'); } catch (e) { toast(e.message, 'error'); }
  });
  root.addEventListener('submit', async ev => {
    const f = ev.target; ev.preventDefault();
    try {
      if (f.id === 'pass-form') { setPasscode(f.p.value); REL.mode = 'loading'; await renderNetwork(); return; }
      if (f.id === 'staff-form') {
        const s = await saveStaff({ name: f.name.value, title: f.title.value, color: STAFF_COLORS[REL.staff.length % STAFF_COLORS.length] });
        if (!store('pinnacle_user')) store('pinnacle_user', s.name);
        renderStaff(); renderForm(); toast(`Added ${s.name}.`); return;
      }
      if (f.id === 'rel-form') {
        const legislator_id = legFromInput(f.leg.value);
        if (!legislator_id) { toast('Pick a legislator from the list.', 'error'); f.leg.focus(); return; }
        await saveRel({ staff_id: f.staff_id.value, legislator_id, strength: f.strength.value, kind: f.kind.value, notes: f.notes.value, last_contact: f.last_contact.value, updated_by: store('pinnacle_user') || '' });
        toast(`Saved: ${REL.staff.find(s => s.id === f.staff_id.value)?.name} knows ${STATE.legById[legislator_id].name}.`);
        f.leg.value = ''; f.notes.value = ''; f.kind.value = ''; f.last_contact.value = '';
        rerender();
      }
    } catch (e) { toast(e.message, 'error'); }
  });
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (!$('view-relationships').hidden) renderGraph(); }, 200); });
}
