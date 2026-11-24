// Quality tiers: the knob table, the automatic pick and the slow governor. Plain JS, no
// three.js and no DOM: node tests drive every function here with made-up adapters, screens and frame times.
//
//   High      today's look, exactly (the goldens are High)
//   Balanced  regular laptops and integrated GPUs
//   Low       iPad, iPhone, Android phones
//
// What a tier cuts, in order (owner, 2026-10-31: "keep the hero part quality: the boat, the water, the wind system; reduce
// quality for the ground, the trees, the clouds"): the forest first, then the ground and the far terrain, then the
// clouds and the atmosphere, and the screen resolution last. The water keeps more of High than anything else; the boat,
// the sails and the wind are not in the table at all.
//
// Two kinds of knob. BUILD knobs are read when the world is made (cloud steps, water bands, the forest's bands, the
// impostor atlas, the streaming radii …, the boat's shadow map): the tier is picked before the world is built. LIVE knobs can change in play
// (the render scale, the streaming radii, the terrain's split): the governor moves these when it steps down.

export const TIER_ORDER = ['high', 'balanced', 'low'];
export const QUALITY_CHOICES = ['auto', ...TIER_ORDER];

// One table. High repeats the engine's own numbers, so a High page is the page it was before this file existed.
export const TIERS = {
  high: {
    label: 'High',
    // render: pixel ratio = min(scale, sqrt(maxPixels / css pixels)), never under minRatio. The UI is DOM, at native res.
    render: { scale: 1, maxPixels: Infinity, minRatio: 0.5, msaa: 4, aa: 'none', retina: { cap: 1.5, maxPixels: Infinity } },   // retina: above DPR 1 the ratio is min(DPR, cap) (owner, 2026-10-30)
    water: { rippleWavelengths: 16, probeSize: 256, lookSize: 1024, reflectionSteps: 16, ultraMask: 15 },   // ultraMask: the FFT slope cascades drawn under ?water=ultra (15 = all four; 7 drops the 2.1 m one and the caustics' finest; 3 keeps the 600 and 85 m)
    clouds: { steps: 96, lightSteps: 5, temporalScale: 0.5 },
    forest: { FULL: 90, NEAR: 220, FAR: 9000, THIN: 3000, SHRUBS: 700, ROCKS: 900, LOGS: 500, DENSITY: 1, KEEP: 1, framePx: 112, frames: 6, farMapCell: 32 },
    terrain: { split: 1.6 },
    ground: { bay: 1, region: 16 },                // the NAIP photo's texel (m) per level: 5632 x 3584 and 2560 x 3840 px (src/naip-layout.js)
    ktx2: { naip: true, ground: true, boat: false },   // the photo ground and the ground layers stay compressed on the GPU (KTX2); the canopy raster is data and stays plain; boat: the cockpit's 7 textures, phones and Low only (the hero stays as authored above Low)
    canopy: { cell: 2 },   // the lidar canopy raster's texel (m), src/forest/canopy-surface.js
    air: { motes: 300, lines: 130, spray: 48 },
    stream: { near: 1200, mid: 5000, nearCap: 2500, uploadMs: 2 },
    memory: { gpuMB: 1500 },     // the budget the tier is allowed (the pick compares it with the device's)
    boat: { shadowMap: 2048 },   // the boat's own shadow map (px; src/core/sunShadow.js): its light, not its parts; 0 = none
  },
  balanced: {
    label: 'Balanced',
    render: { scale: 0.8, maxPixels: 1.6e6, minRatio: 0.5, msaa: 4, aa: 'none', retina: { cap: 1.15, maxPixels: 2.6e6 } },
    water: { rippleWavelengths: 16, probeSize: 128, lookSize: 1024, reflectionSteps: 16, ultraMask: 15 },   // the hero: High's waves, look map and reflections
    clouds: { steps: 56, lightSteps: 3, temporalScale: 0.5 },
    forest: { FULL: 45, NEAR: 120, FAR: 7000, THIN: 1300, SHRUBS: 300, ROCKS: 450, LOGS: 250, DENSITY: 0.65, KEEP: 1, framePx: 72, frames: 5, farMapCell: 48 },   // the first to go
    terrain: { split: 1.3 },
    ground: { bay: 2, region: 32 },
    ktx2: { naip: true, ground: true, boat: false },
    canopy: { cell: 4 },   // the lidar canopy raster's texel (m), src/forest/canopy-surface.js
    air: { motes: 220, lines: 100, spray: 36 },
    stream: { near: 1000, mid: 4000, nearCap: 2000, uploadMs: 2 },
    memory: { gpuMB: 1000 },
    boat: { shadowMap: 1024 },
  },
  low: {
    label: 'Low',
    render: { scale: 1, maxPixels: 0.62e6, minRatio: 0.5, msaa: 0, aa: 'fxaa', retina: { cap: 1, maxPixels: 0.62e6 } },   // cap 1: no retina gain (phones: memory); aa: FXAA (aaFor; was TRAA until perf/slow-loading: the kayaks cost +1.4–2.7 ms GPU under it, +0.14 under FXAA; ?aa=traa keeps it)
    water: { rippleWavelengths: 12, probeSize: 64, lookSize: 512, reflectionSteps: 12, ultraMask: 7 },   // the hero keeps most of its waves (was 6 bands, mask 3)
    clouds: { steps: 28, lightSteps: 2, temporalScale: 0.35 },
    forest: { FULL: 20, NEAR: 60, FAR: 4500, THIN: 450, SHRUBS: 120, ROCKS: 180, LOGS: 100, DENSITY: 0.3, KEEP: 0.5, framePx: 48, frames: 4, farMapCell: 96 },   // a thin forest, near only
    terrain: { split: 1.05 },
    ground: { bay: 4, region: 64 },
    ktx2: { naip: true, ground: true, boat: true },
    canopy: { cell: 8 },   // the lidar canopy raster's texel (m), src/forest/canopy-surface.js
    air: { motes: 120, lines: 60, spray: 24 },
    stream: { near: 600, mid: 2500, nearCap: 1200, uploadMs: 1.5 },
    memory: { gpuMB: 700 },
    boat: { shadowMap: 0 },      // never on Low (owner, 2026-11-11: the phone is CPU-bound; a shadow pass there is 4–8 ms)
  },
};

