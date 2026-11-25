// The quality ladder (the phone pass): three levels above the governor. The governor moves the render
// scale inside a level; the ladder moves the level. Pure, except readStored / writeStored (a safe localStorage).
//
//   L0 full     the desktop: DPR cap 2, 3.4 Mpx (8.3 Mpx on a live desk page: DESK_MAXPX), MSAA 4, the terrain shadow every 4th frame, the cloud key by size
//               (2048 × 512), the forest as the terrain set's (shrubs on the full set), the shallows' full detail
//   L1          about 1.2 Mpx: the pixel cap, the cloud key 1024 × 256, no shrubs, the terrain shadow every 8th frame
//   L2          about 0.7 Mpx (DPR cap 1.5), MSAA 1, the cloud key 1024 × 256, the forest's reach × 0.6 (fewer far trees,
//               thinning sooner), no shrubs, the shadow every 12th frame, the shallows' coarse path (one caustic net, no
//               cobbles: v1's phone path), the spray mist at half (sim/mist.js; live: a uniform)
//   L3          perf(v2) phone, for weak phones: about 0.45 Mpx (DPR cap 1.25), the forest's reach × 0.4, the shadow every
//               24th frame, no spray mist; L2's rows otherwise
//
// What applies when: the caps, the shadow's cadence, the forest's reach and the shallows' detail change live (no pipeline,
// no new texture); MSAA changes live too (BACKLOG-v2 #31): every scene pipeline is declared at both counts, the start
// count built at load, the other built async in the background after the settle (or at once on a step that needs it), and
// the switch lands between two frames once that set is built (main.js msaaSwitch). The cloud key and the boat's shadow
// map are built at load (their pipelines and textures are sized by them), so a live step lists them as `pending` and the
// stored level brings them at the next load. 0 pipelines built synchronously after the first frame at every level.
//
// The first level: ?quality=0|1|2|3 pins it; else a settled level stored for this GPU (≤ 14 days old); else a guess from the
// adapter and the screen (guessLevel). Captures (?headless) take L0 unless pinned, so the goldens never move.
// perf(v2) phone: the phone path's rows (live, every pipeline built at load): waterGrid (the coarse grid: a quarter of the
// triangles), waterAniso (the cascades' anisotropy), waterLite (the lite water: 3 land and 2 cloud taps, the ground height
// a vertex), cloudEvery (the cloud key's step every 2nd frame), simEvery (the FFT sim every 2nd frame: the wake's maps
// every frame), airEvery (the aerial froxels and the land's mirror every 2nd frame). LEVER_ROWS names them for the diag sweep.
// Round 2 (2026-11-13 night): simSplit (the sim's half-rate step spread over both frames: the evolve and the rows' FFT on
// one, the columns, the assemble and the mips on the other; the cloud key and the boat's shadow on the frames the aerial
// pass skips, so no frame carries every half-rate pass), waterCascades (3: the 2.1 m cascade's ripples left out of the sim,
// its roughness kept: render/water.js FLAT3_WGSL), waterFused (the mip chain in 4 dispatches for 16), boatShadowEvery (the
// boat's shadow map every 2nd frame, its matrix following the boat between)
import { formOf } from '../../src/core/profile.js';
const FULL = { waterGrid: 'fine', waterAniso: 8, waterLite: false, cloudEvery: 1, simEvery: 1, airEvery: 1, simSplit: false, waterCascades: 4, waterFused: false, boatShadowEvery: 1 };
const PHONE = { waterGrid: 'coarse', waterAniso: 2, waterLite: true, cloudEvery: 2, simEvery: 2, airEvery: 2, simSplit: true, waterCascades: 3, waterFused: true, boatShadowEvery: 2 };
export const LEVER_ROWS = Object.freeze(Object.keys(FULL));
export const LEVER_OFF = Object.freeze({ ...FULL });
// ?levers= → the rows it pins (none: the full path; all: the phone path; 'grid,lite': those on, the rest full), else null
const LEVER_NAMES = Object.freeze({ grid: 'waterGrid', aniso: 'waterAniso', lite: 'waterLite', clouds: 'cloudEvery', sim: 'simEvery', air: 'airEvery', split: 'simSplit', cascades: 'waterCascades', fused: 'waterFused', bshadow: 'boatShadowEvery' });
export function leverRows(q) {
  if (q == null || q === '') return null;
  const s = String(q).toLowerCase();
  if (s === 'none' || s === '0') return { ...FULL };
  if (s === 'all' || s === '1') return { ...PHONE };
  const on = new Set(s.split(',').map((x) => LEVER_NAMES[x.trim()]).filter(Boolean));
  return Object.fromEntries(LEVER_ROWS.map((k) => [k, on.has(k) ? PHONE[k] : FULL[k]]));
}
export const LEVELS = Object.freeze([
  Object.freeze({ id: 0, name: 'L0 full', dprCap: 2, maxPx: 3.4e6, msaa: 4, boatShadow: 2048, shadowEvery: 4, cloudKey: 'auto', forestReach: 1, shrubs: true, bedFine: 1, mist: 1, ...FULL }),
  Object.freeze({ id: 1, name: 'L1', dprCap: 2, maxPx: 1.2e6, msaa: 4, boatShadow: 2048, shadowEvery: 8, cloudKey: 'small', forestReach: 1, shrubs: false, bedFine: 1, mist: 1, ...FULL }),
  Object.freeze({ id: 2, name: 'L2', dprCap: 1.5, maxPx: 0.7e6, msaa: 1, boatShadow: 1024, shadowEvery: 12, cloudKey: 'small', forestReach: 0.6, shrubs: false, bedFine: 0, mist: 0.5, ...PHONE }),
  Object.freeze({ id: 3, name: 'L3', dprCap: 1.25, maxPx: 0.45e6, msaa: 1, boatShadow: 1024, shadowEvery: 24, cloudKey: 'small', forestReach: 0.4, shrubs: false, bedFine: 0, mist: 0, ...PHONE }),   // perf(v2) phone
]);
export const TOP = LEVELS.length - 1;
export const BUILD_KEYS = Object.freeze(['cloudKey', 'boatShadow']);   // #31: MSAA left this list (live: main.js msaaSwitch)   // perf(v2) phone: the boat's shadow map (2048², 1024² at L2 and L3: 16 MB cleared and stored a frame on a tile GPU, 4 MB)   // the rows a live step cannot change (pipelines are sized by them)
export const STORE_KEY = 'velia.v2.quality';
export const STORE_DAYS = 14;
const clampLevel = (n) => Math.max(0, Math.min(LEVELS.length - 1, Math.trunc(n)));
// fix(v2) desktop quality (the owner's MacBook, 2026-11-15: L0 at 3.4 Mpx of a 4.75 Mpx window, 7 ms GPU work at 60 fps): a
// live desk page's L0 draws up to 8.3 Mpx (a 4K screen at DPR 1, a 16" MacBook full screen at DPR 2); the governor's scale
// trims it when the work misses 60 fps. Phones, tablets, captures (the goldens) and L1-L3 keep the level's own cap
export const DESK_MAXPX = 8.3e6;
//   levelCaps(level, { desk }) -> { dprCap, maxPx }: desk is a live desktop page (not a phone, not a tablet, not a capture)
// perf(v2) phone 30 fps (owner, 2026-11-15: "push for the picture quality"): a live phone or tablet page held at 30 fps
// draws more pixels at L2 and L3 (the phone path's levels): the owner's iPhone settled at L2 × 0.86 (0.45 Mpx) under 60 fps;
// at 30 fps its model fits about 0.85–0.95 Mpx in 26 ms. Captures and desks keep the level caps
export const MOBILE30_CAPS = Object.freeze({ 2: Object.freeze({ dprCap: 2, maxPx: 0.95e6 }), 3: Object.freeze({ dprCap: 1.5, maxPx: 0.6e6 }) });
//   levelCaps(level, { desk, mobile }): mobile is a live phone or tablet page held at 30 fps (not a capture)
export function levelCaps(level, { desk = false, mobile = false } = {}) {
  const L = LEVELS[clampLevel(level)];
  if (mobile && !desk && MOBILE30_CAPS[L.id]) return { ...MOBILE30_CAPS[L.id] };
  return { dprCap: L.dprCap, maxPx: desk && L.id === 0 ? Math.max(L.maxPx, DESK_MAXPX) : L.maxPx };
}

