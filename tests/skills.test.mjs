// node --test tests/skills.test.mjs — Day Sail's skill model (src/sail/skills.js): each skill's
// "mastered" and "struggling" detectors on scripted state and input streams, positives and negatives; the pro path;
// the save; the assist fade; and the hints (src/ui/controlsHint.js) driven by the model on a small DOM stub: a newbie
// gets the right lines in order, a pro gets none and is silenced inside 60 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkills, RULES, PRO, NET, SKILL_IDS } from '../src/sail/skills.js';
import { install, key } from './helpers/dom-stub.mjs';

const DEG = Math.PI / 180, KN = 0.514444;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
// a boat sailing well: a close reach, port tack (wind from port: twa < 0), full sails, moving
const BASE = { twa: -60 * DEG, tws: 5, awa: -40 * DEG, sog: 2.8, heading: 0, heel: 0.2, mainFill: 1, mainStall: 0, boomAngle: 25 * DEG,
  surf: 0, roundUp: 0, groove: 0, level: 3, steer: 0, pull: 0, crew: false, gust: null };
// run f(t) → partial sample for dur s at dt; returns { sk, log: [{ t, why }] } with the first t each skill mastered
function run(f, dur, { dt = 1 / 30, sk = createSkills(), t0 = 0, watch = [] } = {}) {
  const firstMastered = {}, firstWhy = {};
  for (let t = t0; t < t0 + dur - 1e-9; t += dt) {
    sk.update(dt, { ...BASE, ...f(t) });
    for (const id of SKILL_IDS) {
      if (sk.mastered(id) && firstMastered[id] == null) firstMastered[id] = +t.toFixed(2);
      const w = sk.struggling(id); if (w && !firstWhy[id]) firstWhy[id] = { why: w, t: +t.toFixed(2) };
    }
  }
  return { sk, mastered: firstMastered, why: firstWhy };
}
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

// ---- steering ----
test('steering: a course turned onto and held 20 s is mastered; never steering is "idle" by 30 s', () => {
  // turn 15° in 1.5 s with the helm, then hold it
  const h = (t) => (t < 1 ? 0 : t < 2.5 ? (t - 1) * 10 * DEG : 15 * DEG);
  const r = run((t) => ({ heading: h(t), steer: t >= 1 && t < 2.5 ? 1 : 0, pull: t < 1 ? 1 : 0 }), 25);
  assert.ok(r.mastered.steering >= 21 && r.mastered.steering <= 23, `mastered at ${r.mastered.steering}`);
  // never steered: the pilot holds the start's course; not mastered (no course was chosen), and idle by 30 s
  const n = run(() => ({}), 31);
  assert.equal(n.mastered.steering, undefined);
  assert.equal(n.why.steering.why, 'idle'); assert.ok(Math.abs(n.why.steering.t - 30) < 0.3, `idle at ${n.why.steering.t}`);
  // the sails set first (a sheet key, then 2 s full): idle after 8 s
  const n2 = run((t) => ({ pull: t < 0.5 ? 1 : 0 }), 10);
  assert.equal(n2.why.steering.why, 'idle'); assert.ok(n2.why.steering.t >= 8 && n2.why.steering.t < 8.4, `idle at ${n2.why.steering.t}`);
});

test('steering: wandering ±15° after the turn is not mastered; a zig-zag and a circle are struggles', () => {
  const wander = run((t) => ({ heading: 15 * DEG * Math.sin(t / 3), steer: t < 2 ? 1 : 0 }), 40);
  assert.equal(wander.mastered.steering, undefined, 'a wandering course is not "held"');
  // zig-zag: the helm hard over each way every 1.2 s, the heading swinging ±12°
  const zz = run((t) => ({ steer: Math.floor(t / 1.2) % 2 ? 1 : -1, heading: 12 * DEG * Math.sin(t * Math.PI / 1.2) }), 12);
  assert.equal(zz.why.steering?.why, 'zigzag'); assert.equal(zz.mastered.steering, undefined);
  // circles: the helm held over, 8°/s
  const ci = run((t) => ({ steer: 1, heading: wrap(t * 8 * DEG) }), 50);
  assert.equal(ci.why.steering?.why, 'circles'); assert.ok(ci.why.steering.t >= 45 && ci.why.steering.t <= 46, `circles at ${ci.why.steering.t}`);
  // one clean turn is no struggle
  const one = run((t) => ({ steer: t < 1.5 ? 1 : 0, heading: Math.min(t, 1.5) * 10 * DEG }), 20);
  assert.equal(one.why.steering, undefined);
});

