// Let fly (src/sail/letFly.js): a sheet thrown off its winch stays off; the jib let fly with the main in
// rounds a keelboat up and stops her, both let fly she slows and falls off; sheeting in brings the crew back. Driven through
// the same two calls Sail's controls make each frame (fly.before / fly.after around HandSheets.update), on the real physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, KN, DT, Helm, steadyWind } from '../src/sim/boat.js';
import { HandSheets, HAND } from '../src/sim/sail/sheets.js';
import { LetFly, FlyPress, LET_FLY, FLY_NOTES, flyCase, jibTrimRange } from '../src/sim/sail/letFly.js';
import { pilotHeading } from '../src/sim/sail/tackCarry.js';
import { sailState } from '../src/stations/sloop/helmInput.js';
import { NOTES } from '../src/ui/skipper.js';
import { BY_ID, createWords } from '../src/ui/words.js';

const DEG = Math.PI / 180;
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

// Sail's sheets and helm in miniature: the hand on the main (HandSheets), the jib's own trim, the pilot (it holds the heading
// it was given, lets the helm go while a sheet flies, and takes her again on its let-go course, tackCarry.js pilotHeading)
function rig({ twa = 90, kt = 12, pro = false, storage = null } = {}) {
  const phys = new BoatPhysics({ heading: -twa * DEG, speed: 5 * KN });
  const env = { windAt: steadyWind(kt * KN, 0), t: 0 };
  const ctl = { ...CONTROLS, autoTrim: true };
  const hand = new HandSheets(), fly = new LetFly({ storage, once: !!storage }), pilot = new Helm();
  let hold = -twa * DEG, t = 0;
  const said = [];
  function frame({ pull = 0, mainNow = 0, jibDir = 0, jibNow = 0, toggles = {} } = {}) {
    const jr = jibTrimRange(phys.state), io = { ctl, hand, handOn: true, pro, state: phys.state, pullRate: HAND.rate, jr };
    fly.before(DT, { ...io, toggles }, { pull, mainNow, jibDir, jibNow });
    if (mainNow) hand.nudge(mainNow);
    ctl.jibTrim = Math.max(jr.lower, Math.min(jr.upper, (ctl.jibTrim ?? 0) - jibNow - jibDir * (jibDir > 0 ? HAND.rate : HAND.easeRate) * DT));
    ctl.sheet = hand.update(DT, pull, phys.state, { pullRate: HAND.rate });
    fly.after(DT, io, { pull, mainNow, jibDir, jibNow });
    const id = fly.says('sailor'); if (id) said.push(id);
    if (fly.any) { ctl.rudder += (0 - ctl.rudder) * Math.min(1, DT / 0.4); hold = null; }
    else { const s = phys.state; if (hold == null) hold = pilotHeading(s.heading, s.trueWind.angle, s.trueWind.speed); ctl.rudder = pilot.toHeading(s, hold, DT); }
    env.t = t; phys.step(DT, ctl, env); t += DT;
    return phys.state;
  }
  const run = (secs, inp, each) => { for (let i = 0, n = Math.round(secs / DT); i < n; i++) { const s = frame(typeof inp === 'function' ? inp(i * DT) : inp); each?.(s); } return phys.state; };
  // settle on the course with the sheet at the crew's trim (as a player who has trimmed her)
  for (let i = 0; i < 60 / DT; i++) { frame(); if (phys.state.crewSheet) { hand.sheet = phys.state.crewSheet; hand.start = false; } }
  return { phys, ctl, hand, fly, frame, run, said, get t() { return t; } };
}
const kn = (s) => s.sog / KN, twaDeg = (s) => Math.abs(s.trueWind.angle) / DEG;