// ?quality=0|1|2|3 → 0–3, else null (also v1's words: high | balanced | low)
export function pinnedLevel(q) {
  if (q == null || q === '') return null;
  const w = { high: 0, full: 0, balanced: 1, low: 2, smooth: 2 }[String(q).toLowerCase()];
  if (w != null) return w;
  const n = Number(q);
  return Number.isInteger(n) && n >= 0 && n <= TOP ? n : null;
}

// The device facts the guess reads (the phone and tablet words: src/core/profile.js form) (all optional). adapterInfo: WebGPU's adapter.info ({ vendor, architecture,
// description }); screen { w, h, dpr } in CSS px; ua; touch (maxTouchPoints); deviceMemory (GB, Chrome only); coarse
// (matchMedia('(pointer: coarse)')); fallback (isFallbackAdapter).
// form: the device profile's form (src/core/profile.js; the page passes profile.get().form); absent, the same rule from these facts
export function readSignals({ adapterInfo = {}, screen = {}, ua = '', touch = 0, deviceMemory = null, coarse = false, fallback = false, platform = '', form = null } = {}) {
  const w = screen.w ?? 1280, h = screen.h ?? 720, dpr = screen.dpr ?? 1;
  const f = form ?? formOf({ ua, platform, touchPoints: touch, coarse, screenW: w, screenH: h });
  const phone = f === 'phone', tablet = f === 'tablet';
  const vendor = String(adapterInfo.vendor ?? '').toLowerCase(), architecture = String(adapterInfo.architecture ?? '').toLowerCase();
  const description = String(adapterInfo.description ?? '').toLowerCase();
  const apple = vendor === 'apple' || /iPhone|iPad|iPod/.test(ua);
  return { w, h, dpr, phone, tablet, vendor, architecture, description, apple, deviceMemory, fallback: !!fallback, touch };
}

// the Adreno generation from the adapter's strings ('adreno-7xx', 'Adreno (TM) 740' → 7), else null
export function adrenoGen(s) {
  const m = /adreno[^0-9]*([0-9])/.exec(`${s.architecture} ${s.description}`);
  return m ? Number(m[1]) : null;
}

