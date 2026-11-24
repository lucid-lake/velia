// Sail's wind shifts by the player's experience (owner, 2026-11-17; src/sim/sail-shifts.js on the one WindField): per profile, the
// slow swings' size and period over a long sim, the big shifts' size and how often they come, the gust line that brings each one,
// the crew trimming through them for the new sailor, Cruise and Regatta untouched, the worker's texture the page's own, and the
// same seed the same wind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SailShifts, SHIFT_PROFILES, SAIL_SHIFTS } from '../../src/sim/sail-shifts.js';
import { WindField } from '../../src/sim/wind.js';
import { windState, applyWindState } from '../../src/sim/wind-texture.js';
import { sailWindOptions, sailShiftProfile } from '../sim/wind.js';
import { makePattern } from '../regatta/shifts.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const HOURS = 6, SPAN = HOURS * 3600;
const field = (sailShifts, o = {}) => new WindField({ seed: o.seed ?? 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 16, rate: 0 }), ...(sailShifts !== undefined ? { sailShifts } : {}) });
const signedDiff = (a, b) => ((a - b + 540) % 360) - 180;

// the swing's peaks (local extrema of swing(s)) and the full periods between same-side peaks
function peaks(S, P) {
  const out = [];
  let a = S.swing(-1, P), b = S.swing(0, P);
  for (let s = 1; s <= SPAN; s++) {
    const c = S.swing(s, P);
    if ((b > a && b >= c) || (b < a && b <= c)) out.push({ s: s - 1, v: b });
    a = b; b = c;
  }
  return out;
}

for (const id of ['new', 'sail', 'race']) {
  test(`${id}: the swings peak at ±${SHIFT_PROFILES[id].swing.join('–')}°, a full swing 30–90 s and never the same twice`, () => {
    const P = SHIFT_PROFILES[id], S = new SailShifts({ seed: 1, profile: id });
    const pk = peaks(S, P), mags = pk.map((p) => Math.abs(p.v));
    assert.ok(pk.length > SPAN / 50, `${pk.length} peaks in ${HOURS} h`);
    assert.ok(Math.max(...mags) <= P.swing[1] + 1e-9, `the largest swing ${Math.max(...mags).toFixed(2)}° ≤ ${P.swing[1]}°`);
    const inBand = mags.filter((m) => m >= P.swing[0] - 1e-9).length / mags.length;
    assert.ok(inBand > 0.7, `${(inBand * 100).toFixed(0)} % of the peaks in the band`);
    // the full period: a turning point to the next of its kind (veered most to veered most, through a back)
    const per = [];
    for (let i = 2; i < pk.length; i++) per.push(pk[i].s - pk[i - 2].s);
    for (let i = 2; i < pk.length; i++) assert.equal(Math.sign(pk[i].v - pk[i - 1].v), -Math.sign(pk[i - 1].v - pk[i - 2].v), 'maxima and minima alternate');
    const mean = per.reduce((a, b) => a + b, 0) / per.length, sd = Math.sqrt(per.reduce((a, b) => a + (b - mean) ** 2, 0) / per.length);
    assert.ok(mean >= 45 && mean <= 75, `mean period ${mean.toFixed(1)} s`);
    assert.ok(per.filter((p) => p >= 30 && p <= 90).length / per.length > 0.95, 'periods within 30–90 s');
    assert.ok(sd / mean > 0.15, `varied: the period's spread ${(sd / mean * 100).toFixed(0)} % (a sine: 0)`);
    // and some swings turn back short and go out to the same side again: no metronome
    const same = pk.slice(1).filter((p, i) => Math.sign(p.v) === Math.sign(pk[i].v)).length;
    assert.ok(same > 0, `${same} same-side peaks`);
  });

  test(`${id}: big shifts of ${SHIFT_PROFILES[id].big.join('–')}°, ${id === 'new' ? 'rare' : 'every few minutes'}`, () => {
    const P = SHIFT_PROFILES[id], S = new SailShifts({ seed: 1, profile: id });
    let n = 0, on = false, max = 0;
    for (let s = 0; s <= SPAN; s++) {
      const b = Math.abs(S.big(s, P));
      max = Math.max(max, b);
      if (!on && b > 0.5 * P.big[0]) { n++; on = true; } else if (on && b < 0.1) on = false;
    }
    const every = SPAN / n / 60;
    assert.ok(max <= P.big[1] + 1e-9 && max > P.big[1] - 1.5, `the largest ${max.toFixed(1)}° (≤ ${P.big[1]}°)`);
    if (id === 'new') assert.ok(every >= 7 && every <= 16, `one every ${every.toFixed(1)} min`);
    else assert.ok(every >= 3.5 && every <= 7, `one every ${every.toFixed(1)} min`);
  });
}

