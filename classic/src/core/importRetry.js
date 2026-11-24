// A module that fails to import (perf/phone-load). Live metrics, 2026-11-06: "boot: Importing a module script failed."
// (Safari's words; Chrome says "Failed to fetch dynamically imported module", Firefox "error loading dynamically
// imported module"). Two causes: an upload replaced the hashed chunks while a visitor's page was still loading (the old
// index.html asks for chunks the new deploy no longer has), and a flaky phone network. So:
//   importRetry(() => import('./x.js'))   one more try after a short wait when the first fails to import
//   reloadFresh()                         the tab reloads once, with ?fresh=<time> so no cache hands back the old page;
//                                         at most once per tab in 5 minutes (sessionStorage), never without storage
//   dropFresh()                           the reloaded page takes ?fresh off its address bar (a shared link stays clean)
// index.html's first inline script does the same for the page's own entry scripts (a failed <script type=module>).
// No imports: src/main.js uses it before the game's module graph is in.

export const FRESH_KEY = 'lakeshore.fresh.v1';
export const FRESH_EVERY_MS = 5 * 60e3;
const FAILED = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload|module script|dynamically imported/i;
export const isImportError = (e) => FAILED.test(String(e?.message ?? e ?? ''));

export async function importRetry(load, { wait = 400, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  try { return await load(); } catch (e) {
    if (!isImportError(e)) throw e;
    await sleep(wait);
    return load();
  }
}

// true when the reload has been asked for (the caller stops); false when this tab already reloaded lately, or has no storage
export function reloadFresh({ loc = globalThis.location, store = (() => { try { return globalThis.sessionStorage; } catch { return null; } })(), now = Date.now() } = {}) {
  if (!loc || !store) return false;
  let last = NaN;
  try { last = parseFloat(store.getItem(FRESH_KEY) ?? ''); } catch { return false; }
  if (Number.isFinite(last) && now - last < FRESH_EVERY_MS) return false;
  try { store.setItem(FRESH_KEY, String(now)); } catch { return false; }
  const u = new URL(loc.href);
  u.searchParams.set('fresh', now.toString(36));
  loc.replace(u.href);
  return true;
}

export function dropFresh({ loc = globalThis.location, hist = globalThis.history } = {}) {
  try {
    const u = new URL(loc.href);
    if (!u.searchParams.has('fresh')) return false;
    u.searchParams.delete('fresh');
    hist.replaceState(hist.state, '', u.pathname + (u.search.length > 1 ? u.search : '') + u.hash);
    return true;
  } catch { return false; }
}
