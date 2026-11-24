// The voyage bar's motion on v2's loading page (fix/v2-loading-feel; owner 2026-11-15: "the bar must always show movement,
// fake it if needed"). v1's loading screen (src/ui/loading.js) drives the bar through --p from a rAF loop, and the shell's
// first creep animates --p too: both run on the main thread, which v2's boot holds for seconds at a time on a phone (the
// world's build after the device: 2.7 s at 4× CPU), so the bar sat still. Here the sailed line (scaleX) and the sloop
// (translateX of a box as wide as the line) move by Web Animations on transform, which the compositor runs on its own.
//   the creep: from the value now, toward the next milestone's cap, along v + (cap − v) · (1 − 1/√(1 + t/τ)): fast at
//     first, slower and slower, never at the cap and never still (its tail decays as a power, not an exponential, so a
//     stage far longer than planned, a slow link's chunk or a slow phone's build, still shows the line moving)
//   a real milestone (the gate passed, each of v2's boot stages) jumps the bar up to its floor if the creep is behind, and
//     starts a new creep toward its own cap; nothing ever goes back; before ready nothing passes 0.9
//   ready: a short ease to 1 (the card's own hand-off then fades the bar, src/ui/loading.js)
// v1's own progress (api.progress, --p, aria-valuenow, the card's chart sloop) is untouched; this only moves the two pieces.

// name → [floor, cap, half ms]: the floor the bar jumps to when the milestone arrives, the cap its creep approaches, how
// fast (half: the creep covers half the gap in that time). From the phone-profile timeline: the
// modules and the gate ≈ 0.3–0.8 s, the world's build after the device the long one, the pipelines and the sky short, the
// terrain's first stage (the boat waits on it) a network wait.
export const MILESTONES = Object.freeze({
  js: [0, 0.3, 1500],         // this module runs (the shell's CSS creep hands over here)
  gate: [0.06, 0.4, 2500],    // start.js: WebGPU checked, the engine's chunk asked for (a slow link: seconds)
  gpu: [0.16, 0.64, 500],     // main.js: the device is up; the world builds (≈ 0.35 s at 4× CPU since perf/v2-phone-load: the show off the boot path; was 2.6 s)
  terrain: [0.62, 0.86, 900], // the pipelines build
  water: [0.68, 0.86, 900],   // every pipeline built
  sky: [0.72, 0.88, 1200],    // the sky baked; the terrain's first stage awaited
  boat: [0.84, 0.9, 500],     // the boat made; the first frame next
});
export const MAX_BEFORE_READY = 0.9;
const READY_MS = 260;
// a stage that runs long past its plan (a slow link's chunk, a slow phone): every REARM_MS without a milestone, while the
// main thread is free to notice, the creep restarts from where it is toward a cap a quarter of the way on to 0.9, so the
// line keeps a visible pace instead of crawling into its cap
export const REARM_MS = 2500;

// one creep as keyframes: offsets and values (linear between them), its length, and its value at a time (ms), the same
// piecewise line the compositor draws
const STEPS = [0, 0.1, 0.25, 0.5, 1, 1.7, 2.6, 4, 6, 9, 13, 19, 28, 40, 58, 85, 125, 180, 260, 400];   // t / τ
export function creep(v0, cap, half) {
  const tau = half / 3;   // 1 − 1/√(1 + 3) = ½
  const end = STEPS.at(-1) * tau;
  const values = STEPS.map((k) => v0 + (cap - v0) * (1 - 1 / Math.sqrt(1 + k)));
  const offsets = STEPS.map((k) => (k * tau) / end);
  const at = (ms) => {
    if (!(ms > 0)) return values[0];
    if (ms >= end) return values.at(-1);
    const x = ms / end;
    let i = 1; while (offsets[i] < x) i++;
    const f = (x - offsets[i - 1]) / (offsets[i] - offsets[i - 1]);
    return values[i - 1] + (values[i] - values[i - 1]) * f;
  };
  return { values, offsets, duration: end, at };
}