// ---- sail trim ----
test('trim: full ≥ 70 % of 60 s with the player trimming is mastered; luffing half the time, or the crew, is not', () => {
  const r = run((t) => ({ pull: t > 1 && t < 2 ? 1 : 0 }), 64);
  assert.ok(r.mastered.trim >= 61 && r.mastered.trim <= 63, `trim at ${r.mastered.trim}`);
  const half = run((t) => ({ pull: t > 1 && t < 2 ? 1 : 0, mainFill: Math.floor(t / 5) % 2 ? 0.3 : 1 }), 90);
  assert.equal(half.mastered.trim, undefined, '50 % full');
  const crew = run((t) => ({ pull: t > 1 && t < 2 ? 1 : 0, crew: t > 30 && t < 32 }), 90);
  assert.ok(crew.mastered.trim == null || crew.mastered.trim > 92, 'the crew\'s net in the window spoils it');
  const hands = run(() => ({}), 90);
  assert.equal(hands.mastered.trim, undefined, 'never touched a sheet: the crew\'s trim is not the player\'s');
});

test('trim struggling: the first luff speaks after 1.5 s; after a sheet key, luffing or stalled > 10 s', () => {
  const first = run(() => ({ mainFill: 0.3 }), 3);
  assert.equal(first.why.trim.why, 'luff'); assert.ok(first.why.trim.t > 1.4 && first.why.trim.t < 1.6, `luff at ${first.why.trim.t}`);
  const later = run((t) => ({ pull: t < 0.5 ? 1 : 0, mainFill: t > 2 ? 0.3 : 1 }), 11.9);
  assert.equal(later.why.trim, undefined, '9.9 s of luff after the hand touched a sheet: not yet');
  const later2 = run((t) => ({ pull: t < 0.5 ? 1 : 0, mainFill: t > 2 ? 0.3 : 1 }), 13);
  assert.equal(later2.why.trim.why, 'luff');
  const stall = run((t) => ({ pull: t < 0.5 ? 1 : 0, mainStall: t > 2 ? 0.9 : 0 }), 13);
  assert.equal(stall.why.trim.why, 'stall');
  // a run (the main a flat plate by nature): no stall struggle abaft 80°
  const run2 = run((t) => ({ pull: t < 0.5 ? 1 : 0, mainStall: 0.9, awa: -150 * DEG, twa: -160 * DEG }), 20);
  assert.equal(run2.why.trim, undefined);
  // head to wind: not the sheets' fault (the no-go zone's)
  const irons = run(() => ({ mainFill: 0.1, twa: -20 * DEG, sog: 0.3 }), 15);
  assert.equal(irons.why.trim, undefined); assert.equal(irons.why.nogo.why, 'head');
  const crew = run(() => ({ mainFill: 0.3, crew: true }), 15);
  assert.equal(crew.why.trim, undefined, 'the crew trimming');
});

// ---- the no-go zone ----
test('no-go: close-hauled 30 s, full and moving, is mastered; head to wind > 8 s is a struggle', () => {
  const r = run(() => ({ twa: -45 * DEG }), 32);
  assert.ok(r.mastered.nogo >= 29.9 && r.mastered.nogo <= 30.2, `nogo at ${r.mastered.nogo}`);
  assert.equal(run(() => ({ twa: -60 * DEG }), 40).mastered.nogo, undefined, 'a close reach is not close-hauled');
  assert.equal(run(() => ({ twa: -45 * DEG, mainStall: 0.9 }), 40).mastered.nogo, undefined, 'stalled');
  assert.equal(run(() => ({ twa: -45 * DEG, sog: 1 }), 40).mastered.nogo, undefined, 'pinching, slow');
  assert.equal(run(() => ({ twa: -20 * DEG, sog: 0.3 }), 7.9).why.nogo, undefined);
  const h = run(() => ({ twa: -20 * DEG, sog: 0.3 }), 9).why.nogo; assert.equal(h.why, 'head'); assert.ok(h.t > 7.9 && h.t < 8.1, `head at ${h.t}`);
});

