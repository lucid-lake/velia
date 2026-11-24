// Play as Tessie, phase 2a (§ 3.2; owner, 2026-11-20, every default approved): the eye under the
// water and the new controls, on her real sim and the real camera. Behaviour only: the modules are called and their state read.
//   the crossing's hysteresis: under at a nose deeper than 1.8 m (the look below level), up shallower than 0.8 m or on a breach; swimming
//     at 1.2 m never flips it; each crossing takes 0.25–0.4 s and the eye never parks in the band round the surface
//   the climb rate: a hold band of ±8°, full at 35°, smoothstep between; 1.2 m/s walking, 1.6 m/s running, only while she swims
//   keys win over the look (E up, Q down; 0.6 m/s from a drift); a tablet's look never changes depth
//   the limits: 20 m at most, never deeper than the water less 2 m, no dive in water under 6 m; the rate eases over the last 1.5 m
//   the surface's catch: a climb by E or the look ends at the surface swim, never a breach; a level look holds depth within 0.1 m for 20 s
//   the breach: Shift + E at the surface; a running climb of at least 1.0 m/s from depth as her nose passes 1.5 m
//   the assist camera: the yaw waits 1.0 s after the last drag, then swings in behind her (at most 40°/s); the look levels at a limit and
//     after 3 s at rest (15°/s); the automatic pitch at most 30°/s; reduced motion halves the rates; no roll ever, FOV 55°
//   the medium (Tahoe's numbers): a 2 % step seen to 20.6 m in green, 29.6 m in blue; the window a 97° cone; the lens's side test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay, PLAY, LINES, lookRate, climbRate, easeRate, depthWord, noseLimit } from '../sim/tessiePlay.js';
import { createTessieCam, nextMedium, rigBlend, TCAM } from '../ui/tessieCam.js';
import { sightM, sigmaAt, snellK, CRITICAL_DEG, windowRadius, UM_WIND, UNDER } from '../render/underMedium.js';
import { SEEN } from '../render/underwater.js';
import { lensSide, pixelSide, LENS } from '../render/underBack.js';
import { tessieSettings, TESSIE_SETTINGS } from '../ui/tessieSettings.js';

const DT = 1 / 30, DEG = Math.PI / 180;
const make = (depthAt = () => 40) => { const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); C.begin({ x: 0, z: 0, heading: 0 }); return { sim, C }; };
const run = (sim, C, secs, hands, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { sim.step(DT, { playing: true }); C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, {}); each?.(i * DT); } };

test('the climb rate: a ±8° hold band, full at 35° (smoothstep), 1.2 m/s walking, 1.6 m/s running, never at a drift', () => {
  assert.equal(lookRate(7.9 * DEG, 1.2), 0); assert.equal(lookRate(-7.9 * DEG, 1.2), 0);
  assert.ok(Math.abs(lookRate(35 * DEG, 1.2) - 1.2) < 1e-9 && Math.abs(lookRate(50 * DEG, 1.2) - 1.2) < 1e-9, 'full at 35° and past');
  assert.ok(Math.abs(lookRate(-35 * DEG, 1.6) + 1.6) < 1e-9, 'up is negative (her nose shallower)');
  const mid = lookRate(21.5 * DEG, 1.2);
  assert.ok(Math.abs(mid - 0.6) < 1e-6, `smoothstep: half the cap half way (${mid})`);
  let prev = 0; for (let a = 8; a <= 35; a += 0.5) { const v = lookRate(a * DEG, 1.2); assert.ok(v >= prev - 1e-12); prev = v; }
  assert.equal(climbRate({ look: 30 * DEG, swimming: false }), 0, 'a drift: the look steers nothing');
  assert.ok(Math.abs(climbRate({ look: 40 * DEG, swimming: true, nose: 5 }) - PLAY.rate) < 1e-9);
  assert.ok(Math.abs(climbRate({ look: 40 * DEG, swimming: true, run: true, nose: 5 }) - PLAY.rateRun) < 1e-9);
  assert.equal(climbRate({ look: 12 * DEG, swimming: true, nose: 0.5 }), 0, 'at the surface a look under the 15° guard keeps her up');
  assert.ok(climbRate({ look: 20 * DEG, swimming: true, nose: 0.5 }) > 0, 'past the guard she dives');
});

