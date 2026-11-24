// Chill's camera director (src/modes/chill/director.js) over a real 12-minute voyage (the navigator on the physics,
// tests/navigator.test.mjs's world): every pose above the floor (3 m over water, 8 m over land; low passes 2.2 m over
// open water), the boat in clear sight (a blocked line ends the shot within 1.5 s), never nearer than 18 m, shots
// 20–60 s long with every kind used, and no shake: between cuts the view turns under 8.7°/s (the follow camera's chase limit) and the lens accelerates under 3 m/s².
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyage, chillWorld } from '../src/modes/chill/sim.js';
import { Director } from '../src/modes/chill/director.js';
import { FollowCamera } from '../src/sim/boat/followCamera.js';
import { analyticSun } from '../src/sim/timeOfDay.js';
import { floorAt } from '../src/camera.js';

const DEG = Math.PI / 180;

for (const seed of [1, 2]) {
  test(`the director over a 12 min voyage, seed ${seed}`, () => {
    const W = chillWorld({ seed, hour: 17, rate: 20 });
    const dir = new Director({ heightAt: W.terrain.heightAt, seed });
    let follow = null, prev = null, maxTurn = 0, maxAcc = 0, blockedRun = 0, worstBlocked = 0, minFloor = Infinity, minNear = Infinity, n = 0;
    const kinds = new Set();
    let lastCuts = 0;
    voyage({ seed, hour: 17, minutes: 12, world: W, onTick: (t, s, out, nav) => {
      if (Math.round(t * 60) % 2) return;   // 30 Hz
      const dt = 1 / 30;
      follow ??= new FollowCamera({ x: s.x, z: s.z, heading: s.heading });
      const fp = follow.update(dt, s);
      const sun = analyticSun(W.clock(t) % 24);
      const p = dir.update(dt, { t, boat: { x: s.x, z: s.z, heading: s.heading, sog: s.sog }, sun, look: nav.target.look, follow: fp, windSpeed: s.trueWind.speed });
      kinds.add(p.shot);
      const cut = dir.cuts.length !== lastCuts; lastCuts = dir.cuts.length;
      // the floor
      const h = W.terrain.heightAt(p.pos[0], p.pos[2]);
      const fl = p.shot === 'low' ? Math.max(0, h) + 2.2 : floorAt(W.terrain.heightAt, p.pos[0], p.pos[2]);
      minFloor = Math.min(minFloor, p.pos[1] - fl);
      assert.ok(p.pos[1] >= h + 2, `t ${t.toFixed(1)} ${p.shot}: the lens ${p.pos[1].toFixed(1)} m over ground ${h.toFixed(1)} m`);
      // sight and distance
      const blocked = !dir.clear(p.pos, [s.x, 2.5, s.z]);
      blockedRun = blocked && p.shot !== 'follow' ? blockedRun + dt : 0; worstBlocked = Math.max(worstBlocked, blockedRun);
      if (p.shot !== 'follow') minNear = Math.min(minNear, Math.hypot(p.pos[0] - s.x, p.pos[2] - s.z));
      // shake: the view's turn rate and the lens's acceleration, between cuts
      const v = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], L = Math.hypot(...v);
      const dirv = v.map((q) => q / L);
      if (prev && !cut) {
        const turn = Math.acos(Math.min(1, dirv[0] * prev.d[0] + dirv[1] * prev.d[1] + dirv[2] * prev.d[2])) / DEG / dt;
        if (turn > maxTurn) { maxTurn = turn; globalThis.__worstTurn = { t: +t.toFixed(2), shot: p.shot, prev: prev.shot, pos: p.pos.map((q) => +q.toFixed(1)), boat: [s.x | 0, s.z | 0] }; }
        if (prev.v) { const vel = p.pos.map((q, i) => (q - prev.pos[i]) / dt); const acc = Math.hypot(...vel.map((q, i) => (q - prev.v[i]) / dt)); if (p.shot !== 'follow' && prev.shot === p.shot && acc > maxAcc) { maxAcc = acc; globalThis.__worstAcc = { t: +t.toFixed(2), shot: p.shot }; } prev.vel = vel; }
      }
      const vel = prev && !cut ? p.pos.map((q, i) => (q - prev.pos[i]) / dt) : null;
      prev = { d: dirv, pos: p.pos.slice(), v: vel, shot: p.shot };
      n++;
    } });
    const lens = dir.cuts.map((c, i) => c.t - (i ? dir.cuts[i - 1].t : 0));
    console.log(`# seed ${seed}: ${n} frames, shots ${[...kinds].join(',')}, ${dir.cuts.length} changes (${dir.cuts.filter((c) => c.blend).length} blends, ${dir.cuts.filter((c) => c.why === 'blocked').length} blocked), lengths ${lens.map((x) => x.toFixed(0)).join(' ')} s; max turn ${maxTurn.toFixed(2)}°/s, max lens accel ${maxAcc.toFixed(2)} m/s², worst blocked ${worstBlocked.toFixed(2)} s, nearest ${minNear.toFixed(1)} m, floor margin ${minFloor.toFixed(2)} m; worst turn ${JSON.stringify(globalThis.__worstTurn)} acc ${JSON.stringify(globalThis.__worstAcc)}`);
    assert.ok(kinds.size >= 4, `shots: ${[...kinds]}`);
    assert.ok(minFloor >= -1e-6, `under the floor by ${-minFloor}`);
    assert.ok(worstBlocked <= 1.5, `the boat hidden ${worstBlocked.toFixed(2)} s`);
    assert.ok(minNear >= 18 - 1e-6, `the lens ${minNear.toFixed(1)} m from the boat`);
    // the follow shot is Day Sail's own camera: its chase turns at most 0.15 rad/s (8.6°/s), by design
    assert.ok(maxTurn < 8.7, `the view turned ${maxTurn.toFixed(2)}°/s`);
    assert.ok(maxAcc < 3, `the lens accelerated ${maxAcc.toFixed(2)} m/s²`);
    for (const [i, c] of dir.cuts.entries()) if (c.why === 'time') assert.ok(lens[i] >= 19.9 && lens[i] <= 60.1, `shot ${i} ran ${lens[i].toFixed(1)} s`);
  });
}