// What each tier costs relative to High's GPU time at the SAME pixel count (measured on the dev Mac, tools/tiers.mjs;
//). The pick scales the warm-up by these.
// (the variable part's cost per pixel; the frame also has a fixed part that no tier changes: FIXED_SHARE of a High frame)
export const COST = { high: 1, balanced: 0.95, low: 0.7 };
const FIXED_SHARE = 0.45;
// Measured start-frame GPU memory per tier at its own reference screen (MB; tools/tiers.mjs). The pick compares these
// with the device's budget; the table is rewritten by the bench.
export const GPU_MB = { high: 541, balanced: 412, low: 323 };   // start frame at 1280 × 720

// A floor under any tier: nothing here may be zero. The boat, the wind cues on the water and the instruments are not in
// the table at all, so no tier can drop them (tests/quality.test.mjs checks the table keeps every field positive).
export const tierOf = (name) => TIERS[name] ?? TIERS.high;

// The picture's anti-aliasing pass after the tone mapping (fix/boat-stable, owner 2026-11-05: "the boat sometimes is
// flashing, especially on the phone"). Low draws one sample per CSS px on a 3x phone screen with no MSAA, so the boat's
// thin parts (the mast's track, the stanchions, the lifelines, the shrouds, the cockpit's hardware) are under a pixel and
// pop in and out as the boat rolls: 1.2 % of the boat's pixels every frame at wind 4 (tools/boat_flash_probe.mjs).
// MSAA 4 cut the pops' strength by a third, FXAA by two thirds, temporal AA (three's TRAA: a jittered camera and the
// last frames reprojected by depth and velocity) by nine tenths. High and Balanced keep MSAA 4 and nothing after it.
// perf/slow-loading (2026-11-08, owner ask): Low takes FXAA, not TRAA: under TRAA the kayaks cost +1.4–2.7 ms of
// GPU a frame, under FXAA +0.14, and TRAA's velocity target and jitter cost every Low frame. The boat's
// thin parts pop a little more (FXAA cuts the pops by two thirds, TRAA by nine tenths): a look change on Low, the owner's call.
//   'none' | 'fxaa' | 'traa'; ?aa= overrides; TRAA needs WebGPU (the velocity MRT), so the WebGL2 fallback takes FXAA.
const AA_CHOICES = ['none', 'fxaa', 'traa'];
export function aaFor(name, { webgpu = true, param = null } = {}) {
  let aa = AA_CHOICES.includes(param) ? param : (tierOf(name).render.aa ?? 'none');
  if (aa === 'traa' && !webgpu) aa = 'fxaa';
  return aa;
}

