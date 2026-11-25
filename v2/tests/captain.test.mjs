// The binoculars and the VHF on v2 (#5, #6: v2/ui/captain.js, v1's src/sail/captainTools.js on v1's three-free modules). No browser:
//   the binoculars   v1's tests/binoculars.test.mjs ported onto v2's camera chain (captain.camera over a views pose, v2's boat pose
//                    stream): the raise to 6.5° at the sloop's helm eye, the lowering back to the views' pose, the log-scale blend,
//                    the aim held in the world through a tack and the waves, the focus pull; the drag routed to the aim only
//                    while they are up; v1's sight finds from captain.aim (the ruin held 1 s, never while lowered or looking away)
//   the keys         B toggles (no repeats, stand-in keys, modifiers or text fields), Escape lowers, O asks the weather channel
//   the radio        v1's scheduling on v2's state: the forecast by itself 20 s in (a time step a frame, then played), O twice
//                    back to 16, the harbour master's gust call on v2's true wind (never over the forecast), the harbour's chatter
//                    near the entrance, nothing while the settings' vhf is off, no forecast in a capture; the frozen-clock wind
//                    (v2's live timerate 0) gives v1's forecast in milliseconds; the fetch from v2's heights matches v1's
//   the sound        the radio's own bus: eased in, eased out before a stop (no click)
// The browser half: v2/tests/pages/captain.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { bestOf, bestOfEach } from '../../tests/helpers/bestOf.mjs';
import { readFileSync } from 'node:fs';
import { createCaptain, AIM, forecastWind, shoreFromHeights, cameraShim, radioAudio, AUTO_FORECAST_S, CHATTER, VHF_BUS } from '../ui/captain.js';
import { AUTO_FORECAST_S as V1_AUTO, CHATTER as V1_CHATTER } from '../../classic/src/sail/captainTools.js';
import { BINO, yawPitchOf, dirOf, swayAt, nearOverWater } from '../../src/boat/binoculars.js';
import { cameras as sloopCameras } from '../../src/sim/craft/sloop/cameras.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { toWorld } from '../../src/sim/boat/helmCamera.js';
import { createDiscoveries, placesFrom, terrainLos, SIGHT } from '../../src/sail/discoveries.js';
import { forecastFor } from '../../src/vhf/forecast.js';
import { fetchTrace } from '../../src/sim/water-spectrum.js';
import { planTokens } from '../../src/vhf/radio.js';
import { HM } from '../../src/vhf/harbourMaster.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { sailWindOptions } from '../sim/wind.js';
import { heightAt } from './helpers/ground.mjs';   // v2's own heights (v2/terrain/sample.js)
import { shoreDistance } from './helpers/ground.mjs';   // v2's own lake's shore distance (v2/sim/lake.js: the lake-wide grids), v1's on the water
import { createSettings } from '../../src/ui/settings.js';
import { WORLD, terrainFor } from '../ui/logbook.js';
import { installDom, memStorage } from '../../tests/helpers/dom-helm.mjs';

