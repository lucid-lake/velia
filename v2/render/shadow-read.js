// The terrain shadow's reader (M5c): the Shadow record and the 4-tap PCF read, appended to any shader that binds the
// map (render/shadow.js owns the map; the terrain, the forest cards, the boulders and the bed read it). No imports:
// render/terrain.js and render/shadow.js both import it.
export const SHADOW_STRUCT = `struct Shadow { vp: mat4x4f, p: vec4f }`;   // p: on, bias (depth units), 1 / size, texel (m)
// the read: 4 PCF taps; p the world point, nl the surface's cos to the sun (the slope-scaled bias); 1 outside the box
export const SHADOW_READ = (tex, samp, u = 'SH') => `
fn shadowAt(p: vec3f, nl: f32) -> f32 {
  if (${u}.p.x < 0.5) { return 1.0; }
  let lp = ${u}.vp * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z < 0.0 || lp.z > 1.0) { return 1.0; }
  let bias = ${u}.p.y * (1.0 + 3.0 * sqrt(max(1.0 - nl * nl, 0.0)) / max(nl, 0.25));
  let d = ${u}.p.z;
  var s = 0.0;
  s += textureSampleCompare(${tex}, ${samp}, uv + vec2f(-0.5, -0.5) * d, lp.z - bias);
  s += textureSampleCompare(${tex}, ${samp}, uv + vec2f(0.5, -0.5) * d, lp.z - bias);
  s += textureSampleCompare(${tex}, ${samp}, uv + vec2f(-0.5, 0.5) * d, lp.z - bias);
  s += textureSampleCompare(${tex}, ${samp}, uv + vec2f(0.5, 0.5) * d, lp.z - bias);
  return s * 0.25;
}
// one tap (the bed: the water blurs the shadow anyway)
fn shadowAt1(p: vec3f) -> f32 {
  if (${u}.p.x < 0.5) { return 1.0; }
  let lp = ${u}.vp * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z < 0.0 || lp.z > 1.0) { return 1.0; }
  return textureSampleCompare(${tex}, ${samp}, uv, lp.z - ${u}.p.y * 2.0);
}`;
