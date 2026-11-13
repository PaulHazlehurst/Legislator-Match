// ─────────────────────────────────────────────────────────────────────────────
// Idea search — lets the Proposer handle anything someone types, not just
// text that looks like a Maryland bill title.
//
//   1. Plain-language terms are expanded to the words bills actually use
//      ("weed" → cannabis, "uber" → transportation network company).
//   2. Every bill (title, and summary when loaded) is ranked against the idea
//      with BM25, the standard search-engine relevance formula.
//   3. The policy area is inferred from two votes: the rule classifier reading
//      the idea itself, and the areas of the most similar real bills. An idea
//      phrased nothing like a bill title still lands in the right area if
//      bills about the same thing exist.
// ─────────────────────────────────────────────────────────────────────────────
import { classifyBill } from './classifier.js';

const STOP = new Set(('a an and the of for to in on by with from that this these those or as at be is are was were its it into under over ' +
  'i we you they he she our my your their want wants would should could can will make making get give help need needs like so more less ' +
  'establishing requiring altering providing prohibiting authorizing certain bill bills act law laws state maryland people person persons ' +
  'new also not no do does have has when where which who what how than then there about any all each other such may must shall').split(' '));

// lay term → legislative vocabulary (added to the query, not replacing it)
const SYNONYMS = [
  [/\b(weed|pot|marijuana|dispensar\w*|edibles?)\b/, 'cannabis'],
  [/\b(uber|lyft|ride ?shar\w*)\b/, 'transportation network company'],
  [/\b(airbnb|vrbo|vacation rentals?)\b/, 'short-term rental'],
  [/\b(vap(e|es|ing)|e-?cig\w*|juul)\b/, 'electronic smoking device tobacco'],
  [/\bai\b|chatbots?|machine learning|deepfakes?/, 'artificial intelligence'],
  [/\b(evs?|electric cars?|tesla)\b/, 'electric vehicle charging'],
  [/\b(day ?care|babysit\w*|preschool|pre-k)\b/, 'child care prekindergarten'],
  [/\b(cops?|policing)\b/, 'police law enforcement'],
  [/\b(guns?|pistols?|ar-?15)\b/, 'firearm handgun'],
  [/\b(renters?|rent control|evict\w*|slumlords?)\b/, 'landlord tenant residential lease rent'],
  [/\b(hoa|condo)s?\b/, 'homeowners association condominium common ownership'],
  [/\b(doctors?|physicians?)\b/, 'physician health occupations'],
  [/\b(drug prices?|pbm|pharma)\b/, 'prescription drug pharmacy benefits manager'],
  [/\b(mental health|therapy|therapists?|suicide)\b/, 'behavioral health mental'],
  [/\b(opioids?|fentanyl|overdoses?|narcan)\b/, 'opioid overdose substance use'],
  [/\b(sports? bet\w*|gambl\w*|casinos?|draftkings|fanduel)\b/, 'sports wagering gaming'],
  [/\b(crypto\w*|bitcoin|stablecoin)\b/, 'virtual currency financial institutions'],
  [/\b(payday|predatory lend\w*|loan sharks?)\b/, 'credit regulation consumer loan'],
  [/\b(solar|wind farm|renewables?|clean energy)\b/, 'renewable energy solar'],
  [/\b(power bills?|electric bills?|utility bills?|bge|pepco)\b/, 'electric company rates public service commission'],
  [/\b(data centers?)\b/, 'data center'],
  [/\b(privacy|data brokers?|tracking)\b/, 'data privacy personal information'],
  [/\b(social media|tiktok|instagram|screen time)\b/, 'social media online children'],
  [/\b(food trucks?|street vendors?)\b/, 'mobile food service vendor license'],
  [/\b(liquor|booze|brewer\w*|bars?|happy hour)\b/, 'alcoholic beverages license'],
  [/\b(minimum wage|tipped|overtime|gig workers?)\b/, 'wage hour employment'],
  [/\b(paid leave|parental leave|sick leave|fmla|famli)\b/, 'family medical leave insurance'],
  [/\b(unions?|organizing|strike)\b/, 'collective bargaining labor'],
  [/\b(apprentic\w*|trades?|job training|upskill\w*)\b/, 'apprenticeship workforce training'],
  [/\b(speed cameras?|red light|speeding|reckless driv\w*)\b/, 'speed monitoring system vehicle laws'],
  [/\b(bus(es)?|metro|light rail|marc|purple line|transit)\b/, 'transit transportation'],
  [/\b(potholes?|roads?|highways?|bridges?|tolls?)\b/, 'highway transportation'],
  [/\b(schools?|teachers?|classrooms?|students?|blueprint)\b/, 'public schools education'],
  [/\b(college|tuition|student loans?|universit\w*)\b/, 'higher education'],
  [/\b(voting|ballots?|elections?|mail-in|gerrymander\w*)\b/, 'election law'],
  [/\b(property tax\w*|assessments?)\b/, 'property tax'],
  [/\b(tax (breaks?|cuts?|credits?|relief))\b/, 'income tax credit'],
  [/\b(sales tax)\b/, 'sales and use tax'],
  [/\b(bay|oysters?|crabs?|watermen)\b/, 'chesapeake bay natural resources'],
  [/\b(plastic|styrofoam|recycl\w*|litter|landfills?|compost\w*)\b/, 'environment recycling solid waste'],
  [/\b(pfas|forever chemicals?|toxics?|pesticides?)\b/, 'environment hazardous substances'],
  [/\b(climate|emissions?|greenhouse)\b/, 'environment greenhouse gas climate'],
  [/\b(farms?|farmers?|agricultur\w*)\b/, 'agriculture'],
  [/\b(pets?|dogs?|cats?|animal (cruelty|welfare)|puppy mills?)\b/, 'animal welfare'],
  [/\b(prisons?|jails?|inmates?|parole|reentry|returning citizens?)\b/, 'correctional services'],
  [/\b(expunge\w*|clean slate|criminal records?)\b/, 'expungement criminal procedure'],
  [/\b(juveniles?|youth crime)\b/, 'juvenile law'],
  [/\b(domestic violence|protective orders?|stalking)\b/, 'family law protective order'],
  [/\b(divorce|custody|child support|alimony)\b/, 'family law child support custody'],
  [/\b(lawsuits?|sue|liabilit\w*|malpractice)\b/, 'civil actions liability'],
  [/\b(veterans?|military|national guard)\b/, 'veterans military'],
  [/\b(seniors?|elderly|nursing homes?|assisted living)\b/, 'older adults assisted living nursing home'],
  [/\b(disabilit\w*|accessib\w*|wheelchairs?)\b/, 'disabilities accessibility'],
  [/\b(snap|food stamps?|welfare|food banks?)\b/, 'supplemental nutrition assistance human services'],
  [/\b(homeless\w*|shelters?)\b/, 'homelessness housing'],
  [/\b(affordable housing|zoning|adus?|density)\b/, 'housing land use zoning'],
  [/\b(medicaid|uninsured|health coverage)\b/, 'medical assistance program health insurance'],
  [/\b(insurance (rates?|premiums?)|auto insurance|homeowners insurance)\b/, 'insurance'],
  [/\b(abortion|reproductive|ivf|contracepti\w*)\b/, 'public health reproductive'],
  [/\b(hospitals?|er wait|emergency rooms?)\b/, 'hospitals health care facilities'],
  [/\b(nurses?|nursing shortage)\b/, 'health occupations nurses'],
  [/\b(small business\w*|startups?|entrepreneurs?)\b/, 'small business economic development'],
  [/\b(minority[- ]owned|mbe|women[- ]owned)\b/, 'minority business enterprise procurement'],
  [/\b(licens\w*|permits?)\b/, 'license'],
  [/\b(scams?|fraud|junk fees?|price gouging|ticket ?master|subscriptions?)\b/, 'consumer protection'],
  [/\b(broadband|internet access|rural internet|5g)\b/, 'broadband telecommunications'],
  [/\b(cyber\w*|hack\w*|ransomware)\b/, 'cybersecurity information technology'],
  [/\b(immigra\w*|ice|undocumented|sanctuary)\b/, 'immigration enforcement'],
  [/\b(pensions?|state workers?|state employees?)\b/, 'state personnel retirement pension'],
  [/\b(procurement|state contracts?|contractors?)\b/, 'state procurement'],
  [/\b(911|ems|firefighters?|first responders?|paramedics?)\b/, 'emergency services fire public safety'],
  [/\b(horse racing|pimlico|preakness|laurel park)\b/, 'horse racing'],
  [/\b(insulin|epipens?|inhalers?|copays?)\b/, 'prescription drug health insurance cost sharing'],
  [/\b(surprise (medical )?bills?|balance billing|medical debt)\b/, 'health insurance balance billing medical debt'],
  [/\b(ambulances?)\b/, 'emergency medical services'],
  [/\b(e-?bikes?|scooters?|bike lanes?)\b/, 'electric bicycle vehicle laws'],
  [/\b(tickets? (scalp\w*|resale|bots?)|scalp\w*)\b/, 'ticket resale consumer protection'],
  [/\b(rebates?|subsid\w*|grants?)\b/, 'grant program'],
  [/\b(cell ?phones?|smartphones?)\b/, 'cellular telephone device'],
  [/\b(telehealth|telemedicine)\b/, 'telehealth health care'],
  [/\b(school lunch\w*|free meals?)\b/, 'school meals breakfast lunch'],
  [/\b(drones?)\b/, 'unmanned aircraft'],
  [/\b(noncompetes?|non-competes?)\b/, 'noncompete employment'],
  [/\b(right to repair)\b/, 'consumer protection repair equipment'],
];

