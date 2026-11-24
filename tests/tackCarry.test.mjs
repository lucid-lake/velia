// A beginner's tack carries through (fix/tack-wind, src/sail/tackCarry.js). The stall (an outside test,
// 2026-11): A held for 1.5 s then let go mid-turn left the pilot holding the bow head to wind, the boat stopped dead
// at ≈ 0.3–0.6 kn. These run the Sail helm (the key's helmTau, the pilot on release, 2× time) over the real physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, Helm, steadyWind, steadyState, CONTROLS, KN, DT } from '../src/sim/boat.js';
import { helmTau, weatherHelm, HELM } from '../src/sim/sail/feel.js';
import { TackCarry, CARRY, pilotHeading, inIrons } from '../src/sim/sail/tackCarry.js';
import { TackAssist, TOUCHUI } from '../src/ui/touchMap.js';

const DEG = Math.PI / 180;
// port tack close-hauled (wind from port, TWA −45°); a tack is a turn to port (A, steer −1)
// pattern(t, assist) → steer; carry: the fix (false: the old helm, the pilot latching the let-go heading)
function sail({ tws = 12, pattern, carry = true, startKn = null, seconds = 30, sheet = 'player', pro = false }) {
  const ss = steadyState({ twsKn: tws, twaDeg: -45, seconds: 90 });
  const boat = new BoatPhysics({ heading: 45 * DEG, speed: (startKn ?? ss.kn) * KN });
  const env = { windAt: steadyWind(tws * KN, 0), t: 0 };
  const pilot = new Helm(), tc = new TackCarry(), assist = new TackAssist(), ctl = { ...CONTROLS };
  let hold = null, rudder = 0, mainSheet = null, minKn = Infinity, made = null, committed = false, keep = 0;
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    const t = i * dt, s = boat.state;
    const steer = pattern(t, assist, s);
    const co = carry ? tc.update(dt, { steer, twa: s.trueWind.angle, sog: s.sog, yawRate: s.yawRate, enabled: !pro }) : { helm: null, jibSide: 0, keep: 0 };
    committed ||= !!co.committed; if (co.keep) keep = co.keep;
    ctl.jibSide = co.jibSide;
    if (steer) { rudder += (steer - rudder) * Math.min(1, dt / helmTau(steer, s.apparentWind.angle, weatherHelm(s).need)); hold = null; }
    else if (co.helm != null) { rudder += (co.helm - rudder) * Math.min(1, dt / HELM.tau); hold = null; }
    else { if (hold == null) hold = carry && !pro ? pilotHeading(s.heading, s.trueWind.angle, s.trueWind.speed) : s.heading; rudder = pilot.toHeading(s, hold, dt); }
    ctl.rudder = rudder;
    if (sheet === 'player') { if (mainSheet == null && s.mainSheet > 0) mainSheet = s.mainSheet; ctl.sheet = mainSheet; }   // the sheet stays where it was left (sheets.js)
    for (let k = 0; k < 2; k++) { boat.step(DT, ctl, env); env.t += DT; }   // Sail's 2× time
    if (t > 2 && made == null) minKn = Math.min(minKn, s.u / KN);
    if (made == null && s.trueWind.angle > 40 * DEG) made = t - 2;
  }
  const s = boat.state;
  return { made, minKn, twa: s.trueWind.angle / DEG, kn: s.u / KN, committed, keep, heading: s.heading / DEG };
}
const holdFor = (a, b) => (t) => (t > a && t < b ? -1 : 0);