test('keys win over the look: E up and Q down at the cap (0.6 m/s from a drift); a tablet\'s look never changes depth', () => {
  assert.equal(climbRate({ look: 40 * DEG, swimming: true, rise: true, nose: 5 }), -PLAY.rate, 'E against a look down: E');
  assert.equal(climbRate({ look: -40 * DEG, swimming: true, sink: true, nose: 5 }), PLAY.rate, 'Q against a look up: Q');
  assert.equal(climbRate({ sink: true, swimming: false, nose: 5 }), PLAY.rateDrift, 'Q from a drift: she sculls');
  assert.equal(climbRate({ rise: true, swimming: true, run: true, nose: 5 }), -PLAY.rateRun, 'Shift + E');
  assert.equal(climbRate({ rise: true, sink: true, swimming: true, look: 40 * DEG, nose: 5, lookSteers: false }), 0, 'both keys: nothing, and no look on a tablet');
  assert.equal(climbRate({ look: 40 * DEG, swimming: true, nose: 5, lookSteers: false }), 0, 'a tablet: the look only looks');
  assert.equal(climbRate({ diveTo: 6, nose: 0.5 }), PLAY.rate, 'a tap on ▼ at the surface: a dive to 6 m'); assert.equal(climbRate({ diveTo: 6, nose: 5.95 }), 0, 'and it ends there');
  // on the real sim: Q with the look up still takes her down
  const { sim, C } = make();
  run(sim, C, 6, { move: [0, 1], sink: true, look: -30 * DEG });
  assert.ok(C.state.nose > 3, `Q wins over the look up (${C.state.nose.toFixed(2)} m)`);
});

test('the limits: 20 m at most, never deeper than the water less 2 m, no dive in water under 6 m; she never bumps', () => {
  const deep = make(() => 60);
  let max = 0, lastV = 0;
  run(deep.sim, deep.C, 40, { move: [0, 1], sink: true }, () => { max = Math.max(max, deep.C.state.nose); lastV = deep.C.state.climb; });
  assert.ok(max <= PLAY.deepNose + 0.3 && max > PLAY.deepNose - 0.5, `her deepest ${max.toFixed(2)} m (20)`);
  assert.equal(deep.C.state.limit, 'floor', 'at her deepest the limit says so');
  assert.ok(Math.abs(lastV) < 0.15, `eased to a stop (${lastV.toFixed(3)} m/s)`);
  assert.equal(depthWord(deep.C.state.nose), 'DEEP');
  const mid = make(() => 12);
  let m2 = 0; run(mid.sim, mid.C, 30, { move: [0, 1], sink: true }, () => { m2 = Math.max(m2, mid.C.state.nose); });
  assert.ok(m2 <= 10.3 && m2 > 9.4, `in 12 m of water: the water less 2 m, her swim's own wave ±0.3 m (${m2.toFixed(2)})`);
  const sh = make(() => 5);
  run(sh.sim, sh.C, 8, { move: [0, 1], sink: true });
  assert.ok(sh.C.state.nose < 1.0, `in 5 m of water: no dive (${sh.C.state.nose.toFixed(2)})`);
  assert.equal(noseLimit(5, 'deep'), 0); assert.equal(noseLimit(40, 'deep'), 20); assert.equal(noseLimit(15, 'deep'), 13);
  assert.ok(easeRate(3, 19.5, 20) < 3 * 0.4 && easeRate(3, 19.5, 20) > 0, 'the ease over the last 1.5 m');
  assert.equal(easeRate(1.2, 20, 20), 0); assert.equal(easeRate(-1.2, PLAY.swimY, 20), 0);
});

