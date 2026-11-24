// The load feel: the winch slows with the load, easing stays quick, the weather helm rises with the
// heel, and the gamepad's rumble fires on scripted events (a mocked Gamepad API).
import test from 'node:test';
import assert from 'node:assert/strict';
import { winchRate, WINCH, weatherHelm, helmTau, HELM } from '../src/sim/sail/feel.js';
import { HandSheets, HAND, trimBoost } from '../src/sim/sail/sheets.js';
import { RumbleMix, createRumble, RUMBLE } from '../classic/src/sail/rumble.js';
import { BoatPhysics, CONTROLS, Helm, steadyState, steadyWind, KN } from '../src/sim/boat.js';
import { parseFlags } from '../src/sim/core/flags.js';

const DEG = Math.PI / 180;

test('the winch rate falls monotonically as the sheet load rises: 12°/s light, 4–5°/s in a level-4 gust', () => {
  let last = Infinity;
  for (let F = 0; F <= 5000; F += 25) {
    const r = winchRate(F);
    assert.ok(r <= last + 1e-12, `rate rose at ${F} N`);
    last = r;
  }
  assert.ok(Math.abs(winchRate(400) / DEG - 12) < 0.3, `light air ${(winchRate(400) / DEG).toFixed(2)}°/s`);
  const gust4 = winchRate(2800) / DEG;
  assert.ok(gust4 >= 4 && gust4 <= 5, `level-4 gust ${gust4.toFixed(2)}°/s`);
  assert.ok(winchRate(1e6) / DEG >= WINCH.minDeg - 1e-9, 'never under the floor');
});

test('the loads behind the mapping: level 1 is light, a level-4 gust is heavy (the physics, reefed as the crew does)', () => {
  const light = steadyState({ twsKn: 6, twaDeg: 60, seconds: 90 }).state, heavy = steadyState({ twsKn: 28, twaDeg: 50, seconds: 90 }).state;
  const F = (s) => Math.hypot(s.drive, s.side);
  assert.ok(winchRate(F(light)) / DEG > 11, `6 kn: ${F(light).toFixed(0)} N → ${(winchRate(F(light)) / DEG).toFixed(1)}°/s`);
  const h = winchRate(F(heavy)) / DEG;
  assert.ok(h > 4 && h < 5.2, `28 kn: ${F(heavy).toFixed(0)} N → ${h.toFixed(1)}°/s`);
});

test('the hand: pulling in follows the given rate; easing stays at 25°/s whatever the load', () => {
  const s = { mainSheet: 0.5, crewSheet: 30 * DEG, mainFill: 1, mainStall: 0, apparentWind: { angle: 60 * DEG }, trueWind: { angle: 70 * DEG } };
  const fast = new HandSheets({ sheet: 60 * DEG }), slow = new HandSheets({ sheet: 60 * DEG });
  for (let i = 0; i < 60; i++) { fast.update(1 / 60, 1, s, { pullRate: winchRate(300) }); slow.update(1 / 60, 1, s, { pullRate: winchRate(2800) }); }
  // held, the rate ramps up (sheets.js trimBoost, owner 2026-10-30): one second is the given rate × the ramp's mean
  const ramp = (rate, dir) => { let d = 0; for (let i = 1; i <= 60; i++) d += rate * trimBoost((i - 1) / 60, dir) / 60; return d; };
  assert.ok(Math.abs((60 * DEG - fast.sheet) / DEG - ramp(winchRate(300), 1) / DEG) < 0.05, 'light: one second at the light rate, ramped');
  assert.ok(Math.abs((60 * DEG - slow.sheet) / DEG - ramp(winchRate(2800), 1) / DEG) < 0.05, 'loaded: one second at the slow rate, ramped');
  assert.ok(ramp(winchRate(2800), 1) < ramp(winchRate(300), 1), 'the load still slows the winch');
  const ease = new HandSheets({ sheet: 30 * DEG });
  for (let i = 0; i < 60; i++) ease.update(1 / 60, -1, s, { pullRate: winchRate(2800) });
  assert.ok(Math.abs((ease.sheet - 30 * DEG) / DEG - ramp(HAND.easeRate, -1) / DEG) < 0.05, `eased ${((ease.sheet - 30 * DEG) / DEG).toFixed(1)}° in 1 s (25°/s ramped, whatever the load)`);
});

test('weather helm: the rudder the boat needs to hold its course rises with heel (the physics), and so does the estimate', () => {
  const rows = [];
  for (const tws of [6, 9, 12, 15, 18]) {
    const r = steadyState({ twsKn: tws, twaDeg: 50, seconds: 120, controls: { autoReef: false } });
    rows.push({ heel: r.heelDeg, rudder: -r.rudderDeg, est: weatherHelm(r.state).need / DEG });
  }
  rows.sort((a, b) => a.heel - b.heel);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].heel > rows[i - 1].heel, 'the heel rises with the wind');
    assert.ok(rows[i].rudder > rows[i - 1].rudder, `held rudder ${rows.map((r) => r.rudder.toFixed(1)).join(' / ')}° at heel ${rows.map((r) => r.heel.toFixed(1)).join(' / ')}°`);
    assert.ok(rows[i].est >= rows[i - 1].est, `estimate ${rows.map((r) => r.est.toFixed(1)).join(' / ')}°`);
  }
  assert.ok(rows.at(-1).rudder > 5, 'a real pull at 20° of heel');
  for (const r of rows) assert.ok(Math.abs(r.est - r.rudder) < 2.5, `estimate within 2.5° of the physics (${r.est.toFixed(1)} vs ${r.rudder.toFixed(1)})`);
});