// the first guess → { level, why }
export function guessLevel(s) {
  const scr = `${Math.round(s.w)}×${Math.round(s.h)} @${+(+s.dpr).toFixed(2)}`;
  const gpu = [s.vendor, s.architecture].filter(Boolean).join(' ') || 'GPU name hidden';
  if (s.fallback) return { level: TOP, why: `guess: a software adapter (${gpu})` };
  if (!s.phone && !s.tablet) {
    if (['intel', 'qualcomm', 'arm', 'img'].includes(s.vendor)) return { level: 1, why: `guess: a laptop's integrated GPU (${gpu}), ${scr}` };
    return { level: 0, why: `guess: a desktop (${gpu}), ${scr}` };
  }
  if (s.tablet) return { level: 1, why: `guess: a tablet (${gpu}), ${scr}` };
  let level, why;
  const gen = adrenoGen(s);
  // perf(v2) phone (2026-11-13): the owner's iPhone 16 Pro booted at L1 (MSAA 4) and settled to L2 in both browsers, its
  // MSAA 1 only at the next load; a phone now boots at L2 (MSAA 1 from the first frame), a weak one at L3
  // perf(v2) phone 30 fps (owner, 2026-11-15: "phone should target at 30fps not 60 and push for the picture quality"): at
  // 30 fps a strong phone (an Apple GPU, Adreno 7xx and up) boots at L1: MSAA 4, 1.2 Mpx, the full water path; the settle
  // steps it down only when L1's work misses 26 ms (PHONE_AIM of 33.3) and up to L0 (shrubs, the full cloud key) after the calm
  if (s.apple) { level = 1; why = `a phone, Apple GPU (${gpu})`; }
  else if (gen != null) { level = gen >= 7 ? 1 : 3; why = `a phone, Adreno ${gen}xx`; }
  else { level = 3; why = `a phone, ${gpu}`; }
  if (s.deviceMemory != null && s.deviceMemory <= 4 && level < TOP) { level++; why += `, ${s.deviceMemory} GB`; }
  return { level, why: `guess: ${why}, ${scr}` };
}

// the GPU's key for the stored level: a level settled on one GPU is not used on another (a browser profile moved)
export const gpuKey = (s) => [s.vendor || '?', s.architecture || '?', s.phone ? 'phone' : s.tablet ? 'tablet' : 'desk'].join('|');

export function readStored(storage, key, nowMs = Date.now()) {
  try {
    const raw = storage?.getItem?.(STORE_KEY); if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || o.gpu !== key || !(o.level >= 0 && o.level <= TOP)) return null;
    if (!(nowMs - o.at < STORE_DAYS * 864e5)) return null;
    // fix(v2) governor: a record measured before the GPU work metric (the busy span, idle gaps in it) is stale: the page
    // boots at the guess and re-measures, so a level cut by a bad reading (the owner's iPhone: L3 at 60 fps) is not kept
    // fix(v2) desktop quality: a desk record written before desks were held at 60 fps (no DESK_RULE: its governor chased a
    // 120 Hz display) is stale too, so a MacBook settled low under the old rule boots at the guess and re-measures
    // perf(v2) phone 30 fps (owner rulings, 2026-11-15): every record written before picture quality came first (no
    // QUALITY_RULE: a phone settled against 60 fps, a desk against the 60 fps hold) is stale: the new guess, re-measured
    const span = !METRICS.includes(o.measured?.metric), rule = o.measured?.rule !== QUALITY_RULE;
    const ruleWhy = isDeskKey(key) ? 'was measured before quality first (cuts only below 30 fps)' : 'was measured before phones were held at 30 fps';
    return { level: clampLevel(o.level), at: o.at, why: o.why ?? '', measured: o.measured ?? null, stale: span || rule,
      ...(span ? { staleWhy: 'was measured on the busy span' } : rule ? { staleWhy: ruleWhy } : {}) };
  } catch { return null; }
}
// perf(v2) phone round 2: measured { spanMs, level, px, hz }: the GPU busy span the step was decided on, at which level,
// pixels and display rate (a phone in Low Power Mode stores what it measured, not only "on budget at 30 Hz")
// fix(v2) governor: measured { workMs, level, px, hz, metric }: metric 'work' (the GPU timer: the passes' own shares, no
// idle) or 'vsync' (no GPU timer, #32: the frame interval, the work-done probe for the step ups; `vsync: true` beside it)
export const METRIC = 'work';
export const METRICS = Object.freeze(['work', 'vsync']);
// perf(v2) phone 30 fps: every record carries rule QUALITY_RULE (the 30 fps budget: phones held at 30 fps, desks cut only
// below it). fix(v2) desktop quality's 'desk60' records, and every phone record before it, are stale
export const QUALITY_RULE = 'q30';
const isDeskKey = (key) => String(key ?? '').endsWith('|desk');
export function writeStored(storage, key, level, why = '', nowMs = Date.now(), measured = null) {
  if (typeof storage?.setItem !== 'function') return false;
  try { storage.setItem(STORE_KEY, JSON.stringify({ v: 1, gpu: key, level: clampLevel(level), at: nowMs, why: String(why).slice(0, 160), ...(measured ? { measured: { ...measured, metric: measured.metric ?? METRIC, rule: QUALITY_RULE } } : {}) })); return true; } catch { return false; }
}

