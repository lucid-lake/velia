// node --test tests/air.test.mjs — Seeing the wind (src/air.js, src/boat/vane.js, the wind-lines setting): the masthead vane's
// response, the motes (pollen and fluff), the crest wisps, the beginners' wind lines and how they fade with the skill model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AirSim, AIR, airConfig, linesStrength } from '../src/sim/air.js';
import { VaneDamper, mastheadWind, VANE } from '../classic/src/boat/vane.js';
import { createSkills, RULES } from '../src/sail/skills.js';
import { createSettings, SETTINGS, WIND_LINES } from '../src/ui/settings.js';
import { buildSpars, solveRig, SPARS } from '../src/boat/spars.js';

const KN = 0.514444, DEG = Math.PI / 180;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
// a stub wind: a steady breeze FROM the west (toward +x) of `ms`, a gust factor `g`
const wind = (ms = 4, g = 1) => ({ sample: () => ({ vx: ms, vz: 0, speed: ms }), gustAt: () => g });
const run = (sim, secs, ctx, dt = 1 / 30) => { for (let t = 0; t < secs; t += dt) sim.update(dt, { t, cam: [0, 4, 0], boat: { x: 0, z: 0 }, light: 1, sun: [0, 0.5, 0.86], ...ctx }); return sim; };
const sum = (a) => a.reduce((s, v) => s + v, 0);

test('vane: the masthead wind adds the boat\'s own motion and is a little stronger up high', () => {
  // wind from dead ahead at 5 m/s true, the boat at 3 m/s: the apparent is 8 m/s dead ahead (here up high: × (1.2)^0.14)
  const st = { trueWind: { speed: 5, angle: 0 }, apparentWind: { speed: 8, angle: 0 } };
  const m = mastheadWind(st), g = Math.pow(VANE.mastM / VANE.refM, VANE.power);
  assert.ok(Math.abs(m.speed - (5 * g + 3)) < 1e-6, `${m.speed}`);
  assert.ok(Math.abs(m.angle) < 1e-9);
  // wind from the beam (starboard), boat 3 m/s: the apparent comes from forward of the beam, to starboard
  const b = mastheadWind({ trueWind: { speed: 5, angle: 90 * DEG }, apparentWind: { speed: Math.hypot(5, 3), angle: Math.atan2(5, 3) } });
  assert.ok(b.angle > 0 && b.angle < 90 * DEG, `${b.angle / DEG}`);
  assert.deepEqual(mastheadWind({}), { speed: 0, angle: 0 });
});

test('vane: a damped spring: settles on the wind inside 1.5 s, overshoots little, and is brisker in a stronger wind', () => {
  const settle = (ms) => {
    const v = new VaneDamper(); v.step(1 / 60, { speed: ms, angle: 0 });
    let t = 0, maxOver = 0, hit = null;
    for (; t < 6; t += 1 / 60) { const y = v.step(1 / 60, { speed: ms, angle: -60 * DEG }); maxOver = Math.max(maxOver, y - 60 * DEG); if (hit == null && Math.abs(y - 60 * DEG) < 3 * DEG) hit = t; }
    return { hit, maxOver, end: v.yaw };
  };
  const light = settle(2), brisk = settle(10);
  assert.ok(Math.abs(brisk.end - 60 * DEG) < 0.5 * DEG && Math.abs(light.end - 60 * DEG) < 0.5 * DEG, 'both end on the wind');
  assert.ok(brisk.hit < light.hit, `brisk ${brisk.hit} < light ${light.hit}`);
  assert.ok(light.hit < 1.5, `${light.hit}`);
  assert.ok(brisk.maxOver < 0.2 * 60 * DEG, `overshoot ${(brisk.maxOver / DEG).toFixed(1)}°`);
  // the shortest way round: from +170° to −170° the vane turns 20°, not 340°
  const v = new VaneDamper(); v.step(0.01, { speed: 5, angle: -170 * DEG }); v.step(1 / 60, { speed: 5, angle: 170 * DEG });
  assert.ok(Math.abs(v.rate) < 5 * 340 * DEG && v.rate > -200 * DEG, `rate ${v.rate}`);
});