test('the stall, reproduced: A held 1.5 s then let go mid-turn, the old helm holds the bow in the no-go zone and the boat stops', () => {
  for (const tws of [8, 12, 16, 22]) {
    const r = sail({ tws, pattern: holdFor(2, 3.5), carry: false });
    assert.equal(r.made, null, `${tws} kn: the old helm never tacks`);
    // stuck: stopped in the no-go zone, or at its edge on the old tack. In 22 kn she makes ≈ 0.9 kn of sternway there, and
    // since the rudder works reversed astern (fix/sim-astern-rudder) the old helm's hold lets her bow sag to ≈ 41° off; it
    // was held under 40° by a phantom helm from the keel's ±180° downwash
    assert.ok(Math.abs(r.twa) < 45 && r.minKn < 1.1, `${tws} kn: stuck at TWA ${r.twa.toFixed(0)}°, ${r.minKn.toFixed(2)} kn`);
  }
});

test('the fix: the same let-go tack carries through and the boat sails off on the new tack', () => {
  for (const tws of [8, 12, 16, 22]) {
    const r = sail({ tws, pattern: holdFor(2, 3.5) });
    assert.ok(r.committed, `${tws} kn: committed`);
    assert.ok(r.made != null && r.made < 11, `${tws} kn: through in ${r.made?.toFixed(1)} s`);
    assert.ok(r.minKn > 0.8, `${tws} kn: kept way (${r.minKn.toFixed(2)} kn at the slowest)`);
    assert.ok(r.twa > 42 && r.twa < 55, `${tws} kn: the pilot holds the new tack close-hauled (TWA ${r.twa.toFixed(0)}°)`);
    assert.ok(r.kn > 2, `${tws} kn: moving again at 30 s (${r.kn.toFixed(2)} kn)`);
    assert.equal(r.keep, -1, 'the hint line said: keep turning to port');
  }
});

test('held A through head to wind, with way on (≥ 3 kn): through in under 11 s and never stopped', () => {
  for (const tws of [8, 12, 16, 22]) {
    const r = sail({ tws, pattern: holdFor(2, 14) });
    assert.ok(r.made != null && r.made < 11, `${tws} kn: ${r.made?.toFixed(1)} s`);
    assert.ok(r.minKn > 0.8, `${tws} kn: ${r.minKn.toFixed(2)} kn`);
  }
});

test('the Tack button does the whole manoeuvre: ≈ 90° of turn, the sails across, close-hauled on the new tack', () => {
  for (const tws of [8, 12, 16, 22]) {
    const r = sail({ tws, pattern: (t, a, s) => { if (Math.abs(t - 2) < 1e-9) a.start('tack', s.trueWind.angle); return a.active ? a.step(1 / 60, s.trueWind.angle) : 0; } });
    assert.ok(r.made != null && r.made < 11, `${tws} kn: ${r.made?.toFixed(1)} s`);
    const turned = 45 - r.heading;   // from 45° to the new heading, turning to port
    assert.ok(turned > 80 && turned < 105, `${tws} kn: turned ${turned.toFixed(0)}°`);
    assert.ok(r.twa >= TOUCHUI.tackDoneDeg - 2 && r.twa < 55, `${tws} kn: TWA ${r.twa.toFixed(0)}°`);
  }
});

test('honest: a slow boat (1.2 kn, under 1.5) gets no carry and stalls head to wind; in irons the line says how out', () => {
  const r = sail({ tws: 12, startKn: 1.2, pattern: holdFor(2, 3.5) });
  assert.equal(r.committed, false);
  assert.equal(r.made, null);
  assert.ok(inIrons(10 * DEG, 0.5 * KN) && !inIrons(10 * DEG, 2 * KN) && !inIrons(45 * DEG, 0.5 * KN));
  // in irons with the helm over, the crew backs the jib to push the bow off (to port: the clew to starboard)
  const c = new TackCarry(); const o = c.update(1 / 60, { steer: -1, twa: 8 * DEG, sog: 0.2 * KN, yawRate: 0 });
  assert.equal(o.jibSide, 1); assert.equal(o.helm, null);
});

test('Pro: no carry, no backing; the old helm (the stall is real physics there)', () => {
  const r = sail({ tws: 12, pattern: holdFor(2, 3.5), pro: true });
  assert.equal(r.committed, false); assert.equal(r.made, null);
});

