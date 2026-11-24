// The fixed-step sim clock and the day clock on it. The sim advances in equal steps of `step` seconds; a frame feeds its
// wall dt (× the game speed) and the clock runs as many whole steps as fit (at most maxSteps: a long stall never replays a
// minute), carrying the remainder. Under ?headless the page never feeds wall time; a capture calls renderOnce(), which
// steps the clock by exactly one step, so 30 renders are the same 30 steps on every machine (the URL's t pins the start).
// No wall clock is read here.
//
// The scene hour is a pure function of sim time and the rate history, as v1's (src/sim/timeOfDay.js TimeOfDay): a list
// of segments, each from a sim time on at a constant rate (game s per sim s) or on a rate schedule (v1's day clock, slow
// golden hours and a quick night, integrated once into v1's RateTable). The first segment is anchored at sim time 0 (so
// a constant rate is hour0 + t × timerate / 3600, M0's rule); a change keeps the hour continuous, a cut (setHour) jumps it.
//
//   const c = createSimClock({ step: 1 / 120, t0: 0, hour0: 18.75, timerate: 10, schedule: dayClockSchedule({ base: 10 }) });
//   c.advance(dt) → the number of steps run; c.step() one step (captures)
//
// The clock's API (other modules read the time only through it: the sun, the sky, the night, the fireworks, the wind's day,
// the top bar's clock and time menu, the VHF's timing):
//   c.t                    sim seconds now                  c.dt     the fixed step (s)          c.steps  steps run
//   c.acc                  the sim seconds fed and not yet stepped (< c.dt)
//   c.hour                 the hour of day now, [0, 24)     c.hourAt(t)   the same at sim time t
//   c.hourUnwrapped        hours since the start's midnight, monotonic across midnight (18 → 30); c.hourUnwrappedAt(t)
//   c.rate                 game s per sim s now (0: frozen); c.rateAt(t)
//   c.running              the hour moves (rate > 0)
//   c.mode                 'day' (v1's schedule) | 'rate' (a constant rate) | 'frozen' (rate 0), as the clock started
//   c.cuts                 how many jumps so far (setHour)
//   c.gliding              a glide (below) is under way: the hour runs to where it lands
//   c.setHour(h, t = c.t)  a cut: the hour jumps to h at sim time t (unwrapped hours; a schedule keeps running from it);
//                          listeners get onCut(fn) → fn({ from, to, t }); returns the unsubscribe
//   c.glide(h, secs, t = c.t) a cut that eases: the hour runs from now to h over secs sim s (smoothstep), then the schedule runs on
//                          from h; one cut (cuts + 1, onCut gets { from, to, t, secs }). The fireworks' marker: the sky eases to
//                          night in about 1 s, no snap
//   c.setRate(r, t = c.t)  a constant rate from t on (the hour keeps going; the fireworks evening holds the show's pace)
//   c.resume(t = c.t)      back to the clock's own pace from t on (the schedule, or the start's constant rate)
//   c.setSchedule(s, t)    a rate schedule from t on (Cruise's day clock; a frozen clock ignores it)
// The wind's day reads hourUnwrappedAt (src/sim/wind.js WindField.setClock), as v1's core does.
import { RateTable, dayClockSchedule, DAY_CLOCK, DEFAULT_TIMERATE } from '../../src/sim/timeOfDay.js';

// Sail's day clock on v2 (owner, 2026-11-15: the night is sailable): v1's schedule (slow golden hours and twilight) with no quick
// night: the deep night runs at the day's rate (nightMult 1: about 19 real minutes under -12 deg, not 5), so nothing ever says
// "The night passes…" in Sail. Cruise keeps v1's 4 x night (v2/cruise/plan.js cruiseSchedule). v1's DAY_CLOCK is unchanged.
export const SAIL_CLOCK = Object.freeze({ ...DAY_CLOCK, nightMult: 1 });
export const sailSchedule = (base = DEFAULT_TIMERATE) => dayClockSchedule({ base, clock: SAIL_CLOCK });

const wrap24 = (h) => ((h % 24) + 24) % 24;
const MAX_SEGMENTS = 512;   // older segments are dropped (the wind's advection asks back ≈ a minute; a lapse adds ≈ 1 a frame)