test('the physics: jibFree off is the old boat exactly; on, the clew streams out past the hand range to the shrouds', () => {
  const a = new BoatPhysics({ heading: -90 * DEG, speed: 3 }), b = new BoatPhysics({ heading: -90 * DEG, speed: 3 });
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  for (let i = 0; i < 600; i++) { env.t = i * DT; a.step(DT, { ...CONTROLS }, env); const { jibFree, ...old } = CONTROLS; b.step(DT, old, env); }
  for (const k of ['x', 'z', 'heading', 'u', 'heel', 'jibAngle', 'boomAngle']) assert.equal(a.state[k], b.state[k], k);
  const c = new BoatPhysics({ heading: -90 * DEG, speed: 3 });
  for (let i = 0; i < 600; i++) { env.t = i * DT; c.step(DT, { ...CONTROLS, jibFree: true, rudder: 0 }, env); }
  assert.ok(c.state.jibSheet > 79 * DEG && c.state.jibFill < 0.1, `jib sheet ${(c.state.jibSheet / DEG).toFixed(0)}°, fill ${c.state.jibFill.toFixed(2)}`);
});

test('the jib let fly with the main in, on a beam reach in 12 kn: she rounds up under 40° TWA and under 3 kn within 90 s; it stays free past 8 s', () => {
  const r = rig({ twa: 90, kt: 12 });
  const s0 = { kn: kn(r.phys.state), twa: twaDeg(r.phys.state) };
  assert.ok(s0.twa > 85 && s0.kn > 5.5, `settled ${s0.twa.toFixed(0)}° ${s0.kn.toFixed(1)} kn`);
  r.frame({ toggles: { jib: true } });                       // a click on the JIB winch
  assert.ok(r.fly.free.jib && !r.fly.free.main);
  let freeAt8 = null;
  const s = r.run(90, {}, () => { if (freeAt8 == null && r.t > 8.5) freeAt8 = r.fly.free.jib; });
  assert.equal(freeAt8, true, 'still free after 8 s');
  assert.ok(twaDeg(s) < 40 && kn(s) < 3, `after 90 s: TWA ${twaDeg(s).toFixed(0)}°, ${kn(s).toFixed(2)} kn`);
  assert.ok(r.fly.free.jib && !r.hand.crew && r.ctl.jibFree, 'the jib is still flying, the crew has not taken it');
  assert.ok(s.jibFill < 0.1 && s.mainFill > 0.5, 'the jib flogs, the main draws');
  assert.deepEqual(r.said, [FLY_NOTES.jib.sailor]);
});

test('sheeting the jib back in: a second click grinds it in, the pilot bears away, she sails on and the crew has the jib again', () => {
  const r = rig({ twa: 90, kt: 12 });
  r.frame({ toggles: { jib: true } }); r.run(60, {});
  assert.ok(kn(r.phys.state) < 3.5);
  r.frame({ toggles: { jib: true } });                       // click again: in
  assert.ok(!r.fly.free.jib && r.fly.grind.jib && !r.ctl.jibFree);
  let drew = null;
  r.run(60, {}, (s) => { if (drew == null && !r.fly.back.jib) drew = r.t; });
  const s = r.phys.state;
  assert.ok(drew != null, 'the jib drew again');
  assert.ok(kn(s) > 4.5 && s.jibFill > 0.5 && twaDeg(s) >= 39, `sailing on: ${kn(s).toFixed(1)} kn at ${twaDeg(s).toFixed(0)}°, jib fill ${s.jibFill.toFixed(2)}`);
  assert.ok(Math.abs(r.ctl.jibTrim) < 0.6 * DEG, `the crew's match again (trim ${(r.ctl.jibTrim / DEG).toFixed(1)}°)`);
});

test('R (the jib in by hand) takes the jib from free; the crew waits until it draws', () => {
  const r = rig({ twa: 90, kt: 12 });
  r.frame({ toggles: { jib: true } }); r.run(20, {});
  r.frame({ jibDir: 1 });
  assert.ok(!r.fly.free.jib && !r.fly.grind.jib && r.fly.back.jib, 'in by hand, not ground');
  const jr = jibTrimRange(r.phys.state);
  assert.ok(r.ctl.jibTrim > jr.upper - 0.05, 'from the stop, not a jump to the trim');
  r.run(3, { jibDir: 1 });
  assert.ok(r.ctl.jibTrim < jr.upper - 20 * DEG, `the winch's rate pulled it in (${(r.ctl.jibTrim / DEG).toFixed(0)}°)`);
});

