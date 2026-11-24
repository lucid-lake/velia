// A loading line that glides on the compositor between real steps (feat/v2-loading-bar-compositor; owner 2026-11-18: "a
// loading bar that keeps moving even while the phone is busy building shaders", Abyssal Garden's say()).
// The phone's build card (ui/buildCard.js) learns its progress one pipeline at a time, and each pipeline's compile can hold
// the main thread for hundreds of ms on a phone: a line moved by --p (a style change on the main thread) stands still then.
// Here the line's fill moves by one Web Animation on transform (scaleX) alone, which the compositor runs on its own:
//   step(p, next)  a real step: from the value on screen, a short ease up to p if the line is behind (never back), then the
//                  creep (loadBar.js creep(): fast at first, slower and slower) toward next, the next expected step; it never
//                  reaches next, so the line never shows more than the page has done
//   the pace       the creep's half time follows the steps' own pace (the mean gap between steps), so a usual step lands as
//                  the creep is halfway there, and a long one (a slow compile, an asset on the network) still shows motion
//   done()         a short ease to 1
// Nothing runs per frame: one animate() call per real step. Reduced motion: no glide (the caller's plain --p line stays).
//   const g = createLineGlide(fillEl);   g.step(0.42, 0.43);   g.done();   g.stop();   g.value()
import { creep, scaleOf } from './loadBar.js';

export const CATCH_MS = 360;     // the ease up to a step the line is behind
const DONE_MS = 260;      // the last ease to 1
export const PACE = Object.freeze({ first: 1500, min: 300, max: 6000 });   // the creep's half time (ms): its first guess and its bounds
const LEAD_MS = 34;              // the compositor's frame runs a little ahead of this thread's clock (as loadBar.js)
const EASE = [0, 0.25, 0.5, 0.75, 1].map((x) => [x, 1 - (1 - x) ** 3]);   // ease-out as straight pieces, so value() is exact

// the keyframes of one glide: [values, offsets, duration] and its value at a time (ms), the same piecewise line the
// compositor draws
export function glide(from, to, cap, half, catchMs = CATCH_MS) {
  const c = creep(to, Math.max(to, cap), half);
  const lead = to > from + 1e-5 ? catchMs : 0;
  const duration = lead + c.duration;
  const values = [], times = [];
  if (lead) for (const [x, e] of EASE) { values.push(from + (to - from) * e); times.push(x * lead); }
  c.values.forEach((v, i) => { if (lead && i === 0) return; values.push(v); times.push(lead + c.offsets[i] * c.duration); });
  const offsets = times.map((t) => t / duration);
  const at = (ms) => {
    if (!(ms > 0)) return values[0];
    if (ms >= duration) return values.at(-1);
    let i = 1; while (times[i] < ms) i++;
    const f = (ms - times[i - 1]) / (times[i] - times[i - 1] || 1);
    return values[i - 1] + (values[i] - values[i - 1]) * f;
  };
  return { values, offsets, duration, at, cap: c.values.at(-1) };
}

export function createLineGlide(fill, { now = () => globalThis.performance?.now?.() ?? 0, first = PACE.first } = {}) {
  const off = { step() {}, done() {}, stop() {}, value: () => 0, log: [], get pace() { return first; } };
  if (!fill || typeof fill.animate !== 'function') return off;
  const log = [];   // [p, next, value on screen, ms]: what the line did (tests)
  let cur = null, anim = null, last = null, lastP = -1, pace = first, ended = false;
  // the value on screen now: the running glide's, else the line's own transform (the CSS --p it had before the first step)
  const css = () => { try { const t = getComputedStyle(fill).transform; return t && t !== 'none' ? Math.max(0, Math.min(1, scaleOf(t) || 0)) : 0; } catch { return 0; } };
  const value = (lead = 0) => (cur ? cur.g.at(now() - cur.t0 + lead) : css());
  function play(g) {
    try { anim?.cancel(); } catch { /* gone */ }
    anim = fill.animate(g.values.map((v, i) => ({ transform: `scaleX(${v.toFixed(5)})`, offset: g.offsets[i] })), { duration: g.duration, easing: 'linear', fill: 'forwards' });
    cur = { g, t0: now() };
  }
  return {
    log, value: () => value(),
    get pace() { return pace; },
    // p: the real progress (0..1); next: the next expected step, the most the creep may approach
    step(p, next) {
      if (ended) return;
      const t = now();
      p = Math.max(0, Math.min(1, +p || 0));
      if (p <= lastP + 1e-6 && cur) return;   // nothing new (the gate emits on a group or asset change too)
      if (last != null && p > lastP) pace = Math.min(PACE.max, Math.max(PACE.min, 0.7 * pace + 0.3 * (t - last)));
      if (p > lastP) { last = t; lastP = p; }
      const v = Math.min(1, value(LEAD_MS));
      const to = Math.max(v, p), cap = Math.max(to, Math.min(1, +next || 0));
      play(glide(v, to, cap, pace));
      log.push([+p.toFixed(4), +cap.toFixed(4), +v.toFixed(4), Math.round(t)]);
    },
    done() {
      if (ended) return;
      ended = true;
      const v = Math.min(1, value(LEAD_MS));
      try { anim?.cancel(); } catch { /* gone */ }
      anim = fill.animate([{ transform: `scaleX(${v.toFixed(5)})` }, { transform: 'scaleX(1)' }], { duration: DONE_MS, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' });
      cur = null;
      log.push([1, 1, +v.toFixed(4), Math.round(now())]);
    },
    stop() { ended = true; try { anim?.cancel(); } catch { /* gone */ } anim = null; cur = null; },
  };
}
