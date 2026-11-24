// perf(v2) phone 30 fps (owner, 2026-11-15: "phone should target at 30fps not 60 and push for the picture quality"): the
// frame limiter. A phone draws on every 2nd vsync of a 60 Hz display, every 4th of a 120 Hz one (every 3rd at 90 Hz), so
// the frames are even (33.3 ms each, never a 16.7 / 33.3 ms judder). Pure: fed every rAF time stamp, due(ts) says whether
// this callback draws. The skipped callbacks cost nothing but this test; the page's sim time is the real time between the
// drawn frames (main.js: prev moves on a drawn frame only), so the boat's speed is unchanged; touch and keys land in their
// DOM handlers whenever they come and are read by the next drawn frame (at most one vsync later than at 60 fps).
//   vsync: the lower quartile of the last `keep` callback intervals (drawn and skipped: a skipped callback is light, so its
//   interval is the display's), snapped to a known rate. every = round(target / vsync), at least 1 (a 30 Hz display draws
//   every vsync). A callback draws when the time since the last drawn frame is within half a vsync of every × vsync: a late
//   frame (a missed vsync) draws at once, and the next one is again every × vsync after it.
//   const pacer = createPacer({ targetMs: 1000 / 30 });  rAF(ts) → if (!pacer.due(ts)) return requestAnimationFrame(tick);
import { snapRefresh } from './governor.js';

export function createPacer({ targetMs = 1000 / 30, on = true, keep = 32, ring = 120 } = {}) {
  const cb = new Float64Array(keep); let cbN = 0, cbI = 0, prevTs = null, lastDraw = null, vsync = null, skipped = 0, drawn = 0;
  const iv = new Float64Array(ring); let ivN = 0, ivI = 0;
  const estimate = () => {
    if (cbN < 4) return null;
    const a = Array.from(cb.subarray(0, cbN)).sort((x, y) => x - y);
    return snapRefresh(a[Math.floor((a.length - 1) * 0.25)]);
  };
  const pct = (p) => { if (!ivN) return null; const a = Array.from(iv.subarray(0, ivN)).sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((a.length - 1) * p + 0.5))]; };
  return {
    get on() { return on; },
    get targetMs() { return targetMs; },
    get vsyncMs() { return vsync; },
    get every() { return vsync ? Math.max(1, Math.round(targetMs / vsync)) : 1; },
    setOn(v) { on = !!v; },
    due(ts) {
      if (!Number.isFinite(ts)) return true;
      if (prevTs != null) { const d = ts - prevTs; if (d > 2 && d < 100) { cb[cbI] = d; cbI = (cbI + 1) % keep; cbN = Math.min(keep, cbN + 1); vsync = estimate(); } }
      prevTs = ts;
      let draw = true;
      if (on && lastDraw != null && vsync != null) {
        const every = Math.max(1, Math.round(targetMs / vsync));
        draw = ts - lastDraw >= every * vsync - vsync / 2;
      }
      if (!draw) { skipped++; return false; }
      if (lastDraw != null) { const d = ts - lastDraw; if (d > 0 && d < 250) { iv[ivI] = d; ivI = (ivI + 1) % ring; ivN = Math.min(ring, ivN + 1); } }
      lastDraw = ts; drawn++;
      return true;
    },
    // the presented frames: their interval's p50 and p95 (ms), fps from the p50, the vsync and the cadence
    state() {
      const p50 = pct(0.5), p95 = pct(0.95), every = vsync ? Math.max(1, Math.round(targetMs / vsync)) : 1;
      return { on, targetMs: +targetMs.toFixed(2), vsyncMs: vsync == null ? null : +vsync.toFixed(2), hz: vsync ? Math.round(1000 / vsync) : null, every, p50: p50 == null ? null : +p50.toFixed(2), p95: p95 == null ? null : +p95.toFixed(2), fps: p50 ? +(1000 / p50).toFixed(1) : null, drawn, skipped };
    },
    // the diag's line: 'pacing 30.0 fps: every 2nd vsync of 60 Hz · frames p50 33.3 / p95 34.1 ms'
    line() {
      const s = this.state(), nth = s.every === 2 ? '2nd' : s.every === 3 ? '3rd' : `${s.every}th`;
      const cad = !s.on ? 'no limiter' : s.hz == null ? 'measuring the vsync' : s.every === 1 ? `every vsync of ${s.hz} Hz` : `every ${nth} vsync of ${s.hz} Hz`;
      return `pacing ${s.fps != null ? s.fps.toFixed(1) : "–"} fps: ${cad}${s.p50 != null ? ` · frames p50 ${s.p50} / p95 ${s.p95} ms` : ''}`;
    },
  };
}