test('the surface catch: E from 10 m ends at the surface swim, never a breach; a level look holds depth within 0.1 m for 20 s', () => {
  const { sim, C } = make();
  run(sim, C, 12, { move: [0, 1], sink: true });
  const d0 = C.state.nose;
  assert.ok(d0 > 8, `down first (${d0.toFixed(1)} m)`);
  // a level look (inside the hold band) while she swims: her depth holds
  let lo = Infinity, hi = -Infinity;
  run(sim, C, 20, { move: [0, 1], look: 5 * DEG }, (t) => { if (t > 1) { lo = Math.min(lo, C.state.nose); hi = Math.max(hi, C.state.nose); } });
  assert.ok(hi - lo < 0.1, `a level look holds her depth (${lo.toFixed(2)}–${hi.toFixed(2)} m)`);
  const ev = []; let fastNear = 0;
  run(sim, C, 16, { move: [0, 1], rise: true }, () => { for (const e of C.events) ev.push(e.type); if (C.state.nose < PLAY.swimY + 0.5 && C.state.nose > PLAY.swimY + 0.05) fastNear = Math.max(fastNear, -C.state.climb); });
  assert.ok(!ev.includes('breach'), `E alone never breaches (${ev.join(',')})`);
  assert.ok(C.state.nose < 1.0, `she is at the surface (${C.state.nose.toFixed(2)} m)`);
  assert.ok(fastNear < 0.6 * PLAY.rate, `the catch: slow over the last half metre (${fastNear.toFixed(2)} m/s)`);
  assert.ok(ev.includes('surfaced'), 'her breath on surfacing');
});

test('the breach: the dash + E at the surface; a dash climbing 3 m/s or more from depth as her nose passes 1.5 m; a slow climb never', () => {
  const a = make(); run(a.sim, a.C, 3, { move: [0, 1] });
  const ev = []; run(a.sim, a.C, 1, { rise: true, sprint: true }, () => { for (const e of a.C.events) ev.push(e.type); });
  assert.ok(ev.includes('breach'), `the dash + E at the surface (${ev.join(',')})`);
  const b = make(); run(b.sim, b.C, 12, { move: [0, 1], sink: true });
  const evB = []; let at = null;
  run(b.sim, b.C, 12, () => ({ move: [0, 1], rise: true, sprint: b.C.state.nose < 9 }), () => { for (const e of b.C.events) { evB.push(e.type); if (e.type === 'breach' && at == null) at = e.from; } });   // E up; Shift pressed as she passes 9 m
  assert.ok(evB.includes('breach') && at <= PLAY.breachAtM + 0.1 && at > 0.8, `a dash climb from depth breaches at ${at?.toFixed(2)} m`);
  const c = make(); run(c.sim, c.C, 12, { move: [0, 1], sink: true });
  const evC = []; run(c.sim, c.C, 25, () => ({ move: [0, 1], sprint: c.C.state.nose > 1.6, look: -16 * DEG }), () => { for (const e of c.C.events) evC.push(e.type); });   // a dash, the look 16° up: under 3 m/s
  assert.ok(!evC.includes('breach'), `a slow climb (${lookRate(-16 * DEG, PLAY.rateRun).toFixed(2)} m/s) is caught, never a breach (${evC.join(',')})`);
  assert.equal(LINES.fast, 'Faster below the surface. Hold [Q] to dive.');   // [Q]: a key cap on the skipper's line (the UI audit)
});

// the camera on her real sim, the water flat at 0 (the medium's own rules) and a deep bed
function film(secs, hands, o = {}) {
  const sim = createTessie({ seed: 5, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 }), cam = createTessieCam();
  C.begin({ x: 0, z: 0, heading: 0 });
  const rows = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    const t = i * DT, h = hands(t, C, cam);
    sim.step(DT, { playing: true }); C.step(DT, { look: cam.look, ...h }, {});
    const n = sim.state.nose;
    const c = cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, waterAt: () => 0, floorAt: () => -40, limit: !!C.state.limit, resting: !(h.move || h.sink || h.rise), breach: C.state.lunge?.phase === 'breach', ...o, ...(h.cam ?? {}) });
    rows.push({ t, y: c.pos[1], u: { ...c.under }, nose: C.state.nose, yaw: cam.yaw, pitch: cam.pitch, look: cam.look, fov: c.fov, up: [...c.up], psi: n.psi });
  }
  return rows;
}

