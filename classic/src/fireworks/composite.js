// The fireworks' post stage (S1 round 2, the show's evening; src/core/post.js calls it right after the water's reflections):
// the stars draw into their own target of the scene pass ('fireworks'), and here
//   1. they are added to the picture through a soft shoulder that keeps their hue (overlapping finale bursts stay
//      coloured: no white cores);
//   2. the water reflects them through its live wave normals (the water's own MRT: the normal and the reflection
//      weight per pixel): each water pixel's mirrored ray, followed out to the show's distance, picks up what the
//      fireworks target holds there, so the reflection is a long broken vertical streak that shimmers with the waves,
//      like the moon's glitter path; low bursts reflect strongly;
//   look round 1 (F1 light): the fireworks' target is bloomed (three's BloomNode, in screen levels; its passes run
//      only while FW.active); the bloom is the stars' coloured halo on the picture and the broad colour on the water, and
//      a star's own core goes white-hot where its level is high;
//   3. the flash bank lights the frame: a coloured glow round the bursts on the sky, its mirror on the water, and a
//      lift of the land, the boat and the water toward the show for the 0.3–1 s of each flash.
import { Fn, If, Loop, vec2, vec3, vec4, float, max, min, dot, cross, sin, normalize, reflect, sqrt, length, reference, screenUV, screenSize, getViewPosition, getScreenPosition, smoothstep, mix } from 'three/tsl';
import { mrt, texture, clamp } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { FW, FLASH_LOOK, skyFlash } from './light.js';
import { FLASH_SLOTS } from '../../../src/fireworks/flash.js';

export const fireworksMRT = () => mrt({ fireworks: vec4(0) });

// one bloom per scene pass (the post stage builds the composite twice: the plain sky's chain and the clouds' one). Its input
// is the pass's target as a plain texture (a pass texture read inside the bloom's own renders would render the scene again),
// in screen levels (x the exposure), so the half-float mips hold the stars' levels at any exposure
const blooms = new WeakMap();
function bloomOf(scenePass, exposure) {
  let b = blooms.get(scenePass);
  if (!b) {
    const raw = texture(scenePass.getTextureNode('fireworks').value);
    b = bloom(vec4(raw.rgb.mul(exposure), 1), 1, FLASH_LOOK.bloomRadius, 0);
    b._nMips = FLASH_LOOK.bloomMips;   // three levels, not five: 8 passes, not 12 (the two widest were the air's glow, which the flash bank draws)
    const size = b.setSize.bind(b);
    b.setSize = (w, h) => size(w * FLASH_LOOK.bloomRes, h * FLASH_LOOK.bloomRes);   // its first level at a quarter of the frame, not a half: a quarter of the pixels
    const run = b.updateBefore.bind(b);
    b.updateBefore = (frame) => { if (FW.active.value > 0) run(frame); };   // no show in the air: none of its 8 passes
    blooms.set(scenePass, b);
  }
  return b;
}

