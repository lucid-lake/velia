// Tessie's water effects on the CPU (M2 step 3–4; desktop only): the drops and the mist, and her shadow on the bed.
// Pure (no GPU): render/tessie.js draws what this makes. Deterministic: one seeded generator, the sim's events in its order.
//   const fx = createTessieFx({ seed, bedAt })     bedAt(x, z): the bed's height (m, < 0 under the water)
//   fx.step(dt, st, sun)    st: the sim's state (events, rising, spine, wetAge, visible); sun: [x, y, z] toward the sun
//   fx.drops [{ x, y, z, r }]  fx.mists [{ x, y, z, r, a }]  fx.shadow (Float32Array: x, y, z, a × 2 per ribbon point), fx.nShadow
//   fx.skill(type, o)       the RPG's skills' own spray (skillK: the tier's share, src/core/features.js tessieSkillFx; 0: none):
//     'boil'   { x, z, s }                       the Dash's start: a low, wide boil of fine spray and a flat mist
//     'bow'    { x, z, psi, speed, dt, r }       the Dash under way (each step): two sheets thrown out and back from her neck (the V's spray)
//     'hop'    { x, z, tx, tz }                  the Lure: a small fish flicking out of the water toward (tx, tz), a glint and a plop
//     'shimmer' { x, z, r0, r1, dt }             the Lure under way (each step): a school's glints popping up round her, drifting in
//     'crest'  { x, z, r, speed, n }             the Surge's swell: spume thrown off its top at r m from (x, z) as it runs out
//     'hull'   { x, z, fx, fz, s }               a wave reaching a boat: spray up its side facing the wave's source (fx, fz)
//     'column' { x, z, s }                       the Breach's landing: a tall column of water and its crown
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

