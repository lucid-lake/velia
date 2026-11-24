// The race state machine (§ 5): pre-start → the gun → legs → finish, for any number of boats. PURE: no DOM, no
// wall clock, no randomness; the caller passes each tick's step and every boat's pose. It never reads a boat's physics.
//
//   const race = createRace({ course, boats: [{ id, kind: 'player' | 'ai' | 'remote', name, sail }], marks: () => ({ W: { x, z }, ... }) });
//   const events = race.step(dt, { player: { x, z, heading, u }, rival: { ... } }, { windFrom });   // each tick
//   race.touch(id, 'mark' | 'boat')        // a contact gives the boat at fault one 360° turn
//   race.reset()                            // R: back to -60 s, in place
//   race.clock                              // s; < 0 before the gun
// Events ({ type, ... }): horn { n, long } · flag { up: [...] } · tick { s } · gun · ocs { id } · ocsClear { id } · started { id, delayS }
//   rounded { id, mark, t, place, close? } · wrongSide { id, mark } · gap { leader, trailer, mark, s, m } · penalty { id, rule } ·
//   turnDone { id } · roundingHeld { id, mark } · finished { id, t, place } · over { order }.
import { CourseTracker } from '../marks/course.js';
import { trackerCourse } from './course.js';
import { crossing, side, isOver } from './line.js';
import { progressM, rank, GapLog, distToNext } from './progress.js';

const PRESTART_S = 60;
export const RULES = { hullM: 8, turnS: 60, pairGapS: 10 };
const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const KN = 0.514444;

// who gives way when two boats meet: port gives way to starboard; on the same tack the windward boat
// gives way to the leeward one. a, b: { x, z, heading }. Returns the id-index (0 or 1) of the boat at fault, with the rule.
export function atFault(a, b, windFrom) {
  const tack = (s) => (wrap(windFrom - s.heading) > 0 ? 'stbd' : 'port');
  const ta = tack(a), tb = tack(b);
  if (ta !== tb) return { fault: ta === 'port' ? 0 : 1, rule: 'port and starboard' };
  const up = [Math.sin(windFrom), -Math.cos(windFrom)];
  const wa = a.x * up[0] + a.z * up[1], wb = b.x * up[0] + b.z * up[1];
  return { fault: wa > wb ? 0 : 1, rule: 'windward and leeward' };
}