// the level the page boots at → { level, why, source: 'pinned' | 'headless' | 'stored' | 'retry' | 'guess' }
// BACKLOG-v2 #32: a level stored from the frame interval alone (no GPU timer: measured.vsync) may be the vsync's floor, not the
// GPU's: a 60 Hz phone reads 16.7 ms at any level that fits, so it never learns it had room. Such a level is retried one up
// at the next visit, at most once every RETRY_DAYS (measured.retryAt): the settle then judges the higher level on its own
// frames (a level that does not fit misses vsyncs and steps back down within the 6 s settle)
// fix(v2) governor: a record without a known metric (written before 2026-11-14's fix, on the busy span) is stale: the guess
export const RETRY_DAYS = 3;
// perf(v2) iOS pipelines: a retry boots one level up, and a level step back down then builds the other MSAA count's whole
// set; a device whose last load took over RETRY_SLOW_MS to build its first frame's pipelines (iPhone WebKit compiles one at
// a time: 26 s on 2026-11-17) keeps its stored level instead (lastBuildMs: main.js, from the last load on this GPU)
export const RETRY_SLOW_MS = 4000;
// slowCompiler: the registry's levelRetry is off (src/core/features.js: the profile's slow-compiler quirk); absent, from lastBuildMs
export function startLevel({ pinned = null, headless = false, stored = null, guess, nowMs = Date.now(), lastBuildMs = null, slowCompiler = null }) {
  if (pinned != null) return { level: clampLevel(pinned), why: `pinned: ?quality=${pinned}`, source: 'pinned' };
  if (headless) return { level: 0, why: 'a capture: L0 unless ?quality= (the goldens hold it)', source: 'headless' };
  const day = stored ? new Date(stored.at).toISOString().slice(0, 10) : '';
  if (stored?.stale) return { level: guess.level, why: `${guess.why}; stored L${stored.level} (${day}) ${stored.staleWhy ?? 'was measured on the busy span'}: re-measuring`, source: 'guess', staleLevel: stored.level };
  if (stored) {
    const m = stored.measured, busy = m ? `; ${m.workMs ?? m.spanMs} ms ${m.vsync ? 'busy' : 'GPU work'} at L${m.level}, ${(m.px / 1e6).toFixed(2)} Mpx, ${m.hz} Hz` : '';
    if (m?.vsync && stored.level > 0 && !(nowMs - (m.retryAt ?? 0) < RETRY_DAYS * 864e5) && (slowCompiler ?? lastBuildMs > RETRY_SLOW_MS)) return { level: stored.level, why: `stored: settled here before (${day}${busy}); no retry: the shaders took ${(lastBuildMs / 1000).toFixed(1)} s here`, source: 'stored', retryAt: m?.retryAt ?? null };
    if (m?.vsync && stored.level > 0 && !(nowMs - (m.retryAt ?? 0) < RETRY_DAYS * 864e5)) return { level: stored.level - 1, why: `retry: L${stored.level} was settled on the frame interval alone (${day}${busy}; no GPU timer), one level up to try`, source: 'retry', retryAt: nowMs };
    return { level: stored.level, why: `stored: settled here before (${day}${busy})`, source: 'stored', retryAt: m?.retryAt ?? null };
  }
  return { level: guess.level, why: guess.why, source: 'guess' };
}

// the scene parameters at a level: the URL's own ?maxpx= ?dpr= ?msaa= win over the level's rows
//   explicit: a Set of the URL's keys (URLSearchParams.has)
//   opts.desk: a live desktop page (levelCaps)
export function levelParams(P, level, explicit = new Set(), opts = {}) {
  const L = LEVELS[clampLevel(level)], c = levelCaps(level, opts);
  return { ...P, maxPx: explicit.has('maxpx') ? P.maxPx : c.maxPx, dprCap: explicit.has('dpr') ? P.dprCap : c.dprCap, msaa: explicit.has('msaa') ? P.msaa : L.msaa, level: L.id };
}
// the pixels the cloud key is sized from (render/clouds.js keySizeFor: under 0.6 Mpx it takes the 1024 × 256 key)
export const cloudPixels = (level, pixels) => (LEVELS[clampLevel(level)].cloudKey === 'small' ? Math.min(pixels, 0.5e6) : pixels);
// the forest's ranges at a level (forest/lod.js FOREST.desktop | phone × the level's reach; shrubs off below L0)
export function forestAt(base, level) {
  const L = LEVELS[clampLevel(level)], k = L.forestReach;
  return { thin: base.thin * k, fade: base.fade * k, far: base.far * k, shrubFar: L.shrubs ? base.shrubFar : 0 };
}
// the rows a live step from `built` (the level the page was built at) to `level` leaves for the next load
export function pendingRows(built, level) {
  const a = LEVELS[clampLevel(built)], b = LEVELS[clampLevel(level)];
  return BUILD_KEYS.filter((k) => a[k] !== b[k]).map((k) => (k === 'boatShadow' ? `boat shadow ${b.boatShadow}²` : `cloud key ${b.cloudKey === 'small' ? '1024×256' : 'full'}`));
}

// BACKLOG-v2 #31, MSAA live: the count a level draws the scene at (the URL's own ?msaa= wins), and the switch, pure. want(n)
// is called on every level step (the ladder's hysteresis decides the steps: its cooldown, its calm windows); a count whose
// pipelines are not built asks build(n) (async, in the background) and the scene keeps its count; due() names the count to
// switch to once ready(n), checked between two frames; done(n) records the switch. Nothing waits on a build.
//   const sw = createMsaaSwitch({ start: 1, counts: [1, 4], ready: (n) => reg.ready(n), build: (n) => reg.buildCount(n) });
export const msaaOf = (level, explicit = null) => explicit ?? LEVELS[clampLevel(level)].msaa;
export function createMsaaSwitch({ start, counts = [start], ready = () => false, build = () => null } = {}) {
  let cur = start, want = start;
  return {
    get now() { return cur; },
    get wanted() { return want; },
    want(n) {
      if (!counts.includes(n)) return false;   // a count not declared at load (a capture, a URL ?msaa=): never
      want = n;
      if (n !== cur && !ready(n)) build(n);
      return true;
    },
    due: () => (want !== cur && ready(want) ? want : null),
    done(n) { cur = n; },
  };
}

// the backing pixels a level draws for a CSS box (canvas.js backingSize's rule, scale 1)
export function levelPixels(level, cssW, cssH, dpr, opts = {}) {
  const L = levelCaps(level, opts), r = Math.min(dpr || 1, L.dprCap);
  return Math.min(cssW * cssH * r * r, L.maxPx);
}