test('both let fly from a close reach (the squall reflex: the ease held at the stop for 1 s): she slows and falls off, and stays free', () => {
  const r = rig({ twa: 55, kt: 12 });
  const k0 = kn(r.phys.state);
  let both = null;
  r.run(4, { pull: -1 }, () => { if (both == null && r.fly.free.main && r.fly.free.jib) both = r.t; });
  assert.ok(both != null, 'both free while the ease is held');
  assert.ok(r.fly.free.main && r.fly.free.jib && r.ctl.sheet === HAND.max && r.ctl.jibFree);
  let minKn = 99;
  const s = r.run(120, {}, (st) => { minKn = Math.min(minKn, kn(st)); });
  assert.ok(minKn < 0.5 * k0 && minKn < 2, `slowed from ${k0.toFixed(1)} to ${minKn.toFixed(2)} kn`);
  assert.ok(twaDeg(s) > 75, `fell off to ${twaDeg(s).toFixed(0)}° TWA`);
  assert.ok(r.fly.free.main && r.fly.free.jib && !r.hand.crew, 'still free after two minutes: no crew, no timer');
  assert.deepEqual(r.said, ['letFlyBoth']);
});

test('the main let fly stays out past the crew\'s net; W brings it in at the winch rate, and once it draws the net is armed again', () => {
  const r = rig({ twa: 90, kt: 12 });
  r.frame({ toggles: { main: true } });
  r.run(30, {});
  assert.ok(r.fly.free.main && r.hand.sheet === HAND.max && !r.hand.crew, 'free for 30 s, longer than the net\'s 12 s');
  assert.deepEqual(r.said, [], 'the main alone: no line');
  r.frame({ pull: 1 });
  assert.ok(!r.fly.free.main && r.fly.back.main);
  const at = r.hand.sheet;
  r.run(1, { pull: 1 });
  assert.ok(at - r.hand.sheet > 5 * DEG && at - r.hand.sheet < 30 * DEG, `the winch's rate: ${((at - r.hand.sheet) / DEG).toFixed(1)}° in 1 s`);
  r.run(4, { pull: 1 });
  r.run(3, {});
  assert.ok(!r.fly.back.main, 'drawing again');
  // eased right out by hand, hands off: the crew's net comes back after its wait (it is a sheet eased, not a let fly)
  r.run(2.5, () => ({ pull: r.hand.sheet < HAND.max - 1e-6 ? -1 : 0 }));   // S held until the stop, then let go
  assert.ok(!r.fly.free.main, 'eased to the stop by S alone is not a let fly');
  let crew = false, luffed = false;
  r.run(HAND.netAfter + 6, {}, (s) => { crew ||= r.hand.crew; luffed ||= s.mainFill < 0.5; });
  assert.ok(luffed && crew, `the net trims a sail left luffing (luffed ${luffed}, crew ${crew})`);
});