// ---- tacking ----
// a tack at t0: close-hauled −45° → +45° through the wind over `turnS`, the speed dipping to `dip` and back over backS
const tackAt = (t0, { turnS = 4, dip = 1.2, backS = 6, v = 2.8 } = {}) => (t) => {
  if (t < t0) return { twa: -45 * DEG, heading: 0, sog: v };
  const f = Math.min(1, (t - t0) / turnS);
  const sog = t - t0 < turnS ? v - (v - dip) * Math.sin(f * Math.PI / 2) : Math.min(v, dip + (v - dip) * (t - t0 - turnS) / backS);
  return { twa: (-45 + 90 * f) * DEG, heading: 90 * f * DEG, sog, steer: t - t0 < turnS ? 1 : 0 };
};
test('tacking: two clean tacks are mastered; a tack whose speed is not back in 15 s is not clean', () => {
  const two = (t) => (t < 40 ? tackAt(20)(t) : (() => { const r = tackAt(40)(t); return { ...r, twa: -r.twa, heading: 90 * DEG - r.heading }; })());
  const r = run(two, 60);
  assert.ok(r.mastered.tacking > 40 && r.mastered.tacking < 55, `tacking at ${r.mastered.tacking}`);
  assert.equal(r.sk.counts.cleanTacks, 2);
  const slow = run(tackAt(20, { dip: 0.3, backS: 30 }), 60);
  assert.equal(slow.sk.counts.cleanTacks, 0, 'the speed came back after 15 s');
  const one = run(tackAt(20), 50);
  assert.equal(one.sk.counts.cleanTacks, 1); assert.equal(one.mastered.tacking, undefined, 'one clean tack is not two');
});

test('tacking struggling: stopped head to wind mid-tack, the helm in hand, for 3 s', () => {
  // turning up from −45° with the helm, stalls at −15°, stops
  const f = (t) => t < 10 ? { twa: -45 * DEG } : { twa: -Math.max(15, 45 - (t - 10) * 10) * DEG, steer: t < 13 ? 1 : 0, sog: Math.max(0.3, 2.8 - (t - 10) * 0.8), heading: Math.min(30, (t - 10) * 10) * DEG };
  const r = run(f, 20);
  assert.equal(r.why.tacking?.why, 'stuck'); assert.ok(r.why.tacking.t > 13 && r.why.tacking.t < 17, `stuck at ${r.why.tacking.t}`);
  // the same head-to-wind stop with no helm (the pilot drifted up): the no-go zone's struggle, not the tack's
  const drift = run((t) => ({ ...f(t), steer: 0 }), 25);
  assert.equal(drift.why.tacking, undefined); assert.equal(drift.why.nogo?.why, 'head');
});

// ---- gybing ----
const gybeAt = (t0, boomDeg) => (t) => {
  const f = Math.min(1, Math.max(0, (t - t0) / 1.2));
  return { twa: (t < t0 ? 160 : -160) * DEG, awa: (t < t0 ? 160 : -160) * DEG, boomAngle: (boomDeg - 2 * boomDeg * f) * DEG, heading: (t < t0 ? 0 : 40) * DEG };
};
test('gybing: a controlled gybe (the boom swings ≤ 90°: sheeted in) is mastered; two crash gybes are a struggle', () => {
  const ok = run(gybeAt(10, 30), 15);
  assert.ok(ok.mastered.gybing > 10, 'a 60° swing'); assert.equal(ok.sk.counts.crashes, 0);
  const crash = (t) => (t < 20 ? gybeAt(10, 70)(t) : (() => { const r = gybeAt(20, -70)(t); return r; })());
  const c = run(crash, 25);
  assert.equal(c.mastered.gybing, undefined); assert.equal(c.sk.counts.crashes, 2); assert.equal(c.why.gybing?.why, 'crash');
  const one = run(gybeAt(10, 70), 15);
  assert.equal(one.sk.counts.crashes, 1); assert.equal(one.why.gybing, undefined, 'one crash is not yet a struggle');
  // a tack's boom flip (close-hauled) is not a gybe
  const tk = run(tackAt(10), 30); assert.equal(tk.sk.counts.crashes, 0); assert.equal(tk.mastered.gybing, undefined);
});