const stem = (w) => w.length > 5 ? w.replace(/(ations?|ments?|ings?|ities|ity|ies|ers?|ed|es|s)$/, m => (m === 'ies' || m === 'ities' || m === 'ity') ? 'i' : '') : w.replace(/s$/, '');
export function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9'-]*[a-z0-9]|[a-z0-9]/g) || [])
    .filter(w => w.length > 1 && !STOP.has(w)).map(stem).filter(w => w.length > 1);
}
export function expand(text) {
  const low = ' ' + String(text || '').toLowerCase() + ' ';
  const added = [];
  for (const [re, add] of SYNONYMS) if (re.test(low)) added.push(add);
  return added;
}

// docs: [{ id, title, text? }]. Title terms count triple.
export function buildSearchIndex(docs) {
  const postings = new Map(); const len = new Map(); let total = 0;
  for (const d of docs) {
    const tf = new Map();
    for (const t of tokenize(d.title)) tf.set(t, (tf.get(t) || 0) + 3);
    for (const t of tokenize(d.text)) tf.set(t, (tf.get(t) || 0) + 1);
    let n = 0;
    for (const [t, f] of tf) { n += f; if (!postings.has(t)) postings.set(t, []); postings.get(t).push([d.id, f]); }
    len.set(d.id, n); total += n;
  }
  return { postings, len, N: docs.length, avg: total / Math.max(1, docs.length) };
}