// meetM: the centre distance a meeting is judged at (v1's 8 m; v2's fleet passes 0 and judges real hull contact through touch(): with 6
// boats two lanes 8 m apart were a turn every start); turnS: the time a 360 must close in (v1's 60 s; a keelboat's turn on v2's fleet
// physics takes 55–90 s)
// tracker: (trackerCourse, { positions }) → a mark tracker with the CourseTracker's api (v2's game rounding, v2/regatta/rounding.js);
// absent or null: the CourseTracker (the real rule: v1, and v2's Pro)
export function createRace({ course, boats, marks = null, prestartS = PRESTART_S, forgiving = false, meetM = RULES.hullM, turnS = RULES.turnS, tracker = null } = {}) {   // forgiving (Easy): no turns owed for a touch or a meeting; the rest of the rules stand
  const liveMarks = marks ?? (() => {
    const P = Object.fromEntries(course.marks.map((m) => [m.id, { x: m.at[0], z: m.at[1] }]));
    P.committee = { x: course.line.committee[0], z: course.line.committee[1] }; P.pin = { x: course.line.pin[0], z: course.line.pin[1] };
    return P;
  });
  const gaps = new GapLog();
  let clock, phase, B, sent, done;
  const L = course.line, F = course.finish ?? null;   // F: a place race's own finish line (crossed the way of its `up`), else the start line back

  function fresh() {
    clock = -prestartS; phase = 'prestart'; sent = new Set(); done = false;
    B = new Map(boats.map((b) => [b.id, { ...b, status: 'prestart', ocs: false, wasOcs: false, startedAt: null, delayS: null, leg: 0, splits: [], finishedAt: null, place: null,
      prev: null, topU: 0, penalty: null, turns: 0, held: false, tracker: tracker ? tracker(trackerCourse(course), { positions: liveMarks }) : new CourseTracker(trackerCourse(course), { positions: liveMarks }), lastHeading: null, faults: [] }]));
    gaps.log.clear();
  }
  fresh();

  function step(dt, poses, { windFrom = (course.designWindFrom * Math.PI) / 180 } = {}) {
    const ev = []; if (done) return ev;
    const prevClock = clock; clock += dt;
    // ---- the sequence ----
    const at = (s, f) => { if (!sent.has(s) && prevClock < s && clock >= s) { sent.add(s); f(); } };
    if (phase === 'prestart') {
      if (!sent.has('open')) { sent.add('open'); ev.push({ type: 'horn', n: 1, long: false }, { type: 'flag', up: ['class'] }); }
      at(-30, () => ev.push({ type: 'horn', n: 1, long: false }, { type: 'flag', up: ['class', 'P'] }));
      for (let s = -5; s <= -1; s++) at(s, () => ev.push({ type: 'tick', s: -s }));
      at(0, () => { phase = 'racing'; ev.push({ type: 'horn', n: 1, long: true }, { type: 'flag', up: [] }, { type: 'gun' }); });
    }
    // ---- each boat ----
    for (const b of B.values()) {
      const p = poses[b.id]; if (!p) continue;
      const prev = b.prev ?? [p.x, p.z]; b.prev = [p.x, p.z];
      b.topU = Math.max(b.topU, p.u ?? 0);
      if (b.lastHeading != null && b.penalty && !b.penalty.done) {
        b.penalty.turn += wrap(p.heading - b.lastHeading);
        if (clock - b.penalty.since > turnS) { b.penalty.since = clock; b.penalty.turn = 0; }
        if (Math.abs(b.penalty.turn) >= TAU) { b.penalty.done = true; b.penalty = null; b.turns++; ev.push({ type: 'turnDone', id: b.id }); }
      }
      b.lastHeading = p.heading;
      if (b.status === 'finished' || b.status === 'dnf') continue;
      const over = isOver(L, p.x, p.z);
      // before the gun: over the line is OCS until the boat dips back (no recall; the plate shows it)
      if (clock < 0) {
        if (over && !b.ocs) { b.ocs = true; ev.push({ type: 'ocs', id: b.id, early: true }); }
        else if (!over && b.ocs) { b.ocs = false; ev.push({ type: 'ocsClear', id: b.id }); }
        continue;
      }
      if (prevClock < 0 && over && !b.ocs) { b.ocs = true; ev.push({ type: 'ocs', id: b.id }); }
      else if (prevClock < 0 && b.ocs && over) ev.push({ type: 'ocs', id: b.id, atGun: true });
      if (b.status === 'prestart') b.status = b.ocs ? 'ocs' : 'behind';
      const x = crossing(L, prev, [p.x, p.z], b.status === 'racing' ? 0.3 : 99);   // the start counts anywhere along the extended line, the finish a little beyond the ends
      if (b.status === 'ocs' && !over) { b.ocs = false; b.status = 'behind'; ev.push({ type: 'ocsClear', id: b.id }); }
      else if (b.status === 'behind' && x?.dir === 'up') {
        b.status = 'racing'; b.startedAt = clock - dt * (1 - x.f); b.delayS = b.startedAt; ev.push({ type: 'started', id: b.id, delayS: b.delayS });
      } else if (b.status === 'racing') {
        // rounding by the CourseTracker, held while a turn is owed
        const k0 = b.tracker.k;
        const out = b.tracker.update({ x: p.x, z: p.z }, clock);
        for (const e of out) {
          if (e.type === 'rounded') {
            if (b.penalty) { b.tracker.k = k0; b.tracker.prev = null; b.tracker.done = false; b.tracker.log.pop(); if (!b.held) { b.held = true; ev.push({ type: 'roundingHeld', id: b.id, mark: e.mark }); } continue; }
            b.held = false; b.leg = b.tracker.k;
            const t = clock - b.startedAt, rounded = [...B.values()].filter((o) => o.splits.some((s) => s.mark === e.mark));
            b.splits.push({ mark: e.mark, t, at: clock, gapS: null });
            ev.push({ type: 'rounded', id: b.id, mark: e.mark, t, place: rounded.length + 1, ...(e.close ? { close: true } : {}) });
            if (rounded.length) {
              const lead = rounded.sort((a, c) => a.splits.find((s) => s.mark === e.mark).at - c.splits.find((s) => s.mark === e.mark).at)[0];
              const g = clock - lead.splits.find((s) => s.mark === e.mark).at;
              b.splits.at(-1).gapS = g; ev.push({ type: 'gap', leader: lead.id, trailer: b.id, mark: e.mark, s: g, m: g * Math.max(p.u ?? 0, 1) });
            }
          } else if (e.type === 'wrongSide') ev.push({ type: 'wrongSide', id: b.id, mark: e.mark });
          else if (e.type === 'gateMissed' || e.type === 'gateWrong') ev.push({ type: e.type, id: b.id, mark: e.mark });   // a place race's gate (v2/regatta/placeTracker.js)
        }
        if (b.tracker.done || b.tracker.k >= b.tracker.seq.length) b.leg = course.legs.length - 1;
        // the finish: all marks rounded, the bow crosses the line toward the pre-start side
        const fx = F ? crossing(F, prev, [p.x, p.z], 0.3) : null, fin = F ? fx?.dir === 'up' : x?.dir === 'down';
        if (b.tracker.k >= b.tracker.seq.length && fin) {
          b.status = 'finished'; b.finishedAt = clock - dt * (1 - (F ? fx.f : x.f)); b.leg = course.legs.length;
          b.place = [...B.values()].filter((o) => o.finishedAt != null).length;
          ev.push({ type: 'finished', id: b.id, t: b.finishedAt, place: b.place });
        }
      }
      if (b.status === 'racing' || b.status === 'finished') gaps.record(b.id, clock, progressM(course, b.leg, p.x, p.z));
    }
    // ---- boats meeting: the boat at fault owes a turn ----
    const ids = [...B.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = poses[ids[i]], c = poses[ids[j]]; if (!a || !c || clock < 0) continue;
      if (Math.hypot(a.x - c.x, a.z - c.z) < meetM) {
        const bi = B.get(ids[i]), bj = B.get(ids[j]);
        if (bi.status === 'finished' || bj.status === 'finished' || bi.status === 'dnf' || bj.status === 'dnf') continue;
        if (forgiving) continue;
        const f = atFault(a, c, windFrom), who = f.fault === 0 ? bi : bj;
        if (!who.penalty && clock - (who.lastFaultAt ?? -1e9) > RULES.pairGapS) { who.lastFaultAt = clock; who.penalty = { rule: f.rule, since: clock, turn: 0, done: false }; ev.push({ type: 'penalty', id: who.id, rule: f.rule }); }
      }
    }
    // ---- the end ----
    const all = [...B.values()];
    if (all.every((b) => b.status === 'finished' || b.status === 'dnf') || (clock > course.timeLimitS)) { done = true; phase = 'finished'; ev.push({ type: 'over', order: order() }); }
    return ev;
  }

  function touch(id, kind = 'mark') {
    const b = B.get(id); if (forgiving || !b || b.penalty || clock < 0 || b.status === 'finished') return null;
    b.penalty = { rule: kind === 'mark' ? 'touching a mark' : 'contact', since: clock, turn: 0, done: false };
    return { type: 'penalty', id, rule: b.penalty.rule };
  }
  // retire(id): out of the race (a place race's second knockdown: v2/regatta/knocks.js); she ranks last, 'dnf'
  function retire(id, why = 'retired') {
    const b = B.get(id); if (!b || b.status === 'finished' || b.status === 'dnf') return null;
    b.status = 'dnf'; b.dnf = why; b.penalty = null;
    return { type: 'retired', id, why };
  }
  const boatsNow = () => [...B.values()].map((b) => ({ id: b.id, finishedAt: b.finishedAt, progressM: b.status === 'dnf' ? -1e9 : gaps.log.get(b.id)?.at(-1)?.[1] ?? 0 }));
  const order = () => rank(boatsNow());
  const view = (id) => { const b = B.get(id); return b && { id: b.id, name: b.name, kind: b.kind, sail: b.sail, status: b.status, ocs: b.ocs, leg: b.leg, nextMark: b.tracker.current, startedAt: b.startedAt, delayS: b.delayS,
    finishedAt: b.finishedAt, place: b.place, splits: b.splits.map((s) => ({ ...s })), owes: !!b.penalty, turns: b.turns, topKn: b.topU / KN, progressM: gaps.log.get(id)?.at(-1)?.[1] ?? 0, target: b.tracker.target(), guide: b.tracker.guide ?? null }; };

  return {
    step, touch, retire, reset: fresh, view, order,
    get clock() { return clock; }, get phase() { return phase; }, get done() { return done; }, course,
    get ids() { return [...B.keys()]; }, forgiving,
    // the live gap of `id` behind the leader, in seconds (0 for the leader), and the metres of progress between them
    liveGap(id) { const o = order(), lead = o[0]; if (id === lead || !gaps.log.get(id)) return { s: 0, m: 0, leader: lead }; const p = gaps.log.get(id).at(-1)[1], m = (gaps.log.get(lead)?.at(-1)?.[1] ?? 0) - p; return { s: gaps.gapS(lead, p, clock), m, leader: lead }; },
    distToNext(id, pose) { const b = B.get(id); return b ? distToNext(course, b.leg, pose.x, pose.z) : 0; },
  };
}