// the scale a computed transform carries (matrix(a, …) → a; none → 1)
export function scaleOf(transform) {
  if (!transform || transform === 'none') return 1;
  const m = /^matrix(3d)?\(([^)]+)\)/.exec(transform);
  if (!m) return NaN;
  return parseFloat(m[2].split(',')[0]);
}

export function installLoadBar({ root, now = () => performance.now(), every = (fn, ms) => setInterval(fn, ms), clear = (id) => clearInterval(id) } = {}) {
  const sailed = root?.querySelector('.lk-sailed'), sloop = root?.querySelector('.lk-psloop');
  const noop = { mark() {}, ready() {}, stop() {}, rearm() {}, value: () => 0, log: [] };
  if (!sailed || !sloop || typeof sailed.animate !== 'function') return noop;
  const log = [];   // [name, value, ms]: what the bar did (tests and the timeline)
  let cur = null;   // { c: creep, t0 }
  let stopped = false, done = false;
  // the value on screen now: the running creep's, else the shell's CSS creep's (read once, at the hand-over)
  const css = () => { const m = getComputedStyle(sailed).transform; return m && m !== 'none' ? Math.min(MAX_BEFORE_READY, scaleOf(m) || 0) : 0; };   // no transform: nothing sailed yet
  const value = () => (cur ? cur.c.at(now() - cur.t0) : css());
  const anims = [];
  function play(frames, opts) {
    for (const a of anims.splice(0)) { try { a.cancel(); } catch { /* gone */ } }
    anims.push(sailed.animate(frames.map((v, i) => ({ transform: `scaleX(${v.toFixed(4)})`, offset: opts.offsets?.[i] })), { duration: opts.duration, easing: opts.easing ?? 'linear', fill: 'forwards' }));
    anims.push(sloop.animate(frames.map((v, i) => ({ transform: `translateX(${(v * 100).toFixed(2)}%)`, offset: opts.offsets?.[i] })), { duration: opts.duration, easing: opts.easing ?? 'linear', fill: 'forwards' }));
    sailed.style.animation = 'none'; sloop.style.animation = 'none';   // the shell's CSS creep is replaced (script animations sit above it anyway)
  }
  function go(floor, cap, half, name) {
    if (stopped || done) return;
    // a little ahead of now: the compositor's frame runs ahead of this thread's clock, so the new creep never starts behind it
    // (the shell's CSS creep, read on this thread, can trail its compositor frame by a pixel: a hair ahead of it)
    const v = Math.min(MAX_BEFORE_READY, Math.max(floor, cur ? cur.c.at(now() - cur.t0 + 34) : css() + 0.004));
    const c = creep(v, Math.max(v, Math.min(MAX_BEFORE_READY, cap)), half);
    cur = { c, t0: now(), cap: c.values.at(-1), half };
    play(c.values, { offsets: c.offsets, duration: c.duration });
    log.push([name, +v.toFixed(4), Math.round(now())]);
  }
  const api = {
    log, value,
    mark(name) { const m = MILESTONES[name]; if (m) go(m[0], m[1], m[2], name); },
    // the long-stage pace (the interval below calls it): a creep older than REARM_MS restarts toward a farther cap
    rearm() {
      if (stopped || done || !cur || now() - cur.t0 < REARM_MS) return;
      const v = cur.c.at(now() - cur.t0 + 34);
      go(v, Math.max(cur.cap, v + 0.25 * (MAX_BEFORE_READY - v)), Math.max(cur.half, REARM_MS), 'rearm');
    },
    ready() {
      clear(timer);
      if (stopped || done) return;
      const v = value(); done = true; cur = null;
      play([v, 1], { duration: READY_MS, easing: 'cubic-bezier(.2,.6,.3,1)' });
      log.push(['ready', +v.toFixed(4), Math.round(now())]);
    },
    stop() { stopped = true; clear(timer); for (const a of anims.splice(0)) { try { a.cancel(); } catch { /* gone */ } } },
  };
  const timer = every(() => api.rearm(), 500);
  api.mark('js');
  return api;
}