test('the profiles in order: the new sailor calmest, I race the shiftiest, on the wind the boat feels', () => {
  const sd = {};
  for (const id of ['new', 'sail', 'race']) {
    const w = field(id), xs = [];
    for (let t = 0; t < 3600; t += 2) xs.push(signedDiff(w.sample(1200, -1050, t).dirDeg, w.base.dirDeg));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    sd[id] = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    assert.ok(Math.max(...xs.map(Math.abs)) <= SHIFT_PROFILES[id].swing[1] + SHIFT_PROFILES[id].big[1] + 0.5, `${id}: within its swing + big shift`);
  }
  assert.ok(sd.new < 4.5 && sd.new < sd.sail && sd.sail < sd.race, `the spread ${JSON.stringify(Object.fromEntries(Object.entries(sd).map(([k, v]) => [k, +v.toFixed(2)])))}`);
});

test('a big shift arrives with its gust line: the darker water at the front, seen upwind first', () => {
  const w = field('sail'), plain = field(undefined), S = w.sailShifts, P = SHIFT_PROFILES.sail;
  const k0 = S.eventAt(600);
  let checked = 0;
  for (let k = k0; k < k0 + 8; k++) {
    const e = S.events.get(k);
    if (e.keepQ >= P.keep) continue;
    // at the origin s = t: the gust multiplier's peak sits inside the shift's rise
    let best = 0, bestT = 0;
    for (let t = e.t0 - 60; t < e.t0 + 120; t += 0.5) { const g = w.sailShifts.gustMul(0, 0, t, w.base.dirDeg); if (g > best) { best = g; bestT = t; } }
    assert.ok(best > 1.12, `a gust line of +${((best - 1) * 100).toFixed(0)} %`);
    assert.ok(bestT > e.t0 && bestT < e.t0 + SAIL_SHIFTS.riseS, `the gust line at ${(bestT - e.t0).toFixed(1)} s into the ${SAIL_SHIFTS.riseS} s rise`);
    // the same line 600 m upwind passes that much earlier (at the carrying speed)
    const d = w.base.dirDeg * Math.PI / 180, ux = Math.sin(d) * 600, uz = -Math.cos(d) * 600;
    let bestU = 0, bestTU = 0;
    for (let t = e.t0 - 200; t < e.t0 + 120; t += 0.5) { const g = w.sailShifts.gustMul(ux, uz, t, w.base.dirDeg); if (g > bestU) { bestU = g; bestTU = t; } }
    const lead = bestT - bestTU;
    assert.ok(Math.abs(lead - 600 / S.carry) < 25, `seen upwind ${lead.toFixed(0)} s before (≈ ${(600 / S.carry).toFixed(0)} s)`);
    // the field's own speed carries it: the sample against the same wind with no profile (no terrain: the turn leaves the speed)
    const ratio = w.sample(0, 0, bestT).speed / plain.sample(0, 0, bestT).speed;
    assert.ok(Math.abs(ratio - best) < 1e-9, `the sample's speed × ${ratio.toFixed(3)}`);
    checked++;
  }
  assert.ok(checked >= 3, `${checked} big shifts checked`);
});

test('the new sailor: the crew trims through every shift, the sails never stop drawing (a held sheet luffs)', () => {
  const flat = waterFor(() => 0), deep = () => -40;
  const run = (hand) => {
    const B = createBoatSim({ water: flat, heightAt: deep, wind: field('new'), flags: { hand } });
    // the reef on A, set here: this lake at 16:00 gusts to about 27 kn, and a boat on 0 (Sail's default since the REEF
    // selector) lays over to 27.5° and the crew eases the main to spill the gust (crewEase from 24°): fill 0.70 at 93 s with
    // the wind's angle steady at −42°, and 0.00 with no shifts at all. That is the gust, not a shift; the shifts are this test's.
    B.setReef('A', { silent: true });
    B.settle(20);
    let minFill = 1, minSog = Infinity;
    for (let i = 0; i < 60 * 420; i++) { B.step(1 / 60, { steer: 0, pull: 0 }); if (i % 30 === 0) { const r = B.row(); minFill = Math.min(minFill, r.fill); minSog = Math.min(minSog, r.sogKn); } }
    return { minFill, minSog, crew: B.assists.crewTrim };
  };
  const crew = run('0'), held = run('1');
  assert.equal(crew.crew, true);
  assert.ok(crew.minFill > 0.95 && crew.minSog > 4, `the crew's sails: fill ≥ ${crew.minFill}, speed ≥ ${crew.minSog} kn`);
  assert.ok(held.minFill < crew.minFill, `a held sheet does luff (${held.minFill})`);
});