// ---- reading gusts ----
// a patch on the right from t0 for 12 s; steer for it (or not); the boat enters it at t0 + 8 (when steered)
const patchAt = (t0, { steer = true } = {}) => (t) => {
  if (t < t0) return { gust: { here: 1, left: 1, right: 1 } };
  const enter = steer && t > t0 + 8;
  return { gust: { here: enter ? 1.25 : 1, left: 1, right: t < t0 + 12 ? 1.3 : 1 }, steer: steer && t > t0 + 3.5 && t < t0 + 5 ? 1 : 0 };
};
test('reading gusts: steering into 3 patches is mastered; sailing past 3 is the struggle', () => {
  const into = run((t) => patchAt(Math.floor(t / 20) * 20 + 2)(t), 62);
  assert.ok(into.mastered.gusts > 50, `gusts at ${into.mastered.gusts}`); assert.equal(into.sk.counts.intoN, 3);
  const past = run((t) => patchAt(Math.floor(t / 25) * 25 + 2, { steer: false })(t), 76);
  assert.equal(past.mastered.gusts, undefined); assert.equal(past.sk.counts.missedN, 3); assert.equal(past.why.gusts?.why, 'missed');
  // drifting into a patch without steering for it counts for nothing
  const drift = run((t) => (t < 10 ? patchAt(2, { steer: false })(t) : { gust: { here: 1.3, left: 1, right: 1 } }), 20);
  assert.equal(drift.sk.counts.intoN, 0);
});

// ---- the groove ----
test('the groove: 30 s locked in, in total (saved), is mastered; never in 10 min of sailing is the struggle', () => {
  const store = memStore();
  const a = run((t) => ({ groove: t < 20 ? 0.8 : 0 }), 25, { sk: createSkills({ storage: store }) });
  assert.equal(a.mastered.groove, undefined);
  const b = run((t) => ({ groove: t < 11 ? 0.8 : 0 }), 12, { sk: createSkills({ storage: store }) });
  assert.ok(b.mastered.groove > 9.8 && b.mastered.groove < 10.3, `the total carries over the save: ${b.mastered.groove}`);
  const never = run(() => ({}), 601, { dt: 0.25 });
  assert.equal(never.why.groove?.why, 'never'); assert.ok(never.why.groove.t >= 599.5, `never at ${never.why.groove.t}`);
  const some = run((t) => ({ groove: t < 5 ? 0.8 : 0 }), 650, { dt: 0.25 });
  assert.equal(some.why.groove, undefined, 'it found the groove once');
});

// ---- heavy air ----
const blow = (t0) => (t) => ({ level: 4, tws: t < t0 ? 9 : 11.5 });
test('heavy air: a level-4 gust and no round-up for 15 s is mastered; two round-ups are the struggle', () => {
  const r = run(blow(15), 32);
  assert.ok(r.mastered.heavy > 29 && r.mastered.heavy < 31, `heavy at ${r.mastered.heavy}`);
  const rounds = run((t) => ({ ...blow(15)(t), roundUp: (t > 18 && t < 22) || (t > 40 && t < 44) ? 1 : 0 }), 45);
  assert.equal(rounds.mastered.heavy, undefined); assert.equal(rounds.why.heavy?.why, 'roundup'); assert.equal(rounds.sk.counts.roundUps, 2);
  const light = run((t) => ({ level: 2, tws: t < 15 ? 4 : 5 }), 40);
  assert.equal(light.mastered.heavy, undefined, 'a light-air gust is not heavy air');
  assert.equal(run((t) => ({ level: 3, tws: t < 15 ? 8 : 10 }), 40).mastered.heavy, undefined, 'a level-3 gust past 18 kn is not level-4 heavy air');
});