export function createTessieFx({ seed = 1, bedAt = () => -30, L = 19.6, skillK = 1 } = {}) {
  const r = mulberry32((Math.imul(seed | 0, 131) + 7) >>> 0);
  const drops = [], mists = [];
  const shadow = new Float32Array(32 * 8);
  let nShadow = 0, dripAcc = 0, sheetAcc = 0;
  const stats = { spawned: 0, events: {}, skills: {} };
  function drop(x, y, z, vx, vy, vz, rad, life = 3) { if (drops.length >= TFX.maxDrops) drops.shift(); drops.push({ x, y, z, vx, vy, vz, r: rad, life }); stats.spawned++; }
  function mist(x, y, z, rad, a = 0.35, life = 1.6, vy = 0.6, vx = 0, vz = 0) { if (mists.length >= TFX.maxMists) mists.shift(); mists.push({ x, y, z, r: rad * 0.6, r1: rad, a0: a, a, life, age: 0, vy, vx, vz }); }
  let bowAcc = 0, shimAcc = 0;
  const nOf = (n) => Math.max(0, Math.round(n * skillK));
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
    skill(type, o = {}) {
      if (!(skillK > 0)) return 0;
      const n0 = stats.spawned, { x = 0, z = 0 } = o, s = o.s ?? 1;
      stats.skills[type] = (stats.skills[type] ?? 0) + 1;
      if (type === 'boil') {
        // the water heaves up over her as she kicks: a low, wide dome of fine spray, a flat mist, no crown
        for (let i = 0, n = nOf(90 * s); i < n; i++) { const a = r() * Math.PI * 2, rr = 2.2 * Math.sqrt(r()), k = 0.3 + 0.7 * r(); drop(x + Math.cos(a) * rr, 0.05, z + Math.sin(a) * rr, Math.cos(a) * 1.4 * k, 1.0 + 1.6 * r(), Math.sin(a) * 1.4 * k, 0.012 + 0.03 * r() * r(), 1.2); }
        mist(x, 0.35, z, 2.6 * s, 0.22, 1.3, 0.25);
      } else if (type === 'bow') {
        // two sheets off her neck where it cuts the water: thrown out to each side and back along her track, rising and falling
        const fx = Math.sin(o.psi ?? 0), fz = -Math.cos(o.psi ?? 0), lx = -fz, lz = fx, sp = o.speed ?? 10, rad = o.r ?? 0.45;
        bowAcc += (o.dt ?? 1 / 60) * 170 * skillK * Math.min(1.5, sp / 10);
        while (bowAcc >= 1) {
          bowAcc -= 1;
          const side = r() < 0.5 ? -1 : 1, out = 1.6 + 2.6 * r(), back = sp * (0.25 + 0.35 * r()), u = r();
          drop(x + lx * side * rad - fx * 0.3 * r(), 0.1 + 0.2 * r(), z + lz * side * rad - fz * 0.3 * r(), lx * side * out + fx * (sp - back), 1.4 + 2.2 * r(), lz * side * out + fz * (sp - back), 0.014 + 0.045 * u * u, 1.0);
        }
      } else if (type === 'hop') {
        // a small fish out of the water: one bright body arcing toward her, a few drops off its tail, a plop where it went in
        const dx = (o.tx ?? x) - x, dz = (o.tz ?? z) - z, l = Math.hypot(dx, dz) || 1, v = 2.2 + 1.0 * r();
        drop(x, 0.08, z, dx / l * v, 3.0 + 0.8 * r(), dz / l * v, 0.1 + 0.04 * r(), 1.4);
        for (let i = 0, n = nOf(12); i < n; i++) drop(x + (r() - 0.5) * 0.3, 0.05, z + (r() - 0.5) * 0.3, dx / l * v * 0.4 + (r() - 0.5) * 0.8, 0.8 + 1.2 * r(), dz / l * v * 0.4 + (r() - 0.5) * 0.8, 0.01 + 0.015 * r(), 0.9);
      } else if (type === 'shimmer') {
        // the school under the surface: tiny glints popping up all round her between r0 and r1 m, each drifting toward her (each step)
        const r0 = o.r0 ?? 4, r1 = o.r1 ?? 16;
        shimAcc += (o.dt ?? 1 / 60) * 70 * skillK;
        while (shimAcc >= 1) {
          shimAcc -= 1;
          const a = r() * Math.PI * 2, rr = r0 + (r1 - r0) * Math.sqrt(r()), px = x + Math.sin(a) * rr, pz = z - Math.cos(a) * rr;
          drop(px, 0.03, pz, -Math.sin(a) * 0.5, 0.6 + 0.7 * r(), Math.cos(a) * 0.5, 0.02 + 0.02 * r(), 0.6);
        }
      } else if (type === 'crest') {
        // spume blown off the swell's top as it runs: drops thrown up and outward at the crest's speed, a moving white lip
        const rr = o.r ?? 10, n = nOf(o.n ?? 24), sp = o.speed ?? 20;
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2, cx = Math.sin(a), cz = -Math.cos(a), u = r();
          drop(x + cx * rr, 0.25, z + cz * rr, cx * sp * (0.35 + 0.25 * r()), 1.2 + 1.8 * r(), cz * sp * (0.35 + 0.25 * r()), (0.025 + 0.07 * u * u) * (1 + rr / 40), 0.8);   // bigger out where it is far
        }
      } else if (type === 'hull') {
        // the wave meets a hull: a sheet thrown up its side facing the wave, falling back over it; a mist drifting with the wave
        const dx = x - (o.fx ?? x), dz = z - (o.fz ?? z), l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
        for (let i = 0, n = nOf(70 * s); i < n; i++) { const off = (r() - 0.5) * 6, k = r(); drop(x - ux * 1.4 + -uz * off, 0.2, z - uz * 1.4 + ux * off, ux * (1.0 + 2.0 * k) + (r() - 0.5), 3.0 + 3.5 * r(), uz * (1.0 + 2.0 * k) + (r() - 0.5), 0.015 + 0.05 * r() * r(), 1.6); }
        if (skillK >= 1) mist(x - ux * 1.2, 1.0, z - uz * 1.2, 3.0, 0.3, 1.8, 0.5, ux * 1.5, uz * 1.5);
      } else if (type === 'column') {
        // her landing: a tall white column (thrown nearly straight up), its crown low and wide, and a high mist
        for (let i = 0, n = nOf(260 * s); i < n; i++) { const a = r() * Math.PI * 2, rr = 2.4 * Math.sqrt(r()), k = r(); drop(x + Math.cos(a) * rr, 0.2, z + Math.sin(a) * rr, Math.cos(a) * (0.6 + 1.4 * k), 4.5 + 5 * r() * r(), Math.sin(a) * (0.6 + 1.4 * k), 0.03 + 0.08 * r() * r(), 3); }
        crown(x, z, nOf(160 * s), 2.6, 5.5, 3.0);
        // the column's white body: puffs stacked up it, rising with it, and a wide low one over the crown
        mist(x, 1.2, z, 4.0, 0.55, 2.4, 2.2); mist(x, 2.8, z, 4.5, 0.5, 2.6, 2.6); mist(x, 4.5, z, 5.0, 0.4, 2.8, 2.2); mist(x, 0.8, z, 8.0, 0.32, 2.8, 0.3);
      }
      return stats.spawned - n0;
    },
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
      for (const m of mists) { m.age += dt; m.y += m.vy * dt; if (m.vx) { m.x += m.vx * dt; m.z += m.vz * dt; } m.vy *= 1 - dt * 0.8; m.r += (m.r1 - m.r) * Math.min(1, dt * 1.5); m.a = m.a0 * Math.max(0, 1 - m.age / m.life); }
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
