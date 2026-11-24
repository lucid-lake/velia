// Lakeshore volumetric clouds: a raymarched low layer, as a post pass over scene colour + depth.
// Nubis-style (Schneider and Vos, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn", SIGGRAPH 2015):
// a Perlin-Worley shape volume eroded by a Worley detail volume, a weather map for coverage, a height gradient per
// cloud type, Beer-Lambert + powder light toward the sun, a two-lobe Henyey-Greenstein phase.
//
//   const cl = clouds({ camera, sunDir, wind, coverage: 0.6, base: 700, thickness: 900 });
//   post.outputNode = toneMapping(AgX, 1, cl(sceneColor, sceneDepth));
//   cl.uniforms.time.value = t;   // seconds; the layer drifts by wind × time
//
// T2b: pass `atmosphere` (the AtmosphereContext) to light the clouds from the sky model, and `layers: [low, deck]` for
// two layers (one march each, composited per pixel in the order the ray meets them). Empty air costs one cheap probe
// per step: the detail and the sun ray run only inside cloud.
//
// World frame as src/main.js: x east, y up, z south, metres. Deterministic: noise from a seed, jitter from the pixel.
// Every option is a plain value (wrapped in a uniform) or a TSL node (used as is); cl.uniforms holds the wrapped ones.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Break, float, vec2, vec3, vec4, uniform, texture, texture3D, uv, screenCoordinate,
  getViewPosition, getScreenPosition, interleavedGradientNoise, exp, max, min, mix, clamp, saturate, smoothstep, dot,
  normalize, length, fract, passTexture,
} from 'three/tsl';
import { getSplitScalarIlluminance } from '@takram/three-atmosphere/webgpu';
import { span } from './profile.js';
import { toBytes, shapeValues, detailValues, weatherBytes } from './clouds-noise.js';
import { take } from './prebake.js';
import { NIGHT_CLOUD } from './core/night.js';

// a fair layer's weather hooks: every one returns its input, the node itself (a storm: true layer takes the weather
// bus's clouds hooks instead, src/weather/uniforms.js; with no storm running they are gated off: the same pixels)
const FAIR = Object.freeze({
  slabTop: (top) => top, slabBottom: (base) => base, cell: () => null, thickness: (th) => th, type: (t) => t,
  baseFade: (f) => f, coverage: (c) => c, density: (d) => d, height: (h) => h, lightThickness: (th) => th,
  sunFloor: (x) => x, skyFloor: (x) => x, seal: (T) => T,
});
const weatherOf = (o, weather) => (o.storm === true && weather ? weather.clouds : FAIR);