export const budgetMs = (signals) => (signals?.mobile ? 33.3 : 16.7);
// The governor's slack over the budget: 1.2 (a step down past 20 ms at 60 fps); a strong desktop steps down only when even
// its good frames stay under about 40 fps for 10 s (25 ms), never on a hitch
export const governorSlack = (signals) => (signals?.strong ? 1.5 : 1.2);
// a strong start: Apple silicon or a discrete card (readSignals' strong), a real warm-up (a software or a struggling GPU
// takes far longer than 12 ms for it; the dev Mac: 4.6 to 5.5)
const STRONG_WARMUP_MS = 12;
export const strongStart = (s, warmupMs) => !!s?.strong && !s.fallback && warmupMs != null && warmupMs > 0 && warmupMs <= STRONG_WARMUP_MS;

// After ready, on a strong start: 3 s of real frames at High. The GPU's own frame time when the browser has a timestamp
// query (gpuMs), else the frame interval against the display's own (Safari: a frame at the refresh is fast enough). Over
// 12 ms, the retina ratio steps down a rung (1.5 -> 1.25 -> 1) and it measures again; the tier stays High. Quiet: no saved
// cap, and Settings' "reset auto" goes back to the start. Returns null (measuring), { retina } (a step) or 'done'.
export const AFTER_READY = { windowS: 3, targetMs: 12, skipS: 0.5 };
export class AfterReady {
  constructor({ retina = 1, start = 0 } = {}) { this.retina = retina; this.from = start; this.ms = []; this.dts = []; this.done = false; this.steps = []; }
  feed(t, { gpuMs = null, dt = null } = {}) {
    if (this.done) return null;
    if (this.from == null || !Number.isFinite(this.from)) this.from = t;   // the clock starts at the first frame it sees (ready)
    if (t - this.from < AFTER_READY.skipS) return null;   // the first frames after a change carry its cost
    if (gpuMs != null && gpuMs > 0) this.ms.push(gpuMs);
    if (dt != null && dt > 0 && dt < 0.25) this.dts.push(dt * 1000);
    if (t - this.from < AFTER_READY.skipS + AFTER_READY.windowS) return null;
    const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
    let slow;
    if (this.ms.length >= 20) slow = med(this.ms) > AFTER_READY.targetMs;
    else if (this.dts.length >= 20) slow = med(this.dts) > Math.max(AFTER_READY.targetMs, (1000 / 60) * 1.15);   // no timestamps: a frame that keeps a 60 Hz display's pace is fast enough
    else { this.done = true; return 'done'; }
    if (slow && this.retina > 1 + 1e-6) {
      this.retina = RETINA_STEPS.find((r) => r < this.retina - 1e-6) ?? 1;
      this.steps.push({ retina: this.retina, ms: +(this.ms.length ? med(this.ms) : med(this.dts)).toFixed(1), at: t });
      this.from = t; this.ms = []; this.dts = [];
      return { retina: this.retina };
    }
    this.done = true; this.result = { retina: this.retina, ms: +(this.ms.length ? med(this.ms) : med(this.dts)).toFixed(1), gpu: this.ms.length > 0 };
    return 'done';
  }
}
// The pick accepts a tier the governor would also accept: the governor steps down only past budget x 1.2, so a tier predicted
// inside that is kept (a capable Mac on a big window was dropped to Balanced at 19.7 ms predicted).
export const PICK_SLACK = 1.2;

// The device facts the pick reads. All optional; a missing one asks nothing of the tier.
//   adapter: { isFallbackAdapter, vendor, architecture, limits: { maxTextureDimension2D, maxBufferSize } }
//   deviceMemory (GB, Chrome's coarse hint), screen { w, h, dpr } in CSS px, ua (string), touch (maxTouchPoints)
export function readSignals({ adapter = null, deviceMemory = null, screen = null, ua = '', touch = 0, platform = '' } = {}) {
  const info = adapter?.info ?? adapter ?? {};
  const w = screen?.w ?? 1280, h = screen?.h ?? 720, dpr = screen?.dpr ?? 1;
  const phone = /iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i.test(ua) || (touch > 0 && Math.min(w, h) < 500);
  // an iPad asks for the desktop site: a Mac with a touch screen
  const tablet = !phone && (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua) || (/Macintosh|MacIntel/i.test(ua + platform) && touch > 1));
  return {
    fallback: !!(adapter?.isFallbackAdapter ?? info.isFallbackAdapter),
    vendor: String(info.vendor ?? '').toLowerCase(), architecture: String(info.architecture ?? '').toLowerCase(),
    maxTex: adapter?.limits?.maxTextureDimension2D ?? null, maxBuffer: adapter?.limits?.maxBufferSize ?? null,
    deviceMemory, w, h, dpr, mobile: phone, phone, tablet, touch,
    // a strong desktop GPU (owner, 2026-10-31: "do not degrade performance for users like me"): Apple silicon or a discrete
    // NVIDIA / AMD card, not a phone, a tablet or a software adapter
    strong: !phone && !tablet && !(adapter?.isFallbackAdapter ?? info.isFallbackAdapter) && ['apple', 'nvidia', 'amd'].includes(String(info.vendor ?? '').toLowerCase()),
  };
}