const DEG = Math.PI / 180;
const fetchTraceOf = (sd, dirDeg) => fetchTrace(sd, 550, -650, dirDeg, 8000);   // forecast.js's own trace: the bay's middle, upwind
const terrain = { field: { height: heightAt } };
// v2's boat: B.pose (the ride's drawn state), B.state (the physics'), B.t (sim s), B.vessel
const boat = (o = {}) => {
  const B = { t: 0, vessel: CURRENT_VESSEL, pose: { x: 1200, z: -1050, heading: 251 * DEG, heel: 0, pitch: 0, heave: 0 }, state: { x: 1200, z: -1050, trueWind: { speed: 4 } }, ...o };
  B.at = (t, p = {}) => { B.t = t; Object.assign(B.pose, { heel: 0.12 * Math.sin(t), pitch: 0.03 * Math.sin(1.3 * t), heave: 0.2 * Math.sin(0.8 * t) }, p); return B; };
  return B;
};
const normal = { pos: [1200, 6, -1040], target: [1190, 5, -1050], up: [0, 1, 0], fov: 50, near: 0.5 };
const wind = (rate = 0, flags = {}) => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions(flags, { hour: 15, rate }) }); w.setTerrain(heightAt); return w; };
const settingsMem = (o = {}) => { const st = memStorage(); if (Object.keys(o).length) st.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, ...o })); return createSettings({ storage: st }); };
// a radio that records what it is asked (the real one needs Web Audio): v1's state shape, the plan from the tokens
function fakeRadio(log) {
  return () => {
    const state = { playing: false, chatter: false, at: 0, token: -1, plan: null };
    const r = { state, ready: Promise.resolve(null),
      plan: (tokens) => ({ tokens, items: tokens.map((t, i) => ({ id: t.id, at: i, dur: 1, token: i })), dur: tokens.length + 0.5, charAt: tokens.map((_, i) => i) }),
      play(p) { log.push({ play: p.tokens.map((t) => t.id ?? t.pause) }); state.plan = p; state.playing = true; state.at = 0; },
      stop() { log.push({ stop: true }); state.playing = false; state.token = -1; },
      update(dt) { if (state.playing) { state.at += dt; state.token = Math.min(state.plan.items.length - 1, Math.floor(state.at)); if (state.at >= state.plan.dur) { state.playing = false; state.token = -1; } } return state; },
      chatter(n) { if (state.playing) return false; log.push({ chatter: n }); return true; } };
    log.push({ made: true });
    return r;
  };
}

test('v1\'s numbers: the auto forecast at 20 s, the chatter within 700 m every 70–160 s from 25 s', () => {
  assert.equal(AUTO_FORECAST_S, V1_AUTO);
  assert.deepEqual(CHATTER, V1_CHATTER);
});

test('the binoculars on v2\'s chain: up to 6.5° at the sloop\'s helm eye, eased in; lowered, the views\' pose untouched', () => {
  const B = boat(), cap = createCaptain({ B, windField: wind(), terrain, live: false, dom: false });
  assert.equal(cap.camera(1 / 60, normal), normal, 'down: the views\' pose itself');
  cap.setLatch(true);
  let p = cap.camera(0.1, normal);
  assert.ok(cap.k > 0 && cap.k < 1 && p.fov < 50 && p.fov > BINO.fov, `coming up (k ${cap.k}, fov ${p.fov})`);
  for (let i = 0; i < 10; i++) p = cap.camera(0.1, normal);
  assert.equal(cap.k, 1); assert.equal(p.fov, BINO.fov);
  assert.ok(p.near > 1 && p.near < BINO.nearM, `the views look 4° down: the near plane in front of the water (${p.near.toFixed(2)} m, #33)`);
  const eye = sloopCameras(B.vessel).helm.eye, e0 = toWorld(eye, B.pose);
  assert.ok(Math.abs(p.pos[1] - e0[1] - BINO.stand) < 0.05, `the helm's eye height (${p.pos[1].toFixed(2)} vs ${e0[1].toFixed(2)} + ${BINO.stand})`);
  assert.ok(Math.hypot(p.pos[0] - e0[0], p.pos[2] - e0[2]) <= BINO.lean + 1e-6, 'within the skipper\'s lean of the helm');
  const [y0] = yawPitchOf(normal.target.map((v, i) => v - normal.pos[i]));
  assert.ok(Math.abs(cap.bino.yaw - y0) < 1e-9, 'aimed where the views looked');
  assert.ok(cap.aim && Math.abs(Math.hypot(cap.aim.fx, cap.aim.fy, cap.aim.fz) - 1) < 1e-9, 'the aim for the sight finds');
  cap.setLatch(false);
  for (let i = 0; i < 5; i++) p = cap.camera(0.1, normal);
  assert.equal(cap.k, 0); assert.equal(p, normal, 'down again: the views\' pose'); assert.equal(cap.aim, null);
});