export function createSimClock({ step = 1 / 120, maxSteps = 10, t0 = 0, hour0 = 13, timerate = 0, schedule = null } = {}) {
  let t = t0, acc = 0, steps = 0, cuts = 0;
  const table = schedule ? (schedule instanceof RateTable ? schedule : new RateTable(schedule)) : null;
  const rate0 = Math.max(0, timerate || 0);
  const mode = table ? 'day' : rate0 > 0 ? 'rate' : 'frozen';
  const own = (tt, h) => (table ? { t: tt, h, table } : { t: tt, h, rate: rate0 });
  const seg = [own(0, hour0)];
  const cutFns = new Set();
  const segAt = (tt) => { for (let i = seg.length - 1; i > 0; i--) if (tt >= seg[i].t) return seg[i]; return seg[0]; };
  const push = (s) => { seg.push(s); if (seg.length > MAX_SEGMENTS) seg.splice(0, seg.length - MAX_SEGMENTS); };
  const run = (s, dt) => (s.table ? s.table.hourAfter(s.h, dt) : s.h + (dt * s.rate) / 3600);
  const hourUnwrappedAt = (tt) => {
    const s = segAt(tt);
    if (!s.glide) return run(s, tt - s.t);
    const u = (tt - s.t) / s.glide.secs;
    return u < 1 ? s.glide.from + (s.h - s.glide.from) * u * u * (3 - 2 * u) : run(s, tt - s.t - s.glide.secs);
  };
  const hourAt = (tt) => wrap24(hourUnwrappedAt(tt));
  const rateAt = (tt) => { const s = segAt(tt); return s.table ? s.table.rateAt(s.glide && tt - s.t < s.glide.secs ? s.h : hourUnwrappedAt(tt)) : s.rate; };   // a glide reports the pace it lands on
  return {
    get t() { return t; },
    get steps() { return steps; },
    get dt() { return step; },
    get acc() { return acc; },   // the sim seconds fed but not yet stepped (< one step): a camera reads where the boat is between ticks (regatta/index.js)
    get hour() { return hourAt(t); },
    get hourUnwrapped() { return hourUnwrappedAt(t); },
    get rate() { return rateAt(t); },
    get running() { return rateAt(t) > 0; },
    get mode() { return mode; },
    get cuts() { return cuts; },
    get gliding() { const s = segAt(t); return !!s.glide && t - s.t < s.glide.secs; },   // a glide's hour is running to its landing
    get table() { return table; },
    hourAt, hourUnwrappedAt, rateAt,
    setHour(h, at = t) {
      if (!Number.isFinite(h)) return;
      const from = hourUnwrappedAt(at), s = segAt(at);
      push(s.table ? { t: at, h, table: s.table } : { t: at, h, rate: s.rate });
      cuts++;
      for (const fn of cutFns) { try { fn({ from, to: h, t: at }); } catch (e) { console.error(e); } }
    },
    glide(h, secs = 1, at = t) {
      if (!Number.isFinite(h)) return;
      if (!(secs > 0)) { this.setHour(h, at); return; }
      const from = hourUnwrappedAt(at), s = segAt(at);
      push({ ...(s.table ? { table: s.table } : { rate: s.rate }), t: at, h, glide: { from, secs } });
      cuts++;
      for (const fn of cutFns) { try { fn({ from, to: h, t: at, secs }); } catch (e) { console.error(e); } }
    },
    setRate(r, at = t) { push({ t: at, h: hourUnwrappedAt(at), rate: Math.max(0, r || 0) }); },
    resume(at = t) { push(own(at, hourUnwrappedAt(at))); },
    // Cruise (v2/cruise): another rate schedule from t on (v1's TimeOfDay.setSchedule: Cruise's day clock at its own base, the
    // hour continuous); a frozen clock stays frozen (a capture's time stands still in every mode)
    setSchedule(schedule, at = t) { if (mode === 'frozen' || !schedule) return; push({ t: at, h: hourUnwrappedAt(at), table: schedule instanceof RateTable ? schedule : new RateTable(schedule) }); },
    onCut(fn) { cutFns.add(fn); return () => cutFns.delete(fn); },
    advance(dt) {
      if (!(dt > 0)) return 0;
      acc += Math.min(dt, step * maxSteps);
      let n = 0;
      while (acc >= step && n < maxSteps) { acc -= step; t += step; n++; }
      if (acc >= step) acc = 0;   // a stall past the cap: drop the rest, never replay it later
      steps += n;
      return n;
    },
    step() { t += step; steps++; return 1; },
  };
}