test('the crossing is gradual (owner, 2026-11-20): one continuous rig, the eye through the surface slowly, no jump, no flag flip-flop', () => {
  assert.equal(rigBlend(0.5), 0); assert.equal(rigBlend(3.5), 1); assert.ok(rigBlend(2) > 0.3 && rigBlend(2) < 0.7);
  assert.equal(nextMedium('air', 0.01), 'air', 'within the hysteresis: the side it was on'); assert.equal(nextMedium('air', 0.3), 'water'); assert.equal(nextMedium('water', -0.01), 'water'); assert.equal(nextMedium('water', -0.3), 'air');
  const rows = film(40, (t) => (t < 4 ? { move: [0, 1] } : t < 12 ? { move: [0, 1], sink: true } : t < 20 ? { move: [0, 1] } : { move: [0, 1], rise: true }));
  let worstStep = 0, worstNear = 0, band = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.t > 3) worstStep = Math.max(worstStep, Math.abs(b.y - a.y));
    if (b.t > 3 && Math.abs(a.u.depth) < TCAM.under.slowM && Math.abs(b.u.depth) < TCAM.under.slowM) worstNear = Math.max(worstNear, Math.abs(b.y - a.y) / DT);
    if (b.t > 4 && b.t < 20 && b.u.crossing) band += DT;
  }
  assert.ok(worstStep < 0.2, `no jump: the eye's worst step ${worstStep.toFixed(3)} m a frame`);
  assert.ok(worstNear <= TCAM.under.slowV + 1e-6, `through the surface at most ${TCAM.under.slowV} m/s (${worstNear.toFixed(2)})`);
  assert.ok(band > 1.2, `the split frame lasts ${band.toFixed(2)} s on the way down (a gradual crossing, never a 0.3 s wipe)`);
  const flips = []; for (let i = 1; i < rows.length; i++) if (rows[i].t > 3 && rows[i].u.medium !== rows[i - 1].u.medium) flips.push(rows[i].t.toFixed(1));
  assert.equal(flips.length, 2, `the eye's side flips once down, once up (${flips.join(', ')})`);
  assert.ok(rows.filter((r) => r.t > 14 && r.t < 20).every((r) => r.u.medium === 'water' && r.u.k > 0.95), 'down: the water rig');
  assert.ok(rows.filter((r) => r.t > 36).every((r) => r.u.medium === 'air'), 'up: the air rig');
  for (const r of rows) { assert.deepEqual(r.up, [0, 1, 0], 'no roll'); assert.equal(r.fov, 55); }
  // the eye parked at the waterline with a swell lapping at the lens: its side never flip-flops
  const sim = createTessie({ seed: 5, depthAt: () => 40 }); sim.ambush(0, 0, 0, 1); sim.step(DT, { playing: true });
  const cam = createTessieCam(); let flipped = 0, prev = null, nose = 0;
  for (let i = 0; i < 900; i++) {
    const t = i * DT, wave = 0.12 * Math.sin(t * 1.9);
    const c = cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: 0, nose: i < 300 ? Math.min(2, i * DT) : 2, waterAt: () => wave });
    if (i > 450 && prev && c.under.medium !== prev) flipped++;
    prev = c.under.medium; nose = c.under.depth;
  }
  assert.ok(flipped <= 1, `a swell at the lens: ${flipped} flips (the eye at ${nose.toFixed(2)} m)`);
});