test('weather helm: with the helm centred (the pilot off), a heeled boat rounds up, harder the more it heels', () => {
  // from a steady close reach held by the helm, let go: the yaw rate toward the wind 2 s later
  const roundUp = (tws) => {
    const twa = 55 * DEG, windAt = steadyWind(tws * KN, 0), env = { windAt, t: 0 };
    const b = new BoatPhysics({ heading: -twa, speed: 3 }), helm = new Helm();
    for (let i = 0; i < 90 * 60; i++) { env.t = i / 60; b.step(1 / 60, { ...CONTROLS, autoReef: false, rudder: helm.toHeading(b.state, -twa) }, env); }
    const heel = Math.abs(b.state.heel), h0 = b.state.heading;
    for (let i = 0; i < 2 * 60; i++) { env.t += 1 / 60; b.step(1 / 60, { ...CONTROLS, autoReef: false, rudder: 0 }, env); }
    // the wind is from the north (0°), the boat on port tack heading −55°: rounding up turns it toward 0, i.e. + yaw
    return { heel: heel / DEG, turn: (b.state.heading - h0) / DEG };
  };
  const a = roundUp(7), b = roundUp(11), c = roundUp(16);
  assert.ok(a.heel < b.heel && b.heel < c.heel, `heel ${a.heel.toFixed(1)} / ${b.heel.toFixed(1)} / ${c.heel.toFixed(1)}°`);
  assert.ok(b.turn > a.turn && c.turn > b.turn, `the round-up in 2 s: ${a.turn.toFixed(1)} / ${b.turn.toFixed(1)} / ${c.turn.toFixed(1)}°`);
  assert.ok(c.turn > 2, 'felt: more than 2° in 2 s at 16 kn');
});

test('the helm\'s weight: bearing away against the weather helm is slower, heading up is not', () => {
  const need = 8 * DEG, awa = 40 * DEG;   // wind from starboard: heading up is + (starboard)
  assert.equal(helmTau(1, awa, need), HELM.tau);
  assert.ok(Math.abs(helmTau(-1, awa, need) - HELM.tau * (1 + HELM.heavy)) < 1e-9);
  assert.equal(helmTau(-1, awa, 0), HELM.tau, 'no heel, no weight');
  assert.equal(helmTau(1, -awa, need), HELM.tau * (1 + HELM.heavy), 'mirrored on the other tack');
});

// ---- the rumble ----
const base = () => ({ u: 3, trueWind: { speed: 6, angle: 60 * DEG }, apparentWind: { speed: 8, angle: 40 * DEG }, mainFill: 1, jibFill: 1 });
const run = (mix, seconds, f, dt = 1 / 60) => { const out = []; for (let i = 0; i < seconds / dt; i++) { const { s, pose } = f(i * dt); out.push(mix.step(dt, s, pose, { hullSpeed: 3.4, simDt: dt * 2 })); } return out; };
const kinds = (mix) => mix.fired.map((e) => e.kind);

test('rumble: a steady sail is still; a gust arriving is a soft rising rumble', () => {
  const mix = new RumbleMix();
  const calm = run(mix, 8, () => ({ s: base(), pose: { heave: 0, pitch: 0 } }));
  assert.deepEqual(kinds(mix), [], 'nothing fires on a steady sail');
  assert.ok(calm.every((m) => m.strong === 0 && m.weak === 0));
  // the true wind steps 6 → 8.5 m/s (+42 %) over 1 s
  const g = run(mix, 6, (t) => ({ s: { ...base(), trueWind: { speed: 6 + 2.5 * Math.min(1, t), angle: 60 * DEG } }, pose: { heave: 0, pitch: 0 } }));
  assert.deepEqual(kinds(mix), ['gust']);
  const peak = Math.max(...g.map((m) => m.strong)), at = g.findIndex((m) => m.strong === peak);
  assert.ok(peak > 0.1 && peak <= RUMBLE.max.strong, `peak ${peak.toFixed(2)}`);
  assert.ok(at / 60 > 1.2, `it rises (peak at ${(at / 60).toFixed(2)} s)`);
  assert.ok(g.at(-1).strong < 0.2 * peak, 'then fades');
  // a puff in a near-calm (1.5 → 2.0 m/s, +33 % but 0.5 m/s) is not felt
  const calmMix = new RumbleMix();
  run(calmMix, 6, (t) => ({ s: { ...base(), trueWind: { speed: 1.5 + 0.5 * Math.min(1, t / 0.5), angle: 60 * DEG } }, pose: null }));
  assert.deepEqual(kinds(calmMix), [], 'no rumble for a near-calm puff');
});