// #33: a raise from a view that looks down (the follow camera, the helm view) aimed the glasses at water closer than the 14 m near
// plane, so the first moment cut the near water away and showed the lake bed. Every frame of the raise, once the near plane moves
// out (k past focusAt), the frame's bottom edge must meet the water beyond it; a level aim keeps v1's 14 m (the rig stays clear)
test('#33: raised while looking down, the near plane never passes the water; a level aim keeps 14 m', () => {
  const B = boat();
  for (const downDeg of [4, 10, 18, 25]) {
    const cap = createCaptain({ B, windField: wind(), terrain, live: false, dom: false });
    const d = [-Math.cos(downDeg * DEG), -Math.sin(downDeg * DEG), 0], from = { ...normal, target: normal.pos.map((v, i) => v + d[i] * 10) };
    cap.setLatch(true);
    let worst = Infinity;
    for (let i = 0; i < 40; i++) {
      B.at(i / 30);
      const p = cap.camera(1 / 30, from);
      if (p === from || p.near <= from.near) continue;   // still the views' own near plane (k under focusAt)
      const f = p.target.map((v, j) => v - p.pos[j]), l = Math.hypot(...f), half = p.fov * DEG / 2;
      const below = half - Math.asin(f[1] / l);   // the bottom edge under the horizon
      const water = below > 0 ? (p.pos[1] - 0.3) * Math.cos(half) / Math.sin(below) : Infinity;   // its depth where it meets a 0.3 m crest
      worst = Math.min(worst, water - p.near);
    }
    assert.ok(worst > 0, `${downDeg}° down: the water stays in front of the near plane (margin ${worst.toFixed(2)} m)`);
    assert.equal(cap.k, 1);
  }
  assert.equal(nearOverWater([0, 2.6, 0], [0, 0.01, -1], BINO.fov), BINO.nearM, 'a level aim: v1\'s 14 m');
  assert.equal(nearOverWater([0, 2.6, 0], [0, -0.03, -1], BINO.fov), BINO.nearM, '2° down: still 14 m');
  assert.ok(nearOverWater([0, 2.6, 0], [0, -0.4, -1], BINO.fov) >= BINO.nearMinM, 'never under nearMinM');
});

test('steadied on v2\'s boat pose: the aim holds in the world through a 90° tack and the waves; the sway only', () => {
  const B = boat(), cap = createCaptain({ B, windField: wind(), terrain, live: false, dom: false });
  cap.setLatch(true);
  for (let i = 0; i < 20; i++) cap.camera(0.05, normal);
  const yaws = [];
  for (let i = 0; i < 400; i++) { const p = cap.camera(0.05, (B.at(1 + i * 0.05, { heading: (251 - 90 * i / 400) * DEG }), normal)); yaws.push(yawPitchOf(p.target.map((v, k) => v - p.pos[k]))[0]); }
  const spread = Math.max(...yaws) - Math.min(...yaws);
  assert.ok(spread < 0.2 * DEG && spread > 0.01 * DEG, `the aim wandered ${(spread / DEG).toFixed(3)}° (the sway only)`);
  const s = swayAt(3.7); assert.ok(Math.abs(s[0]) < 0.08 * DEG && Math.abs(s[1]) < 0.06 * DEG);
});

test('the focus pull: blurred as they come up, sharp after 0.7 s', () => {
  const cap = createCaptain({ B: boat(), windField: wind(), terrain, live: false, dom: false });
  const blurs = [], ease = (k) => k * k * (3 - 2 * k);
  cap.setLatch(true);
  // the lens view's blur (v1's view.update(k, blurPx)): the binoculars' focus clock
  for (let i = 0; i < 40; i++) { cap.camera(0.05, normal); blurs.push(cap.bino.focusT == null ? 0 : BINO.focusPx * (1 - ease(Math.min(1, cap.bino.focusT / BINO.focusS)))); }
  assert.ok(Math.max(...blurs) > BINO.focusPx * 0.8 && blurs.at(-1) === 0 && blurs[0] === 0, `${blurs.map((b) => b.toFixed(1)).join(' ')}`);
});