test('the assist camera: the yaw waits 1.0 s after the last drag, then swings in (at most 40°/s); the look levels at a limit and after 3 s at rest; reduced halves the rates', () => {
  const sim = createTessie({ seed: 5, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 }), cam = createTessieCam();
  C.begin({ x: 0, z: 0, heading: 0 });
  const step = (o = {}, h = { move: [0, 1] }) => { sim.step(DT, { playing: true }); C.step(DT, { look: cam.look, ...h }, {}); const n = sim.state.nose; return cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, waterAt: () => 0, ...o }); };
  for (let i = 0; i < 60; i++) step();
  for (let i = 0; i < 10; i++) step({ orbit: [0.06, 0], follow: true });   // a drag: 34° to the side
  const y0 = cam.yaw; let moved = null, worst = 0, prev = cam.yaw;
  for (let i = 0; i < 120; i++) { step({ follow: true }); if (moved == null && Math.abs(cam.yaw - y0) > 1e-4) moved = (i + 1) * DT; worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(cam.yaw - prev), Math.cos(cam.yaw - prev))) / DT); prev = cam.yaw; }
  assert.ok(moved != null && moved >= 0.95 && moved <= 1.1, `the recentre waits 1.0 s (moved after ${moved?.toFixed(2)} s)`);
  assert.ok(worst <= 40 * DEG + 1e-6 && worst > 5 * DEG, `then at most 40°/s (${(worst / DEG).toFixed(1)})`);
  assert.ok(Math.abs(Math.atan2(Math.sin(cam.yaw - sim.state.nose.psi), Math.cos(cam.yaw - sim.state.nose.psi))) < 4 * DEG, 'behind her again');
  // "Camera follows her" off: no recentre
  for (let i = 0; i < 6; i++) step({ orbit: [0.06, 0], follow: true });
  const y1 = cam.yaw; for (let i = 0; i < 90; i++) step({ follow: true, followOn: false });
  assert.ok(Math.abs(cam.yaw - y1) < 1e-9, 'Camera follows her off: the look stays');
  // the look levels at a limit (over about 1 s)
  for (let i = 0; i < 8; i++) step({ orbit: [0, 0.05] });
  const l0 = cam.look; assert.ok(l0 > 0.3, `a look down (${(l0 / DEG).toFixed(0)}°)`);
  for (let i = 0; i < 30; i++) step({ limit: true });
  assert.ok(Math.abs(cam.look) < 0.1 * l0, `levelled in 1 s at a limit (${(cam.look / DEG).toFixed(1)}°)`);
  // and after 3 s at rest, at 15°/s
  for (let i = 0; i < 8; i++) step({ orbit: [0, 0.05] });
  for (let i = 0; i < 10; i++) step();   // the drag's smoothing settles
  const l1 = cam.look; for (let i = 0; i < Math.round(2.9 / DT); i++) step({ resting: true }, {});
  assert.ok(Math.abs(cam.look - l1) < 1e-6, 'nothing before 3 s at rest');
  const a = cam.look; for (let i = 0; i < 30; i++) step({ resting: true }, {});
  const rate = (a - cam.look) / (30 * DT) / DEG;
  assert.ok(rate > 13 && rate < 16, `then 15°/s (${rate.toFixed(1)})`);
  // the automatic pitch moves at most 30°/s
  let wp = 0, pp = cam.pitch; for (let i = 0; i < 90; i++) { step({ limit: true }); wp = Math.max(wp, Math.abs(cam.pitch - pp) / DT); pp = cam.pitch; }
  assert.ok(wp <= 30 * DEG + 1e-6, `the pitch at most 30°/s (${(wp / DEG).toFixed(1)})`);
  // reduced motion: 15°/s at rest becomes 7.5°/s, the recentre waits 2 s
  const cr = createTessieCam();
  const sim2 = createTessie({ seed: 5, depthAt: () => 40 }), C2 = createTessiePlay({ sim: sim2, depthAt: () => 40 }); C2.begin({ x: 0, z: 0, heading: 0 });
  const st2 = (o = {}) => { sim2.step(DT, { playing: true }); C2.step(DT, { move: [0, 1] }, {}); const n = sim2.state.nose; return cr.step(DT, { spine: sim2.state.spine, L: sim2.L, psi: n.psi, nose: C2.state.nose, reduced: true, ...o }); };
  for (let i = 0; i < 30; i++) st2();
  for (let i = 0; i < 10; i++) st2({ orbit: [0.06, 0], follow: true });
  const yr = cr.yaw; let mr = null; for (let i = 0; i < 90; i++) { st2({ follow: true }); if (mr == null && Math.abs(cr.yaw - yr) > 1e-4) mr = (i + 1) * DT; }
  assert.ok(mr != null && mr >= 1.95, `reduced: the recentre waits 2 s (${mr?.toFixed(2)})`);
});