// The ladder: fed the frame's cost (the GPU work with timestamps, else the wall frame interval) with the backing pixels.
//   settle: after `warmMs` (the first frames, the stream's first hitches), `settleMs` of samples; their trimmed mean
//   (the slowest 10 % dropped) is projected to each level by pixels: the pixel-bound part (pixMs, the scene and the
//   composite, when the page passes it; else 75 %: FIXED) scales with the pixels, the rest is fixed. A level fits when its
//   projection at the governor's good scale (SCALE_OK: 0.85, 72 % of its pixels) is ≤ the budget, or at full pixels ≤
//   budget × 1.1; the best level that fits, at most one level up from where it booted (and only when the full-pixel
//   projection is ≤ budget × 0.8). The settled level is stored with the work it was decided on.
//   then: 1 s windows; two in a row over budget × 1.3, the frames off vsync (when the page passes their interval), while
//   the governor sits at its floor step one level down (at most once per `cooldownMs`), stored; 60 calm windows
//   (projection one level up ≤ budget × 0.8) step one level up; a level stepped down from within `failMs` of stepping up
//   to it needs twice the calm windows next time (no oscillation).
//   The budget is never under 60 fps's 16.7 ms: a level is a feature cut, kept for a page that misses 60 fps; inside it
//   the governor's scale tunes to the refresh on a phone (a desktop never loses features to a 120 Hz vsync; since
//   2026-11-15 a desk page's governor is held at 60 fps too: engine/governor.js frameBudget). perf(v2) phone 30 fps (owner
//   rulings, 2026-11-15: picture quality first): the page passes a held budget, 30 fps's 33.3 ms on every page, × aimK
//   (a phone's 0.78, its thermal headroom; a desk's 1): setBudget(ms, { held: true, aimK }).
//   BACKLOG-v2 #32, without a GPU timer (Safari, iOS, any page without ?diag): the cost is the rAF interval, which a 60 Hz
//   display holds at 16.7 ms whatever the GPU's headroom, so the ladder stepped down but never up. `busyMs`, fed beside the
//   cost, is the busy span from the work-done probe (createBusyProbe: submit → onSubmittedWorkDone, an upper bound on the
//   GPU's span); the step-up tests (the settle's level above the boot, the calm windows) read it in place of the interval.
//   The step-down tests keep the interval (a missed vsync is the frame's real cost). `vsync` (no GPU timer) marks each stored
//   decision (metric 'vsync'), so the next visit may retry one level up (startLevel); `retryAt` rides along.
//   const lad = createLadder({ level, pxAt: (k) => px });  lad.feed(ms, now, px, govAtFloor, { dt, pixMs, busyMs }) → null | { level, why }
//   (a number in place of the object is busyMs: #32's form)
export const FIXED = 0.25;
export const SCALE_OK = 0.85;
export function createLadder({ level = 0, pxAt, budgetMs = 1000 / 60, warmMs = 2000, settleMs = 4000, windowMs = 1000, cooldownMs = 10000, calmWindows = 60, failMs = 60000, paceK = 1.1, enabled = true, vsync = false, retryAt = null, held = false, aimK = 1 } = {}) {
  let cur = clampLevel(level), phase = enabled ? 'warm' : 'off', t0 = null, samples = [], pixes = [], pxSum = 0, busySamples = [];
  let winStart = null, wSum = 0, wPx = 0, wN = 0, wPix = 0, wPixN = 0, wDt = 0, wDtN = 0, wBusy = 0, wBusyN = 0, slow = 0, calm = 0, lastStep = -Infinity, lastUp = -Infinity, lastMean = null, lastBusy = null, steps = 0, why = '', measured = null;
  let hold = false;   // step D2: held while a race runs (the race ladder steps down; nothing steps up mid-race)
  const trimmed = (xs) => { const a = xs.slice().sort((x, y) => x - y), keep = a.slice(0, Math.max(1, Math.ceil(a.length * 0.9))); return keep.reduce((t, x) => t + x, 0) / keep.length; };
  const failedUp = new Set();   // fix(v2) governor: levels a step up to did not hold
  const booted = cur;
  // perf(v2) phone round 2: a display slower than 40 Hz (a phone in Low Power Mode: 30 Hz) still settles against 60 Hz's
  // 16.7 ms, so the level stored for next time is the device's real capacity, not "on budget at 30 Hz"
  // perf(v2) phone 30 fps (owner rulings, 2026-11-15: picture quality first): a held budget (setBudget(ms, { held: true,
  // aimK })) is taken as it is: 30 fps's 33.3 ms, × aimK (a phone's 0.78: 26 ms, its thermal headroom; a desk's 1). The
  // tests read B (a level fits, the calm, the step down at B × 1.3); "frames on vsync" reads the held budget itself
  const budget = () => (held ? budgetMs * aimK : budgetMs > 25 ? 1000 / 60 : Math.max(budgetMs, 1000 / 60));
  // the cost at level k with `f` of its pixels; pix: the measured pixel-bound ms (null: FIXED's 75 %)
  const project = (mean, px, k, pix = null, f = 1) => { const p = Math.min(mean, pix ?? mean * (1 - FIXED)); return mean - p + p * (pxAt(k) * f / Math.max(1, px)); };
  const rec = (mean, from, px) => ({ workMs: +mean.toFixed(2), level: from, px: Math.round(px), hz: Math.round(1000 / budgetMs), metric: vsync ? 'vsync' : METRIC, ...(vsync ? { vsync: true } : {}), ...(retryAt != null ? { retryAt } : {}) });
  const word = () => (vsync ? 'ms' : 'ms GPU work');
  function settle(now) {
    // the slowest 10 % dropped (by cost), their pixel parts with them
    const idx = samples.map((_, i) => i).sort((x, y) => samples[x] - samples[y]).slice(0, Math.max(1, Math.ceil(samples.length * 0.9)));
    const mean = idx.reduce((s, i) => s + samples[i], 0) / idx.length, px = pxSum / samples.length, B = budget();
    const withPix = idx.filter((i) => pixes[i] != null);
    const pix = withPix.length === idx.length ? withPix.reduce((s, i) => s + pixes[i], 0) / idx.length : null;
    // #32: the probe's busy span for the level above the boot, when most frames carried one (never over the interval)
    const busy = busySamples.length >= samples.length / 2 ? Math.min(mean, trimmed(busySamples)) : null;
    lastMean = mean; lastBusy = busy;
    let pick = LEVELS.length - 1;
    for (let k = Math.max(0, booted - 1); k < LEVELS.length; k++) {
      const full = project(k < booted && busy != null ? busy : mean, px, k, pix), ok = project(mean, px, k, pix, SCALE_OK * SCALE_OK);
      if (k < booted ? full <= B * 0.8 : (ok <= B || full <= B * 1.1)) { pick = k; break; }
    }
    // perf(v2) phone 30 fps: under a held budget the settle steps down one level at most. The projection is by pixels alone,
    // and L1 → L2 also leaves the full water path for the phone path (its sim and boat shadow at half rate, a third of
    // L1's fixed work on the iPhone model), so a far step would overshoot; a level that still misses steps on in play
    if (held && pick > booted + 1) pick = booted + 1;
    if (hold) pick = cur;   // step D2: a race is running: the race's own ladder decides (no step up mid-race, a step down only when quiet)
    phase = 'settled'; winStart = now;
    const from = cur; cur = pick; steps += pick !== from ? 1 : 0; if (pick < from) lastUp = now;
    const up = pick < from && busy != null, k = up ? busy : mean;
    why = `settled: ${k.toFixed(1)} ${up ? 'ms busy (the work-done probe; no GPU timer)' : word()} at L${from}, ${(px / 1e6).toFixed(2)} Mpx, over ${(settleMs / 1000).toFixed(0)} s (budget ${B.toFixed(1)}${held ? `${aimK < 1 ? `: ${Math.round(aimK * 100)} % of ${budgetMs.toFixed(1)}` : ''} ms, quality first` : budgetMs > 25 ? `; display ${Math.round(1000 / budgetMs)} Hz` : ''}), ${pick === from ? 'kept' : `L${from} → L${pick}`}`;
    measured = rec(k, from, px);
    return { level: cur, why, changed: pick !== from, store: true, measured };
  }
  return {
    get level() { return cur; },
    get phase() { return phase; },
    get why() { return why; },
    setBudget(ms, opts = null) { if (ms > 0 && Number.isFinite(ms)) budgetMs = ms; if (opts) { held = !!opts.held; if (opts.aimK > 0 && opts.aimK <= 1) aimK = opts.aimK; } },
    // step D2: hold(true) while a race runs: the windows keep reading, no step is taken (their counts start again); force(k, now)
    // takes a level the race's ladder chose (the cooldown runs from it, so the page's ladder does not step back at the race's end)
    hold(on) { hold = !!on; if (hold) { slow = 0; calm = 0; } },
    get held() { return hold; },
    force(k, now = null) { cur = clampLevel(k); slow = 0; calm = 0; if (now != null) lastStep = now; },
    // extra: { dt (the frame's rAF interval, ms), pixMs (the cost's pixel-bound part, ms) }, both optional
    feed(ms, now, px, govAtFloor = false, extra = null) {
      if (phase === 'off' || !(ms >= 0) || !Number.isFinite(now) || !(px > 0)) return null;
      const { dt = null, pixMs = null, busyMs = null } = typeof extra === 'number' ? { busyMs: extra } : (extra ?? {});
      if (t0 == null) t0 = now;
      if (phase === 'warm') { if (now - t0 >= warmMs) { phase = 'settling'; } else return null; }
      const hasBusy = busyMs != null && busyMs >= 0 && Number.isFinite(busyMs);
      if (phase === 'settling') {
        samples.push(ms); pixes.push(pixMs >= 0 ? pixMs : null); pxSum += px; if (hasBusy) busySamples.push(busyMs);
        return now - t0 >= warmMs + settleMs ? settle(now) : null;
      }
      wSum += ms; wPx += px; wN++; if (pixMs >= 0) { wPix += pixMs; wPixN++; } if (dt > 0 && dt < 250) { wDt += dt; wDtN++; } if (hasBusy) { wBusy += busyMs; wBusyN++; }
      if (now - winStart < windowMs) return null;
      const mean = wSum / wN, wpx = wPx / wN, pix = wPixN === wN ? wPix / wPixN : null, fdt = wDtN ? wDt / wDtN : null, B = budget();
      const busy = wBusyN >= wN / 2 ? Math.min(mean, wBusy / wBusyN) : null;   // #32: the probe's span (never over the interval)
      wSum = 0; wPx = 0; wN = 0; wPix = 0; wPixN = 0; wDt = 0; wDtN = 0; wBusy = 0; wBusyN = 0; winStart = now; lastMean = mean; lastBusy = busy;
      // fix(v2) governor: frames on vsync never step down (nothing to win); without their interval, the old rule
      const paced = fdt != null && fdt <= Math.max(budgetMs, 1000 / 60) * paceK;
      if (hold) { slow = 0; calm = 0; return null; }   // step D2: a race runs
      if (mean > B * 1.3 && govAtFloor && !paced) slow++; else slow = 0;
      if (cur > 0 && project(busy ?? mean, wpx, cur - 1, pix) <= B * 0.8) calm++; else calm = 0;
      if (slow >= 2 && cur < LEVELS.length - 1 && now - lastStep >= cooldownMs) {
        const from = cur; cur++; slow = 0; calm = 0; steps++;
        if (now - lastUp <= failMs) failedUp.add(from);   // the step up to `from` did not hold: twice the calm next time
        lastStep = now;
        why = `governor: ${mean.toFixed(1)} ${word()} at the scale floor (budget ${B.toFixed(1)}), L${from} → L${cur}`;
        measured = rec(mean, from, wpx);
        return { level: cur, why, changed: true, store: true, measured };
      }
      const need = failedUp.has(cur - 1) ? calmWindows * 2 : calmWindows;
      if (calm >= need && now - lastStep >= cooldownMs) {
        const from = cur; cur--; calm = 0; slow = 0; lastStep = now; lastUp = now; steps++;
        const k = busy ?? mean;
        why = `governor: ${need} s calm at ${k.toFixed(1)} ${busy != null ? 'ms busy (the work-done probe; no GPU timer)' : word()}, L${from} → L${cur}`;
        measured = rec(k, from, wpx);
        return { level: cur, why, changed: true, store: true, measured };
      }
      return null;
    },
    state: () => ({ level: cur, booted, phase, hold, steps, lastMean: lastMean == null ? null : +lastMean.toFixed(2), lastBusy: lastBusy == null ? null : +lastBusy.toFixed(2), budgetMs: +budget().toFixed(2), why, measured, calm, failedUp: [...failedUp] }),
  };
}