test('rumble: slamming into a wave is a short thump; the slow pitching from the waves is not', () => {
  const mix = new RumbleMix();
  // a 4 s swell, ±0.3 m heave and ±3° pitch: no slam
  run(mix, 10, (t) => ({ s: base(), pose: { heave: 0.3 * Math.sin(2 * Math.PI * t / 2), pitch: 3 * DEG * Math.sin(2 * Math.PI * t / 2 + 1) } }));
  assert.deepEqual(kinds(mix), [], 'a swell is not a slam');
  // the bow falls into a trough and stops dead in 0.05 s (scene time): a slam
  const out = run(mix, 1, (t) => ({ s: base(), pose: { heave: t < 0.3 ? -0.8 * t : -0.24, pitch: t < 0.3 ? -6 * DEG * t / 0.3 : -6 * DEG } }));
  assert.deepEqual(kinds(mix), ['slam']);
  const on = out.filter((m) => m.strong > 0).length / 60;
  assert.ok(on > 0.05 && on < 0.15, `short: ${on.toFixed(3)} s`);
});

test('rumble: flogging sails flutter the light motor at ≈ 7 Hz', () => {
  const mix = new RumbleMix();
  const out = run(mix, 2, () => ({ s: { ...base(), mainFill: 0.1, jibFill: 0.1 }, pose: null }));
  assert.deepEqual(kinds(mix), ['flog']);
  const w = out.map((m) => m.weak > 0);
  let edges = 0; for (let i = 1; i < w.length; i++) if (w[i] && !w[i - 1]) edges++;
  assert.ok(edges >= 12 && edges <= 16, `${edges} pulses in 2 s`);
  assert.ok(out.every((m) => m.strong === 0 && m.weak <= RUMBLE.flog.weak + 1e-9), 'light: the weak motor only');
});

test('rumble: a surf swells long (from the acceleration, or from state.surf when the physics sets it)', () => {
  const mix = new RumbleMix();
  // downwind past hull speed, accelerating 0.4 m/s² for 3 s, then holding 4.6 m/s for 2 s, then slowing
  const out = run(mix, 8, (t) => ({ s: { ...base(), trueWind: { speed: 9, angle: 150 * DEG }, u: t < 3 ? 3.4 + 0.4 * t : t < 5 ? 4.6 : 3.2 }, pose: null }));
  assert.deepEqual(kinds(mix), ['surf']);
  const on = out.filter((m) => m.strong > 0.01).length / 60;
  assert.ok(on > 3, `long: ${on.toFixed(1)} s`);
  const first = out.findIndex((m) => m.strong > 0.01), peakAt = out.findIndex((m) => m.strong === Math.max(...out.map((x) => x.strong)));
  assert.ok(peakAt - first > 60, 'swelling, not a step');
  const flagged = new RumbleMix();
  run(flagged, 3, (t) => ({ s: { ...base(), surf: t > 1 ? 1 : 0 }, pose: null }));
  assert.deepEqual(kinds(flagged), ['surf'], 'state.surf drives it when present');
});

test('rumble: plays dual-rumble on a mocked Gamepad API, subtle, and ?rumble=0 is silent', () => {
  const calls = [];
  const pad = { connected: true, mapping: 'standard', vibrationActuator: { playEffect: (type, p) => { calls.push({ type, ...p }); return Promise.resolve('complete'); } } };
  const nav = { getGamepads: () => [null, pad] };
  const r = createRumble({ flags: parseFlags(''), nav });
  for (let i = 0; i < 60; i++) r.update(1 / 60, { ...base(), mainFill: 0.1, jibFill: 0.1 }, null, { simDt: 1 / 30 });
  assert.ok(calls.length >= 8 && calls.length <= 25, `${calls.length} effects in 1 s (≤ 20 Hz)`);
  assert.ok(calls.every((c) => c.type === 'dual-rumble' && c.strongMagnitude <= RUMBLE.max.strong && c.weakMagnitude <= RUMBLE.max.weak));
  assert.deepEqual(r.mix.fired.map((e) => e.kind), ['flog']);
  const quiet = [];
  const nav2 = { getGamepads: () => [{ ...pad, vibrationActuator: { playEffect: (...a) => { quiet.push(a); return Promise.resolve(); } } }] };
  const r0 = createRumble({ flags: parseFlags('rumble=0'), nav: nav2 });
  for (let i = 0; i < 60; i++) r0.update(1 / 60, { ...base(), mainFill: 0.1, jibFill: 0.1 }, null);
  assert.equal(quiet.length, 0, '?rumble=0');
  const none = createRumble({ flags: parseFlags(''), nav: { getGamepads: () => [] } });
  assert.doesNotThrow(() => none.update(1 / 60, base(), null));
});