// → [{ id, score, matched: Set(term) }] best first
export function search(index, text, { extra = [], limit = 40 } = {}) {
  const own = tokenize(text), syn = tokenize([...expand(text), ...extra].join(' '));
  const q = new Map();
  for (const t of own) q.set(t, 1);
  for (const t of syn) if (!q.has(t)) q.set(t, 0.6);
  const k1 = 1.4, b = 0.7, scores = new Map(), matched = new Map();
  for (const [t, w] of q) {
    const post = index.postings.get(t); if (!post) continue;
    const idf = Math.log(1 + (index.N - post.length + 0.5) / (post.length + 0.5));
    for (const [id, f] of post) {
      const s = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * index.len.get(id) / index.avg));
      scores.set(id, (scores.get(id) || 0) + w * s);
      (matched.get(id) || matched.set(id, new Set()).get(id)).add(t);
    }
  }
  // One stray common word is not "similar": need two shared terms, or one rare one.
  const rare = new Set([...q.keys()].filter(t => { const p = index.postings.get(t); return p && p.length <= Math.max(3, index.N * 0.004); }));
  const need = q.size >= 3 ? 2 : 1;
  return [...scores].filter(([id]) => matched.get(id).size >= need || [...matched.get(id)].some(t => rare.has(t)))
    .map(([id, score]) => ({ id, score, matched: matched.get(id) }))
    .sort((a, b2) => b2.score - a.score).slice(0, limit);
}

// Infer the policy area of free text.
// billOf(id) → { topic, subtopic, secondary }. Returns ranked areas with a
// 0–1 share, the best subtopic for the top area, and the similar bills used.
export function inferArea(index, text, billOf, { extra = [], aiTopic = null } = {}) {
  const hits = search(index, text, { extra, limit: 40 });
  const votes = {};
  const add = (t, w) => { if (t && w > 0) votes[t] = (votes[t] || 0) + w; };

  // the rule classifier reading the idea (and its expansion) as if it were a bill
  const c = classifyBill({ title: text, description: [...expand(text), ...extra].join('; ') });
  const cTot = Object.values(c.scores || {}).reduce((a, v) => a + v, 0) || 1;
  for (const [t, v] of Object.entries(c.scores || {})) add(t, 1.0 * v / cTot);

  // the neighbours: areas of the most similar real bills
  // (score squared, so the closest matches dominate the long tail)
  const top = hits.slice(0, 25), sTot = top.reduce((a, h) => a + h.score ** 2, 0) || 1;
  for (const h of top) { const b = billOf(h.id); if (!b) continue; add(b.topic, 1.4 * h.score ** 2 / sTot); add(b.secondary, 0.35 * h.score ** 2 / sTot); }
  if (aiTopic) add(aiTopic, 1.2);

  const tot = Object.values(votes).reduce((a, v) => a + v, 0) || 1;
  const areas = Object.entries(votes).map(([topic, v]) => ({ topic, share: v / tot })).sort((a, b) => b.share - a.share);
  return { areas, hits, classifier: c, subtopicFor: (topic) => bestSubtopic(top, billOf, topic, c) };
}

function bestSubtopic(hits, billOf, topic, c) {
  const v = {};
  for (const h of hits) { const b = billOf(h.id); if (b?.topic === topic && b.subtopic) v[b.subtopic] = (v[b.subtopic] || 0) + h.score; }
  if (c.topic === topic && c.subtopic) v[c.subtopic] = (v[c.subtopic] || 0) + 4;
  const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0];
  const tot = Object.values(v).reduce((a, x) => a + x, 0);
  return best && best[1] / tot >= 0.4 ? best[0] : null;
}
