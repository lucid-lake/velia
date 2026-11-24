// The boat's waterline against the real water (fix/v2-keel-visible; owner, 2026-11-18: "Do we have a keel under the sailboat?
// When it capsizes I didn't notice it", then "It's OK for the keel to show as a dark fin through the clear water; we just need
// to respect the physics — different water clarity levels"). What is under the water is decided at each point's world
// position against the drawn surface there, not by the hull frame's own waterline (y < 0): heeled hard, knocked down or rolled
// by Tessie, the keel and the rudder rise into the air and draw lit; what is under the surface draws through the water
// (render/underwater.js: the refracted view, the water's K, the weather's scatter), never cut out.
//   The water under a boat: a 5 × 3 patch of the drawn surface's heights (water.heightAt, the CPU twin of the drawn FFT
//   surface) in the boat's own axes (along the keel and across it), filled once a frame per boat and read bilinearly per
//   fragment. 15 heights cover the hull, the keel on her side and the rudder; past the patch the edge holds.
//   Record (Model.w, 5 × vec4): w[0] = (cx, cz, ux, uz): the patch's centre and its along axis (unit, world xz);
//   w[1..4] = the 15 heights (along-major: i = ia × 3 + ib) and an on flag (1: a patch; 0: never under water).
//   underWeight: 0 in the air, 1 under the water: a soft 10 cm blend under the surface (the bilinear patch's error a few cm;
//   a sliver of the blend sits under the water, where the surface covers it), × a gate on the hull frame's height: the
//   underbody (y < 0) and the topsides to 0.3 m take the water; the deck, the cockpit and the rig never do (no water
//   inside the hull or the cockpit at any heel to 90°), so a submerged lee deck keeps today's look.
// Pure (no GPU): v2/tests/keel-visible.test.mjs.

export const PATCH = Object.freeze({ na: 5, nb: 3, along: 2.4, across: 2.0, blendM: 0.10, gate: Object.freeze([0, 0.3]) });
export const PATCH_FLOATS = 20;

// fill out (Float32Array(20)) for a boat at (cx, cz) whose keel runs along (ux, uz) (the hull frame's z in the world, any
// length); heightAt(x, z) → the water's height there (m), or a number: a flat water at that height
export function fillPatch(out, cx, cz, ux, uz, heightAt) {
  const l = Math.hypot(ux, uz);
  if (l > 1e-6) { ux /= l; uz /= l; } else { ux = 0; uz = 1; }
  out[0] = cx; out[1] = cz; out[2] = ux; out[3] = uz;
  const flat = typeof heightAt === 'number' ? heightAt : null;
  for (let ia = 0; ia < PATCH.na; ia++) {
    const a = (ia - (PATCH.na - 1) / 2) * PATCH.along;
    for (let ib = 0; ib < PATCH.nb; ib++) {
      const b = (ib - (PATCH.nb - 1) / 2) * PATCH.across;
      // a point a along the keel and b across it (the across axis (−uz, ux), as the WGSL reads it)
      out[4 + ia * PATCH.nb + ib] = flat ?? heightAt(cx + a * ux - b * uz, cz + a * uz + b * ux);
    }
  }
  out[19] = 1;
  return out;
}
import { smooth } from '../../../src/sim/core/math.js';
import { clamp } from '../../../src/sim/core/math.js';
// the patch's water height at world (x, z) (bilinear; the edge held past it)
export function patchHeight(W, x, z) {
  const rx = x - W[0], rz = z - W[1];
  const fa = clamp((rx * W[2] + rz * W[3]) / PATCH.along + (PATCH.na - 1) / 2, 0, PATCH.na - 1);
  const fb = clamp((-rx * W[3] + rz * W[2]) / PATCH.across + (PATCH.nb - 1) / 2, 0, PATCH.nb - 1);
  const ia = Math.min(Math.floor(fa), PATCH.na - 2), ib = Math.min(Math.floor(fb), PATCH.nb - 2), ta = fa - ia, tb = fb - ib;
  const h = (i, j) => W[4 + i * PATCH.nb + j];
  return (h(ia, ib) * (1 - tb) + h(ia, ib + 1) * tb) * (1 - ta) + (h(ia + 1, ib) * (1 - tb) + h(ia + 1, ib + 1) * tb) * ta;
}
// 0 in the air … 1 under the water, for a point at world (x, y, z) whose hull-frame height is yl
export function underWeight(W, x, y, z, yl) {
  if (!(W[19] > 0.5)) return 0;
  return smooth(0, PATCH.blendM, patchHeight(W, x, z) - y) * (1 - smooth(PATCH.gate[0], PATCH.gate[1], yl));
}

// the WGSL twin (needs M: Model with w: array<vec4f, 5>)
export const WATERLINE_WGSL = `
const WP_NA = ${PATCH.na}u; const WP_NB = ${PATCH.nb}u; const WP_A = ${PATCH.along.toFixed(4)}; const WP_B = ${PATCH.across.toFixed(4)};
const WP_BLEND = ${PATCH.blendM.toFixed(4)}; const WP_G0 = ${PATCH.gate[0].toFixed(4)}; const WP_G1 = ${PATCH.gate[1].toFixed(4)};
fn wpAt(i: u32) -> f32 { return M.w[1u + i / 4u][i % 4u]; }
fn wpOn() -> bool { return M.w[4].w > 0.5; }
// the drawn water's height at world xz (the boat's patch, render/boat/waterline.js patchHeight)
fn waterAt(xz: vec2f) -> f32 {
  let c = M.w[0]; let r = xz - c.xy;
  let fa = clamp(dot(r, c.zw) / WP_A + f32(WP_NA - 1u) * 0.5, 0.0, f32(WP_NA - 1u));
  let fb = clamp(dot(r, vec2f(-c.w, c.z)) / WP_B + f32(WP_NB - 1u) * 0.5, 0.0, f32(WP_NB - 1u));
  let ia = min(u32(fa), WP_NA - 2u); let ib = min(u32(fb), WP_NB - 2u);
  let ta = fa - f32(ia); let tb = fb - f32(ib);
  let i0 = ia * WP_NB + ib; let i1 = i0 + WP_NB;
  return mix(mix(wpAt(i0), wpAt(i0 + 1u), tb), mix(wpAt(i1), wpAt(i1 + 1u), tb), ta);
}
fn wpGate(yl: f32) -> f32 { return 1.0 - smoothstep(WP_G0, WP_G1, yl); }
// 0 in the air … 1 under the water (underWeight)
fn underWeight(world: vec3f, yl: f32) -> f32 {
  if (!wpOn()) { return 0.0; }
  return smoothstep(0.0, WP_BLEND, waterAt(world.xz) - world.y) * wpGate(yl);
}`;