// --- The noise volumes, baked once into 3D textures (the noise: src/clouds-noise.js) ------------------------------
function volume(size, data) {
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// Shape: Perlin-Worley (billows) remapped by a low Worley fBm. Detail: a three-octave Worley fBm. Weather: R coverage,
// G type. Taken from the load-time bake (src/prebake.js, workers) when it made these, else computed here: the same bytes.
export function cloudTextures(seed = 1, shapeSize = 96, detailSize = 32) {
  const shapeData = take(`clouds:shape:${seed}:${shapeSize}`) ?? toBytes(shapeValues(seed, shapeSize));
  const detailData = take(`clouds:detail:${seed}:${detailSize}`) ?? toBytes(detailValues(seed, detailSize));
  const wdata = take(`clouds:weather:${seed}`) ?? weatherBytes(seed);
  const shape = volume(shapeSize, shapeData), detail = volume(detailSize, detailData);
  const W = 256;
  const weather = new THREE.DataTexture(wdata, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
  weather.minFilter = weather.magFilter = THREE.LinearFilter;
  weather.wrapS = weather.wrapT = THREE.RepeatWrapping;
  weather.needsUpdate = true;
  return { shape, detail, weather };
}

// --- The pass ---------------------------------------------------------------------------------------------------
const asNode = (v, fallback) => {
  const x = v ?? fallback;
  if (x?.isNode) return x;
  if (x?.isVector3 || x?.isVector2 || x?.isColor || typeof x === 'number') return uniform(x);
  if (Array.isArray(x)) return uniform(x.length === 2 ? new THREE.Vector2(...x) : new THREE.Vector3(...x));
  throw new Error(`clouds: bad option ${x}`);
};

const SHAPE_M = 5000, DETAIL_M = 700, FINE_M = 117, WEATHER_M = 24000;   // tile sizes in metres (FINE: 6× the detail)
const FINE_NEAR = 1500, FINE_FAR = 4000;   // metres: the fine octave at full weight up to NEAR, gone by FAR
const LAYER_DEFAULTS = {
  coverage: 0.5,                   // 0 clear .. 1 overcast
  type: 0.6,                       // 0 stratus (flat sheets) .. 1 cumulus (tall towers)
  density: 0.04,                   // extinction per metre at full density
  base: 700, thickness: 900,       // metres above the lake
  weatherOffset: [0, 0],           // metres; shifts this layer's weather map so two layers don't share a pattern
  steps: 96,                       // samples along the ray (compile-time); 96 halves the error of 64 vs a 512 reference
  sunScale: 1, ambientScale: 1,    // trims on the light, per layer
  nearFade: 20,                    // metres: density fades in over this distance from the camera (no sheet in your face)
  skyOcclusion: 1.0,               // the sky light dims by exp(-k × optical depth straight up), from 2 cheap samples
                                   // above each lit sample: thick cores and undersides darken, thin edges keep the sky
                                   // (learned from a public cumulus shader). 0 = off (no extra samples).
  fine: 'auto',                    // the fine erosion octave near the camera (crisp close-up edges): true, false, or
                                   // 'auto' = with temporal only (alone it doubles the march noise: 0.3 → 1.0 levels)
  terrain: null,                   // { heightAt, band, taper, raise, outside, extentM, size }: hug the slopes (bakeTerrainMask)
};

// A terrain mask for one layer, baked once (R8, world-anchored, not drifting): 1 where the ground is within `band` metres
// of the layer's base, falling to 0 over `taper` more, and 0 over the water (heights under 5 m). The layer's coverage rises by `raise` on the mask and is scaled
// by `outside` off it, so a low bank hugs the slopes at its own height and leaves the open lake clear.
export function bakeTerrainMask(heightAt, base, { band = 60, taper = 250, extentM = 16000, size = 512 } = {}) {
  const data = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const h = heightAt((i + 0.5) / size * extentM - extentM / 2, (j + 0.5) / size * extentM - extentM / 2);
    const x = Math.min(1, Math.max(0, (Math.abs(h - base) - band) / taper));
    const land = Math.min(1, Math.max(0, (h - 5) / 35));   // water is not a slope: 0 on the lake, 1 from 40 m up
    data[j * size + i] = Math.round((1 - x * x * (3 - 2 * x)) * land * land * (3 - 2 * land) * 255);
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

const hg = (c, g) => float(1 - g * g).div(float(1 + g * g).sub(c.mul(2 * g)).pow(1.5)).mul(1 / (4 * Math.PI));

// One layer: uniforms, density, and a march that returns { L, T, tNear } along a ray (no compositing).
function makeLayer(opts, shared) {
  const o = { ...LAYER_DEFAULTS, ...opts };
  const u = {
    coverage: asNode(o.coverage), type: asNode(o.type), density: asNode(o.density),
    base: asNode(o.base), thickness: asNode(o.thickness), weatherOffset: asNode(o.weatherOffset),
    sunScale: asNode(o.sunScale), ambientScale: asNode(o.ambientScale), nearFade: asNode(o.nearFade),
    skyOcclusion: asNode(o.skyOcclusion),
  };
  const { tex, s } = shared;
  let mask = null;
  if (o.terrain) {
    // taper 250 m and raise 0.25: a soft band on the slopes; 120 m / 0.35 drew bright streaks (sweep 2026-10-28)
    const tr = { band: 60, taper: 250, raise: 0.25, outside: 0.25, extentM: 16000, size: 512, ...o.terrain };
    if (typeof o.base !== 'number') throw new Error('clouds: a terrain-masked layer needs a numeric base (the mask is baked at it)');
    mask = { tex: bakeTerrainMask(tr.heightAt, o.base, tr), extentM: tr.extentM };
    u.terrainRaise = asNode(tr.raise); u.terrainOutside = asNode(tr.outside);
  }

  // Density in two parts, so empty air costs one weather + one shape lookup: the base (coverage, type, shape) and the
  // detail erosion. density(p, true) is the base only (sun-ray samples); density(p) the full value.
  // wow/storm (the weather bus, src/weather/uniforms.js clouds): the deck layer (storm: true) carries the cell; a fair
  // layer's hooks return their input. Off, m = 0 and every stormy term is the old one exactly (x + 0, mix(a, b, 0));
  // on, the cell's towers rise to STORM_TOP_M, fill in and darken.
  const wx = weatherOf(o, shared.weather);
  const slabTop = () => wx.slabTop(u.base.add(u.thickness));
  const slabBottom = () => wx.slabBottom(u.base);   // the shelf cloud and the rain's curtains hang below the deck
  const baseDensity = (p) => {
    const top = slabTop();
    const m = wx.cell(p);
    const thick = wx.thickness(u.thickness, m, u.base);
    const h = saturate(p.y.sub(u.base).div(thick));
    const q = p.sub(vec3(s.wind.x, 0, s.wind.y).mul(s.time));
    const wthr = texture(tex.weather, q.xz.add(u.weatherOffset).div(WEATHER_M));
    const t = wx.type(saturate(u.type.add(wthr.g.sub(0.5).mul(0.5))), m);
    // Height gradient: top at 30 % (stratus) .. 100 % (cumulus) of the layer. The base fades over 10 % (cumulus) ..
    // 35 % (stratus): a thin sheet seen edge-on shows no ruled line.
    const hTop = mix(0.3, 1.0, t);
    const grad = smoothstep(0.0, wx.baseFade(mix(0.35, 0.1, t), m), h).mul(float(1).sub(smoothstep(hTop.mul(0.55), hTop, h)));
    let cov = wx.coverage(saturate(u.coverage.add(wthr.r.sub(0.5).mul(0.7))), m);
    if (mask) {
      const m = texture(mask.tex, p.xz.div(mask.extentM).add(0.5)).r;   // world-anchored: the slopes don't drift
      cov = saturate(cov.mul(mix(u.terrainOutside, 1.0, m)).add(m.mul(u.terrainRaise)));
    }
    const shape = texture3D(tex.shape, q.add(vec3(u.weatherOffset.x, 0, u.weatherOffset.y)).div(SHAPE_M)).r;
    // Nubis: shape × gradient, cut by coverage, weighted by coverage.
    let d = saturate(shape.mul(grad).sub(float(1).sub(cov)).div(max(cov, 0.05))).mul(saturate(cov.mul(1.5)));
    // the cell: denser, the shelf over the outflow line, the rain's curtains under it
    d = wx.density(d, { p, m, base: u.base, shape, detail: tex.detail, wind: s.wind, time: s.time });
    return { d: d.mul(p.y.greaterThan(slabBottom()).and(p.y.lessThan(top)).select(1.0, 0.0)), h: wx.height(h, m), q };
  };
  // Erosion: the detail octave everywhere, plus a fine octave (FINE_M) near the camera, so the edges of a cloud
  // seen from a few hundred metres stay crisp; past FINE_FAR it would only alias, and costs a texture read.
  const erode = ({ d, h, q }, dist) => {
    const qd = q.add(vec3(0, s.time.mul(2.0), 0));
    let det = texture3D(tex.detail, qd.div(DETAIL_M)).r;
    let k = float(0.3);   // erosion strength
    if (dist && o.fine) {
      const w = float(1).sub(smoothstep(FINE_NEAR, FINE_FAR, dist));
      const fine = texture3D(tex.detail, qd.add(vec3(37.0, 11.0, 53.0)).div(FINE_M)).r;
      det = mix(det, det.mul(0.5).add(fine.mul(0.5)), w);
      k = mix(0.3, 0.42, w);   // near: bite deeper, so the fine octave carves the edge instead of only shading it
    }
    const dm = mix(det, float(1).sub(det), saturate(h.mul(4)));   // wispy under, billowy above
    return saturate(d.sub(dm.mul(k)).div(float(1).sub(k)));
  };
  const sampleDensity = (p, cheap) => (cheap ? baseDensity(p).d : erode(baseDensity(p)));

  // The sun and sky light on this layer, once per pixel at the ray's entry point (mid-layer height).
  const lightAt = (pWorld) => {
    if (!s.atmosphere) return { sun: s.sunColor.mul(u.sunScale), ambTop: s.ambientTop.mul(u.ambientScale), ambBottom: s.ambientBottom.mul(u.ambientScale) };
    const A = s.atmosphere;
    let pE = A.matrixWorldToECEF.mul(vec4(pWorld, 1)).xyz;
    if (A.correctAltitude) pE = pE.add(A.altitudeCorrectionECEF);
    const ill = getSplitScalarIlluminance(pE.mul(A.parametersNode.worldToUnit), A.sunDirectionECEF).toVar();
    // Sun: E / π, not the single-scatter E / 4π: the one-octave Beer term loses the light that multiple scattering
    // carries through a real cloud, and 4× matched target-04's pastel tops (sweep 1–4×, 2026-10-28).
    // Sky: the scalar illuminance spans the whole sphere, but the light comes from the upper half (the ground is dark),
    // so the mean sky radiance is E / 2π. The ground bounce (bottom) is a third of it (an assumption).
    // + the starlit night's sky light (src/core/night.js; 0 until the night sky writes it): a night deck reads grey-blue
    const sky = ill.get('indirect').mul(1 / (2 * Math.PI)).add(NIGHT_CLOUD.mul(A.parametersNode.luminanceScale)).mul(u.ambientScale);
    return { sun: ill.get('direct').mul(1 / Math.PI).mul(u.sunScale), ambTop: sky, ambBottom: sky.mul(0.33) };
  };

  // Quadratic spacing (fine steps near the camera, long ones far out), jittered per pixel. Each step probes the base
  // density first; the detail lookup and the sun ray run only where the base is non-zero (empty-space skipping).
  const march = (ro, dirW, sceneDist, jitter, sunDir, phase) => {
    const top = slabTop();
    const dy = dirW.y;
    const safeDy = dy.abs().lessThan(1e-4).select(dy.greaterThanEqual(0).select(1e-4, -1e-4), dy);
    const bottom = slabBottom();
    const tBase = bottom.sub(ro.y).div(safeDy), tTop = top.sub(ro.y).div(safeDy);
    const tNear = max(min(tBase, tTop), 0.0).toVar();
    const tFar = max(tBase, tTop).toVar();
    If(ro.y.greaterThan(bottom).and(ro.y.lessThan(top)), () => { tNear.assign(0.0); });
    tFar.assign(min(min(tFar, sceneDist), s.maxDistance));

    const T = float(1).toVar(), L = vec3(0).toVar();
    If(tFar.greaterThan(tNear), () => {
      // The light at two depths, the entry and the exit (mid-layer height), blended along the ray: a long ray through
      // the layer sees the far side's sun colour, not the near side's.
      const midY = u.base.add(u.thickness.mul(0.5));
      const pIn = ro.add(dirW.mul(tNear)), pOut = ro.add(dirW.mul(tFar));
      const litIn = lightAt(vec3(pIn.x, midY, pIn.z)), litOut = lightAt(vec3(pOut.x, midY, pOut.z));
      const sunIn = vec3(litIn.sun).toVar(), ambTopIn = vec3(litIn.ambTop).toVar(), ambBotIn = vec3(litIn.ambBottom).toVar();
      const sunOut = vec3(litOut.sun).toVar(), ambTopOut = vec3(litOut.ambTop).toVar(), ambBotOut = vec3(litOut.ambBottom).toVar();
      const segment = tFar.sub(tNear);
      // wow/storm: in a thunderhead the sun's ray reaches further (its own tower shades its base); the slab is 0 with no storm
      const lightStep = wx.lightThickness(u.thickness).mul(0.5 / shared.lightSteps);
      const N = o.steps;

      Loop(N, ({ i }) => {
        const x = float(i).add(jitter).div(N);
        const tCur = tNear.add(segment.mul(x).mul(x));
        const dt = segment.mul(x.mul(2).add(1 / N)).div(N);
        const p = ro.add(dirW.mul(tCur));
        const b = baseDensity(p);
        If(b.d.greaterThan(0.0), () => {
          const d = erode(b, tCur).mul(smoothstep(0.0, u.nearFade, tCur));   // no eye-level sheet in the lens
          If(d.greaterThan(0.002), () => {
            const od = float(0).toVar();
            for (let k = 0; k < shared.lightSteps; k++) {
              const sk = (k + 0.5) * (1 + k * 0.5);
              od.addAssign(sampleDensity(p.add(sunDir.mul(lightStep.mul(sk))), true).mul(lightStep.mul(1 + k * 0.5)));
            }
            const sigma = d.mul(u.density);
            const beer = exp(od.mul(u.density).negate());
            const beerSoft = exp(od.mul(u.density).mul(-0.12)).mul(0.25);   // multiple-scattering stand-in
            const powder = float(1).sub(exp(sigma.mul(-120)));
            const f = saturate(tCur.sub(tNear).div(max(segment, 1.0)));
            const sunCol = mix(sunIn, sunOut, f), ambTop = mix(ambTopIn, ambTopOut, f), ambBottom = mix(ambBotIn, ambBotOut, f);
            // wow/storm: inside a thunderhead the light scatters on (a floor on the sun's term; 0 with no storm, so max() is the old value)
            const sunL = sunCol.mul(wx.sunFloor(max(beer, beerSoft))).mul(phase).mul(mix(0.5, 1.0, powder));
            const hFrac = saturate(p.y.sub(u.base).div(u.thickness));
            let skyVis = float(1);
            if (o.skyOcclusion !== 0) {
              // Optical depth straight up over 0.25 of the layer: samples at 0.06 and 0.18 (the base density only).
              const up = u.thickness.mul(0.06), up2 = u.thickness.mul(0.18);
              const odUp = sampleDensity(p.add(vec3(0, up, 0)), true).add(sampleDensity(p.add(vec3(0, up2, 0)), true))
                .mul(u.thickness.mul(0.125));
              skyVis = exp(odUp.mul(u.density).mul(u.skyOcclusion).negate());
              skyVis = wx.skyFloor(skyVis);   // wow/storm: no black voids in a dense cell (the sky's light gets in sideways)
            }
            const amb = mix(ambBottom, ambTop.mul(skyVis), hFrac);   // the sky term only: the ground bounce comes from below
            const S = sunL.add(amb).mul(sigma);
            const Tstep = exp(sigma.mul(dt).negate());
            L.addAssign(T.mul(S.sub(S.mul(Tstep))).div(max(sigma, 1e-6)));
            T.mulAssign(Tstep);
          });
        });
        If(T.lessThan(0.01), () => { Break(); });
      });
      // Far clouds fade into the haze rather than end at maxDistance.
      const fade = float(1).sub(smoothstep(s.maxDistance.mul(0.5), s.maxDistance, tNear));
      T.assign(mix(1.0, T, fade));
      L.mulAssign(fade);
    });
    return { L, T, tNear };
  };
  return { u, march };
}

// --- Temporal accumulation (T2c) -------------------------------------------------------------------------------
// The clouds' raw result (L in rgb, T in a) is marched at `scale` of the screen (half by default: a quarter of the
// pixels) into our own target, then resolved against last frame's history: reprojected through the front layer's
// mid-plane (clouds have no depth buffer of their own), clamped to the current 3×3 neighbourhood (no ghosts) and
// blended at `alpha`. With the jitter rotated per frame, the march noise averages out over ≈ 1 / alpha frames.
// Two history targets swap each frame (no copy). No RTTNode: it re-renders on every render call (the march ran twice).
// The scene's depth must be a plain texture here: a pass texture inside these nested renders re-renders the scene.
const _quad = /*@__PURE__*/ new THREE.QuadMesh();
const _p = /*@__PURE__*/ new THREE.Vector3(), _f = /*@__PURE__*/ new THREE.Vector3();
const CUT_M = 15, CUT_COS = Math.cos(12 * Math.PI / 180);   // a camera move between two frames past these is a cut
const _size = /*@__PURE__*/ new THREE.Vector2();
let _state;
class CloudTemporalNode extends THREE.TempNode {
  static get type() { return 'CloudTemporalNode'; }
  constructor(rawNode, camera, planeYs, maxDistance, alpha, frame, scale, passes = 1) {
    // passes 2: march into a target, then resolve with a 3×3 neighbourhood clamp. passes 1: march and resolve in one
    // nested pass, the history clamped to a band around the current value (one render pass fewer; slow clouds don't ghost).
    super('vec4');
    this.rawNode = rawNode;
    this.camera = camera;
    this.planeYs = planeYs;
    this.maxDistance = maxDistance;
    this.scale = scale;
    this.passes = passes;
    this.alpha = uniform(alpha);
    this.frame = frame;   // the jitter's rotation (the march reads it); counts frames
    this.updateBeforeType = THREE.NodeUpdateType.FRAME;
    const opts = { depthBuffer: false, type: THREE.HalfFloatType };
    this._raw = new THREE.RenderTarget(1, 1, opts);
    this._ping = [new THREE.RenderTarget(1, 1, opts), new THREE.RenderTarget(1, 1, opts)];
    this._cur = 0;
    this._camWorld = uniform(new THREE.Matrix4());
    this._projInv = uniform(new THREE.Matrix4());
    this._prevView = uniform(new THREE.Matrix4());   // last frame's world → view
    this._prevProj = uniform(new THREE.Matrix4());
    this._texel = uniform(new THREE.Vector2());
    this._fresh = true;
    this._first = true;
    this._firstU = uniform(1);
    this._rawMaterial = new THREE.NodeMaterial();
    this._rawMaterial.name = 'CloudRaw';
    this._material = new THREE.NodeMaterial();
    this._material.name = 'CloudTemporal';
    this._historyTex = texture(this._ping[1].texture);
    this._outTex = passTexture(this, this._ping[0].texture);   // a pass texture: ties this node's updateBefore into the frame
  }
  getTextureNode() { return this._outTex; }
  reset() { this._fresh = true; }
  updateBefore({ renderer }) {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(1, Math.ceil(_size.x * this.scale)), h = Math.max(1, Math.ceil(_size.y * this.scale));
    _state = THREE.RendererUtils.resetRendererState(renderer, _state);
    const cam = this.camera;
    this._camWorld.value.copy(cam.matrixWorld);
    this._projInv.value.copy(cam.projectionMatrixInverse);
    // a cut (the camera jumped since the last frame drawn: a capture's run-up, a director's cut, a mode's hand-over): the
    // history belongs to another view, and reprojected through the layers' planes it showed as hard-edged dark slabs (the
    // fireworks capture, 2026-11-08); start again from the current frame
    _p.setFromMatrixPosition(cam.matrixWorld); _f.set(0, 0, -1).transformDirection(cam.matrixWorld);
    if (this._lastPos && (_p.distanceTo(this._lastPos) > CUT_M || _f.dot(this._lastFwd) < CUT_COS)) this._first = true;
    (this._lastPos ??= new THREE.Vector3()).copy(_p); (this._lastFwd ??= new THREE.Vector3()).copy(_f);
    if (this._fresh || this._raw.width !== w || this._raw.height !== h) {
      for (const rt of [this._raw, ...this._ping]) { rt.setSize(w, h); renderer.initRenderTarget(rt); }
      this._texel.value.set(1 / w, 1 / h);
      this._prevView.value.copy(cam.matrixWorldInverse); this._prevProj.value.copy(cam.projectionMatrix);
      this._first = true;
      this._fresh = false;
    }
    const cur = this._ping[this._cur], prev = this._ping[1 - this._cur];
    this._historyTex.value = prev.texture;
    this._outTex.value = cur.texture;
    this._firstU.value = this._first ? 1 : 0;   // no history yet: show the current frame
    if (this.passes === 2) {
      renderer.setRenderTarget(this._raw);
      _quad.material = this._rawMaterial;
      _quad.render(renderer);
    }
    renderer.setRenderTarget(cur);
    _quad.material = this._material;
    _quad.render(renderer);
    this._cur = 1 - this._cur;
    this._prevView.value.copy(cam.matrixWorldInverse);
    this._prevProj.value.copy(cam.projectionMatrix);
    this.frame.value += 1;
    this._first = false;
    THREE.RendererUtils.restoreRendererState(renderer, _state);
  }
  setup() {
    this._rawMaterial.fragmentNode = this.rawNode;
    this._rawMaterial.needsUpdate = true;
    const raw = texture(this._raw.texture);
    const history = this._historyTex;
    const first = this._firstU;
    this._material.fragmentNode = Fn(() => {
      const uvN = uv();
      const single = this.passes === 1;
      const cur = (single ? vec4(this.rawNode) : raw.sample(uvN)).toVar();
      const lo = cur.toVar(), hi = cur.toVar();
      if (single) {   // a band around the current value: ±25 % and ±0.02 (the march noise is a few %)
        lo.assign(cur.mul(0.75).sub(0.02)); hi.assign(cur.mul(1.25).add(0.02));
      } else {
        for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const c = raw.sample(uvN.add(vec2(dx, dy).mul(this._texel)));
          lo.assign(min(lo, c)); hi.assign(max(hi, c));
        }
      }
      // Reproject through the nearest layer mid-plane ahead of the camera (or a far point for level rays).
      const vFar = getViewPosition(uvN, float(1.0), this._projInv);
      const dir = normalize(this._camWorld.mul(vec4(vFar, 0.0)).xyz);
      const ro = this._camWorld.mul(vec4(0, 0, 0, 1)).xyz;
      const tRep = float(this.maxDistance).toVar();
      for (const y of this.planeYs) {
        const t = asNode(y).sub(ro.y).div(dir.y);
        If(t.greaterThan(0.0).and(t.lessThan(tRep)), () => { tRep.assign(t); });
      }
      const world = ro.add(dir.mul(tRep));
      const prevUv = getScreenPosition(this._prevView.mul(vec4(world, 1.0)).xyz, this._prevProj);
      const inside = prevUv.x.greaterThanEqual(0).and(prevUv.x.lessThanEqual(1)).and(prevUv.y.greaterThanEqual(0)).and(prevUv.y.lessThanEqual(1));
      const histRaw = history.sample(prevUv);
      const hist = clamp(histRaw, lo, hi);
      // A texel the boat has just uncovered (or covered): its history is the short march that stopped at the sail, clear air
      // (T near 1), where the ray now runs through the whole deck (T near 0). Clamped to the band it was still 25 % short of
      // light for some frames: a dark smear trailing the mast head and the leech across a storm's deck (inside the storm's
      // slab the boat is not marched as sky; see nearSky). Clouds do not change their transmittance that fast (the march
      // noise is a few %), so a jump in T is a change of what the ray hits: take the current frame there.
      const cut = smoothstep(0.08, 0.3, histRaw.a.sub(cur.a).abs());
      return inside.and(first.lessThan(0.5)).select(mix(hist, cur, max(this.alpha, cut)), cur);
    })();
    this._material.needsUpdate = true;
    return this._outTex;
  }
}

export function clouds({
  camera,                          // the scene camera (matrices are read every frame)
  sunDir,                          // unit vector toward the sun, world frame
  wind = [5, 0],                   // m/s, (x east, z south); every layer drifts by it
  atmosphere,                      // an AtmosphereContext: light from the sky model (sun transmittance, sky light)
  sunColor = new THREE.Color(1.0, 0.85, 0.7).multiplyScalar(1.8),   // without atmosphere: radiance, scene units
  ambientTop = new THREE.Color(0.55, 0.62, 0.75).multiplyScalar(0.5),
  ambientBottom = new THREE.Color(0.30, 0.32, 0.36).multiplyScalar(0.2),
  time = 0,                        // seconds
  lightSteps = 5,                  // sun-ray samples (compile-time)
  maxDistance = 30000,             // metres; layers fade out toward it
  seed = 1,
  textures,                        // reuse a cloudTextures() result
  temporal = false,                // accumulate over frames at temporalScale (live loop); off for headless captures
  temporalAlpha = 0.1,             // the current frame's weight in the blend
  temporalScale = 0.5,             // the march's resolution with temporal on (0.5: a quarter of the pixels)
  nearSky = 0,                     // wow/birds: metres. > 0: the temporal march treats geometry nearer than this AND nearer
                                   // than the first layer as open sky (the full-res composite masks it anyway), so a small
                                   // moving thing (a bird) leaves no trail in the history. 0 (the default, the goldens): unchanged.
  temporalPasses = 1,              // nested render passes per frame: 1 (march and resolve together, the default since
                                   // 2026-10-29: ≈ 2.7 ms less in tools/bench.mjs, no visible change) or 2 (+ a 3×3 clamp)
  weather = null,                  // the weather bus (src/weather/uniforms.js createWeatherBus): a storm: true layer carries
                                   // its cell, and the deck seals the sun's disc; null: fair weather, no hooks
  layers,                          // [{ coverage, type, density, base, thickness, weatherOffset, steps, sunScale, ambientScale,
                                   //    nearFade, terrain }]
  ...single                        // or one layer's options at the top level (the T2 interface)
} = {}) {
  if (!camera) throw new Error('clouds: camera is required');
  const endTex = span('clouds:textures');
  const tex = textures ?? cloudTextures(seed);
  endTex();
  const s = {
    sunDir: asNode(sunDir, new THREE.Vector3(0.3, 0.3, -0.9).normalize()), wind: asNode(wind), time: asNode(time),
    maxDistance: asNode(maxDistance), sunColor: asNode(sunColor), ambientTop: asNode(ambientTop),
    ambientBottom: asNode(ambientBottom), atmosphere, frame: uniform(0),
  };
  const layerOpts = layers ?? [single];
  if (layerOpts.length > 2) throw new Error('clouds: one or two layers');
  const list = layerOpts.map((l) => makeLayer({ ...l, fine: (l.fine ?? 'auto') === 'auto' ? temporal : l.fine }, { tex, s, lightSteps, weather }));
  const camWorld = uniform(camera.matrixWorld);
  const camProjInv = uniform(camera.projectionMatrixInverse);

  // The raw result along each pixel's ray: vec4(L, T), so that out = scene × T + L.
  const raw = (depthNode, skyNear = 0) => Fn(() => {
    const uvN = uv();
    const depth = depthNode.r !== undefined ? depthNode.r : depthNode;
    const vFar = getViewPosition(uvN, float(1.0), camProjInv);
    const dirW = normalize(camWorld.mul(vec4(vFar, 0.0)).xyz).toVar();
    const ro = camWorld.mul(vec4(0, 0, 0, 1)).xyz.toVar();
    const sceneDist = depth.greaterThanEqual(0.999999).select(float(1e9), length(getViewPosition(uvN, depth, camProjInv))).toVar();
    if (skyNear > 0) {   // wow/birds (nearSky): near geometry in front of every layer marches as sky; see the option
      const tEntry = float(1e9).toVar();
      // the slab as the march and the composite below see it (fix/storm-clouds-over-boat): under a storm's rain the deck's
      // slab reaches down to the water (weather.clouds.slabBottom), the camera is inside it (tEntry 0) and nothing is
      // "in front of every layer". With the fair base here, the boat marched as sky while the composite, inside the slab,
      // masked nothing: the whole sky's cloud lay over the boat in the helm view.
      for (const l of layerOpts) {
        const o = { ...LAYER_DEFAULTS, ...l };
        const lo = weatherOf(o, weather).slabBottom(asNode(o.base)), hi = asNode(o.base).add(asNode(o.thickness));
        const dy = dirW.y.abs().lessThan(1e-4).select(dirW.y.greaterThanEqual(0).select(1e-4, -1e-4), dirW.y);
        const t0 = lo.sub(ro.y).div(dy), t1 = hi.sub(ro.y).div(dy);
        const inside = ro.y.greaterThan(lo).and(ro.y.lessThan(hi));
        If(max(t0, t1).greaterThan(0.0), () => { tEntry.assign(min(tEntry, max(inside.select(0.0, min(t0, t1)), 0.0))); });
      }
      If(sceneDist.lessThan(min(tEntry, float(skyNear))), () => { sceneDist.assign(1e9); });
    }
    // Interleaved gradient noise, rotated by the golden ratio each frame (the frame stays 0 without temporal).
    const jitter = fract(interleavedGradientNoise(screenCoordinate.xy).add(s.frame.mul(0.618034)));
    const sun = normalize(s.sunDir);
    const cosT = dot(dirW, sun);
    const phase = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3).mul(4 * Math.PI).add(0.1);

    const res = vec4(0, 0, 0, 1).toVar();
    if (list.length === 1) {
      const r = list[0].march(ro, dirW, sceneDist, jitter, sun, phase);
      res.assign(vec4(r.L, r.T));
    } else {
      // Layers do not overlap in height, so along one ray they are hit in tNear order: front over back.
      const [a, b] = list.map((l) => l.march(ro, dirW, sceneDist, jitter, sun, phase));
      If(a.tNear.lessThanEqual(b.tNear), () => {
        res.assign(vec4(a.L.add(b.L.mul(a.T)), a.T.mul(b.T)));
      }).Else(() => {
        res.assign(vec4(b.L.add(a.L.mul(b.T)), a.T.mul(b.T)));
      });
    }
    return res;
  })();

  let temporalNode = null;
  const apply = (colorNode, depthNode) => {
    let r;
    if (!temporal) r = raw(depthNode);
    else {
      // A plain texture of the same depth buffer: a pass texture inside the nested resolve render would make the
      // scene pass render again (measured: +2 × 3.5 ms).
      r = raw(depthNode.value?.isTexture ? texture(depthNode.value) : depthNode, nearSky);
      const planes = layerOpts.map((l) => { const o = { ...LAYER_DEFAULTS, ...l }; return asNode(o.base).add(asNode(o.thickness).mul(0.5)); });
      temporalNode = new CloudTemporalNode(r, camera, planes, maxDistance, temporalAlpha, s.frame, temporalScale, temporalPasses);
      const lowTex = temporalNode.getTextureNode(), texel = temporalNode._texel;
      const distAt = (uvN, d) => d.greaterThanEqual(0.999999).select(float(1e9), length(getViewPosition(uvN, d, camProjInv)));
      // Upsampling a low-res texel that straddles a ridge would smear cloud onto the ridge. Per full-res pixel: if the
      // scene is nearer than the first layer's entry along the ray, nothing can be in front of it.
      r = Fn(() => {
        const uvN = uv();
        const depth = depthNode.r !== undefined ? depthNode.r : depthNode;
        const dirW = normalize(camWorld.mul(vec4(getViewPosition(uvN, float(1.0), camProjInv), 0.0)).xyz);
        const ro = camWorld.mul(vec4(0, 0, 0, 1)).xyz;
        const sceneDist = depth.greaterThanEqual(0.999999).select(float(1e9), length(getViewPosition(uvN, depth, camProjInv)));
        const tEntry = float(1e9).toVar();
        for (const l of layerOpts) {
          const o = { ...LAYER_DEFAULTS, ...l };
          const lo = weatherOf(o, weather).slabBottom(asNode(o.base)), hi = asNode(o.base).add(asNode(o.thickness));
          const dy = dirW.y.abs().lessThan(1e-4).select(dirW.y.greaterThanEqual(0).select(1e-4, -1e-4), dirW.y);
          const t0 = lo.sub(ro.y).div(dy), t1 = hi.sub(ro.y).div(dy);
          const inside = ro.y.greaterThan(lo).and(ro.y.lessThan(hi));
          const tIn = inside.select(0.0, min(t0, t1));
          If(max(t0, t1).greaterThan(0.0), () => { tEntry.assign(min(tEntry, max(tIn, 0.0))); });
        }
        // A depth-aware upsample (fix/storm-clouds-over-boat): each low-res texel holds the cloud in front of ITS scene
        // depth (the march stops there), so a plain bilinear tap laid the open sky's cloud over the mast beside it, and
        // the mast's clear air over the sky, in half-res blocks. The four texels round the pixel, each weighed by how
        // close its ray's scene distance is to this pixel's; a pixel with no like texel (a shroud, a stay: thinner than
        // a texel) is nearer than all four, and takes the nearest-in-depth one's cloud scaled by its share of that ray.
        const res = vec4(0, 0, 0, 1).toVar();
        If(sceneDist.greaterThanEqual(tEntry), () => {
          const g = uvN.div(texel).sub(0.5), f = fract(g), uv0 = g.sub(f).add(0.5).mul(texel);
          const sum = vec4(0).toVar(), wSum = float(0).toVar(), best = vec4(0, 0, 0, 1).toVar(), bestRel = float(1e20).toVar(), bestD = float(1e9).toVar();
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const uvT = uv0.add(vec2(dx, dy).mul(texel));
            const c = lowTex.sample(uvT), dT = distAt(uvT, depthNode.sample(uvT).r);
            const rel = dT.sub(sceneDist).abs().div(max(min(dT, sceneDist), 1.0));
            const w = (dx ? f.x : float(1).sub(f.x)).mul(dy ? f.y : float(1).sub(f.y)).add(0.01).div(rel.mul(20).mul(rel.mul(20)).add(1));
            sum.addAssign(c.mul(w)); wSum.addAssign(w);
            If(rel.lessThan(bestRel), () => { bestRel.assign(rel); best.assign(c); bestD.assign(dT); });
          }
          If(wSum.greaterThan(1e-3), () => { res.assign(sum.div(wSum)); }).Else(() => {
            res.assign(mix(vec4(0, 0, 0, 1), best, saturate(sceneDist.div(min(bestD, s.maxDistance)))));
          });
        });
        return res;
      })();
    }
    return vec4(vec3(colorNode.rgb).mul(weather ? weather.clouds.seal(r.a) : r.a).add(r.rgb), 1.0);   // wow/storm: a storm's thick deck seals the sun's disc (off: r.a)
  };

  apply.uniforms = { ...s, ...list[0].u };   // the shared ones plus the first layer's (the T2 interface)
  apply.layers = list.map((l) => l.u);
  apply.textures = tex;
  apply.resetHistory = () => temporalNode?.reset();   // after a camera cut
  // D2 (time of day): the sun's direction for the phase function and the light march, per frame. The light itself
  // already follows the sky model's sun (getSplitScalarIlluminance reads atmosphere.sunDirectionECEF). In place: the
  // uniform may hold the caller's own vector (main.js passes sunWorld).
  apply.setSun = (dir) => { s.sunDir.value.set(dir.x, dir.y, dir.z).normalize(); };
  apply.daylight = (f) => { apply.setSun(f.sunDir); if (f.cut) apply.resetHistory(); };
  clouds.last = apply;   // the newest instance, for demos and tools (main.js does not expose its own)
  return apply;
}
