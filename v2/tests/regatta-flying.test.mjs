// Regatta's flying start (no long wait in the box before the gun): the fleet laid already sailing at speed toward the line, a short
// countdown with a 2–3 s spare to ease away; the gun waits for the first bow at Beginner and Club (nobody can be over early), Pro judges
// early as OCS; the classic box unchanged; the deal (Beginner and Club always flying, Pro now and then the box); the Custom Start row;
// the coach's words. No browser: the real BoatPhysics on the real wind field, v1's race rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, Helm } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, courseIds, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { side } from '../../src/sim/race/line.js';
import { courseToWind } from '../regatta/geometry.js';
import { createRegattaSession, FLY, sailToLine } from '../regatta/session.js';
import { dealHand, handSeed, customHand, describeHand, clampCustom, isFlying, STARTS, DEFAULT_CUSTOM, DEFAULT_SETUP, PRESETS, DEAL_CLASSIC } from '../regatta/setup.js';
import { customDials } from '../regatta/hub.js';
import { createCoach, STEPS } from '../regatta/coach.js';
import { raceLine } from '../../src/ui/phoneQuiet.js';

const DEG = Math.PI / 180;
const WATERS = 'tahoe-emerald';
// the winds of the sweep: the lake's default, a fresh one from the west, a light air from the south-east, a strong northerly
const WINDS = [[210, null], [250, 7], [140, 2.2], [20, 12]];

function setup({ id = 'island-sprint', dir = 210, speedMs = null, seed = 1, rivals = 1, pace = 2, gunWaits = true, helper = false, flying = true, prestartS } = {}) {
  const course = courseToWind(courseFor(WATERS, id, { scale: 0.35 }), dir, { loadCourse, snapCourse });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, ...(speedMs ? { speedMs } : {}) } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed, flying, pace, gunWaits, helper, ...(prestartS ? { prestartS } : {}) });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  return { S, phys, windAt };
}
// sail the player's boat from the start's pose: 'helper' (the start helper's hands), 'straight' (AUTO: her heading held, the crew
// trimming), or a fixed heading offset (deg, + freer) held the same way; until `afterS` past the gun
function sail(o, { how = 'straight', offDeg = 0, afterS = 6 } = {}) {
  const { S, phys } = o, ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind }, helm = new Helm(), log = [], hold = S.me0.heading - offDeg * DEG;
  let t = 0;
  for (let i = 0; i < Math.round((S.prestartS + afterS) / DT); i++) {
    // straightThenHelper: AUTO straight on until she is over early, then the start helper's hands take her back below the line
    if (how === 'helper' || (how === 'straightThenHelper' && log.some((e) => e.type === 'ocs' && e.id === 'me'))) S.helperTick(ctl, t); else ctl.rudder = helm.toHeading(phys.state, hold, DT);
    env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); log.push(...S.drain());
  }
  const me = (type) => log.filter((e) => e.type === type && e.id === 'me');
  return { log, started: me('started')[0] ?? null, ocs: me('ocs'), gunEarly: log.find((e) => e.type === 'gunEarly') ?? null };
}

test('the flying start: every boat already sailing at speed toward the line, on her own lane, the countdown 8.5 s of real time at the pace', () => {
  for (const pace of [2, 1.5, 1]) {
    const { S } = setup({ rivals: 5, pace });
    assert.equal(S.flying, true); assert.ok(Math.abs(S.prestartS - (FLY.runS + FLY.holdS) * pace) < 1e-9); assert.ok(Math.abs(S.race.clock + S.prestartS) < 1e-9);
    for (const b of [{ name: 'you', pose: S.me0 }, ...S.rivals.map((r) => ({ name: r.name, pose: r.pose0 }))]) {
      const d = -side(S.line, b.pose.x, b.pose.z), twa = Math.abs(Math.atan2(Math.sin(S.windFrom - b.pose.heading), Math.cos(S.windFrom - b.pose.heading))) / DEG;
      assert.ok(d >= FLY.minBackM - 1e-6 && d < 60, `${b.name}: ${d.toFixed(1)} m below the line`);
      assert.ok(b.pose.speed > 2, `${b.name}: at speed (${b.pose.speed.toFixed(2)} m/s)`);
      assert.ok(twa > 40 && twa < 75, `${b.name}: a close reach toward the line, never head to wind (${twa.toFixed(0)}° off the wind)`);
    }
    // the lanes do not cross: each boat its own place along the line
    const xs = [S.me0, ...S.rivals.map((r) => r.pose0)].map((p) => (p.x - S.line.pin[0]) * S.line.dir[0] + (p.z - S.line.pin[1]) * S.line.dir[1]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] > 4, `lanes ${xs.map((x) => x.toFixed(0)).join(', ')} m along`);
  }
});