test('vane: geometry: an arrow with a polished tip, and two fixed tabs (red to port, green to starboard) 45° off the bow', () => {
  const g = buildSpars(solveRig(SPARS));
  for (const md of [g.vane, g.vaneTabs]) { const a = md.arrays(); assert.ok(a.position.length > 0 && a.position.every(Number.isFinite) && a.normal.every(Number.isFinite)); }
  const tabs = g.vaneTabs.arrays(), cols = [];
  for (let i = 0; i < tabs.position.length; i += 3) cols.push([tabs.position[i], tabs.color[i], tabs.color[i + 1], tabs.color[i + 2]]);
  const redX = cols.filter((c) => c[1] > 0.25 && c[2] < 0.1).map((c) => c[0]), greenX = cols.filter((c) => c[2] > 0.1 && c[1] < 0.1).map((c) => c[0]);
  assert.ok(redX.length && Math.max(...redX) < 0, 'red is to port (−x)');
  assert.ok(greenX.length && Math.min(...greenX) > 0, 'green is to starboard (+x)');
  // the arrow's head (−z) carries a metal vertex (metalness 1, roughness ≤ 0.1): the tip that catches the light
  const a = g.vane.arrays();
  let tip = 0; for (let i = 0; i < a.mr.length; i += 2) if (a.mr[i] === 1 && a.mr[i + 1] <= 0.1) tip++;
  assert.ok(tip > 10, `polished vertices ${tip}`);
  // the vane's length is ≈ 1.3 × a Windex (0.33 m): 0.5 to 0.7 m with the tip
  let z0 = Infinity, z1 = -Infinity; for (let i = 2; i < a.position.length; i += 3) { z0 = Math.min(z0, a.position[i]); z1 = Math.max(z1, a.position[i]); }
  assert.ok(z1 - z0 > 0.5 && z1 - z0 < 0.7, `${(z1 - z0).toFixed(2)} m`);
});

test('air: the same seed and clock draw the same air (no Math.random)', () => {
  const a = run(new AirSim({ wind: wind(), seed: 3 }), 6, { lines: 1 }), b = run(new AirSim({ wind: wind(), seed: 3 }), 6, { lines: 1 }), c = run(new AirSim({ wind: wind(), seed: 4 }), 6, { lines: 1 });
  assert.deepEqual([...a.motes.x], [...b.motes.x]); assert.deepEqual([...a.lines.bx], [...b.lines.bx]);
  assert.notDeepEqual([...a.motes.x], [...c.motes.x]);
});

test('air: motes drift with the true wind, few in the pool, and none lower than the water\'s own flecks', () => {
  const sim = new AirSim({ wind: wind(4), seed: 1 });
  run(sim, 2, { lines: 0 });
  const x0 = [...sim.motes.x], z0 = [...sim.motes.z];
  run(sim, 2.0, { lines: 0 });
  let moved = 0, n = 0; for (let i = 0; i < sim.nMote; i++) if (sim.motes.alpha[i] > 0.01 && Math.abs(sim.motes.x[i] - x0[i]) < 20) { moved += sim.motes.x[i] - x0[i]; n++; }
  assert.ok(n > 20 && moved / n > 2.5, `mean downwind drift ${(moved / n).toFixed(2)} m in 2 s at 4 m/s (≈ 85 % of it)`);
  assert.ok(sim.motes.n - sim.nWisp <= 300, 'a few hundred');
  for (let i = 0; i < sim.nMote; i++) if (sim.motes.alpha[i] > 0.004) assert.ok(sim.motes.y[i] > AIR.lowFade[0], `a mote at ${sim.motes.y[i]} m shows`);
  // sparse in a breeze: at most the calm share of the pool
  assert.ok(sim.stats.active <= AIR.calmFrac * sim.nMote * 1.05, `${sim.stats.active}`);
});

test('air: denser and faster in a gust (a rise of the wind module\'s gust factor over its own mean)', () => {
  // the factor sits at 0.6 (a lee) for a minute, then 0.9: a gust of 1.5× its mean
  const stepWind = (ms) => ({ sample: () => ({ vx: ms, vz: 0, speed: ms }), gustAt: (x, z, t) => (t < 60 ? 0.6 : 0.9) });
  const go = (w) => { const s = new AirSim({ wind: w, seed: 1 }); let before = 0; for (let t = 0; t < 72; t += 1 / 30) { s.update(1 / 30, { t, cam: [0, 4, 0], boat: { x: 0, z: 0 }, light: 1, lines: 0 }); if (Math.abs(t - 59.9) < 1 / 60) before = s.stats.active; } return { s, before }; };
  const { s: gusty, before } = go(stepWind(4));
  assert.ok(gusty.stats.active > before * 1.4, `lee ${before}, gust ${gusty.stats.active}`);
  const calm = run(new AirSim({ wind: wind(4, 1.0), seed: 1 }), 72, { lines: 0 });
  assert.ok(gusty.stats.active > calm.stats.active * 1.4, `steady ${calm.stats.active}`);
  const fast = go(stepWind(8)).s;
  const speed = (s) => { let v = 0, n = 0; for (let i = 0; i < s.nMote; i++) if (s.motes.alpha[i] > 0.01) { v += Math.hypot(s.vx[i], s.vz[i]); n++; } return v / n; };
  assert.ok(speed(fast) > speed(gusty) * 1.6, `${speed(fast).toFixed(2)} vs ${speed(gusty).toFixed(2)}`);
});