// 2026-11-19: the glasses stopped just above the horizon: the cursor reaches the screen's top and movementY ends. The aim now has a
// pitch gain (a drag or a mouse stroke of about 600 px spans the range) and a cursor held in the window's top or bottom edge keeps tilting
test('the tilt reaches +35° up and -20° down: by a drag (the mouse held at the top edge: the page test)', () => {
  const B = boat(), cap = createCaptain({ B, windField: wind(), terrain, live: false, dom: false });
  cap.setLatch(true);
  const level = { pos: [1200, 6, -1040], target: [1190, 6, -1040], up: [0, 1, 0], fov: 50, near: 0.5 };
  for (let i = 0; i < 40; i++) cap.camera(1 / 30, level);
  const pitchOf = () => cap.bino.pitch / DEG;
  assert.ok(Math.abs(pitchOf()) < 1, `starts level (${pitchOf().toFixed(1)}°)`);
  // a drag of 500 px up (a phone's one finger or a held mouse: orbitFromDrag's 0.004 rad a pixel)
  const hands = (px) => ({ orbit: [0, px * 0.004], zoom: 1 });
  for (let i = 0; i < 25; i++) { cap.takeLook(hands(-20)); cap.camera(1 / 30, level); }   // 500 px
  assert.ok(pitchOf() >= 30, `500 px of drag up reads ≥ +30° (${pitchOf().toFixed(1)}°)`);
  for (let i = 0; i < 60; i++) { cap.takeLook(hands(-20)); cap.camera(1 / 30, level); }
  assert.ok(Math.abs(pitchOf() - 35) < 0.01, `clamped at +35° (${pitchOf().toFixed(2)}°)`);
  const p = cap.camera(1 / 30, level), f = p.target.map((v, k) => v - p.pos[k]);
  assert.ok(f[1] / Math.hypot(...f) > Math.sin(34 * DEG), 'the camera itself looks up (the target is above the eye)');
  for (let i = 0; i < 120; i++) { cap.takeLook(hands(20)); cap.camera(1 / 30, level); }
  assert.ok(Math.abs(pitchOf() + 20) < 0.01, `down to -20° and no further (${pitchOf().toFixed(2)}°)`);
});

test('the drag aims the glasses only while they are up; the views get none then; down, the drag is the views\' own', () => {
  const cap = createCaptain({ B: boat(), windField: wind(), terrain, live: false, dom: false });
  const h = { orbit: [0.07, 0], zoom: 1.2 };
  cap.takeLook(h); assert.deepEqual(h, { orbit: [0.07, 0], zoom: 1.2 }, 'down: untouched');
  cap.setLatch(true); for (let i = 0; i < 10; i++) cap.camera(0.1, normal);
  const y0 = cap.bino.yaw, h2 = { orbit: [0.07, 0], zoom: 1.2 };
  cap.takeLook(h2); assert.deepEqual(h2, { orbit: null, zoom: 0 }, 'up: the views get no look or zoom');
  cap.camera(1 / 60, normal);
  assert.ok(Math.abs(cap.bino.yaw - y0 - 0.07 * BINO.look) < 1e-9, 'the look at the helm view\'s rate ÷ 7');
});

test('the camera shim: the HUD reads the pose\'s forward from matrixWorld (−z) and its position', () => {
  const s = cameraShim(), c = s.set({ pos: [1, 2, 3], target: [1 + 3, 2, 3 - 4], up: [0, 1, 0] }), e = c.matrixWorld.elements;
  assert.deepEqual([-e[8], -e[9], -e[10]].map((v) => +v.toFixed(6)), [0.6, 0, -0.8]);
  assert.deepEqual([e[4], e[5], e[6]].map((v) => +v.toFixed(6)), [0, 1, 0]);
  assert.deepEqual([e[0], e[1], e[2]].map((v) => +v.toFixed(6)), [0.8, 0, 0.6], 'right = forward × up');
  assert.deepEqual(c.position, { x: 1, y: 2, z: 3 });
});