// ---- wind shifts (pro) and surfing (pro) ----
test('wind shifts: three tacks right after a header are mastered; tacks in a steady wind are not', () => {
  // the wind from north (0°); leg k close-hauled at sgn·45° (port first: twa −45°), a tack every 90 s at T_k = 85 + 90k.
  // shift: 10 s before each tack the wind heads that leg by 6° (toward its bow), and goes back 15 s after the tack.
  const seq = (shift) => (t) => {
    const k = Math.floor((t + 5) / 90), T = 85 + 90 * k, sgn = k % 2 ? -1 : 1, prevSgn = -sgn;
    const W = shift ? (t >= T - 10 ? sgn * 6 : t < T - 90 + 15 && k > 0 ? prevSgn * 6 : 0) * DEG : 0;
    let H = sgn * 45 * DEG, steer = 0, sog = 2.8;
    if (t >= T) { const f = Math.min(1, (t - T) / 4); H = sgn * (45 - 90 * f) * DEG; steer = f < 1 ? -sgn : 0; const r = tackAt(T)(t); sog = r.sog; }
    return { heading: H, twa: wrap(W - H), steer, sog };
  };
  const r = run(seq(true), 3 * 90 + 2, { dt: 1 / 20 });
  assert.equal(r.sk.counts.cleanTacks, 3);
  assert.equal(r.sk.counts.headers, 3); assert.ok(r.mastered.shifts > 0);
  const steady = run(seq(false), 3 * 90 + 2, { dt: 1 / 20 });
  assert.equal(steady.sk.counts.cleanTacks, 3);
  assert.equal(steady.sk.counts.headers, 0); assert.equal(steady.mastered.shifts, undefined);
  assert.equal(r.why.shifts, undefined, 'no hint: the pod teaches');
});
test('surfing: three bursts are mastered; two are not; no hint', () => {
  const r = run((t) => ({ surf: [3, 8, 13].some((a) => t > a && t < a + 1.5) ? 0.8 : 0 }), 16);
  assert.ok(r.mastered.surfing > 13); assert.equal(r.why.surfing, undefined);
  assert.equal(run((t) => ({ surf: [3, 8].some((a) => t > a && t < a + 1.5) ? 0.8 : 0 }), 16).mastered.surfing, undefined);
  // one long surf is one burst
  assert.equal(run((t) => ({ surf: t > 2 ? 0.8 : 0 }), 30).sk.counts.bursts, 1);
});

// ---- the pro ----
// a competent first minute: W at 0.4 s, head up 12° at 1–2.2 s and hold, a tack at 26 s
function proStream(t) {
  const pull = t > 0.4 && t < 1.2 ? 1 : 0;
  if (t < 26) { const h = t < 1 ? 0 : t < 2.2 ? -(t - 1) * 10 * DEG : -12 * DEG; return { pull, heading: h, steer: t >= 1 && t < 2.2 ? -1 : 0, twa: (-57 - h / DEG) * DEG }; }
  const r = tackAt(26)(t); return { ...r, heading: -12 * DEG + r.heading, steer: r.steer };
}
test('the pro: steering, trim and a clean tack inside 60 s silence every hint (saved)', () => {
  const store = memStore();
  const sk = createSkills({ storage: store });
  let proAt = null;
  sk.onChange((e) => { if (e.type === 'pro') proAt = sk.t; });
  run(proStream, 60, { sk });
  assert.ok(proAt != null && proAt < PRO.withinS, `pro at ${proAt}`);
  assert.ok(sk.muted); assert.deepEqual(sk.needs(), []);
  // even while luffing and head to wind afterwards
  run(() => ({ mainFill: 0.2, twa: -10 * DEG, sog: 0.2 }), 20, { sk, t0: 60 });
  assert.deepEqual(sk.needs(), []);
  assert.ok(createSkills({ storage: store }).muted, 'the next visit is quiet too');
  // the same sailing a minute late is no pro (the struggles still speak)
  const late = createSkills();
  run(() => ({ mainFill: 1 }), 30, { sk: late });
  run((t) => proStream(t - 30), 60, { sk: late, t0: 30 });
  assert.equal(late.pro, false);
  // no tack: no pro
  const noTack = createSkills(); run((t) => proStream(Math.min(t, 25)), 60, { sk: noTack }); assert.equal(noTack.pro, false);
});

test('"I sail" mutes the newbie hints and is saved; the needs list keeps its priority', () => {
  const store = memStore(), sk = createSkills({ storage: store });
  run(() => ({ mainFill: 0.3 }), 3, { sk });
  assert.deepEqual(sk.needs().map((n) => n.hint), ['pull']);
  sk.setISail(true); assert.deepEqual(sk.needs(), []); assert.ok(createSkills({ storage: store }).iSail);
  sk.setISail(false);
  // head to wind and luffing: the no-go line first (it outranks the sheets); mid-tack stuck outranks both
  const b = createSkills(); run(() => ({ mainFill: 0.3, twa: -20 * DEG, sog: 0.3 }), 9, { sk: b });
  assert.equal(b.needs()[0].hint, 'irons');
  // a mastered skill silences its line forever
  const c = createSkills({ storage: memStore() }); run((t) => ({ pull: t > 1 && t < 2 ? 1 : 0 }), 64, { sk: c });
  run(() => ({ mainFill: 0.3 }), 15, { sk: c, t0: 64 }); assert.equal(c.struggling('trim'), 'luff'); assert.ok(!c.needs().some((n) => n.skill === 'trim'), 'trim mastered: no sheet line');
});

