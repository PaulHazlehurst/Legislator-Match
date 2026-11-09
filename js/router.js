// Hash routes: #/champions[/topic[/subtopic]], #/bills, #/relationships,
// #/insights, #/proposer, #/directory, #/watchlist, #/playbook,
// #/legislator/<id>, #/bill/<id>
const routes = [];
export function route(pattern, fn) { routes.push([pattern, fn]); }
export function navigate(hash) { if (location.hash !== hash) location.hash = hash; else dispatch(); }
export function dispatch() {
  const parts = (location.hash || '#/champions').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  for (const [p, fn] of routes) if (p === parts[0]) return fn(...parts.slice(1));
  return routes[0]?.[1]();
}
export function startRouter() { window.addEventListener('hashchange', dispatch); dispatch(); }