export function fireworksComposite({ lit, scenePass, exposure }) {
  const bloomTex = bloomOf(scenePass, exposure).getTextureNode();
  const fwTex = scenePass.getTextureNode('fireworks'), depthTex = scenePass.getTextureNode('depth'), wTex = scenePass.getTextureNode('water');
  const cam = scenePass.camera;
  const proj = reference('projectionMatrix', 'mat4', cam), projInv = reference('projectionMatrixInverse', 'mat4', cam);
  const view = reference('matrixWorldInverse', 'mat4', cam), world = reference('matrixWorld', 'mat4', cam);
  // the soft shoulder in screen levels, the same scale on all three channels: the hue holds
  const shoulder = (c) => {
    const s = c.mul(exposure), m = max(s.r, max(s.g, s.b));
    return s.div(m.div(FLASH_LOOK.limit).add(1)).div(exposure);
  };
  // wow round: the fireworks layer's own colour kept vivid where bursts overlap (a dense finale summed to a pastel pink):
  // its chroma pushed out by FLASH_LOOK.sat about its luminance, after the shoulder; never below 0
  const vivid = (c) => { const l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return max(mix(vec3(l), c, FLASH_LOOK.sat), vec3(0)); };
  return Fn(() => {
    const uv = screenUV, col = vec4(lit).toVar();
    // the star's core white-hot where it is bright, its bloom the coloured halo round it
    const star = fwTex.sample(uv).rgb, sm = max(star.r, max(star.g, star.b));
    const hot = smoothstep(FLASH_LOOK.hotFrom, FLASH_LOOK.hotTo, sm.mul(exposure)).mul(FLASH_LOOK.hot);
    const halo = bloomTex.sample(uv).rgb.div(exposure).mul(FW.active).mul(FLASH_LOOK.bloom);
    col.rgb.addAssign(vivid(shoulder(mix(star, vec3(sm), hot).add(halo))));
    const d0 = depthTex.sample(uv).r;
    const camPos = world.element(3).xyz;
    const vp = getViewPosition(uv, d0, projInv);
    const vW = normalize(view.transpose().mul(vec4(normalize(vp), 0)).xyz);
    const gain = FW.gain;
    If(d0.greaterThanEqual(0.99999), () => {
      // wow round: the lowest 2.5° of the night sky (the haze reddened Reno's light dome into a dark red band over the far
      // shore) turned to the twilight's deep blue at the same level; FW.night: 0 by day, so the day sky is untouched
      const low = smoothstep(0.045, 0.0, vW.y).mul(FW.night).mul(FLASH_LOOK.horizonBlue);
      const lv = max(col.r, max(col.g, col.b));
      col.rgb.assign(mix(col.rgb, vec3(0.3, 0.5, 1.0).mul(lv).mul(1.2), low));
      col.rgb.addAssign(skyFlash(vW, camPos).mul(gain));   // the sky round the bursts
    }).Else(() => {
      // round 3 (owner: "does the mountain colour under the fireworks look normal?"): no even lift. The far land fades to
      // a dark silhouette (darker than the sky above it; its lights kept), and each burst washes only the faces that
      // turn to it, in its own colour, by 1 / (1 + (d / 650 m)²): the near shore glows, the ridges 10–20 km off do not
      const px = vec2(1).div(screenSize);
      const Px = world.mul(vec4(getViewPosition(uv.add(vec2(px.x, 0)), depthTex.sample(uv.add(vec2(px.x, 0))).r, projInv), 1)).xyz;
      const Py = world.mul(vec4(getViewPosition(uv.add(vec2(0, px.y)), depthTex.sample(uv.add(vec2(0, px.y))).r, projInv), 1)).xyz;
      const Pv = world.mul(vec4(vp, 1)).xyz;
      const n0 = normalize(cross(Px.sub(Pv), Py.sub(Pv)));
      const nW = n0.mul(dot(n0, vW).lessThan(0).select(1, -1));   // toward the camera
      const dist = length(vp);
      const lum = max(col.r, max(col.g, col.b)).mul(exposure);
      const far = smoothstep(FLASH_LOOK.farFrom, FLASH_LOOK.farTo, dist).mul(float(1).sub(smoothstep(0.5, 1.6, lum))).mul(FW.night);   // a night look only (S5)
      col.rgb.mulAssign(mix(float(1), float(FLASH_LOOK.farDark), far));
      const wash = vec3(0).toVar(), nearL = vec3(0).toVar();
      Loop(FLASH_SLOTS, ({ i }) => {
        const bp = FW.bankPos.element(i), bc = FW.bankCol.element(i);
        const L = bp.xyz.sub(Pv), d = length(L);
        const facing = max(dot(nW, L.div(d)), 0);
        wash.addAssign(bc.rgb.mul(bp.w).mul(facing).div(d.div(FLASH_LOOK.washM).pow2().add(1)));
        nearL.addAssign(bc.rgb.mul(bp.w.add(bc.w.mul(0.5))).mul(facing.mul(0.6).add(0.4)).div(d.div(FLASH_LOOK.washM).pow2().add(1)));
      });
      const onWater = wTex.sample(uv).a.greaterThan(0.5).select(0, 1);   // the water takes the flash through its reflection only
      // S2: the wash through a soft cap (a finale's many gold bursts turned the near shore orange-brown)
      const ws = wash.mul(FLASH_LOOK.wash), wm = max(ws.r, max(ws.g, ws.b));
      col.rgb.addAssign(ws.div(wm.div(FLASH_LOOK.washCap).add(1)).mul(gain).mul(onWater));
      // look round 1: the boat and all within nearTo m take the burst's colour by their own lightness (a white hull and a
      // sail flash, dark rigging does not; half-facing: the depth's normals are noise on thin things), through a soft cap
      const nearK = float(1).sub(smoothstep(FLASH_LOOK.nearFrom, FLASH_LOOK.nearTo, dist)).mul(clamp(lum.mul(1.2).add(0.1), 0.1, 1));
      const ns = nearL.mul(FLASH_LOOK.nearWash).mul(nearK), nm = max(ns.r, max(ns.g, ns.b));
      col.rgb.addAssign(ns.div(nm.div(FLASH_LOOK.nearCap).add(1)).mul(gain).mul(onWater));
      const w = wTex.sample(uv);
      If(w.a.greaterThan(0.5), () => {
        const k = FLASH_LOOK.wave;
        const ny = sqrt(max(float(1).sub(w.x.mul(w.x)).sub(w.y.mul(w.y)), 0));
        // S2: the fine ripples the wave map does not hold (cm-scale, moving): the reflection breaks into thin streaks and glints
        const rt = FW.time, pw = Pv;
        const rx = sin(pw.x.mul(3.1).add(pw.z.mul(1.3)).add(rt.mul(1.9))).mul(0.55).add(sin(pw.x.mul(9.7).sub(pw.z.mul(6.1)).add(rt.mul(3.3))).mul(0.3)).add(sin(pw.x.mul(23.0).add(pw.z.mul(17.0)).sub(rt.mul(5.1))).mul(0.15));
        const rz = sin(pw.z.mul(4.3).sub(pw.x.mul(0.9)).add(rt.mul(2.3))).mul(0.55).add(sin(pw.z.mul(12.1).add(pw.x.mul(4.7)).sub(rt.mul(2.9))).mul(0.3)).add(sin(pw.z.mul(29.0).sub(pw.x.mul(13.0)).add(rt.mul(4.4))).mul(0.15));
        const nW = normalize(vec3(w.x.mul(k).add(rx.mul(FLASH_LOOK.ripple)), ny, w.y.mul(k).add(rz.mul(FLASH_LOOK.ripple))));
        // look round 1: the water's broad colour. The bloomed layer (the halos and the lit smoke) and the air's glow, mirrored
        // by the wave map's own normal (no fine ripples: their lattice of sines showed as a grid of dots once the water
        // took real light), on a weight never under waterFloor (the water at the hull is tinted too)
        const nS = normalize(vec3(w.x.mul(k), ny, w.y.mul(k)));
        const rS0 = reflect(vW, nS);
        const rS = vec3(rS0.x, max(rS0.y, 0.02).mul(FLASH_LOOK.lift), rS0.z);
        const suvS = getScreenPosition(view.mul(vec4(camPos.add(rS.mul(FW.dist.div(max(length(rS.xz), 0.05)))), 1)).xyz, proj);
        const insideS = smoothstep(0, 0.08, suvS.x).mul(smoothstep(1, 0.92, suvS.x)).mul(smoothstep(0, 0.08, suvS.y)).mul(smoothstep(1, 0.92, suvS.y));
        const soft = max(min(w.z.mul(2.5).add(0.04), 1), FLASH_LOOK.waterFloor);
        col.rgb.addAssign(shoulder(bloomTex.sample(suvS).rgb.div(exposure)).mul(FW.active).mul(insideS).mul(soft).mul(FLASH_LOOK.reflectBloom));
        col.rgb.addAssign(skyFlash(normalize(rS), camPos).mul(gain).mul(soft).mul(FLASH_LOOK.water));
        const rW0 = reflect(vW, nW);
        const rW = vec3(rW0.x, rW0.y.mul(FLASH_LOOK.lift), rW0.z).toVar();   // FLASH_LOOK.lift 1: the true mirror
        If(rW.y.greaterThan(0.002), () => {
          const t = FW.dist.div(max(length(rW.xz), 0.05));
          const Pv = view.mul(vec4(camPos.add(rW.mul(t)), 1)).xyz;
          const suv = getScreenPosition(Pv, proj);
          const inside = smoothstep(0, 0.02, suv.x).mul(smoothstep(1, 0.98, suv.x)).mul(smoothstep(0, 0.02, suv.y)).mul(smoothstep(1, 0.98, suv.y));
          // four taps up and down the screen: the ripples the normal map does not resolve
          const sp = vec2(0, 0.0025);
          const taps = fwTex.sample(suv).rgb.add(fwTex.sample(suv.add(sp)).rgb).add(fwTex.sample(suv.sub(sp)).rgb).add(fwTex.sample(suv.add(sp.mul(2.2))).rgb).mul(0.25);
          // glints: the ripple crests facing the burst carry the light, the troughs between them go dark (thin broken streaks)
          // wow round: the crests broken up by the live wave normal and two slanted ripples (the even lattice read as rows)
          const irr = sin(pw.x.mul(1.37).add(pw.z.mul(2.91)).add(w.x.mul(9.0)).add(rt.mul(1.3))).mul(sin(pw.z.mul(0.83).sub(pw.x.mul(3.7)).add(w.y.mul(11.0)).sub(rt.mul(0.9))));
          const crest = smoothstep(0.15, 0.85, rx.mul(rz).mul(0.9).add(irr.mul(0.7)).add(0.45));
          const weight = min(w.z.mul(2.5).add(0.04), 1).mul(crest.mul(1.6));
          col.rgb.addAssign(shoulder(taps).mul(inside).mul(weight).mul(FLASH_LOOK.reflect));

        });
      });
    });
    return col;
  })();
}