// BACKLOG-v2 #32: the GPU's busy span without timestamp-query. After a frame's submit, the time until the queue says its work
// is done (GPUQueue.onSubmittedWorkDone, in WebGPU since its first release, Safari's too): one probe in flight at a time,
// the median of the last `keep`. It is an upper bound on the span (the promise's own latency, a queue still busy with the
// frame before), so it can only under-promise headroom: a level stepped up on it fits.
//   const probe = createBusyProbe({ done: () => device.queue.onSubmittedWorkDone() });  after the submit: probe.sample();  probe.span → ms | null
export function createBusyProbe({ done, now = () => performance.now(), keep = 30, min = 8 } = {}) {
  const ring = new Float64Array(keep); let n = 0, i = 0, pending = false, failed = false, seq = 0;
  return {
    sample() {
      if (pending || failed || typeof done !== 'function') return false;
      const t = now(), my = ++seq; pending = true;
      let p; try { p = done(); } catch { failed = true; pending = false; return false; }
      Promise.resolve(p).then(() => { if (my !== seq) return; ring[i] = now() - t; i = (i + 1) % keep; n = Math.min(keep, n + 1); pending = false; }, () => { failed = true; pending = false; });
      return true;
    },
    reset() { n = 0; i = 0; seq++; pending = false; },
    get span() { if (n < min) return null; const a = Array.from(ring.subarray(0, n)).sort((x, y) => x - y); return a[a.length >> 1]; },
    get count() { return n; },
    get failed() { return failed; },
  };
}