test('sailing on reaches the line FLY.holdS (2–3 s of real time) before the gun: a short ease times it (the placement sailed ahead)', () => {
  for (const id of ['island-sprint', 'bay-tour']) for (const [dir, sp] of WINDS) {
    const o = setup({ id, dir, speedMs: sp });
    const T = sailToLine(o.S.line, o.S.me0, o.windAt, { maxS: 60 }), spare = (o.S.prestartS - T) / 2;
    assert.ok(spare >= 1.8 && spare <= 3.2, `${id} ${dir}°: the line ${T?.toFixed(2)} s in of ${o.S.prestartS}: ${spare.toFixed(2)} s of real time to spare`);
  }
});

test('Beginner and Club: AUTO straight on crosses at the gun (it waits for her), the helper within ±1.5 s; never over early, on every course and wind', () => {
  for (const id of courseIds(WATERS).slice(0, 1)) for (const [dir, sp] of WINDS.slice(0, 1)) {   // every course and wind: v2/tests/slow/regatta-flying.slow.mjs
    const tag = `${id} ${dir}°${sp ? ` ${sp} m/s` : ''}`;
    const a = sail(setup({ id, dir, speedMs: sp }), { how: 'straight' });
    assert.equal(a.ocs.length, 0, `${tag}: straight, never over early`);
    assert.ok(a.started && Math.abs(a.started.delayS) <= 1.5, `${tag}: straight, started ${a.started?.delayS?.toFixed(2)} s after the gun`);
    assert.ok(a.gunEarly?.id === 'me' && a.gunEarly.earlyS > 0, `${tag}: the gun waited for her bow (${JSON.stringify(a.gunEarly)})`);
    const b = sail(setup({ id, dir, speedMs: sp, helper: true }), { how: 'helper' });
    assert.equal(b.ocs.length, 0, `${tag}: the helper, never over early`);
    assert.ok(b.started && Math.abs(b.started.delayS) <= 1.5, `${tag}: the helper started ${b.started?.delayS?.toFixed(2)} s after the gun`);
  }
});

test('Beginner and Club cannot be over early in a flying start: a freer, faster heading only brings the gun sooner; the fleet too', () => {
  for (const off of [10, 20]) {
    const r = sail(setup({ dir: 250, speedMs: 7 }), { offDeg: off });
    assert.equal(r.ocs.length, 0, `${off}° freer: never over early`);
    assert.ok(r.started && r.started.delayS >= 0 && r.started.delayS <= 1.5, `${off}° freer: started ${r.started?.delayS?.toFixed(2)} s after the gun`);
  }
  const f = sail(setup({ rivals: 5, helper: true }), { how: 'helper', afterS: 14 });
  assert.equal(f.log.filter((e) => e.type === 'ocs').length, 0, 'nobody in the fleet over early');
  assert.equal(new Set(f.log.filter((e) => e.type === 'started').map((e) => e.id)).size, 6, 'the whole fleet started within 14 s of the gun');
});

test('Pro: the same placement, early is over early (OCS) with the normal return; a short ease starts clean', () => {
  const o = setup({ pace: 1.5, gunWaits: false, rivals: 0, helper: true });   // the helper's hands only once she is over (the return)
  assert.equal(o.S.gunWaits, false);
  const r = sail(o, { how: 'straightThenHelper', afterS: 40 });
  assert.ok(r.ocs.length > 0 && r.ocs[0].early, `straight on is over early (${JSON.stringify(r.ocs[0])})`);
  assert.equal(r.gunEarly, null, 'the gun keeps its time');
  assert.ok(r.log.some((e) => e.type === 'ocsClear' && e.id === 'me'), 'back below the line clears it');
  assert.ok(r.started && r.started.delayS > 0, `then she starts (${r.started?.delayS?.toFixed(1)} s after the gun)`);
  // the start helper's way (bear away for the spare, then head up): clean at Pro's timing too
  const h = sail(setup({ pace: 1.5, gunWaits: false, rivals: 0, helper: true }), { how: 'helper' });
  assert.equal(h.ocs.length, 0); assert.ok(h.started && h.started.delayS >= 0 && h.started.delayS <= 1.5, `eased: started ${h.started?.delayS?.toFixed(2)}`);
});