test('Cruise and Regatta keep their wind: no profile there; off is the lake\'s own shifts bit for bit; a pattern wins', () => {
  const settings = { get: (k) => ({ profile: 'race', welcomed: true })[k] };
  assert.equal(sailShiftProfile({ mode: 'cruise', settings }), null);
  assert.equal(sailShiftProfile({ mode: 'regatta', settings, pro: true }), null);
  assert.equal(sailShiftProfile({ mode: 'sail', settings }), 'race');
  assert.equal(sailShiftProfile({ mode: 'sail', settings: { get: (k) => ({ profile: 'new', welcomed: true })[k] } }), 'new');
  assert.equal(sailShiftProfile({ mode: 'sail', settings: { get: (k) => ({ profile: 'new', welcomed: false })[k] } }), 'sail', 'not asked yet: the default');
  assert.equal(sailShiftProfile({ mode: 'sail', settings: { get: (k) => ({ profile: 'sail', welcomed: true })[k] }, pro: true }), 'race', 'Pro on');
  assert.equal(sailShiftProfile({ flags: { windshift: 'new' }, mode: 'sail', settings }), 'new');
  assert.equal(sailShiftProfile({ flags: { shifts: false }, mode: 'sail' }), null);
  // a Cruise field (no profile, 'off'), and Sail's field with the profile set to null and eased out, are the lake's own wind exactly
  const plain = field(undefined), off = field('off'), back = field('sail');
  back.sailShifts.setProfile(null, 100);
  for (const [x, z, t] of [[0, 0, 0], [1200, -1050, 400], [-300, 800, 1999]]) {
    assert.deepEqual(off.sample(x, z, t), plain.sample(x, z, t));
    assert.deepEqual(back.sample(x, z, t + 200), plain.sample(x, z, t + 200));
  }
  // Sail → Cruise on a live page: Cruise's wind at once, no easing (the autopilot never sails a blend)
  const handed = field('sail');
  handed.sailShifts.setProfile(null, 300, { now: true });
  assert.deepEqual(handed.sample(1200, -1050, 300), plain.sample(1200, -1050, 300));
  assert.deepEqual(off.toTexture(32, 4096, 500, 0, 0), plain.toTexture(32, 4096, 500, 0, 0));
  assert.deepEqual(back.toTexture(32, 4096, 500, 0, 0), plain.toTexture(32, 4096, 500, 0, 0));
  // Regatta's pattern: the same turn everywhere whatever the profile
  const race = field('race');
  race.pattern = makePattern('oscillating', { tGun: 0 });
  for (const t of [0, 22.5, 45, 300]) assert.ok(Math.abs(race.dirAt(500, -200, t) - (race.base.dirDeg + race.pattern.deg(t))) < 1e-9);
});

test('a profile change eases in over 20 s: the wind never jumps', () => {
  const w = field('new');
  let prev = w.dirAt(1200, -1050, 299), worst = 0;
  w.sailShifts.setProfile('race', 300);
  for (let t = 300; t < 340; t += 0.25) { const d = w.dirAt(1200, -1050, t); worst = Math.max(worst, Math.abs(d - prev)); prev = d; }
  assert.ok(worst < 1, `the largest step ${worst.toFixed(3)}° in 0.25 s`);
  assert.equal(w.sailShifts.profile, 'race');
});

test('every effect reads the same shift: the texture (the page\'s and the worker\'s) is the sample; the same seed, the same wind', () => {
  const a = field('sail'), b = field('sail'), c = field('sail', { seed: 2 });
  const t = 777, n = 16, ext = 4096, cx = 1024, cz = -1024;
  const ta = a.toTexture(n, ext, t, cx, cz), tb = b.toTexture(n, ext, t, cx, cz);
  assert.deepEqual(ta, tb, 'deterministic by seed');
  assert.notDeepEqual(c.toTexture(n, ext, t, cx, cz), ta, 'another seed, another wind');
  // texel centres against sample(): the same direction and speed (the 1-D table's interpolation only)
  const cell = ext / n;
  let worstDeg = 0, worstSp = 0;
  for (let j = 0; j < n; j += 3) for (let i = 0; i < n; i += 3) {
    const x = cx - ext / 2 + (i + 0.5) * cell, z = cz - ext / 2 + (j + 0.5) * cell, p = j * n + i, s = a.sample(x, z, t);
    const d = Math.atan2(-ta[2 * p], ta[2 * p + 1]) * 180 / Math.PI;
    worstDeg = Math.max(worstDeg, Math.abs(signedDiff(d, s.dirDeg))); worstSp = Math.max(worstSp, Math.abs(Math.hypot(ta[2 * p], ta[2 * p + 1]) - s.speed));
  }
  assert.ok(worstDeg < 0.2 && worstSp < 0.02, `texture vs sample: ${worstDeg.toFixed(3)}°, ${worstSp.toFixed(4)} m/s`);
  // the worker's field set from the page's state draws the same texture, mid-blend too
  a.sailShifts.setProfile('race', t - 5);
  const worker = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay });
  applyWindState(worker, windState(a, t));
  assert.deepEqual(worker.toTexture(n, ext, t, cx, cz), a.toTexture(n, ext, t, cx, cz));
});