test('sight: v1\'s finds from captain.aim on v2\'s world: the ruin held 1 s of real time, never lowered or looking away', () => {
  const t2 = terrainFor(heightAt), places = placesFrom({ terrain: t2, shoreline: WORLD.shoreline, harbour: WORLD.harbour });
  const run = (raise, off = 0, dur = 1.5) => {
    const B = boat(), cap = createCaptain({ B, windField: wind(), terrain, live: false, dom: false }), disc = createDiscoveries({ places, los: terrainLos(heightAt) });
    if (raise) { cap.setLatch(true); for (let i = 0; i < 10; i++) cap.camera(0.1, normal); }
    const found = {};
    for (let t = 0; t <= dur; t += 1 / 30) {
      if (raise) { const e = cap.bino.pose.pos, p = places.ruin, [y, pt] = yawPitchOf([p.x - e[0], (p.y ?? 0) + SIGHT.aimY - e[1], p.z - e[2]]); cap.bino.yaw = y + off; cap.bino.pitch = pt; }
      cap.camera(1 / 30, normal);
      for (const id of disc.update({ t: t * 2, rt: t, x: B.state.x, z: B.state.z, heading: B.pose.heading, sog: 2, tws: 6, twa: -2, cam: null, sunElevDeg: 17, bino: cap.aim })) found[id] = +t.toFixed(2);
    }
    return found;
  };
  const ok = run(true);
  assert.ok(ok.ruin >= SIGHT.holdS - 0.05 && ok.ruin <= SIGHT.holdS + 0.15, `the ruin found at ${ok.ruin} s`);
  assert.deepEqual(run(false), {}, 'not raised: never');
  assert.deepEqual(run(true, 3 * DEG), {}, 'aimed 3° off: never');
  assert.deepEqual(run(true, 0, 0.8), {}, 'under 1 s: not yet');
});

test('keys: B toggles (no repeats, stand-in keys, modifiers or text fields); Escape lowers; a click lowers; O is no key', () => {
  const D = installDom();
  try {
    const log = [], cap = createCaptain({ B: boat(), windField: wind(), terrain, settings: settingsMem(), live: true, auto: false, dom: false, makeRadio: fakeRadio(log) });
    D.key('KeyB'); assert.equal(cap.latched, true, 'B latches');
    D.key('KeyB', true, { repeat: true }); D.key('KeyB', false); assert.equal(cap.latched, true, 'a repeat and the key up change nothing');
    D.key('KeyB', true, { metaKey: true }); D.key('KeyB', true, { ctrlKey: true }); D.key('KeyB', true, { lkDock: true }); D.key('KeyB', true, { lkVirtual: true });
    assert.equal(cap.latched, true, 'Cmd+B, Ctrl+B, the dock\'s and the pad\'s stand-ins change nothing');
    const field = document.createElement('input'); document.body.appendChild(field); field.focus(); D.key('KeyB'); field.blur?.(); field.remove();
    assert.equal(cap.latched, true, 'typing in a field changes nothing');
    D.key('Escape'); assert.equal(cap.latched, false, 'Escape lowers');
    D.key('KeyB'); D.key('KeyB'); assert.equal(cap.latched, false, 'B again lowers');
    assert.equal(cap.channel, '16');
    D.key('KeyO'); assert.equal(cap.channel, '16'); assert.equal(cap.job, null, 'O does nothing: the VHF is its button\'s (the Pro drawer, Conditions)');
    cap.listen(); assert.equal(cap.channel, 'WX 1'); assert.ok(cap.job, 'the button\'s way: the forecast\'s job (a time step a frame)');
    cap.listen(); assert.equal(cap.channel, '16'); assert.equal(cap.job, null, 'again: back to 16');
    cap.dispose();
  } finally { D.uninstall(); }
});