test('air: none at night, none in rain', () => {
  const night = run(new AirSim({ wind: wind(4, 1.0), seed: 1 }), 8, { lines: 1, light: 0.05 });
  assert.equal(night.stats.active, 0); assert.ok(Math.max(...night.motes.alpha) < 1e-3, 'every mote and wisp dark');
  const rain = run(new AirSim({ wind: wind(4, 1.0), seed: 1 }), 8, { lines: 0, rain: 1 });
  assert.equal(rain.stats.active, 0);
  // dusk: dimmer than noon
  const dusk = run(new AirSim({ wind: wind(4, 1.0), seed: 1 }), 8, { lines: 0, light: 0.3 }), noon = run(new AirSim({ wind: wind(4, 1.0), seed: 1 }), 8, { lines: 0 });
  assert.ok(sum(dusk.motes.alpha) < sum(noon.motes.alpha));
});

test('air: crest spray only above ≈ 18 kn, sparse, thin and short-lived', () => {
  const waves = () => ({ y: 0.5 });   // every point a crest
  const below = run(new AirSim({ wind: wind(17 * KN), seed: 1, waveAt: waves }), 10, { lines: 0 });
  assert.equal(below.stats.wisps, 0, '17 kn: none');
  let peak = 0, sim = new AirSim({ wind: wind(24 * KN), seed: 1, waveAt: waves });
  for (let t = 0; t < 10; t += 1 / 30) { sim.update(1 / 30, { t, cam: [0, 4, 0], boat: { x: 0, z: 0 }, light: 1, lines: 0 }); peak = Math.max(peak, sim.stats.wisps); }
  assert.ok(peak > 0 && peak <= 12, `at 24 kn up to ${peak} wisps at once`);
  const A = AIR.spray; assert.ok(A.alpha <= 0.25 && A.size[1] <= 0.4 && A.life[0] + A.life[1] <= 1.3 && A.rate <= 10);
  // no crest, no spray (flat water)
  assert.equal(run(new AirSim({ wind: wind(24 * KN), seed: 1, waveAt: () => ({ y: 0 }) }), 6, { lines: 0 }).stats.wisps, 0);
  assert.equal(run(new AirSim({ wind: wind(24 * KN), seed: 1 }), 6, { lines: 0 }).stats.wisps, 0, 'no wave field, none');
});

test('air: the wind lines flow with the wind, gather in gusts, and vanish with strength 0', () => {
  const on = run(new AirSim({ wind: wind(5), seed: 1 }), 8, { lines: 1 });
  assert.ok(on.stats.lines > 25, `${on.stats.lines} strokes`);
  // each stroke lies along the wind (+x here) and is a short stroke, 2–8 m
  let along = 0, n = 0; const L = on.lines;
  for (let j = 0; j < L.n; j++) if (L.alpha[j] > 0.02) { const dx = L.bx[j] - L.ax[j], dz = L.bz[j] - L.az[j], len = Math.hypot(dx, dz); assert.ok(len <= 8.01); if (len > 0.3) { along += dx / len; n++; } }
  assert.ok(n > 15 && along / n > 0.95, `alignment ${(along / n).toFixed(3)}`);
  const off = run(new AirSim({ wind: wind(5), seed: 1 }), 12, { lines: 0 });
  assert.equal(off.stats.lines, 0); assert.ok(Math.max(...off.lines.alpha) < 1e-3);
  // gathering: strokes spawn where the gust factor is high first (a stripe of gust at z > 0 vs calm at z < 0)
  const striped = { sample: () => ({ vx: 5, vz: 0, speed: 5 }), gustAt: (x, z) => (z > 0 ? 1.4 : 0.9) };
  const sg = run(new AirSim({ wind: striped, seed: 2 }), 10, { lines: 1 });
  let hi = 0, lo = 0; for (let j = 0; j < sg.lines.n; j++) if (sg.lines.alpha[j] > 0.02) (sg.lp.z[j] > 0 ? hi++ : lo++);
  assert.ok(hi > lo * 1.4, `gust side ${hi}, calm side ${lo}`);
});

