// The stage director (owner, 2026-11-17: "We present the kayaks, Tessie and the birds like a
// stage at the opening. Think through the timing and performance; not too flowery. After the first round, these show up
// randomly"). It reads the showcase list (v2/stage/acts.js ACTS) and is the only thing that decides when an act plays. Pure:
// no DOM, no GPU, no Math.random, no wall clock (the play clock it is stepped with, and the seed).
//
// The rules (one stage, one act at a time):
//   - nothing in the first QUIET_S of play, but an act whose opening atS is earlier (the kayak pair at the start)
//   - the opening round, in its order, each at its atS (less its leadS, ± its seeded jitter), with GAP_S of plain sailing after
//     the act before it (its gapAfterS when it sets one); it plays once per session (sessionStorage), a returning player in the
//     same tab goes straight to the random pool
//   - then the random pool: an act every RANDOM_S after the last one ended (× CRUISE_K in Cruise: longer gaps), weighted, each
//     after its cooldown, never the same twice in a row (unless it is the only act this device has), never two at once
//   - busy (tacking, docking, a knockdown warning, the chart open, a kayaker by the boat): a due act waits up to WAIT_S, then
//     it is skipped (an opening act goes to the random pool)
//   - skipped where its feature(...) is off (a phone: no Tessie, no dive: the kayaks only); off in a race and in a capture
//     unless ?stage=<id> pins an act (then that act alone; ?stage=off: none)
//   - the next act's code and assets preloaded in the gap before it, never before the first step, one load at a time
//
//   const d = createStageDirector({ acts, seed, isOn, ctx, busy, race, cruise, pin, enabled, storage, overrides })
//     isOn(feature) → bool (src/core/features.js feature(name).on); ctx: what the act modules read (start(ctx), plus the act,
//     opening, durationS, rand); busy() → a reason string or null; race(), cruise() → bool; pin: null | 'off' | an act id;
//     enabled: false keeps it off (a capture without a pin); storage: sessionStorage or a stand-in; overrides: { [id]: { atS } };
//     near(areaId, withinM) → bool: the boat inside that area (v2/stage/areas.js) or within withinM of its edge (an act's nearby row)
//   d.step(dt, { playing })   each sim frame on the living clock (play time counts only while `playing`)
//   d.state                   { t, on, phase ('opening' | 'random' | 'off'), active, next }
//   d.timeline                [{ t, id, ev ('start' | 'end' | 'wait' | 'skip' | 'load'), why? }]
//   d.budget()                { deskMs, phoneMs } of the act on stage (0 with none)
//   d.stop()                  the act on stage off now (a mode change)
//   d.quiet(s)                a birthplace's move: the act on stage off, nothing new for s of play (BIRTH.quietS 15)
import { ACTS } from './acts.js';

export const STAGE = Object.freeze({
  QUIET_S: 15,          // s of play with nothing on stage (the player gets the boat and the view first)
  GAP_S: 30,            // s of plain sailing between acts (the opening's)
  RANDOM_S: [60, 150],  // s from one act's end to the next random act
  CRUISE_K: 2,          // Cruise: the random gaps this much longer
  WAIT_S: 20,           // s a due act waits while the player is busy, then it is skipped
  RACE_GAP_S: 30,       // s after a race before an act
  RETRY_S: 20,          // s before the pool is tried again after an act could not start (no spot, nothing on)
  OVER_S: 60,           // s past an act's longest time before it is stopped
  SESSION_KEY: 'velia.stage.opening',
});

// a seeded hash in [0, 1) (the same seed, the same stage)
function hash01(seed, k) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const sessionGet = (s, k) => { try { return s?.getItem?.(k) ?? null; } catch { return null; } };
const sessionSet = (s, k, v) => { try { s?.setItem?.(k, v); } catch { /* a private window: the opening plays again */ } };

