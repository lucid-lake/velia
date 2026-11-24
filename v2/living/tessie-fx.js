// Tessie's water effects on the CPU (M2 step 3–4; desktop only): the drops and the mist, and her shadow on the bed.
// Pure (no GPU): render/tessie.js draws what this makes. Deterministic: one seeded generator, the sim's events in its order.
//   const fx = createTessieFx({ seed, bedAt })     bedAt(x, z): the bed's height (m, < 0 under the water)
//   fx.step(dt, st, sun)    st: the sim's state (events, rising, spine, wetAge, visible); sun: [x, y, z] toward the sun
//   fx.drops [{ x, y, z, r }]  fx.mists [{ x, y, z, r, a }]  fx.shadow (Float32Array: x, y, z, a × 2 per ribbon point), fx.nShadow
//
// The drops: the sheets that run off her back as it rises out of the water (from both flanks, falling off), the drips off
// every part above the water while she is wet (fewer as she dries), the splashes of the break (a ring of drops thrown up),
// the tail's flick (a fan thrown up and back), its slap and the dive (a column and a ring), the breach's sheets and its fall.
// The mist: a soft puff at the big ones. A drop is ballistic and goes when it falls back through the water.
// The shadow: her spine projected down the sun onto the bed, a ribbon as wide as she is, only where the bed is within 14 m
// and the sun is up; darker in the shallows (the bed's sunlit share), soft at its edges.
import { mulberry32 } from '../../src/sim/core/rng.js';
import { radiusAt } from '../sim/tessie.js';

const TFX = Object.freeze({ maxDrops: 900, maxMists: 24, g: 9.81, shadowDepth: 14, shadowK: 0.55 });