test('the radio on v2\'s state: the forecast by itself 20 s in, sampled a frame at a time, then played; never in a capture or with the VHF off', () => {
  const log = [], B = boat(), w = wind();
  const cap = createCaptain({ B, windField: w, terrain, settings: settingsMem(), live: true, dom: false, makeRadio: fakeRadio(log), flags: { chatter: false } });   // (?hm=0 also stops the auto forecast, v1's rule)
  assert.deepEqual(log, [{ made: true }], 'on by default: the radio made (its clip table) when the chunk comes, nothing played');
  cap.toggle(); cap.toggle();   //: the player's first use (the VHF button off, then on); before it nothing speaks
  let t = 0, frames = 0;
  while (t < AUTO_FORECAST_S - 0.1) { cap.update(1 / 60); t += 1 / 60; B.t += 2 / 60; }
  assert.equal(cap.job, null); assert.equal(log.length, 1, 'nothing before 20 s');
  while (!cap.job) { cap.update(1 / 60); B.t += 2 / 60; t += 1 / 60; assert.ok(t < AUTO_FORECAST_S + 0.2, 'the job starts at 20 s'); }
  while (!log.some((x) => x.play)) { cap.update(1 / 60); B.t += 2 / 60; frames++; assert.ok(frames < 30, 'the job ends'); }
  assert.ok(frames >= 10 && frames <= 13, `the forecast sampled over ${frames} frames (7 + 3 time steps), never in one`);
  const fc = cap.forecast;
  assert.match(fc.text, /^Lake forecast for this afternoon\. /);
  assert.deepEqual(log.at(-1).play, fc.tokens.map((x) => x.id ?? x.pause), 'played: the forecast\'s tokens');
  assert.equal(cap.channel, 'WX 1');
  // v1's forecast from the same field at the same time
  assert.equal(fc.text, forecastFor({ wind: forecastWind(wind(), B.t), t: B.t, terrain: { heightAt, shoreDistance } }).text, 'the same words as v1\'s forecast on the lake\'s shore distance');
  // the radio's own clock: played out, the LCD back to 16 after 4 s
  for (let i = 0; i < 60 * (fc.tokens.length + 6); i++) cap.update(1 / 60);
  assert.equal(cap.channel, '16'); assert.equal(cap.radio.state.playing, false);
  // off: stops at once, nothing more
  cap.listen(); assert.ok(cap.job); cap.setOn(false);
  assert.equal(cap.on, false); assert.equal(cap.job, null); assert.equal(cap.channel, '16');
  const n = log.length; for (let i = 0; i < 600; i++) cap.update(1 / 60); assert.equal(log.length, n, 'off: silent');
  // a capture (headless) and a page with the VHF saved off never speak by themselves
  for (const [o, why] of [[{ settings: settingsMem(), flags: { headless: '1' } }, 'headless'], [{ settings: settingsMem({ vhf: false }), flags: {} }, 'vhf off']]) {
    const L = [], c = createCaptain({ B: boat(), windField: w, terrain, live: true, dom: false, makeRadio: fakeRadio(L), ...o });
    for (let i = 0; i < 60 * 30; i++) c.update(1 / 60);
    assert.ok(!L.some((x) => x.play), `${why}: no forecast`);
    if (why === 'vhf off') { assert.deepEqual(L, [], 'off: no radio made, no clip fetched'); c.toggle(); assert.deepEqual(L, [{ made: true }], 'the VHF button on: the radio made'); }
  }
});

//, 2026-11-17: "the VHF forecast audio loads on first use of the radio"; every device)
test('first use: before the player uses the radio no forecast or harbour call plays (the sprite never fetched); O plays it, the button\'s on brings the forecast', () => {
  const log = [], B = boat();
  const cap = createCaptain({ B, windField: wind(), terrain, settings: settingsMem(), live: true, dom: false, makeRadio: fakeRadio(log), flags: { chatter: false } });
  B.state.trueWind.speed = 9;   // a gust the harbour master would call
  for (let i = 0; i < 60 * (HM.warmS + 60); i++) { cap.update(1 / 60); B.t += 2 / 60; }
  assert.ok(!log.some((x) => x.play), 'unused: nothing played (no forecast at 20 s, no harbour call)');
  assert.equal(cap.used, false);
  cap.listen();   // O
  for (let i = 0; i < 30 && !log.some((x) => x.play); i++) cap.update(1 / 60);
  assert.equal(cap.used, true); assert.deepEqual(log.find((x) => x.play).play.slice(0, 1), ['hdr'], 'O: the forecast at once');
  const L2 = [], c2 = createCaptain({ B: boat(), windField: wind(), terrain, settings: settingsMem({ vhf: false }), live: true, dom: false, makeRadio: fakeRadio(L2), flags: { chatter: false } });
  for (let i = 0; i < 60 * 25; i++) c2.update(1 / 60);
  c2.toggle();   // the VHF button on, 25 s in: the forecast by itself now (its 20 s are past)
  for (let i = 0; i < 30 && !L2.some((x) => x.play); i++) c2.update(1 / 60);
  assert.ok(L2.some((x) => x.play), 'turned on: the forecast');
});

