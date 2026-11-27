// The RPG's skill waves on Tessie's water (pure; the sim keeps them, render/creature-map.js draws them in her map). Each skill has
// its own wave so no two read alike (none is a flat ring):
//   swell   the Tail Surge's slap and the Breach's landing: one raised, rolling crest (a hump with a trough behind it) running out at
//           `speed` m/s to `maxR` m, foam broken along its top, its height falling off as it spreads (p: speed, maxR, amp m, width m)
//   inward  the Lure's call: a short train of ripples closing in on her from `r0` m at `speed` m/s, no foam (p: r0, speed, amp, width)
//   churn   the Dash's boil and the wake it tears up: a disc of white, churned water `r` m across that grows by `grow` m/s and
//           fades over its life (p: r, amp, grow)
// A source is [x, z, age, kind, p0, p1, p2, p3]: two vec4 in the map's uniform.
export const SKILL_WAVE_KIND = Object.freeze({ swell: 1, inward: 2, churn: 3 });
export const SKILL_WAVE_MAX = 10;
// m from its centre the wave reaches at `age` (the map's extent must cover it)
export function waveReach(w, age) {
  const p = w.p;
  if (w.kind === 1) return Math.min(p[1], p[0] * age) + p[3] * 2;
  if (w.kind === 2) return p[0] + p[3] * 2;
  return p[0] + p[2] * age;
}
// the creature map's side (m) for a reach (m from her centre): 64 m until a wave runs past 23 m, then wide enough that the map's
// round fade (render/wake.js: from 0.28 to 0.49 of the side) starts beyond it; never past maxE (the texel stays under 1.5 m)
export const MAP_E = Object.freeze({ base: 64, fadeAt: 0.36, maxE: 192 });
export const mapExtent = (reach) => Math.min(MAP_E.maxE, Math.max(MAP_E.base, reach > 0 ? reach / MAP_E.fadeAt : 0));
// the swell's height (m) at d m from its centre (JS twin of the shader's: the tests and the boats' lift read it)
export function swellHeight(p, age, d) {
  const [speed, maxR, amp, width] = p, rr = Math.min(maxR, speed * age);
  const fade = rr >= maxR ? Math.max(0, 1 - (speed * age - maxR) / (speed * 0.6)) : 1;
  const a = amp * Math.sqrt(4 / Math.max(4, rr)) * fade, x = (d - rr) / width;
  return a * (Math.exp(-x * x) - 0.35 * Math.exp(-(x + 1.6) * (x + 1.6)));
}
