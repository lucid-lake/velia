// The spray mist's WGSL (v2/sim/mist.js: the numbers, the drift and the JS twin of its weight), folded into the water's
// fragment (render/water.js fs: no new pass, no pipeline, no texture: the baked foam lace's coarse mips, one tap a layer).
// Reads the frame's `mist` row: x the level's amount (0: off, every pixel skips it), y unused, zw the wisps' drift (m).
// mistCover(...) → the share of the pixel the mist covers (0..MIST.max); mistColour(...) the light it scatters.
import { MIST } from '../sim/mist.js';
import { FOAM_TEX } from './water-surface.js';   // the baked lace's size (its mips: the soft blobs)

const f = (x) => x.toFixed(6);

// lite: the phone's water (one layer, not two)
export const mistWgsl = (lite = false) => `
// --- the spray mist (v2/sim/mist.js MIST): wisps of the blurred lace stretched along the wind, drifting with it ---
const MI_ON = vec2f(${f(MIST.onset[0])}, ${f(MIST.onset[1])}); const MI_STORM = ${f(MIST.storm)}; const MI_SU = vec2f(${f(MIST.stormU[0])}, ${f(MIST.stormU[1])});
const MI_GUST = ${f(MIST.gust)}; const MI_BIN = ${f(MIST.binDeg * Math.PI / 180)}; const MI_FADE = vec2f(${f(MIST.binFade[0])}, ${f(MIST.binFade[1])});
const MI_SC = vec2f(${f(MIST.scale[0])}, ${f(MIST.scale[1])}); const MI_SC2 = vec2f(${f(MIST.scale2[0])}, ${f(MIST.scale2[1])});
const MI_LOD = ${f(MIST.lod)}; const MI_LACE = ${f(MIST.lace)}; const MI_GAIN = ${f(MIST.laceGain)};   // the lace's level, its mean there, the contrast
const MI_RATE2 = ${f(MIST.speed2 / MIST.speed - 1)};   // the second layer runs ahead of the first by this share of its drift
const MI_WISP = vec2f(${f(MIST.wisp[0])}, ${f(MIST.wisp[1])}); const MI_MEAN = ${f(MIST.mean)}; const MI_FAR = vec2f(${f(MIST.far[0])}, ${f(MIST.far[1])});
const MI_CREST = ${f(MIST.crest)}; const MI_TAU = ${f(MIST.tau)}; const MI_SLANT = ${f(MIST.slant)}; const MI_MAX = ${f(MIST.max)}; const MI_ALB = ${f(MIST.albedo)};
// the weight before the pattern (sim/mist.js mistWeight): the onset on the local wind, the outflow's share, the gust
fn mistWeight(U: f32, storm: f32, gust: f32) -> f32 {
  let k = max(smoothstep(MI_ON.x, MI_ON.y, U), storm * MI_STORM * smoothstep(MI_SU.x, MI_SU.y, U));
  return k * (1.0 + MI_GUST * clamp(gust - 1.0, 0.0, 1.0));
}
// one layer of wisps along the wind's travel ang (rad): the baked foam lace (the slope array's last layer) read at a coarse
// level of its mips, where its cells blur into soft blobs, stretched along the wind: one bilinear tap, no noise maths (v1's
// Perlin cost 1–1.5 ms at 2560 x 1600); far, the level follows the footprint (the mips average it: no sparkle); the two nearest
// fixed directions cross-faded (one tap inside a bin), so a shift never swings the far wisps sideways
fn mistLayer(p: vec2f, ang: f32, sc: vec2f, off: vec2f, fp: f32, salt: f32) -> f32 {
  let fb = ang / MI_BIN; let fk = floor(fb); let w1 = smoothstep(MI_FADE.x, MI_FADE.y, fb - fk); let w0 = 1.0 - w1;
  let lod = max(MI_LOD, log2(max(fp * sc.y * ${FOAM_TEX}.0, 1e-6)));
  var st = 0.0;
  for (var j = 0; j < 2; j++) {
    let wj = select(w0, w1, j == 1);
    if (wj > 0.0) {
      let a = (fk + f32(j)) * MI_BIN; let wd = vec2f(cos(a), sin(a)); let u = p - off;
      let q = vec2f(dot(u, wd), dot(u, vec2f(-wd.y, wd.x))) * sc + salt;
      st += (textureSampleLevel(tSlope, sRep, q, FOAM_LAYER, lod).r - MI_LACE) * wj;
    }
  }
  return 0.5 + MI_GAIN * st / sqrt(w0 * w0 + w1 * w1);
}
// the share of the pixel the mist covers: p the water's rest frame (m), ang the local wind's travel, k the weight (mistWeight ×
// the level), crest 0..1 the big waves' crest here, fp the footprint (m), vy the view's height (|V.y|)
fn mistCover(p: vec2f, ang: f32, k: f32, crest: f32, fp: f32, vy: f32) -> f32 {
  ${lite ? 'let pat = mistLayer(p, ang, MI_SC, F.mist.zw, fp, 0.0);' : 'let pat = 0.6 * mistLayer(p, ang, MI_SC, F.mist.zw, fp, 0.0) + 0.4 * mistLayer(p, ang, MI_SC2, F.mist.zw * (1.0 + MI_RATE2), fp, 13.7);'}
  let wisp = mix(smoothstep(MI_WISP.x, MI_WISP.y, pat), MI_MEAN, smoothstep(MI_FAR.x, MI_FAR.y, fp));   // far: its mean (no sparkle)
  let dens = k * wisp * ((1.0 - MI_CREST) + MI_CREST * crest);
  return min(1.0 - exp(-dens * MI_TAU / (vy + MI_SLANT)), MI_MAX);
}
// the light the mist scatters: the sky's and a forward lobe of the sun (bright looking toward it), the overcast's grey in a storm
fn mistColour(eSky: vec3f, sunPerp: vec3f, s: vec3f, V: vec3f) -> vec3f {
  let fwd = pow(clamp(dot(s, -V), 0.0, 1.0), 6.0);
  let c = MI_ALB * (eSky + sunPerp * (0.25 + 1.6 * fwd)) / PI;
  return mix(c, stormMurkColour() * 0.8, F.storm.x * F.storm.z);
}
`;