// ---- the assists fade ----
test('the crew\'s net: 12 s, 25 s once trim is mastered, off once the groove is too; the player\'s setting wins', () => {
  const sk = createSkills({ storage: memStore() });
  assert.equal(sk.netAfter, NET.start);
  run((t) => ({ pull: t > 1 && t < 2 ? 1 : 0 }), 64, { sk });
  assert.ok(sk.mastered('trim')); assert.equal(sk.netAfter, 25);
  run(() => ({ groove: 0.8 }), 31, { sk, t0: 64 });
  assert.ok(sk.mastered('groove')); assert.equal(sk.netAfter, Infinity);
  // set explicitly: 12 s stays 12 s whatever the skill
  const p = createSkills({ storage: memStore() });
  assert.equal(p.cycleNet(), 12); run((t) => ({ pull: t > 1 && t < 2 ? 1 : 0 }), 64, { sk: p });
  assert.ok(p.mastered('trim')); assert.equal(p.netAfter, 12);
  assert.equal(p.cycleNet(), 25); assert.equal(p.cycleNet(), 'off'); assert.equal(p.netAfter, Infinity); assert.equal(p.cycleNet(), 'auto'); assert.equal(p.netAfter, 25);
  // the pilot: unset by default, a saved setting once chosen
  const store = memStore(), q = createSkills({ storage: store }); assert.equal(q.pilot, null); q.setPilot(false); assert.equal(createSkills({ storage: store }).pilot, false);
});

test('the save survives a corrupt store and a throwing one', () => {
  const bad = { getItem: () => '{not json', setItem: () => { throw new Error('full'); }, removeItem() {} };
  const sk = createSkills({ storage: bad });
  run(() => ({ twa: -45 * DEG }), 32, { sk });
  assert.ok(sk.mastered('nogo'), 'mastered in memory');
  const thrower = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.doesNotThrow(() => createSkills({ storage: thrower }).setISail(true));
});

// ---- the hints, driven by the model (controlsHint.js on a DOM stub) ----
// A toy boat for the hint flow: the helm turns it 10°/s; head to wind (|twa| < 32°) it stops; the sheet starts eased
// (the sails luffing) and fills after 1 s of W.
async function hintRun(script, dur, { dt = 1 / 30 } = {}) {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const sk = createSkills();
  const boat = { heading: 0, from: -57 * DEG, sog: 2.8, sheetS: 0, t: 0 };
  const state = () => {
    const twa = wrap(boat.from - boat.heading);
    return { trueWind: { angle: twa, speed: 5 }, apparentWind: { angle: twa * 0.7, speed: 6 }, sog: boat.sog, heading: boat.heading,
      mainFill: boat.sheetS >= 1 ? 1 : 0.3, mainStall: 0, boomAngle: -Math.sign(twa) * 25 * DEG, heel: 0.2, surf: 0, roundUp: 0, groove: 0 };
  };
  const hint = createControlsHint({ state, skills: sk, once: false, storage: null });
  const seq = []; let mutedAt = null;
  const down = new Set();
  for (let t = 0; t < dur; t += dt) {
    boat.t = t;
    for (const [code, on] of script(t, state()) ?? []) { if (on && !down.has(code)) { down.add(code); key(code, true); } else if (!on && down.has(code)) { down.delete(code); key(code, false); } }
    const steer = (down.has('KeyD') ? 1 : 0) - (down.has('KeyA') ? 1 : 0), pull = (down.has('KeyW') ? 1 : 0) - (down.has('KeyS') ? 1 : 0);
    boat.heading = wrap(boat.heading + steer * 10 * DEG * dt);
    if (pull > 0) boat.sheetS += dt;
    const s = state(), at = Math.abs(s.trueWind.angle);
    boat.sog = at < 32 * DEG ? Math.max(0.2, boat.sog - 0.35 * dt) : Math.min(2.8, boat.sog + 0.4 * dt);
    sk.update(dt, { twa: s.trueWind.angle, tws: 5, awa: s.apparentWind.angle, sog: s.sog, heading: s.heading, heel: 0.2, mainFill: s.mainFill, mainStall: 0,
      boomAngle: s.boomAngle, surf: 0, roundUp: 0, groove: 0, level: 3, steer, pull, crew: false, gust: null });
    hint.update(dt);
    if (hint.current !== (seq.at(-1)?.hint ?? 'none')) seq.push({ hint: hint.current, t: +t.toFixed(1) });
    if (sk.muted && mutedAt == null) mutedAt = +t.toFixed(1);
  }
  hint.dispose();
  return { seq, sk, mutedAt, shown: seq.filter((x) => x.hint !== 'none').map((x) => x.hint) };
}

