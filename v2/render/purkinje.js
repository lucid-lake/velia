// The Purkinje shift (owner, 2026-11-20: "Look comparison", item 3): as the light falls the eye's rods take over from
// its cones and, sharing their pathways, add to the cones' signals, so a night scene is not a darker day: its dark tones come up a
// little and turn blue, its bright ones stay. In the composite (render/shaders.js TONEMAP), on the exposed colour before the bloom's
// glow and the tone curve; its amount and scale from v2/sim/night.js (PURKINJE, purkinjeAmount): 0 by day (the uniform branch skips
// it: the day's frame is bit for bit the same), up to the night's strength once the sun is down, less under a bright moon.
//   The model (Patry, "Real-Time Samurai Cinema: Lighting, Atmosphere, and Tonemapping in Ghost of Tsushima", SIGGRAPH 2021 Advances
//   in Real-Time Rendering, pp. 160-168; after Cao, Pokorny, Smith and Zele 2008 and Kirk and O'Brien 2011): a colour c (linear
//   Rec.709) gives the cones' and the rods' responses, the cones' gains g = (1 + their arguments)^-1/2, and the rods' change in RGB
//   from those gains times the rods' response: out = c + FROM_GAIN(g) × rod(c) × amount. The colour is first scaled to a retinal
//   illuminance (`scale`: the night's white card to `retina` trolands), so our long-exposure night (far brighter than a real one)
//   still reads as night to the model.
//   About 25 ALU operations a pixel, only while the amount is over 0 (night), every device.
// The folded constants (the receptor rows from linear Rec.709 and the rods' change from the gains) are Ponlai's
// packages/render/post/Purkinje.ts (github.com/HuberyLL/ponlai @ cca9056, MIT, © 2026 Hubery; the full notice in
// v2/render/LICENSE-ponlai.txt), computed there from the published tables named above; the WGSL and the JS twin are written here.
const PK = Object.freeze({
  L: [0.152563, 0.423367, 0.0806355],
  M: [0.0798717, 0.696033, 0.161123],
  S: [0.0031211, 0.0459169, 0.130669],
  ROD: [0.0150385, 0.589431, 0.38577],
  R: [8.42712, -9.02804, 0.268173],
  G: [1.53333, 6.29916, -0.288388],
  B: [17.3479, 17.2285, 1.5731],
});
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// the JS twin of the shader's purkinje(): c the exposed linear colour, scale to the retinal illuminance, amount 0..
export function purkinjeShift(c, scale, amount) {
  if (!(amount > 0)) return c.slice();
  const x = c.map((v) => v * scale);
  const g = [1 / Math.sqrt(1 + dot(PK.L, x)), 1 / Math.sqrt(1 + dot(PK.M, x)), 1 / Math.sqrt(1 + dot(PK.S, x))];
  const rods = dot(PK.ROD, x) / scale;
  return [dot(PK.R, g), dot(PK.G, g), dot(PK.B, g)].map((d, i) => Math.max(c[i] + d * rods * amount, 0));
}
const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(7)).join(', ')})`;
export const PURKINJE_WGSL = `
fn purkinje(c: vec3f, scale: f32, amount: f32) -> vec3f {
  let x = c * scale;
  let g = inverseSqrt(vec3f(dot(${v3(PK.L)}, x), dot(${v3(PK.M)}, x), dot(${v3(PK.S)}, x)) + 1.0);
  let rods = dot(${v3(PK.ROD)}, x) / scale;
  return max(c + vec3f(dot(${v3(PK.R)}, g), dot(${v3(PK.G)}, g), dot(${v3(PK.B)}, g)) * (rods * amount), vec3f(0.0));
}`;
