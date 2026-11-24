// The post chain (split from src/core/index.js boot, refactor Phase 2 step 3): the scene pass (the tier's MSAA, the
// water's MRT), the water's reflections, the sky's aerial perspective, the clouds, the thunderstorm's grade, flash and
// rainbow, the helm's live 3D objects, then AgX and the tier's anti-aliasing finish.
//
//   const pc = await createPost({ renderer, scene, camera, quality, water, daylight, clouds, weather, flags });
//   weather: the world's weather bus (src/weather/uniforms.js), whose storm grade runs before the tone mapping
//   pc.post          the RenderPipeline (src/core/loop.js draws it)
//   pc.hud           the helm station's objects (src/ui/hud3d.js)
//   pc.plainSky()    the sky fallback's chain: no aerial perspective, no clouds (both read the LUTs)
//   pc.traaWarm(fn)  a warm-up build wrapped with TRAA's matrix set (src/core/warmup.js)
//   pc.passDepth     the render call depth the scene pass draws at (src/core/warmup.js passDepthFor, then as measured)
import * as THREE from 'three/webgpu';
import { pass, toneMapping, renderOutput, mrt, velocity, texture, vec4, mix } from 'three/tsl';
import { FAR_LOOK, farLookOn } from './farLook.js';
import { createGrade, gradeMode } from './grade.js';
import { aerialPerspective } from '@takram/three-atmosphere/webgpu';
import { CLOUDS } from '../../../src/sim/core/params.js';
import { aaFor } from '../quality/tiers.js';
import { importRetry } from './importRetry.js';
import { createHud3d } from '../ui/hud3d.js';
import { passDepthFor } from './warmup.js';