test('a turn back the other way aborts the tack; a small luff up (to 38°) does not commit', () => {
  const c = new TackCarry();
  for (let i = 0; i < 120; i++) c.update(1 / 60, { steer: 0, twa: -45 * DEG, sog: 5 * KN, yawRate: 0 });
  c.update(1 / 60, { steer: -1, twa: -38 * DEG, sog: 5 * KN, yawRate: -8 * DEG });
  assert.equal(c.active, false, 'a luff to 38° is the helmsman pinching, not a tack');
  c.update(1 / 60, { steer: -1, twa: -25 * DEG, sog: 4.5 * KN, yawRate: -8 * DEG });
  assert.equal(c.active, true);
  const o = c.update(1 / 60, { steer: 0, twa: -20 * DEG, sog: 4 * KN, yawRate: -8 * DEG });
  assert.ok(Math.abs(o.helm - -CARRY.helm) < 1e-9 && o.keep === -1, 'let go: the helm stays over to port, keep turning to port');
  c.update(1 / 60, { steer: 1, twa: -18 * DEG, sog: 4 * KN, yawRate: -6 * DEG });
  assert.equal(c.active, false, 'the helm the other way: aborted');
});

test('the pilot never holds the bow head to wind: let go inside 40° it bears away to 40° on the side the wind is on', () => {
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(close(pilotHeading(10 * DEG, -10 * DEG, 5), 40 * DEG), 'wind from 0°, from port: the course 040°');
  assert.ok(close(pilotHeading(-5 * DEG, 5 * DEG, 5), -40 * DEG), 'from starboard: 320°');
  assert.equal(pilotHeading(1.0, 50 * DEG, 5), 1.0, 'outside the no-go zone: as let go');
  assert.equal(pilotHeading(1.0, 0, 0), 1.0, 'no wind read yet (the first frame): as it is');
});

test('the quiet hint line: "keep turning" with the side while the bow turns through; gone 0.8 s after; no voice, no pop-up', async () => {
  const { install } = await import('./helpers/dom-stub.mjs');
  install();
  const { createControlsHint, KEEP } = await import('../src/ui/controlsHint.js');
  const { createSkills } = await import('../src/sail/skills.js');
  const { createWords, termsIn } = await import('../src/ui/words.js');
  const text = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  let hand = 'keys';
  const sk = createSkills({ storage: null }), spoken = [];
  const hint = createControlsHint({ state: () => null, skills: sk, words: createWords({ skills: sk }), once: false, storage: null, voice: { say: (t) => spoken.push(t) },
    modality: () => hand, touch: () => hand === 'touch' });
  hint.keep(-1); hint.update(1 / 60);
  assert.equal(hint.current, 'keep');
  assert.match(hint.el.innerHTML, /data-k="A"/); assert.match(text(hint.el.innerHTML), /keep turning, through the wind/);
  hint.keep(1); hint.update(1 / 60);
  assert.match(hint.el.innerHTML, /data-k="D"/, 'the side follows the turn');
  hint.keep(0); for (let i = 0; i < 30; i++) hint.update(1 / 60);
  assert.equal(hint.current, 'keep', 'it lingers a moment');
  for (let i = 0; i < 30; i++) hint.update(1 / 60);
  assert.equal(hint.current, 'none');
  hand = 'touch'; hint.keep(-1); hint.update(1 / 60);
  assert.doesNotMatch(hint.el.innerHTML, /class="cap/); assert.match(text(hint.el.innerHTML), /keep turning left/);
  assert.deepEqual(spoken, [], 'no voice line (no clip to make)');
  for (const d of [-1, 1]) for (const f of [KEEP.keys, KEEP.hand]) assert.deepEqual(termsIn(text(f(d))), [], 'plain words: no bare sailing term');
  hint.dispose();
});