test('hints: a newbie who does nothing, then flails, gets the lines in order', async () => {
  // nothing for 5 s; W when the pull line shows; then nothing (no helm); then a hard turn up into the wind and hold it
  const r = await hintRun((t, s) => {
    const keys = [];
    keys.push(['KeyW', t > 5 && t < 6.5]);
    keys.push(['KeyA', t > 40 && Math.abs(s.trueWind.angle) > 12 * DEG]);   // the wind is on port: A heads up
    return keys;
  }, 60);
  assert.equal(r.seq[0].hint, 'pull'); assert.ok(r.seq[0].t > 1.4 && r.seq[0].t < 2, `pull at ${r.seq[0].t}`);
  // the skill lines in order: the sails, the helm, then the boat stuck head to wind with the helm in hand (the tack line)
  const order = r.shown.filter((h, i, a) => a.indexOf(h) === i && !['whisper', 'wind', 'look'].includes(h));
  assert.deepEqual(order.slice(0, 2), ['pull', 'steer'], `order ${JSON.stringify(r.seq)}`);
  assert.ok(['tack', 'irons'].includes(order[2]), `then the boat stopped head to wind: ${JSON.stringify(r.seq)}`);
  const steerAt = r.seq.find((x) => x.hint === 'steer').t;
  assert.ok(steerAt > 8 && steerAt < 12, `the helm line 8 s after the sails were set: ${steerAt}`);
  assert.equal(r.mutedAt, null);
});

test('hints: a pro who acts at once never sees a line, and the model silences them inside 60 s', async () => {
  // W at 0.4 s; head up to close-hauled at once and hold; tack at 25 s (a quick turn through the wind), hold
  const r = await hintRun((t, s) => {
    const twa = s.trueWind.angle;
    // the wind on port (twa < 0): A heads up; the tack keeps A on through the wind to close-hauled on starboard
    return [['KeyW', t > 0.4 && t < 1.6], ['KeyA', (t > 0.8 && t < 25 && twa < -46 * DEG) || (t > 25 && t < 40 && (twa < 0 || twa < 45 * DEG))]];
  }, 90);
  assert.deepEqual(r.shown, [], `no hints: ${JSON.stringify(r.seq)}`);
  assert.ok(r.mutedAt != null && r.mutedAt < 60, `silenced at ${r.mutedAt}`);
  assert.ok(r.sk.mastered('steering'));
});

test('hints: holding H, I turns "I sail" on and every line goes quiet', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  const sk = createSkills();
  const s = { trueWind: { angle: -60 * DEG, speed: 5 }, apparentWind: { angle: -40 * DEG }, sog: 2.8, heading: 0, mainFill: 0.3, mainStall: 0, boomAngle: 0.4 };
  const hint = createControlsHint({ state: () => s, skills: sk, once: false, storage: null });
  key('KeyH', true); hint.update(0.1); assert.equal(hint.current, 'keys');
  assert.match(hint.el.innerHTML, /I sail/); assert.match(hint.el.innerHTML, /crew's net/); assert.doesNotMatch(hint.el.innerHTML, /wing-on-wing/, 'the pro rows wait for trim');
  key('Digit7', true); key('Digit7', false); key('KeyH', false);
  assert.ok(sk.iSail);
  for (let i = 0; i < 300; i++) { sk.update(1 / 30, { twa: -60 * DEG, awa: -40 * DEG, sog: 2.8, heading: 0, mainFill: 0.3 }); hint.update(1 / 30); }
  assert.equal(hint.current, 'none');
  hint.dispose();
  // the pro rows appear with ?pro=1 (proKeys)
  install();
  const h2 = createControlsHint({ state: () => s, skills: createSkills(), once: false, storage: null, proKeys: () => true });
  key('KeyH', true); h2.update(0.1); assert.match(h2.el.innerHTML, /wing-on-wing/); h2.dispose();
});