test('the medium: Tahoe\'s sight (20.6 m green, 29.6 m blue), a storm\'s 5–8 m at depth, the 97° window, the lens\'s side test', () => {
  const s = sightM(16);
  assert.ok(Math.abs(s[1] - 20.6) < 0.1 && Math.abs(s[2] - 29.6) < 0.1, `sight at depth ${s.map((x) => x.toFixed(1)).join(' / ')} m`);
  const top = sightM(1);
  assert.ok(top[1] >= 25 && top[1] <= 30, `the bright shallows: ${top[1].toFixed(1)} m in green (owner: realistic, 25–30 m)`);
  const st = sightM(10, { storm: 1 });
  assert.ok(st[1] > 5 && st[1] < 9 && st[2] > 6 && st[2] < 10, `a storm at depth: ${st.map((x) => x.toFixed(1)).join(' / ')} m`);
  const bub = sightM(0.5, { storm: 1, wind: 14, rain: 1 });
  assert.ok(bub[2] < 2, `in the bubble layer: under 2 m (${bub[2].toFixed(2)})`);
  assert.ok(sigmaAt(0.5, { wind: 14 })[1] > sigmaAt(4, { wind: 14 })[1], 'the wind\'s bubbles only in the top metres');
  assert.ok(Math.abs(CRITICAL_DEG - 48.6) < 0.05, `critical angle ${CRITICAL_DEG.toFixed(2)}°`);
  assert.ok(snellK(Math.cos(40 * DEG)) > 0 && snellK(Math.cos(55 * DEG)) < 0, 'inside the window at 40° off vertical, mirror at 55°');
  assert.ok(Math.abs(windowRadius(8) * 2 - 18.2) < 0.2, `the window 18 m across from 8 m down (${(windowRadius(8) * 2).toFixed(1)})`);
  assert.deepEqual([...UM_WIND.wind], [...SEEN.wind]); assert.equal(UM_WIND.rain, SEEN.rain); assert.equal(UM_WIND.storm, SEEN.storm);
  assert.ok(UNDER.edge > 0.2 && UNDER.edge < 0.25, 'the window\'s soft edge (Abyssal Garden\'s 0.22)');
  // the lens: a level eye 0.2 m under a flat surface; a pixel looking up 30° is over the line, level is under
  assert.ok(lensSide([0, -0.2, 0], [0, Math.sin(30 * DEG), Math.cos(30 * DEG)]) > 0);
  assert.ok(lensSide([0, -0.2, 0], [0, 0, 1]) < 0);
  assert.ok(lensSide([0, -0.2, 0], [0, 0, 1], { h: 0, sx: 0, sz: -0.5 }) > 0, 'a sloping wave at the lens bends the line');
  assert.ok(LENS.m >= 0.5 && LENS.m <= 1.5 && LENS.band >= TCAM.under.slowM);
  // the split frame's rule: the eye at the waterline looking level, the pixels over the line take the air's path, under it the water's
  const eye = [0, 0.0, 0], up = [0, Math.sin(10 * DEG), Math.cos(10 * DEG)], down = [0, -Math.sin(10 * DEG), Math.cos(10 * DEG)];
  assert.equal(pixelSide(eye, up, {}), 'air'); assert.equal(pixelSide(eye, down, {}), 'water');
  assert.equal(pixelSide(eye, up, { h: 0.3 }), 'water', 'a crest at the lens: the line rises over that pixel');
  assert.equal(pixelSide([0, 0.6, 0], down, {}), 'air', '0.6 m up the frame is all air at a level look');
});

test('the settings: Invert up/down off and Camera follows her on by default, each remembered', () => {
  const mem = new Map(), store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const S = tessieSettings(store);
  assert.equal(S.get('invert'), false); assert.equal(S.get('follow'), true);
  S.set('invert', true); S.set('follow', false);
  assert.deepEqual(JSON.parse(mem.get(TESSIE_SETTINGS.key)), { invert: true, follow: false });
  S.forget(); assert.equal(S.get('invert'), true); assert.equal(S.get('follow'), false);
  assert.equal(S.set('nope', true), false);
});