export async function createPost({ renderer, scene, camera, quality, water, daylight, clouds: cl, weather, flags, fireworks = false }) {
  // --- Post: aerial perspective (the sky's own haze on the ridge), clouds, then AgX ----
  const scenePass = pass(scene, camera, { samples: quality.tier.render.msaa });   // ?aa=none|fxaa|traa: the A/B
  const depth = scenePass.getTextureNode('depth');
  // fix/boat-stable: the anti-aliasing after the tone mapping, per tier (tiers.js aaFor: Low, the phones, takes TRAA)
  let AA = aaFor(quality.name, { webgpu: !!renderer.backend?.isWebGPUBackend, param: flags.aa });
  // perf/slow-loading: the scene pass's colour targets must fit the device's bytes per sample (WebGPU's default
  // limit, 32: four RGBA16F targets). The water's three plus TRAA's velocity fill it; the fireworks' target (on by default
  // on the July 4 day since S5) made five, 40 bytes: every pipeline failed and a Low page (the phones, TRAA then) drew a
  // black world. TRAA never goes past the limit: with the fireworks' target and no room, FXAA.
  const fwOn = !!fireworks;
  const bytesMax = renderer.backend?.device?.limits?.maxColorAttachmentBytesPerSample ?? 32;
  if (AA === 'traa' && fwOn && (3 + 1 + 1) * 8 > bytesMax) AA = 'fxaa';
  quality.aa = AA;
  // the pass's module only when this page uses it (phones; a desktop page loads exactly what it did before)
  const { traa } = AA === 'traa' ? await importRetry(() => import('three/addons/tsl/display/TRAANode.js')) : {};   // a failed import: once more (src/core/importRetry.js)
  const { fxaa } = AA === 'fxaa' ? await importRetry(() => import('three/addons/tsl/display/FXAANode.js')) : {};
  // the fireworks' evening (src/fireworks/composite.js): the stars' own target, then their shoulder, their reflection
  // through the waves and their flash after the water's reflections; on other days nothing here changes
  const fwc = fwOn ? await importRetry(() => import('../fireworks/composite.js')) : null;   // fireworks: the show's evening (index.js)
  let passMRT = AA === 'traa' ? water.passMRT().merge(mrt({ velocity })) : water.passMRT();
  if (fwc) passMRT = passMRT.merge(fwc.fireworksMRT());
  // fix/fireworks-sky-rect: the fireworks' target blends by each material's own blending (three's default for a named MRT
  // target is none: the smoke's quads replaced what was under them, a dark rectangle round the bursts; src/fireworks/engine.js).
  // Set on the merged MRT: three 0.184's merge() drops the blend modes
  if (fwc) passMRT.setBlendMode('fireworks', new THREE.BlendMode(THREE.MaterialBlending));
  scenePass.setMRT(passMRT);   // T3b: the water's normal and sky for the reflections pass (+ TRAA's velocity)
  const lit0 = water.reflections(scenePass, { steps: quality.tier.water.reflectionSteps });           // the ridges mirrored in the lake (screen-space)
  // (lit: the reflections and the fireworks without the haze and the clouds: the plain sky's chain below)
  const lit = fwc ? fwc.fireworksComposite({ lit: lit0, scenePass, exposure: daylight.exposure }) : lit0;
  const aerialFull = aerialPerspective(lit0, depth);
  // S3 (src/core/farLook.js): the haze on surfaces kept at hazeK (the sky pixels come out of the aerial pass
  // unchanged, so the mix leaves them as they are); ?far=old: the full haze
  const aerial = farLookOn(flags) ? mix(lit0, aerialFull, FAR_LOOK.hazeK) : aerialFull;
  // the scene pass already drew the sky (skyBackground); the aerial pass drew it again on every sky pixel (≈ 2.1 ms
  // in sail mode). Only MSAA edge pixels on the ridgeline change, by a few levels.
  aerialFull.skyNode = null;
  const Pipeline = THREE.RenderPipeline ?? THREE.PostProcessing;
  const post = new Pipeline(renderer);
  // the helm station's live 3D objects (src/ui/hud3d.js): the boat's own wheel and winches, laid in before the tone mapping
  // S1 + S2 (src/core/grade.js): the sky curve before the clouds, the LUT after AgX and after the cockpit's
  // composite; the cockpit's own crisp canvas (a phone's) takes the same LUT in its tone map. ?grade=0: neither
  const GM = gradeMode(flags), grade = GM.lut || GM.sky ? createGrade() : null;
  if (grade) daylight.add?.((f) => grade.setSun(f.elevDeg ?? 90));
  const lutOf = (c) => (grade && GM.lut ? grade.lut(c) : c);
  const hud = createHud3d({ renderer, scene, toneMap: (c) => lutOf(toneMapping(THREE.AgXToneMapping, daylight.exposure, c)) });
  // the last step: AgX, then the tier's anti-aliasing (AA above). TRAA (three's temporal reprojection AA: the scene camera
  // jittered over 32 sub-pixel offsets, the history reprojected by depth and velocity and clamped to the neighbourhood)
  // runs on the tone-mapped colour, so a bright sliver of stainless averages as it looks, not as its HDR value
  let traaNode = null;   // the TRAA node (src/core/warmup.js needs its velocity's projection: fix/first-visit-hitches)
  const finish = (c) => {
    const graded = lutOf(toneMapping(THREE.AgXToneMapping, daylight.exposure, c));
    // depth and velocity as plain textures of the scene pass's targets: a pass texture read inside TRAA's own resolve
    // render would render the scene pass again (as the clouds found, src/clouds.js)
    if (AA === 'traa') return (traaNode = traa(graded, texture(depth.value), texture(scenePass.getTextureNode('velocity').value), camera));
    if (AA !== 'fxaa') return graded;
    post.outputColorTransform = false;   // sRGB here, so FXAA reads perceptual luma
    return fxaa(renderOutput(graded, THREE.NoToneMapping, THREE.SRGBColorSpace));
  };
  // wow/storm: the thunderstorm's grade, flash and rainbow before the tone mapping (the weather bus; off: the input as is)
  const skyGraded = grade && GM.sky ? grade.skyCurve(aerial, depth, !!renderer.reversedDepthBuffer) : aerial;   // S2: true sky only, the clouds laid over after
  const clouded = CLOUDS ? cl(skyGraded, depth) : skyGraded;
  // the fireworks after the clouds (fix 2026-11-08): the stars write no depth, so the cloud march ran on past them to the far
  // sky and laid every cloud in the view over the bursts, unlit, dark blobs across them; the shells burst under the cloud
  // base (≈ 300 m against 700 m and up), so the bursts, their reflection and their flash go on top of the clouds
  const sceneColor = fwc ? fwc.fireworksComposite({ lit: clouded, scenePass, exposure: daylight.exposure }) : clouded;
  post.outputNode = finish(hud.compose(vec4(weather.stormGrade(sceneColor, depth), sceneColor.a ?? 1)));

  // fix/sky-load: the plain sky's chain (src/core/skyFallback.js): no aerial perspective, no clouds (both read the LUTs)
  const plainSky = () => {
    post.outputNode = finish(hud.compose(lit));
    post.needsUpdate = true;
  };

  // TRAA (the phone tiers): its velocity output reads the unjittered projection as a uniform while TRAA draws, and the
  // camera's own matrix otherwise; a shader built outside TRAA's draw differed from the one the draw needs (one line),
  // so on those tiers no warm-up build was ever used (fix/first-visit-hitches: the phone built the splash, the bolts and
  // the rain in play). The scene pass's warm-ups build with TRAA's own matrix set, as its draw does.
  const traaWarm = (fn) => async (...a) => {
    const v = traaNode && a[2]?.pass ? (traaNode._velocityNode ?? velocity) : null;
    if (v && v.projectionMatrix !== null) return fn(...a);   // already set (inside a draw): leave it
    // in play (live: perf/ready-first-frame): TRAA's own draw sets and clears the matrix each frame, so it is set only
    // while three reads it for the warm-up's builds (src/core/warmup.js liveHooks), never across a frame
    if (v && a[2]?.live) {
      const set = () => { v.setProjectionMatrix(traaNode._originalProjectionMatrix); return () => v.setProjectionMatrix(null); };
      const o = a[2], was = o.around ?? {};
      const both = (f) => (r) => { const u1 = f?.(r), u2 = set(); return () => { u2(); u1?.(); }; };
      return fn(a[0], a[1], { ...o, around: { sync: both(was.sync), build: both(was.build) } });
    }
    v?.setProjectionMatrix?.(traaNode._originalProjectionMatrix);
    try { return await fn(...a); } finally { v?.setProjectionMatrix?.(null); }
  };

  // the scene pass's render call depth (perf/enter-freeze): the warm-ups build in the render context its draw uses
  // (src/core/warmup.js warmScene passDepth); the AA's rule until the pass has drawn, then the depth its own draw saw
  // (the scene's render() inside PassNode.updateBefore runs one level below the caller's)
  let passDepth = passDepthFor(AA);
  const ub = scenePass.updateBefore;
  if (typeof ub === 'function' && typeof renderer._callDepth === 'number') {
    scenePass.updateBefore = function (...a) { const d = renderer._callDepth + 1; if (d >= 1) passDepth = d; return ub.apply(this, a); };
  }

  return { post, hud, scenePass, depth, lit, AA, plainSky, traaWarm, grade, get passDepth() { return passDepth; } };
}