test('the classic start is unchanged: the box at −0:45 / −1:30 / −3:00, no flying placement, the gun never waits', () => {
  for (const pre of [45, 90, 180]) {
    const { S } = setup({ flying: false, prestartS: pre, gunWaits: true });
    assert.equal(S.flying, false); assert.equal(S.gunWaits, false); assert.equal(S.prestartS, pre); assert.ok(Math.abs(S.race.clock + pre) < 1e-9);
  }
  const { S } = setup({ flying: false, prestartS: 45 });
  assert.ok(-side(S.line, S.me0.x, S.me0.z) >= 36 - 1e-6, 'the box at least 36 m below the line (R3)');
});

test('the deal: Beginner and Club always a flying start; Pro mostly flying, now and then a classic box; Custom\'s Start row', () => {
  for (const id of ['beginner', 'club']) for (const skill of ['easy', 'pro']) {
    const s = { ...DEFAULT_SETUP, ...PRESETS[id], skill };
    for (let n = 0; n < 400; n++) { const h = dealHand(handSeed('fly', n), s); assert.equal(h.prestartS, 0, `${id} hand ${n}`); assert.ok(isFlying(h)); }
  }
  const pro = Array.from({ length: 400 }, (_, n) => dealHand(handSeed('fly', n), { ...DEFAULT_SETUP, ...PRESETS.pro }).prestartS);
  const classic = pro.filter((p) => p > 0).length;
  assert.ok(classic > 0.1 * 400 && classic < 0.35 * 400, `Pro: ${classic} of 400 classic (${DEAL_CLASSIC.pro})`);
  assert.ok(pro.every((p) => [0, ...DEAL_CLASSIC.starts].includes(p)));
  // Custom: Flying first and the default, then the classic times; the hand and the hub say the start type
  assert.deepEqual(STARTS.map((x) => x.label), ['Flying start', 'Line −0:45', 'Line −1:30', 'Line −3:00']);
  assert.equal(DEFAULT_CUSTOM.start, 0); assert.equal(clampCustom({}).start, 0); assert.equal(clampCustom({ start: 90 }).start, 90);
  const row = customDials({ setup: DEFAULT_SETUP }).find((r) => r.id === 'start');
  assert.equal(row.value, 'Flying start'); assert.deepEqual(row.pickers[0].options.map((o) => o.label), STARTS.map((x) => x.label));
  assert.equal(row.pickers[0].options.find((o) => o.on).v, '0');
  assert.equal(describeHand(customHand(DEFAULT_SETUP, 1)).start, 'Flying start');
  assert.equal(describeHand(customHand({ ...DEFAULT_SETUP, custom: { ...DEFAULT_CUSTOM, start: 45 } }, 1)).start, 'Line −0:45');
});

test('the coach: a flying start says "Line ahead", never the box\'s "Stay below the white line"; the classic start keeps its line; phones keep both cues', () => {
  const run = (flying) => {
    const C = createCoach({ coach: 'all' }), said = [];
    for (let c = flying ? -17 : -45; c < 0; c += 0.25) { const l = C.update(c, { clock: c, status: 'prestart', ocs: false, flying, legKind: null, leg: 0, finishLeg: false, lay: null, inZone: false, rounding: 'port', next: null, target: null, tacked: false }); if (l?.id) said.push(l); }
    return said;
  };
  const f = run(true), b = run(false);
  assert.ok(f.some((l) => l.id === 'flying' && /^Line ahead/.test(l.text) && /gun/.test(l.text)), JSON.stringify(f.map((l) => l.id)));
  assert.ok(!f.some((l) => l.id === 'prestart' || /box|below the white line|gold boat/i.test(l.text)), 'no box guidance in a flying start');
  assert.ok(b.some((l) => l.id === 'prestart') && !b.some((l) => l.id === 'flying'));
  assert.ok(STEPS.find((s) => s.id === 'flying'));
  const fl = f.find((l) => l.id === 'flying'), pl = b.find((l) => l.id === 'prestart');
  assert.equal(raceLine(fl, true), fl, 'a phone keeps the flying start\'s cue'); assert.equal(raceLine(pl, true), pl);
});