test('the harbour master on v2\'s true wind: the gust call after the warm-up, never over the forecast; the chatter near the entrance', () => {
  const log = [], B = boat(), cap = createCaptain({ B, windField: wind(), terrain, settings: settingsMem(), live: true, auto: false, dom: false, makeRadio: fakeRadio(log), flags: { chatter: false } });
  for (let i = 0; i < 60 * (HM.warmS + 5); i++) cap.update(1 / 60);
  assert.ok(!log.some((x) => x.play), 'a steady 4 m/s: no call');
  cap.listen();   // the forecast first: the harbour master waits
  B.state.trueWind.speed = 9;   // 17.5 kn, over 1.3 × the slow mean
  for (let i = 0; i < 20; i++) cap.update(1 / 60);
  assert.deepEqual(log.filter((x) => x.play).map((x) => x.play[0]), ['hdr'], 'the forecast plays; the gust waits');
  for (let i = 0; i < 60 * 40 && !log.some((x) => x.play?.[0] === 'hm_gust'); i++) cap.update(1 / 60);
  assert.ok(log.some((x) => x.play?.[0] === 'hm_gust'), 'the gust call once the radio is quiet');
  assert.deepEqual(cap.hmDone, ['hm_gust']);
  // the harbour's chatter: within 700 m of the entrance, on 16, never in the first 25 s
  const at = WORLD.harbour.entrance.centre, L = [], B2 = boat({ state: { x: at[0] + 100, z: at[1], trueWind: { speed: 3 } } });
  const c2 = createCaptain({ B: B2, windField: wind(), terrain, settings: settingsMem(), live: true, auto: false, dom: false, makeRadio: fakeRadio(L), flags: { hm: false } });
  for (let i = 0; i < 60 * (CHATTER.firstS - 1); i++) c2.update(1 / 60);
  assert.ok(!L.some((x) => x.chatter), 'not before 25 s');
  for (let i = 0; i < 60 * 3; i++) c2.update(1 / 60);
  assert.ok(L.some((x) => x.chatter), 'near the entrance: a murmur on 16');
  const L3 = [], c3 = createCaptain({ B: boat(), windField: wind(), terrain, settings: settingsMem(), live: true, auto: false, dom: false, makeRadio: fakeRadio(L3), flags: { hm: false } });
  for (let i = 0; i < 60 * 200; i++) c3.update(1 / 60);
  assert.ok(!L3.some((x) => x.chatter), 'out on the lake: none');
});

test('the Settings key vhf: the VHF button writes it; a change from elsewhere (Settings) stops the radio', () => {
  const log = [], s = settingsMem(), cap = createCaptain({ B: boat(), windField: wind(), terrain, settings: s, live: true, auto: false, dom: false, makeRadio: fakeRadio(log) });
  assert.equal(cap.on, true);
  cap.toggle(); assert.equal(s.get('vhf'), false); assert.equal(cap.on, false);
  cap.toggle(); assert.equal(s.get('vhf'), true);
  cap.listen(); for (let i = 0; i < 15; i++) cap.update(1 / 60);
  assert.equal(cap.radio.state.playing, true);
  s.set('vhf', false); assert.equal(cap.radio.state.playing, false, 'Settings off: stopped'); assert.equal(cap.channel, '16');
});

test('the frozen clock (v2\'s live timerate 0): v1\'s forecast in milliseconds; a running clock is the field itself; the fetch from v2\'s heights', () => {
  const w0 = wind(0), w1 = wind(1);
  assert.equal(forecastWind(w1, 10), w1, 'a running day clock: the field as it is');
  const t0 = performance.now(), f0 = forecastFor({ wind: forecastWind(w0, 10), t: 10, terrain: { heightAt, shoreDistance } });
  budget(performance.now() - t0, 2000, 'the frozen-clock forecast (it ran out to 10^13 s and exhausted the page before)');
  const f1 = forecastFor({ wind: w1, t: 10, terrain: { heightAt, shoreDistance } });
  assert.equal(f0.facts.window, 'afternoon'); assert.ok(f0.facts.hi >= f0.facts.lo + 4, `${f0.text}`);
  assert.equal(f0.facts.lo, f1.facts.lo, 'the same next hour as a running clock\'s (the day\'s base barely moves in an hour)');
  // the waves' fetch: v2's heights alone against the lake's shore-distance grids (v1's grids, lake-wide), every 45°
  const sd = shoreFromHeights(heightAt);
  for (let d = 0; d < 360; d += 45) {
    const a = fetchTraceOf(shoreDistance, d), b = fetchTraceOf(sd, d);
    assert.ok(Math.abs(a - b) <= Math.max(30, 0.03 * a), `${d}°: ${a.toFixed(0)} vs ${b.toFixed(0)} m`);
  }
});