export function createStageDirector({ acts = ACTS, seed = 1, isOn = () => true, ctx = {}, busy = () => null, race = () => false, cruise = () => false,
  pin = null, enabled = true, storage = null, overrides = {}, near = () => false, S = STAGE } = {}) {
  const on = pin === 'off' ? false : !!pin || !!enabled;
  const cast = acts.filter((a) => (!pin || a.id === pin) && (!a.feature || isOn(a.feature)));
  const timeline = [];
  let quietUntil = -Infinity;
  let t = 0, k = 0, active = null, last = null, lastEndT = -Infinity, lastGapAfter = 0, waitS = 0, waitFor = null, raceUntil = -Infinity, wasRace = false;
  const ended = new Map();   // id → the play time it last left the stage (its cooldown counts from there)
  // an act's random row now: its nearby row over it while the boat is near that area (Tessie by her water: more often)
  const rowOf = (x) => (x.nearby && near(x.nearby.area, x.nearby.withinM) ? { ...x.random, ...x.nearby } : x.random);
  const coolEnd = (x) => (ended.get(x.id) ?? -Infinity) + (rowOf(x)?.cooldownS ?? 0);
  const rnd = () => hash01(seed, ++k);
  // the opening: the acts with one, in order, unless this tab has had it (a pinned act always opens)
  const opened = !pin && sessionGet(storage, S.SESSION_KEY) === '1';
  const opening = opened ? [] : cast.filter((a) => a.opening).sort((a, b) => a.opening.order - b.opening.order).map((a) => {
    const o = { ...a.opening, ...(overrides[a.id] ?? {}) }, jit = overrides[a.id]?.atS != null ? 0 : (o.jitterS ?? 0);
    return { act: a, at: Math.max(0, o.atS - (o.leadS ?? 0) + (rnd() * 2 - 1) * jit), gapAfter: o.gapAfterS ?? S.GAP_S, quietOk: o.atS < S.QUIET_S };
  });
  let phase = !on || !cast.length ? 'off' : opening.length ? 'opening' : 'random';
  const gapK = () => (cruise() ? S.CRUISE_K : 1);
  // the pool's gap: an act's nearby gapS while its area is near (the shortest), else RANDOM_S; × CRUISE_K in Cruise
  const gapRow = () => { let g = S.RANDOM_S; for (const x of cast) if (x.nearby?.gapS && near(x.nearby.area, x.nearby.withinM) && x.nearby.gapS[1] < g[1]) g = x.nearby.gapS; return g; };
  const randomGap = () => { const g = gapRow(); return (g[0] + (g[1] - g[0]) * rnd()) * gapK(); };
  let nextAt = phase === 'random' ? Math.max(S.QUIET_S, randomGap()) : null;
  let pick = null;   // the random act chosen for nextAt (chosen early so its load can run in the gap)
  // preload: one load at a time, never before the first step
  let loading = null;
  const loaded = new Set();
  const loads = [];
  function preload(a) {
    if (!a || !a.load || loaded.has(a.id) || loading) return;
    loading = a.id; loads.push({ t: +t.toFixed(2), id: a.id }); log(a.id, 'load');
    let p; try { p = Promise.resolve(a.load()); } catch (e) { p = Promise.reject(e); }
    p.then(() => loaded.add(a.id), () => {}).finally(() => { if (loading === a.id) loading = null; });
  }
  function log(id, ev, why) { timeline.push(why ? { t: +t.toFixed(2), id, ev, why } : { t: +t.toFixed(2), id, ev }); if (timeline.length > 400) timeline.shift(); }
  const persistOpening = () => { if (!pin) sessionSet(storage, S.SESSION_KEY, '1'); };

  function chooseRandom() {
    const pool = cast.filter((x) => x.random), only = pool.length === 1;
    // never the same twice in a row (unless it is the only one, or its nearby row says repeat: Tessie in her own water)
    const fresh = pool.filter((x) => only || x.id !== last?.id || rowOf(x).repeat);
    const ready = fresh.filter((x) => coolEnd(x) <= nextAt);
    if (!ready.length) {   // all cooling: the earliest cooldown's end (still a full gap after the last act)
      if (fresh.length) nextAt = Math.max(nextAt, Math.min(...fresh.map(coolEnd)));
      return null;
    }
    const sum = ready.reduce((s, x) => s + rowOf(x).weight, 0);
    let r = rnd() * sum;
    for (const x of ready) { r -= rowOf(x).weight; if (r <= 0) return x; }
    return ready[ready.length - 1];
  }
  function begin(a, isOpening) {
    const c = { ...ctx, act: a, opening: isOpening, durationS: a.durationS, rand: rnd() };
    let h = null;
    try { h = a.start ? a.start(c) : null; } catch (e) { h = null; log(a.id, 'skip', `error: ${e?.message ?? e}`); }
    if (!h) { log(a.id, 'skip', 'cannot start'); return false; }
    active = { act: a, h, at: t, opening: isOpening, gapAfter: isOpening ? (opening.find((o) => o.act === a)?.gapAfter ?? S.GAP_S) : S.GAP_S };
    if (h.result === undefined && h.done?.then) h.done.then((r) => { if (h.result === undefined) h.result = r ?? 'played'; });
    log(a.id, 'start');
    return true;
  }
  function finish(result) {
    const a = active.act, shown = result !== 'skipped' && result !== 'deferred';
    log(a.id, 'end', result);
    if (shown) { lastEndT = t; last = a; lastGapAfter = active.gapAfter; }
    ended.set(a.id, t);
    active = null;
    if (phase === 'random') { nextAt = Math.max(t + (shown ? randomGap() : S.RETRY_S), S.QUIET_S); pick = null; }
  }
  function endOpening() { phase = 'random'; persistOpening(); nextAt = Math.max(S.QUIET_S, (Number.isFinite(lastEndT) ? lastEndT : t) + randomGap()); pick = null; }

  const self = {
    get state() { return { t: +t.toFixed(2), on, phase, active: active?.act.id ?? null, next: phase === 'opening' ? opening[0]?.act.id ?? null : pick?.id ?? null, nextAt: phase === 'random' ? (nextAt == null ? null : +nextAt.toFixed(2)) : phase === 'opening' ? +(opening[0]?.at ?? 0).toFixed(2) : null, cast: cast.map((a) => a.id), loads: loads.slice() }; },
    timeline,
    budget() { return active ? { ...active.act.budget } : { deskMs: 0, phoneMs: 0 }; },
    stop() { if (active) { active.h.stop?.(); finish('stopped'); } },
    // a birthplace's move: the act on stage stops (it was where she was) and nothing new starts for s of play;
    // then the opening goes on where it was or the pool, as before (the opening is never replayed)
    quiet(s = S.QUIET_S) { if (active) { active.h.stop?.(); finish('stopped'); } quietUntil = Math.max(quietUntil, t + s); waitFor = null; waitS = 0; log('stage', 'quiet', `${s} s`); },
    step(dt, { playing = true } = {}) {
      if (phase === 'off' || !playing || !(dt > 0)) return self.state;
      t += dt;
      // a race: nothing new on stage (an act on stage runs out: Tessie dives, the kayaks and the birds are cut), a gap after it
      if (race()) { wasRace = true; if (active) { active.h.step?.(dt); if (active.h.result !== undefined) finish(active.h.result); } return self.state; }
      if (wasRace) { wasRace = false; raceUntil = t + S.RACE_GAP_S; }
      if (active) {
        active.h.step?.(dt);
        if (active.h.result === undefined && t - active.at > (active.act.durationS?.[1] ?? 60) + S.OVER_S) { active.h.stop?.(); if (active.h.result === undefined) active.h.result = 'stopped'; }
        if (active.h.result !== undefined) finish(active.h.result);
        return self.state;
      }
      // the next act and when
      let a = null, due = Infinity, isOpening = phase === 'opening';
      if (isOpening) {
        const o = opening[0];
        a = o.act;
        due = Math.max(o.at, lastEndT + lastGapAfter, o.quietOk ? 0 : S.QUIET_S);
      } else {
        if (!pick) pick = chooseRandom();
        a = pick; due = nextAt;
        if (!a) return self.state;
      }
      due = Math.max(due, raceUntil, quietUntil);
      preload(a);   // in the gap before it (a load runs alone)
      if (t < due) return self.state;
      // busy: wait up to WAIT_S, then skip
      const why = busy();
      if (why) {
        if (waitFor !== a.id) { waitFor = a.id; waitS = 0; log(a.id, 'wait', why); }
        waitS += dt;
        if (waitS <= S.WAIT_S) return self.state;
        log(a.id, 'skip', `busy: ${why}`);
        waitFor = null; waitS = 0;
        if (isOpening) { opening.shift(); if (!opening.length) endOpening(); }
        else { ended.set(a.id, t - Math.max(0, (rowOf(a)?.cooldownS ?? 0) - S.RANDOM_S[0])); nextAt = t + S.RETRY_S; pick = null; }
        return self.state;
      }
      waitFor = null; waitS = 0;
      const ok = begin(a, isOpening);
      if (isOpening) { opening.shift(); if (!opening.length && !ok) endOpening(); }
      else if (!ok) { nextAt = t + S.RETRY_S; pick = null; }
      if (ok && isOpening && !opening.length) { persistOpening(); phase = 'random'; nextAt = null; pick = null; }
      return self.state;
    },
  };
  // the opening's last act on stage → the random pool's first gap counts from its end (finish sets nextAt while phase is random)
  return self;
}