// Step D2 (owner 2026-11-17): the race's quality ladder, above the page's ladder while a race runs. It
// only steps DOWN, on slow frames: the p90 of the frames' wall intervals in each 1 s bucket, against the held budget (30 fps's
// 33.3 ms). A step needs `buckets` (3) buckets running with their p90 over overK × the budget (a 1–2 s hitch never does); the
// hysteresis: the slow run ends only on a bucket under clearK × the budget, so a bucket between the two keeps the run (it does not
// add to it). No judging in the race's first `warmMs` (the gun, the first frames of the fleet), `afterStepMs` after a step (the new
// rung's frames are a new reading) and `afterPauseMs` after a pause (a frame over `pauseMs`: a hidden tab, a GC). A step lands only
// in a quiet moment (the race says so: never at the start, never mid-rounding, never at the finish); one due outside one waits for
// the next, and is dropped if the frames recover first. It never steps up mid-race (the page's ladder is held while the race runs;
// a thermal phone would oscillate) and no rung builds a pipeline. The rungs, cheapest first: the fleet's far LOD bands (the phone's:
// lod.js LOD_BANDS.phone), then one quality level a step (the page's live rows: the caps, the shadow's cadence, the forest's reach,
// the water's phone path; MSAA once built), to L3.
//   const rq = createRaceLadder({ budgetMs: 33.3, level: 1 });   rq.start(now, level); rq.stop(now)
//   rq.feed(dtMs, now, { quiet, why }) → null | { rung: 'fleet' | 'level', level, why, at, p90 }    rq.state(); rq.lines()
export const RACE_Q = Object.freeze({ bucketMs: 1000, buckets: 3, p: 0.9, overK: 1.3, clearK: 1.12, warmMs: 20000, afterStepMs: 5000, afterPauseMs: 3000, pauseMs: 250, minFrames: 8 });
export function p90Of(xs, p = RACE_Q.p) {
  if (!xs.length) return null;
  const a = Array.from(xs).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}