// The highest tier the device's FACTS allow, before any measuring, and the memory budget in MB. Returns
// { ceiling, memMB, why: [reasons] }.
export function ceilingFor(s) {
  let at = 0;   // index into TIER_ORDER
  const why = [];
  const cap = (i, text) => { if (i > at) { at = i; why.push(text); } };
  if (s.fallback) cap(2, 'software adapter');
  if (s.phone) cap(2, 'phone');
  if (s.tablet) cap(1, 'tablet');
  if (s.maxTex != null && s.maxTex < 8192) cap(2, `max texture ${s.maxTex}`);
  if (s.maxBuffer != null && s.maxBuffer < 256 * 2 ** 20) cap(2, 'small buffer limit');
  if (s.deviceMemory != null && s.deviceMemory <= 2) cap(2, `${s.deviceMemory} GB device`);
  else if (s.deviceMemory != null && s.deviceMemory <= 4) cap(1, `${s.deviceMemory} GB device`);
  if (s.vendor === 'intel' || s.vendor === 'qualcomm' || s.vendor === 'arm' || s.vendor === 'img') cap(1, `${s.vendor} (integrated) GPU`);
  // the tab memory budget: a phone tab dies near 1.5 GB; stay under about 1 GB (owner brief)
  const memMB = s.phone ? 1000 : s.tablet ? 1400 : s.deviceMemory != null ? Math.max(700, s.deviceMemory * 1024 * 0.25) : 2500;
  return { ceiling: TIER_ORDER[at], memMB, why };
}

// Pixels the tier draws on this screen (css px × ratio²)
// Retina (owner pick, 2026-10-30): on a screen with DPR > 1, High draws at min(DPR, 1.5) and Balanced at min(DPR, 1.15)
// (a 2.6 Mpx ceiling, never under 1); Low has no `retina` entry and keeps its memory-capped ratio (phones). At DPR 1 (the
// goldens, any 1x screen) nothing changes. `retinaMax` is the governor's cap, stepped 1.5 -> 1.25 -> 1.0 before a tier drops.
export function pixelRatioFor(name, s, retinaMax = Infinity) {
  const r = tierOf(name).render, css = Math.max(1, s.w * s.h);
  const base = Math.max(r.minRatio, Math.min(r.scale, Math.sqrt(r.maxPixels / css)));
  const dpr = s.dpr ?? 1;
  if (!r.retina || r.retina.cap <= 1 || !(dpr > 1)) return base;
  const hi = Math.max(1, Math.min(dpr, r.retina.cap, retinaMax, Math.sqrt(r.retina.maxPixels / css)));
  return Math.max(base, hi);
}
const REF_PIXELS = 960 * 540;   // the warm-up draws at this size

// Predicted GPU ms for a tier: the warm-up's ms (one frame of the reference workload at REF_PIXELS) scaled by the
// tier's cost and the pixels it will draw. `gain` converts the warm-up to a High frame at REF_PIXELS (calibrated).
const WARMUP_GAIN = 1.5;   // calibrated on the dev Mac (M-series, 4.6 ms warm-up ↔ a 12.3 ms High frame at 1280 × 720)
export function predictMs(name, s, warmupMs, gain = WARMUP_GAIN) {
  const ratio = pixelRatioFor(name, s);
  const px = (s.w * s.h * ratio * ratio) / REF_PIXELS, px720 = (1280 * 720) / REF_PIXELS;
  return warmupMs * gain * (px720 * FIXED_SHARE + (1 - FIXED_SHARE) * COST[name] * px);
}

// Can the warm-up change the pick? Not when the facts cap the device at the lowest tier: Low either way (perf/phone-load:
// a phone skips the 1.2–2.6 s warm-up)
export const warmupDecides = (s) => ceilingFor(s).ceiling !== TIER_ORDER.at(-1);