test('the rules table covers\'s skills', () => {
  assert.deepEqual(SKILL_IDS, ['steering', 'trim', 'nogo', 'tacking', 'gybing', 'gusts', 'groove', 'heavy', 'shifts', 'surfing']);
  assert.equal(RULES.trim.wrongS, 10); assert.equal(RULES.nogo.headS, 8); assert.equal(RULES.steering.holdS, 20); assert.equal(RULES.groove.neverS, 600);
  assert.equal(PRO.withinS, 60); assert.equal(KN, 0.514444);
});

test('lost (not a skill): circling far from anything for 2 min asks for the chart, once per browser', () => {
  const R = 40, at = { x: 1500, z: -1200 };   // ≈ 1.9 km from the island, in the bay's mouth
  const circ = (t) => { const a = t * 3 / R; return { x: at.x + R * Math.sin(a), z: at.z - R * Math.cos(a), heading: wrap(a + Math.PI / 2) }; };
  const r = run(circ, 125, { dt: 1 / 10 });
  assert.equal(r.sk.struggling('lost'), 'circling');
  assert.equal(run(circ, 110, { dt: 1 / 10 }).sk.struggling('lost'), null, 'not before 2 min');
  const sk = r.sk; assert.equal(sk.needs().at(-1)?.hint, 'chart');
  sk.once('chart'); run(circ, 5, { sk, t0: 125, dt: 1 / 10 }); assert.ok(!sk.needs().some((n) => n.hint === 'chart'), 'once');
  // the same circles by the island: not lost; a straight course far out: not lost
  assert.equal(run((t) => { const c = circ(t); return { ...c, x: c.x - at.x + 150, z: c.z - at.z }; }, 125, { dt: 1 / 10 }).sk.struggling('lost'), null, 'by the island');
  assert.equal(run((t) => ({ x: at.x + t * 2.4, z: at.z }), 125, { dt: 1 / 10 }).sk.struggling('lost'), null, 'a straight course');
});

test('hints: the mouse phrasing follows the modality, a shown line is re-said; 5 cycles the net', async () => {
  install();
  const { createControlsHint } = await import('../src/ui/controlsHint.js');
  let kind = 'keys';
  const s = { trueWind: { angle: -60 * DEG, speed: 5 }, apparentWind: { angle: -40 * DEG }, sog: 2.8, heading: 0, mainFill: 0.3, mainStall: 0, boomAngle: 0.4 };
  const sk = createSkills();
  const hint = createControlsHint({ state: () => s, skills: sk, once: false, storage: null, modality: () => kind });
  for (let i = 0; i < 90 && hint.current !== 'pull'; i++) { sk.update(1 / 30, { twa: -60 * DEG, awa: -40 * DEG, sog: 2.8, heading: 0, mainFill: 0.3 }); hint.update(1 / 30); }
  assert.equal(hint.current, 'pull'); assert.match(hint.el.innerHTML, /pull the sails in/);
  kind = 'mouse'; for (const f of [...(globalThis.__lkListeners?.('lk-modality') ?? [])]) f();
  hint.force('pull'); assert.match(hint.el.innerHTML, /pull the sails in/);
  hint.force('tack'); assert.match(hint.el.innerHTML, /across the wind/);
  kind = 'keys'; hint.force('tack'); assert.match(hint.el.innerHTML, /steer through faster/);
  hint.force('off');
  key('KeyH', true); hint.update(0.1);
  assert.match(hint.el.innerHTML, /data-k="5"/); assert.match(hint.el.innerHTML, /chart/);
  const net0 = sk.net; key('KeyN', true); key('KeyN', false); assert.equal(sk.net, net0, 'N is the chart, not the net');
  key('Digit5', true); key('Digit5', false); assert.equal(sk.net, 12);
  key('KeyH', false); hint.dispose();
  // the pro rows: feat/pro-sailing's traveller, behind the gate
  install();
  const h2 = createControlsHint({ state: () => s, skills: createSkills(), once: false, storage: null, proKeys: () => true });
  key('KeyH', true); h2.update(0.1); assert.match(h2.el.innerHTML, /traveller/); assert.doesNotMatch(h2.el.innerHTML, /data-k="P"/); h2.dispose();
});