test('the input mapping: a click and a long press, the touch tap, Pro\'s drag past the stop, the squall needs the stop, W/S', () => {
  const p = new FlyPress();
  p.press(0, 100, 100); p.move(102, 101); assert.equal(p.release(0.15), true, 'a mouse click');
  p.press(0, 100, 100); p.move(130, 100); assert.equal(p.release(0.2), false, 'a drag is a trim');
  p.press(0, 100, 100); assert.equal(p.release(LET_FLY.clickS + 0.2), false, 'a slow press is not a click');
  p.press(0, 100, 100, true); assert.equal(p.release(0.1, false), false, 'a touch tap never lets fly');
  p.press(0, 100, 100, true); assert.equal(p.release(0.1, true), true, 'a touch tap on a free winch sheets in');
  p.press(0, 100, 100, true); assert.equal(p.tick(0.3), false); assert.equal(p.tick(LET_FLY.pressS + 0.01), true, 'the long press'); assert.equal(p.tick(0.9), false, 'once'); assert.equal(p.release(1), false);
  p.press(0, 100, 100, true); p.move(100, 130); assert.equal(p.tick(1), false, 'a held drag is not a long press');
  // the squall needs the main at its stop: the ease held mid-range only eases
  const f = new LetFly();
  for (let i = 0; i < 120; i++) f.squallTick(DT, true, false);
  assert.ok(!f.any);
  for (let i = 0; i < 59; i++) f.squallTick(DT, true, true);
  assert.ok(!f.any, 'not before 1 s');
  f.squallTick(DT, true, true); f.squallTick(DT, true, true);
  assert.ok(f.free.main && f.free.jib, 'held at the stop for 1 s: both fly');
  // Pro: the winch dragged on out at its stop clicks into free; basic: the stop is only a stop
  for (const pro of [true, false]) {
    const ctl = { ...CONTROLS }, hand = new HandSheets({ sheet: HAND.max }), fl = new LetFly();
    fl.before(DT, { ctl, hand, handOn: true, pro, state: {}, jr: { lower: -1, upper: 0.4 } }, { mainNow: -0.01 });
    assert.equal(fl.free.main, pro, `pro ${pro}`);
  }
  // S (ease) on a free main does nothing; W (pull) takes it back
  const g = new LetFly(); g.letGo('main'); const ctl = { ...CONTROLS }, hand = new HandSheets({ sheet: HAND.max });
  g.before(DT, { ctl, hand, handOn: true, pro: false, state: {}, jr: { lower: -1, upper: 0.4 } }, { pull: -1 }); assert.ok(g.free.main);
  g.before(DT, { ctl, hand, handOn: true, pro: false, state: {}, jr: { lower: -1, upper: 0.4 } }, { pull: 1 }); assert.ok(!g.free.main && g.back.main);
});

test('the words: R. speaks once per case (jib, then both), plain or sailor, kept per browser; "let fly" is a glossed term', () => {
  const st = mem();
  const a = new LetFly({ storage: st });
  a.letGo('main'); assert.equal(a.says('plain'), null, 'the main alone');
  a.letGo('jib'); assert.equal(a.says('plain'), 'letFlyBoth');
  a.sheetIn('main'); assert.equal(a.says('plain'), 'letFlyJibPlain');
  a.sheetIn('jib'); a.letGo('jib'); assert.equal(a.says('plain'), null, 'once');
  const b = new LetFly({ storage: st }); b.letGo('jib'); assert.equal(b.says('sailor'), null, 'kept across a reload');
  assert.equal(flyCase({ main: true, jib: false }), null);
  for (const id of ['letFlyJib', 'letFlyJibPlain', 'letFlyBoth']) assert.ok(NOTES[id]?.text && NOTES[id]?.speak, id);
  assert.equal(NOTES.letFlyJib.speak, 'Jib’s let fly. She’ll round up and stop. Sheet in to sail on.');
  assert.equal(NOTES.letFlyJibPlain.speak, 'Jib let go. She’ll turn into the wind and stop. Pull it in to sail on.');
  assert.equal(NOTES.letFlyBoth.speak, 'Sheets let fly. She’ll slow down. Sheet in to sail on.');
  assert.ok(BY_ID['let-fly']);
  const w = createWords({ skills: { mastered: () => false } });
  assert.match(w.expand(NOTES.letFlyBoth.text), /data-term="let-fly">let fly</);
});

test('the winch marker: a free sail flogging flutters amber (luff), even head to wind; drawing it shows as drawing', () => {
  assert.equal(sailState({ fill: 0, twa: 25 * DEG, free: true }), 'luff');
  assert.equal(sailState({ fill: 0, twa: 25 * DEG }), 'off', 'unchanged without a let fly');
  assert.equal(sailState({ fill: 0.9, twa: 120 * DEG, free: true }), 'draw');
  assert.equal(sailState({ fill: 0, twa: 25 * DEG, free: true, furl: 1 }), 'off');
});