export function createTessieFx({ seed = 1, bedAt = () => -30, L = 19.6 } = {}) {
  const r = mulberry32((Math.imul(seed | 0, 131) + 7) >>> 0);
  const drops = [], mists = [];
  const shadow = new Float32Array(32 * 8);
  let nShadow = 0, dripAcc = 0, sheetAcc = 0;
  const stats = { spawned: 0, events: {} };
  function drop(x, y, z, vx, vy, vz, rad, life = 3) { if (drops.length >= TFX.maxDrops) drops.shift(); drops.push({ x, y, z, vx, vy, vz, r: rad, life }); stats.spawned++; }
  function mist(x, y, z, rad, a = 0.35, life = 1.6, vy = 0.6) { if (mists.length >= TFX.maxMists) mists.shift(); mists.push({ x, y, z, r: rad * 0.6, r1: rad, a0: a, a, life, age: 0, vy }); }
  // a burst at (x, z) on the water: n drops thrown up (speed up) and out (out), from a ring of radius ring
  function burst(x, z, n, up, out, ring = 0.5, size = [0.02, 0.05]) {
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, k = 0.4 + 0.6 * r(), rr = ring * (0.7 + 0.5 * r());
      const u = r(); drop(x + Math.cos(a) * rr, 0.05, z + Math.sin(a) * rr, Math.cos(a) * out * k, up * (0.5 + 0.7 * r()), Math.sin(a) * out * k, size[0] + (size[1] - size[0]) * u * u * u, 1.2 + 1.2 * r());   // many fine, a few big
    }
  }
  // a crown: a sheet thrown out low and wide round a big splash (the streaks fan out and fall back as a ring)
  function crown(x, z, n, up, out, ring) { for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, k = 0.6 + 0.4 * r(), u = r(); drop(x + Math.cos(a) * ring, 0.1, z + Math.sin(a) * ring, Math.cos(a) * out * k, up * (0.6 + 0.6 * r()), Math.sin(a) * out * k, 0.01 + 0.05 * u * u, 1.4); } }
  const frameAt = (sp, i) => { const o = i * 8, a = Math.max(0, i - 1) * 8, b = Math.min(63, i + 1) * 8; let tx = sp[b] - sp[a], tz = sp[b + 2] - sp[a + 2]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; return { x: sp[o], y: sp[o + 1], z: sp[o + 2], lx: -tz, lz: tx }; };
  const self = {
    drops, mists, shadow, stats, get nShadow() { return nShadow; },
    step(dt, st, sun = [0, 1, 0]) {
      if (!(dt > 0)) return self;
      if (st?.visible) {
        for (const e of st.events ?? []) {
          stats.events[e.type] = (stats.events[e.type] ?? 0) + 1;
          const s = e.s ?? 1;
          if (e.type === 'break') { burst(e.x, e.z, Math.round(18 + 30 * s), 2.2 + 1.5 * s, 1.1, e.r ?? 0.6); if (s > 0.6) mist(e.x, 0.6, e.z, 1.6 + s, 0.22); }
          else if (e.type === 'under') { burst(e.x, e.z, Math.round(10 + 14 * s), 1.4, 0.7, e.r ?? 0.5, [0.015, 0.035]); }
          else if (e.type === 'flick') { for (let i = 0; i < 70; i++) drop(e.x + (r() - 0.5) * 0.6, e.y, e.z + (r() - 0.5) * 0.6, (r() - 0.5) * 2.2, 2.5 + 3 * r(), (r() - 0.5) * 2.2, 0.015 + 0.03 * r()); }
          else if (e.type === 'slap') { burst(e.x, e.z, 140, 4.2, 2.2, 0.8, [0.02, 0.06]); mist(e.x, 0.8, e.z, 3.2, 0.4); }
          else if (e.type === 'dive') { burst(e.x, e.z, 50, 2.6, 1.4, 0.9); mist(e.x, 0.5, e.z, 2.2, 0.25); }
          else if (e.type === 'breach') { burst(e.x, e.z, 160, 4.5, 1.8, 1.0, [0.012, 0.07]); crown(e.x, e.z, 120, 2.2, 3.2, 1.6); mist(e.x, 1.0, e.z, 3.0, 0.25); }
          else if (e.type === 'fall') { burst(e.x, e.z, 220, 6.0, 3.0, 1.6, [0.012, 0.08]); crown(e.x, e.z, 200, 3.0, 4.5, 2.4); mist(e.x, 1.2, e.z, 5.0, 0.35, 2.4, 0.9); }
        }
        // the sheets off her rising back: from both flanks of each part coming up out of the water, the rate by its speed
        const sp = st.spine;
        for (const q of st.rising ?? []) {
          const [x, top, z, vy, rad] = q;
          if (vy < 0.08) continue;
          sheetAcc += dt * vy * rad * 30;
          const i = Math.max(0, Math.min(63, Math.round(Math.hypot(x - sp[0], z - sp[2]) / (L / 63))));
          const f = frameAt(sp, i);
          while (sheetAcc >= 1) {
            sheetAcc -= 1;
            const side = r() < 0.5 ? -1 : 1, h = Math.max(0.05, top - rad * (0.3 + 0.5 * r()));
            drop(x + f.lx * side * rad * 0.95, h, z + f.lz * side * rad * 0.95, f.lx * side * (0.3 + 0.5 * r()), vy * 0.6 - 0.2 * r(), f.lz * side * (0.3 + 0.5 * r()), 0.012 + 0.02 * r(), 2);
          }
        }
        // the drips off every part above the water, fewer as she dries (12 s), at least a few while she is up
        const wet = 0.25 + 0.75 * Math.exp(-(st.wetAge ?? 0) / 12);
        const up = (st.rising ?? []).filter((q) => q[5] > 0.05);
        dripAcc += dt * up.length * 6 * wet;
        while (dripAcc >= 1 && up.length) {
          dripAcc -= 1;
          const q = up[Math.floor(r() * up.length)], [x, top, z, , rad] = q;
          const side = r() < 0.5 ? -1 : 1, a = r() * Math.PI;
          drop(x + Math.cos(a) * rad * 0.8 * side, Math.max(0.05, top - rad * (0.4 + 0.6 * r())), z + Math.sin(a) * rad * 0.8 * side, 0, -0.1 * r(), 0, 0.008 + 0.01 * r(), 2);
        }
        if (up.length === 0) dripAcc = 0;
      }
      // fly: ballistic, gone back through the water
      for (const d of drops) { d.vy -= TFX.g * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.life -= dt; }
      for (let i = drops.length - 1; i >= 0; i--) if (drops[i].life <= 0 || (drops[i].y < 0 && drops[i].vy < 0)) drops.splice(i, 1);
      for (const m of mists) { m.age += dt; m.y += m.vy * dt; m.vy *= 1 - dt * 0.8; m.r += (m.r1 - m.r) * Math.min(1, dt * 1.5); m.a = m.a0 * Math.max(0, 1 - m.age / m.life); }
      for (let i = mists.length - 1; i >= 0; i--) if (mists[i].age >= mists[i].life) mists.splice(i, 1);
      // the shadow on the bed
      nShadow = 0;
      if (st?.visible && sun[1] > 0.12) {
        const sp = st.spine, sl = Math.hypot(sun[0], sun[1], sun[2]), sx = sun[0] / sl, sy = sun[1] / sl, sz = sun[2] / sl;
        let any = false;
        for (let k = 0; k < 32; k++) {
          const i = Math.round(k * 63 / 31), f = frameAt(sp, i), s = i * L / 63;
          // down the sun to the bed (two steps: the bed's height where the ray lands)
          let hb = bedAt(f.x, f.z), t0 = (f.y - hb) / sy, qx = f.x - sx * t0, qz = f.z - sz * t0;
          hb = bedAt(qx, qz); t0 = (f.y - hb) / sy; qx = f.x - sx * t0; qz = f.z - sz * t0;
          const depth = -hb, w = radiusAt(s, L) * 1.1 + 0.2;
          const a = f.y < hb + 0.3 ? 0 : TFX.shadowK * (1 - smooth(TFX.shadowDepth * 0.5, TFX.shadowDepth, depth)) * smooth(0.12, 0.35, sy) * (depth > 0.3 ? 1 : 0) * Math.min(1, w * 2);
          if (a > 0.01) any = true;
          const y = hb + 0.15, o = k * 8;
          shadow[o] = qx - f.lx * w; shadow[o + 1] = y; shadow[o + 2] = qz - f.lz * w; shadow[o + 3] = a;
          shadow[o + 4] = qx + f.lx * w; shadow[o + 5] = y; shadow[o + 6] = qz + f.lz * w; shadow[o + 7] = a;
        }
        nShadow = any ? 32 : 0;
      }
      return self;
    },
  };
  return self;
}
import { smooth } from '../../src/sim/core/math.js';
