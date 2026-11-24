// What a phone, or any page on a slow link, fetches only once the home card is live (fix/ios-start-2: the card and Enter
// first, on a 4G phone every MB before it costs about a second; perf/slow-loading: a desktop on Slow 4G too): the sound
// (the beds, the boat, the controls), the bay's fine skyline and the bark photos. A desktop on a fast link gets them at
// once, as before.
//   await afterCard();   // at once on a fast desktop; on a phone, a tablet or a slow link when the card is live (or after 60 s)
//   await afterReady();  // on every live page once the first live frame is drawn (captures: at once)
//   slowLink()           // this page's link is slow (Save-Data, a 2g/3g estimate, or the terrain grids came in under 12 Mbps)
import { touchDevice } from './device.js';
import { FLAGS } from '../sim/core/flags.js';

// a fetch that waits for afterCard() (perf/phone-load): the sounds a phone needs only once the card is live (the boat's
// water and rig, the engine, the birds, the skipper's clips: 1.9 MB, 23 files on the phone before, all before ready).
// The modules take it as their default fetchFn; a desktop on a fast link fetches at once, as before.
export const cardFetch = (url, opts) => afterCard().then(() => globalThis.fetch(url, opts));

// The link's speed, measured (perf/slow-loading): the page's own downloads so far that carried a body (≥ 100 KB
// on the wire: a revalidated 304 or a cached file says nothing about the link), as bytes over the time they were in flight.
// They run in parallel (the terrain grids, ≈ 3.5–10 MB, fetched by the module graph before anything asks), so the span is
// the link's, not one stream's. null when nothing has been measured yet.
export const SLOW_MBPS = 12;   // DevTools' Fast 4G is 9 Mbps and Slow 4G 1.6; a home broadband link is ≥ 25
export function measuredMbps(g = globalThis, out = null) {   // out: { bytes } filled in (how much the measure rests on)
  let list = [];
  try { list = g.performance?.getEntriesByType?.('resource') ?? []; } catch { return null; }
  let bytes = 0;
  const spans = [];
  for (const e of list) {
    if (!(e.transferSize >= 100e3) || !(e.responseEnd > e.startTime)) continue;
    bytes += e.transferSize; spans.push([e.startTime, e.responseEnd]);
  }
  if (!spans.length) return null;
  // the time the link was busy with them: the union of their spans (an idle stretch between two downloads is not the link's)
  spans.sort((p, q) => p[0] - q[0]);
  let busy = 0, [a, b] = spans[0];
  for (const [s, e] of spans.slice(1)) { if (s > b) { busy += b - a; a = s; b = e; } else b = Math.max(b, e); }
  busy += b - a;
  if (out) out.bytes = bytes;
  return busy > 0 ? (bytes * 8) / (busy * 1000) : null;
}
// slow: Save-Data, the browser's own 2g/3g estimate (Chrome; Safari and Firefox have none), or a measured link under
// SLOW_MBPS. Decided once per page, at the first call that has a measure (the world's build: the grids are in by then).
let slow = null;
export function slowLink(g = globalThis, { fresh = false } = {}) {
  if (slow != null && !fresh && g === globalThis) return slow;
  const f = g === globalThis ? FLAGS.slow : g.__slowFlag;   // ?slow=1|0 forces it (a probe, an A/B)
  if (f === '1' || f === '0') return f === '1';
  const c = g.navigator?.connection;
  const mbps = measuredMbps(g);
  const v = !!(c?.saveData || /^(slow-2g|2g|3g)$/.test(String(c?.effectiveType ?? '')) || (mbps != null && mbps < SLOW_MBPS));
  if (g === globalThis && (v || mbps != null)) slow = v;   // nothing measured yet and no hint: fast for now, asked again next time
  return v;
}

// the film's link verdict (src/ui/attractReel.js link): 'slow' under 4 Mbps (the 16 MB film would take over 30 s and share
// the game's link: the stills instead), 'mid' under SLOW_MBPS (the film after the downloads, at the 'sky' stage), 'fast'
// above, null while nothing is measured, or under 1 MB measured and not fast (the first scripts and the still are ≥ 100 KB:
// in within 0.6 s on any broadband)
const REEL_SLOW_MBPS = 4;
export function reelLink(g = globalThis) {
  const f = g === globalThis ? FLAGS.slow : g.__slowFlag;
  if (f === '1') return 'slow';
  if (f === '0') return 'fast';
  const c = g.navigator?.connection;
  if (c?.saveData || /^(slow-2g|2g|3g)$/.test(String(c?.effectiveType ?? ''))) return 'slow';
  const o = {}, m = measuredMbps(g, o);
  if (m == null) return null;
  if (m >= SLOW_MBPS) return 'fast';
  // under 1 MB the request's own round trips weigh too much (one 0.2 MB still on Fast 4G's 165 ms reads as 4 Mbps): not yet
  if (o.bytes < 1e6) return null;
  return m < REEL_SLOW_MBPS ? 'slow' : 'mid';
}

const LIVE = ['home', 'menu', 'attract', 'out', 'gone', 'off'];
let waiting = null;
export function cardLive(g = globalThis) {
  const L = g.__veliaLoading;
  return !L || L.off === true || LIVE.includes(L.state) || LIVE.includes(g.document?.getElementById?.('lk-load')?.dataset?.state);
}
// phone: wait for the card (a phone or tablet, or a slow link); false fetches at once
export function afterCard({ g = globalThis, phone = touchDevice(g) || slowLink(g), maxMs = 60000 } = {}) {
  if (!phone || cardLive(g)) return Promise.resolve(true);
  return (waiting ??= new Promise((res) => {
    const done = () => { clearInterval(iv); clearTimeout(to); g.removeEventListener?.('lakeshore:home', done); waiting = null; res(true); };
    const iv = setInterval(() => { if (cardLive(g)) done(); }, 400);
    const to = setTimeout(done, maxMs);
    g.addEventListener?.('lakeshore:home', done);
  }));
}

// the first live frame has been drawn (src/ui/loading.js logs 'ready'), or there is no card (captures, ?noload): what
// play needs only later waits for it on every device (perf/slow-loading: the kayak paddlers' figures, the photo ground's
// fine levels on a slow link), so it never shares the start's bandwidth. maxMs: never a deadlock.
export const isReady = (g = globalThis) => { const L = g.__veliaLoading; return !L || L.off === true || (L.log ?? []).some((r) => r[0] === 'ready'); };
let readyWait = null;
export function afterReady({ g = globalThis, maxMs = 180000 } = {}) {
  if (isReady(g)) return Promise.resolve(true);
  const make = () => new Promise((res) => {
    const done = () => { clearInterval(iv); clearTimeout(to); res(true); };
    const iv = setInterval(() => { if (isReady(g)) done(); }, 250);
    const to = setTimeout(done, maxMs);
  });
  if (g !== globalThis) return make();
  return (readyWait ??= make().finally(() => { readyWait = null; }));
}