test('every forecast token and harbour call has its clip in the shipped sprite (audio/vhf/forecast.json)', () => {
  const meta = JSON.parse(readFileSync(new URL('../../audio/vhf/forecast.json', import.meta.url), 'utf8'));
  const B = boat(), f = forecastFor({ wind: forecastWind(wind(0), 10), t: 10, terrain: { heightAt, shoreDistance } });
  const p = planTokens(f.tokens, meta.clips);
  assert.ok(p.items.every((it) => it.off != null), 'a clip for each word');
  for (const id of ['hm_anchor', 'hm_gust', 'hm_advisory', 'hm_storm']) assert.ok(meta.clips[id], id);
  assert.ok(p.dur > 8 && p.dur < 25, `${p.dur.toFixed(1)} s`);
  assert.equal(B.t, 0);
});

test('the radio\'s bus: its own gain node on the page\'s master, eased in; a stop eased out first (no click), then back up', async () => {
  const calls = [];
  class Param { constructor(v) { this.value = v; } setTargetAtTime(v, t, tau) { calls.push(['target', v, tau]); this.value = v; } setValueAtTime(v) { calls.push(['set', v]); } cancelScheduledValues() {} }
  const saved = globalThis.GainNode;
  globalThis.GainNode = class { constructor(ctx, o) { this.gain = new Param(o.gain); this.out = []; } connect(n) { this.out.push(n); return n; } };
  try {
    const master = { m: 1 }, ctx = { currentTime: 0 };
    let res; const audio = { ready: new Promise((r) => { res = r; }) };
    const bus = radioAudio(audio); let got = null;
    bus.attach((o) => { got = o; });
    res({ ctx, master }); await audio.ready; await null;
    assert.ok(got && got.master !== master && got.master.out[0] === master, 'the radio\'s master is its own bus into the page\'s');
    assert.equal(got.master.gain.value, VHF_BUS.gain); assert.deepEqual(calls[0], ['target', VHF_BUS.gain, VHF_BUS.inS], 'eased in from 0');
    let stopped = false; bus.quiet(() => { stopped = true; });
    assert.equal(stopped, false, 'not cut at once'); assert.deepEqual(calls.at(-1), ['target', 0, VHF_BUS.outS], 'eased out');
    await new Promise((r) => setTimeout(r, VHF_BUS.stopMs + 20));
    assert.equal(stopped, true, 'then stopped'); assert.deepEqual(calls.at(-1), ['target', VHF_BUS.gain, VHF_BUS.inS], 'and the bus back up for the next call');
  } finally { globalThis.GainNode = saved; }
});

test('the page\'s CPU: the radio\'s frame without a job is a few µs; a forecast step a few ms', () => {
  const log = [], B = boat(), cap = createCaptain({ B, windField: wind(), terrain, settings: settingsMem(), live: true, auto: false, dom: false, makeRadio: fakeRadio(log) });
  // load-proof (v2 #29): the fastest of 20 batches of 300 idle frames; each forecast step's fastest of 5 jobs
  const idleUs = bestOf(() => cap.update(1 / 60), { batches: 20, per: 300 }) * 1000;
  budget(idleUs, 50, 'the radio\'s idle frame', 'µs');
  cap.listen(); while (cap.job) cap.update(1 / 60);
  // warm (the second forecast: the first pays the JIT), each step one time step of the bay's wind
  const steps = bestOfEach((time) => { cap.listen(); cap.listen(); while (cap.job) time(() => cap.update(1 / 60)); }, { batches: 5 });
  steps.sort((a, b) => a - b);
  budget(steps[steps.length >> 1], 8, 'forecast step, median'); budget(steps.at(-1), 20, 'forecast step, worst');
  assert.equal(dirOf(0, 0)[2], -1);
});