// The pick. warmupMs: the measured warm-up (null: it failed or was skipped). Returns
// { tier, ceiling, why, predicted: {tier: ms}, budget, measured }.
export function pickTier(s, warmupMs = null, { gain = WARMUP_GAIN } = {}) {
  const { ceiling, memMB, why } = ceilingFor(s);
  const budget = budgetMs(s);
  const from = TIER_ORDER.indexOf(ceiling);
  const predicted = {};
  const fits = (name) => GPU_MB[name] <= memMB;
  if (warmupMs == null || !(warmupMs > 0)) {
    // no measurement: the safe middle, never above the ceiling
    const tier = TIER_ORDER[Math.max(from, 1)];
    return { tier: fits(tier) ? tier : 'low', ceiling, why: [...why, 'no warm-up'], predicted, budget, measured: false, memMB };
  }
  // a strong desktop GPU starts at High (owner, 2026-10-31: "I have a powerful MacBook, do not degrade users like me"): the
  // warm-up's pixel prediction put this Mac on Low (High at its retina ratio 1.5 on 1512 x 945 predicted 35 ms); the real
  // frames decide instead, after ready (AfterReady below: the ratio steps 1.5 -> 1.25 -> 1 until the GPU frame is under 12 ms)
  if (strongStart(s, warmupMs) && from === 0 && fits('high')) return { tier: 'high', ceiling, why: [...why, 'strong GPU: checked after ready'], predicted, budget, measured: true, memMB, strong: true };
  let tier = 'low';
  for (let i = from; i < TIER_ORDER.length; i++) {
    const name = TIER_ORDER[i];
    predicted[name] = predictMs(name, s, warmupMs, gain);
    if (predicted[name] <= budget * PICK_SLACK && fits(name)) { tier = name; break; }
  }
  return { tier, ceiling, why, predicted, budget, measured: true, memMB };
}

// The setting wins: 'auto' picks; a named tier is the tier (the player asked). A saved governor cap (an earlier session
// stepped down on this device) only limits 'auto'.
export function resolveTier(setting, s, warmupMs, { cap = null, gain } = {}) {
  if (setting && setting !== 'auto' && TIERS[setting]) return { tier: setting, forced: true, why: ['setting'], budget: budgetMs(s) };
  const p = pickTier(s, warmupMs, { gain });
  if (cap && TIER_ORDER.indexOf(cap) > TIER_ORDER.indexOf(p.tier)) return { ...p, tier: cap, why: [...p.why, 'earlier session stepped down'], forced: false };
  return { ...p, forced: false };
}

// --- The governor -----------------------------------------------------------------------------------------------
// Steps DOWN only. Feed it every frame's wall time (s); when even the 10th-percentile frame of the last `windowS` seconds is over
// budget × `slack`, it returns the next rung: the tier below, then (on Low) a smaller render ratio. A rung applies its
// LIVE knobs; the build knobs of a lower tier wait for the next start (the cap is saved for it).
const RATIO_STEP = 0.85;
export const RETINA_STEPS = [1.5, 1.25, 1.0];   // the governor's first rungs on a retina screen, before any tier drops
export class Governor {
  constructor({ tier = 'high', budget = 16.7, windowS = 10, slack = 1.2, minRatioFactor = 0.6, now = 0, retina = 1 } = {}) {
    this.tier = tier; this.budget = budget; this.windowS = windowS; this.slack = slack;
    this.retina = retina;            // the retina ratio now drawn (1 = none); stepped down first
    this.factor = 1;                 // extra render-ratio factor, only below Low
    this.minFactor = minRatioFactor;
    this.samples = []; this.from = now; this.steps = [];
  }
  // returns null, or { tier, factor, reason } when it steps
  feed(dtSec, now) {
    if (!(dtSec > 0) || dtSec > 1) return null;   // a stall or a tab switch is not a frame time
    this.samples.push([now, dtSec * 1000]);
    while (this.samples.length && this.samples[0][0] < now - this.windowS) this.samples.shift();
    if (now - this.from < this.windowS) return null;   // a full window since the last step (or the start)
    const ms = this.samples.map((x) => x[1]).sort((a, b) => a - b);
    const med = ms[Math.floor(ms.length * 0.1)];   // the 10th percentile: even the good frames of the window are slow (~9 of 10 s)
    if (med <= this.budget * this.slack) return null;
    const i = TIER_ORDER.indexOf(this.tier);
    let step = null;
    if (this.retina > 1 + 1e-6) {
      this.retina = RETINA_STEPS.find((r) => r < this.retina - 1e-6) ?? 1;
      step = { tier: this.tier, factor: this.factor, retina: this.retina, reason: `p10 ${med.toFixed(1)} ms over ${this.budget} ms: render ratio ${this.retina}` };
    } else if (i < TIER_ORDER.length - 1) { this.tier = TIER_ORDER[i + 1]; step = { tier: this.tier, factor: this.factor, retina: 1, reason: `p10 ${med.toFixed(1)} ms over ${this.budget} ms` }; }
    else if (this.factor > this.minFactor + 1e-6) { this.factor = Math.max(this.minFactor, this.factor * RATIO_STEP); step = { tier: this.tier, factor: this.factor, reason: `p10 ${med.toFixed(1)} ms on Low: smaller render` }; }
    if (step) { this.steps.push({ ...step, at: now }); this.samples = []; this.from = now; }
    return step;
  }
}