export function createRaceLadder({ budgetMs = 1000 / 30, level = 0, top = TOP, fleet = true, ...opts } = {}) {
  const O = { ...RACE_Q, ...opts };
  let active = false, startAt = -Infinity, lastStep = -Infinity, lastPause = -Infinity, bucketAt = null, run = 0, runAt = null, pending = null, p90 = null;
  let cur = clampLevel(level), fleetLite = false, why = 'no race', B = budgetMs;
  const dts = [], steps = [];
  const clear = (now = null) => { dts.length = 0; bucketAt = now; run = 0; runAt = null; pending = null; };
  const r1 = (x) => Math.round(x * 10) / 10;
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const canStep = () => (fleet && !fleetLite) || cur < top;
  const guard = (now) => (now - startAt < O.warmMs ? `race: no judging in its first ${O.warmMs / 1000} s` : now - lastStep < O.afterStepMs ? `race: ${O.afterStepMs / 1000} s after a step`
    : now - lastPause < O.afterPauseMs ? `race: ${O.afterPauseMs / 1000} s after a pause` : null);
  return {
    get active() { return active; }, get level() { return cur; }, get fleetLite() { return fleetLite; }, get why() { return why; }, get steps() { return steps.slice(); },
    setBudget(ms) { if (ms > 0 && Number.isFinite(ms)) B = ms; },
    setLevel(k) { cur = clampLevel(k); },   // the page's level moved outside the race ladder (Setup's pin, the hook)
    start(now, k = cur) { active = true; startAt = now; lastStep = -Infinity; lastPause = -Infinity; cur = clampLevel(k); fleetLite = false; clear(now); p90 = null; steps.length = 0; why = 'race: warming up'; },
    stop() { if (!active) return; active = false; fleetLite = false; clear(); why = steps.length ? `race over: ${steps.length} step${steps.length > 1 ? 's' : ''} down` : 'race over: no step'; },
    // dtMs: the frame's wall interval; ctx.quiet: the race allows a step now (ctx.why: what it waits for when not)
    feed(dtMs, now, ctx = {}) {
      if (!active || !(dtMs > 0) || !Number.isFinite(now)) return null;
      if (dtMs > O.pauseMs) { lastPause = now; clear(now); why = `race: a ${Math.round(dtMs)} ms pause, ${O.afterPauseMs / 1000} s before judging again`; return null; }
      const g = guard(now);
      if (g) { if (bucketAt == null || now - bucketAt >= O.bucketMs) { dts.length = 0; bucketAt = now; } why = g; return null; }   // the guards: no buckets kept
      if (bucketAt == null) bucketAt = now;
      dts.push(dtMs);
      // a pending step lands at the first quiet frame (its run still slow)
      if (pending != null && run >= O.buckets && ctx.quiet && canStep()) return step(now);
      if (pending != null && !ctx.quiet) why = `race: a step due (p90 ${r1(p90)} ms), waiting for a quiet moment${ctx.why ? ` (${ctx.why})` : ''}`;
      if (now - bucketAt < O.bucketMs) return null;
      // a bucket closes: its p90 against the thresholds
      const n = dts.length; p90 = n >= O.minFrames ? p90Of(dts, O.p) : null; dts.length = 0; bucketAt = now;
      if (p90 == null) return null;
      if (p90 > B * O.overK) { run++; if (runAt == null) runAt = now; } else if (p90 < B * O.clearK) { run = 0; runAt = null; pending = null; }
      if (run < O.buckets) { why = run ? `race: p90 ${r1(p90)} ms > ${r1(B * O.overK)}, ${run} of ${O.buckets} s` : `race: p90 ${r1(p90)} ms of ${r1(B)} (steps down after ${O.buckets} s over ${r1(B * O.overK)})`; return null; }
      if (!canStep()) { why = `race: p90 ${r1(p90)} ms, at the last rung (L${cur}${fleetLite ? ', far fleet' : ''})`; return null; }
      if (!ctx.quiet) { pending = pending ?? now; why = `race: a step due (p90 ${r1(p90)} ms), waiting for a quiet moment${ctx.why ? ` (${ctx.why})` : ''}`; return null; }
      return step(now);
    },
    state: () => ({ active, level: cur, fleetLite, p90: p90 == null ? null : r1(p90), budgetMs: r1(B), overMs: r1(B * O.overK), run, pending: pending != null, steps: steps.slice(), why }),
    lines() { return [`race quality ${active ? 'on' : 'off'}${fleetLite ? ' · far fleet' : ''} · ${why}`, ...steps.map((s) => `  step ${s.rung === 'fleet' ? 'fleet bands' : `→ L${s.level}`} at ${mmss(s.at)} (p90 ${s.p90} ms${s.waitedMs ? `, waited ${r1(s.waitedMs / 1000)} s` : ''})`)]; },
  };
  function step(now) {
    const waited = pending != null ? now - pending : 0, at = now - startAt, slowS = runAt != null ? (now - runAt) / 1000 + O.bucketMs / 1000 : O.buckets;
    let st;
    if (fleet && !fleetLite) { fleetLite = true; st = { rung: 'fleet', level: cur }; }
    else { cur++; st = { rung: 'level', level: cur }; }
    st.why = `race ${mmss(at)}: p90 ${r1(p90)} ms > ${r1(B * O.overK)} for ${r1(slowS)} s${waited > 0 ? `, ${r1(waited / 1000)} s waited for a quiet moment` : ''} → ${st.rung === 'fleet' ? 'the fleet\'s far bands' : `L${cur}`}`;
    st.at = Math.round(at); st.p90 = r1(p90);
    steps.push({ rung: st.rung, level: st.level, at: st.at, p90: st.p90, waitedMs: Math.round(waited) });
    why = st.why; lastStep = now; clear(now);
    return st;
  }
}