test('air: the lines fade out over a few seconds when their strength drops (not a pop)', () => {
  const sim = run(new AirSim({ wind: wind(5), seed: 1 }), 6, { lines: 1 });
  const before = sum(sim.lines.alpha);
  sim.update(1 / 30, { t: 6, cam: [0, 4, 0], boat: { x: 0, z: 0 }, light: 1, lines: 0 });
  assert.ok(sum(sim.lines.alpha) > 0.8 * before, 'one frame later they are still there');
  for (let t = 6.03; t < 14; t += 1 / 30) sim.update(1 / 30, { t, cam: [0, 4, 0], boat: { x: 0, z: 0 }, light: 1, lines: 0 });
  assert.ok(sum(sim.lines.alpha) < 0.1 * before, 'and gone within about 8 s');
});

test('lines setting: on / auto / off; auto fades with the skill model\'s windRead()', () => {
  assert.equal(SETTINGS.windLines, 'off'); assert.deepEqual(WIND_LINES, ['on', 'auto', 'off']);   // off by default (owner, 2026-10-30)
  assert.equal(linesStrength('on', 1), 1); assert.equal(linesStrength('off', 0), 0);
  assert.equal(linesStrength('auto', 0), 1); assert.equal(linesStrength('auto', 1), 0); assert.ok(Math.abs(linesStrength('auto', 0.65) - 0.35) < 1e-9);
  const s = createSettings({ storage: null });
  assert.equal(s.get('windLines'), 'off');
  assert.equal(s.set('windLines', 'bogus'), 'off'); assert.equal(s.set('windLines', true), 'off');
  assert.equal(s.set('windLines', 'off'), 'off'); assert.equal(s.get('windLines'), 'off');
  const store = new Map(); const mem = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  createSettings({ storage: mem }).set('windLines', 'on'); assert.equal(createSettings({ storage: mem }).get('windLines'), 'on', 'saved per browser');
  store.set('lakeshore.settings.v1', JSON.stringify({ windLines: 'nonsense' })); assert.equal(createSettings({ storage: mem }).get('windLines'), 'off');
});

test('lines setting: a row on the home card\'s Settings page, wired and painted', async () => {
  const { pagesHtml } = await import('../src/ui/homePages.js');
  const html = pagesHtml({ waters: [], vessels: [], wChosen: '', vChosen: '', wSoon: '', vSoon: '' });
  const row = html.match(/<div class="set" data-set="windlines">.*?<\/div>/s)?.[0] ?? '';
  assert.match(row, /wind lines/);
  for (const q of ['on', 'auto', 'off']) assert.match(row, new RegExp(`data-r="windLines:${q}"`));
  // the row painted from the setting, a click setting it and the shell handing it to the controls: a real browser
  // (tests/pages/shellRows.page.mjs (retired 2026-11-18)); the controls fading the lines by the skill: tests/pages/liveFlags.page.mjs (retired 2026-11-18)
});

test('skills: windRead() rises as gusts are steered into and headers tacked, and a pro reads the wind already', () => {
  const BASE = { twa: -60 * DEG, tws: 5, awa: -40 * DEG, sog: 2.8, heading: 0, heel: 0.2, mainFill: 1, mainStall: 0, boomAngle: 25 * DEG, surf: 0, roundUp: 0, groove: 0, level: 3, steer: 0, pull: 0, crew: false, gust: null };
  const sk = createSkills();
  assert.equal(sk.windRead(), 0, 'a newcomer reads nothing');
  // a gust patch to starboard, seen, steered toward, then entered: three times
  const G = RULES.gusts;
  for (let k = 1; k <= 3; k++) {
    for (let t = 0; t < 4; t += 1 / 30) sk.update(1 / 30, { ...BASE, gust: { here: 1, left: 1, right: 1.3 } });
    for (let t = 0; t < 2; t += 1 / 30) sk.update(1 / 30, { ...BASE, steer: 1, gust: { here: 1.0, left: 1, right: 1.3 } });
    for (let t = 0; t < 6; t += 1 / 30) sk.update(1 / 30, { ...BASE, gust: { here: 1.3, left: 1, right: 1 } });
    for (let t = 0; t < 8; t += 1 / 30) sk.update(1 / 30, { ...BASE, gust: { here: 1, left: 1, right: 1 } });
    if (k < 3) assert.ok(sk.windRead() >= (k - 1) * 0.65 / 3 - 1e-9 && sk.windRead() < 0.65, `after ${k}: ${sk.windRead()}`);
  }
  assert.ok(sk.mastered('gusts') && Math.abs(sk.windRead() - 0.65) < 1e-9, `gusts mastered: ${sk.windRead()}`);
  // "I sail" or a pro reads it all
  const p = createSkills(); p.setISail(true); assert.equal(p.windRead(), 1);
  assert.equal(G.into, 3);
});

test('notes: the wind lines and the skill are on file', { skip: "not in the public tree: it reads a private design note" }, () => {
  assert.match(read(''), /windRead/);
});