// --- The saved cap (2026-10-30 rule; the old rule saved a 14-day cap on the FIRST step, so one busy minute left the game
// degraded for two weeks) ---------------------------------------------------------------------------------------------
// A cap is saved only when the governor stepped down in 2 or more SEPARATE sessions within 7 days (every step is logged
// with its session id), and it expires after 3 days. The warm-up never saves one. 'reset auto' clears the cap and the log.
export const CAP_KEY = 'lakeshore.tier.v2', CAP_DAYS = 3;
export const STEPLOG_KEY = 'lakeshore.tier.steps.v1', CAP_SESSIONS = 2, CAP_WINDOW_DAYS = 7;
export const OLD_CAP_KEY = 'lakeshore.tier.v1', MIGRATED_KEY = 'lakeshore.tier.mig.v1';   // the 14-day cap's key, and the one-time clean-up flag
export const QUALITY_NOTICE = 'Quality lowered for smooth sailing \u00b7 Setup';       // the top capsule's line after a step-down
export function readCap(storage, nowMs = Date.now()) {
  try {
    const v = JSON.parse(storage?.getItem(CAP_KEY) ?? 'null');
    if (v && TIERS[v.cap] && nowMs - v.at < CAP_DAYS * 864e5) return v.cap;
  } catch { /* none */ }
  return null;
}
export function writeCap(storage, cap, nowMs = Date.now()) {
  try { storage?.setItem(CAP_KEY, JSON.stringify({ cap, at: nowMs })); } catch { /* private mode */ }
}
const readLog = (storage, nowMs) => {
  try {
    const v = JSON.parse(storage?.getItem(STEPLOG_KEY) ?? 'null');
    if (Array.isArray(v)) return v.filter((e) => e && TIERS[e.tier] && typeof e.session === 'string' && nowMs - e.at < CAP_WINDOW_DAYS * 864e5);
  } catch { /* none */ }
  return [];
};
// One governor step-down in `session`. Returns { capped: tier|null, sessions }: capped is the tier saved as the cap when
// this step is the second separate session inside 7 days, else null (the step is only logged).
export function recordStepDown(storage, tier, session, nowMs = Date.now()) {
  const log = readLog(storage, nowMs);
  if (!log.some((e) => e.session === session && e.tier === tier)) log.push({ tier, session: String(session), at: nowMs });
  try { storage?.setItem(STEPLOG_KEY, JSON.stringify(log)); } catch { /* private mode */ }
  const sessions = new Set(log.map((e) => e.session)).size;
  if (sessions >= CAP_SESSIONS) { writeCap(storage, tier, nowMs); return { capped: tier, sessions }; }
  return { capped: null, sessions };
}
// 'reset auto': forget the cap and the log of steps
export function clearCap(storage) {
  for (const k of [CAP_KEY, STEPLOG_KEY, OLD_CAP_KEY]) { try { storage?.removeItem?.(k); } catch { /* ignore */ } }
}
// One time: drop any cap the old 14-day rule saved (it lives under OLD_CAP_KEY; the new rule never reads it). Returns true if it ran.
export function migrateCap(storage) {
  try {
    if (!storage || storage.getItem(MIGRATED_KEY)) return false;
    storage.removeItem?.(OLD_CAP_KEY); storage.removeItem?.(CAP_KEY);
    storage.setItem(MIGRATED_KEY, '1');
    return true;
  } catch { return false; }
}
