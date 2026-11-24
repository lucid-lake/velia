// The clearing's rainbow (wow/storm): drawn in the post grade (src/weather/uniforms.js stormGrade), after the clouds, so
// the deck never covers it, and only on pixels whose scene lies past ≈ 900 m (the bow stands in the rain, behind the
// boat and the near shore). Coloured by the angle from the antisolar point: the primary bow at 40.7° (violet) to 42.4°
// (red), a faint secondary at 50–53.5° with its colours reversed, a little light inside the primary. It shows only in
// the rain's direction (the departing cell), above the horizon, and only when the geometry allows it (stormArc.js
// rainbowWeight: the sun under 42° and behind the viewer). Its strength comes from storm.js (SU.bow).
import { vec3, float, smoothstep, dot, normalize, acos, clamp, vec2, mix } from 'three/tsl';
import { RAINBOW } from '../../../src/sim/weather/stormArc.js';

// { light, alex }: the bow's light (0–1 per channel, before the strength) and Alexander's band (0–1, the darkening)
// the bow's light along a world view direction dir, for the sun sunDir and the
// rain toward toRain (a horizontal vec2)
export function rainbowLight(dir, sunDir, toRain) {
  const th = acos(clamp(dot(dir, sunDir.negate()), -1, 1)).mul(180 / Math.PI);   // degrees from the antisolar point
  // soft edges (the sun's 0.5° disc and the drops' spread blur a real bow), colours washed toward white a little
  const band = (a, b, x) => smoothstep(a - 0.9, a + 0.4, x).mul(float(1).sub(smoothstep(b - 0.4, b + 0.9, x)));
  const hueOf = (x, a, b) => clamp(x.sub(a).div(b - a), 0, 1);   // 0 at the inner (violet) edge, 1 at the outer (red)
  const spectrum = (h) => mix(vec3(smoothstep(0.35, 0.85, h).add(smoothstep(0.0, 0.12, h).mul(float(1).sub(smoothstep(0.12, 0.3, h))).mul(0.35)),
    smoothstep(0.1, 0.45, h).mul(float(1).sub(smoothstep(0.62, 0.95, h))),
    float(1).sub(smoothstep(0.2, 0.55, h)).mul(0.9)), vec3(0.55), 0.3);
  const p = spectrum(hueOf(th, RAINBOW.innerDeg, 42.4)).mul(band(RAINBOW.innerDeg, 42.4, th));
  // the secondary: a third of the primary, its colours reversed
  const s2 = spectrum(float(1).sub(hueOf(th, 50.2, RAINBOW.secondaryOuterDeg))).mul(band(50.2, RAINBOW.secondaryOuterDeg, th)).mul(0.33);
  // inside the primary the sky is lighter (every drop sends some light there); between the bows, Alexander's dark band
  const inside = float(1).sub(smoothstep(36, 41, th)).mul(smoothstep(18, 32, th)).mul(0.1);
  const toward = smoothstep(0.15, 0.75, dot(normalize(vec2(dir.x, dir.z)), normalize(toRain)));
  const above = smoothstep(-0.005, 0.03, dir.y).mul(float(1).sub(smoothstep(0.55, 0.85, dir.y)));
  const w = toward.mul(above);
  return { light: p.add(s2).add(vec3(inside)).mul(w), alex: smoothstep(42.4, 43.6, th).mul(float(1).sub(smoothstep(49.0, 50.4, th))).mul(w) };
}