test('agile under the water (owner, 2026-11-20): Q and E at 4.5 m/s (6.75 running; the fast hunter\'s × 1.5), at speed in about 0.2 s, stopping as quick; sharper turns under the water; HIDDEN past 8 m', () => {
  assert.equal(PLAY.rate, 4.5); assert.equal(PLAY.rateRun, 6.75);
  const { sim, C } = make();
  run(sim, C, 4, { move: [0, 1] });
  let t95 = null, t = 0;
  run(sim, C, 1.5, { move: [0, 1], sink: true }, () => { t += DT; if (t95 == null && C.state.climb >= 0.9 * PLAY.rate) t95 = t; });
  assert.ok(t95 != null && t95 <= 0.3, `Q: at 90 % of 4.5 m/s after ${t95?.toFixed(2)} s`);
  const d0 = C.state.nose; run(sim, C, 2, { move: [0, 1], sink: true });
  const rate = (C.state.nose - d0) / 2;
  assert.ok(rate > 3.8 && rate < 4.9, `the nose goes down at ${rate.toFixed(2)} m/s`);
  let tStop = null; t = 0;
  run(sim, C, 1, { move: [0, 1] }, () => { t += DT; if (tStop == null && Math.abs(C.state.climb) < 0.1 * PLAY.rate) tStop = t; });
  assert.ok(tStop != null && tStop <= 0.3, `let go: stopped after ${tStop?.toFixed(2)} s`);
  run(sim, C, 6, { move: [0, 1], sink: true });
  assert.ok(C.state.hidden && C.state.nose > PLAY.hiddenM, `past 8 m she is hidden (${C.state.nose.toFixed(1)} m)`);
  let worst = 0, prev = sim.state.nose.psi;
  run(sim, C, 3, { move: [0, -1] }, () => { const p = sim.state.nose.psi; worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(p - prev), Math.cos(p - prev))) / DT); prev = p; });
  assert.ok(worst > 30 * DEG && worst <= PLAY.under.turnMax * DEG + 1e-6, `under the water she turns at ${(worst / DEG).toFixed(1)}°/s`);
});

test('every Space press bites (owner, 2026-11-20): the snap plays each time, its jaw opening; locked under a boat at depth, the rising strike', () => {
  const { sim, C } = make();
  run(sim, C, 4, { move: [0, 1] });
  const bites = []; let gape = 0;
  for (let k = 0; k < 3; k++) { run(sim, C, 0.1, { move: [0, 1], bite: true }, () => { for (const e of C.events) if (e.type === 'bite') bites.push(e); gape = Math.max(gape, sim.state.gape ?? 0); }); run(sim, C, 1.0, { move: [0, 1] }, () => { gape = Math.max(gape, sim.state.gape ?? 0); }); }
  assert.equal(bites.length, 3, 'three presses, three bites (nothing in reach)');
  assert.ok(bites.every((e) => e.kind === 'snap'), 'snaps');
  assert.ok((sim.state.bites ?? 0) >= 3, `the snap reached full reach each time (${sim.state.bites})`);
  assert.ok(gape > 9 * DEG && gape <= 10 * DEG + 1e-9, `the snap's jaw opens 10° (${(gape / DEG).toFixed(1)}°)`);
  run(sim, C, 5, { move: [0, 1], sink: true });
  const n = sim.state.nose, d0 = C.state.nose;
  assert.ok(d0 > 6, `down at ${d0.toFixed(1)} m`);
  const boat = { id: 'b', kind: 'sail', x: n.x + Math.sin(n.psi) * 6, z: n.z - Math.cos(n.psi) * 6, heading: n.psi + Math.PI / 2, u: 0, L: 8.5, B: 3 };
  const lock = { ...boat, k: 1, ix: boat.x, iz: boat.z, under: true };
  const ev = []; let fastest = 0, prevN = C.state.nose;
  for (let i = 0; i < Math.round(7 / DT); i++) { sim.step(DT, { playing: true }); C.step(DT, { bite: i < 2 }, { target: { ...boat, d: 4 }, lock }); for (const e of C.events) ev.push(e.type); fastest = Math.max(fastest, (prevN - C.state.nose) / DT); prevN = C.state.nose; }
  assert.ok(ev.includes('lunge') && ev.includes('breach') && ev.includes('fall'), `the rising strike: the rise, the breach and the fall (${ev.join(',')})`);
  assert.ok(fastest > 3, `she rises fast (${fastest.toFixed(1)} m/s)`);
});
