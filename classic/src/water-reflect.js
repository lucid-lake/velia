// The water's screen-space reflections (split from src/water.js, refactor round 2 Phase D; the code is unchanged): the
// ridges traced in the depth buffer (ssrReflections; hazeM and debug are the water's own), and the clouds in the water
// after the cloud pass (cloudReflections, opt-in). The water writes the 'water' and 'waterSky' targets they read.
import {
  Fn, If, Loop, Break, reference, screenUV, getViewPosition, getScreenPosition, perspectiveDepthToViewZ,
  vec2, vec3, vec4, float, exp, sqrt, pow, max, mix, smoothstep, normalize, reflect, convertToTexture,
} from 'three/tsl';

// Reflections of the ridge: for each water pixel, march the mirrored ray in view space (16 exponential steps from
// 1 m to 16 km, then 5 bisections) against the depth buffer. A hit swaps the water's sky reflection for the colour
// there, hazed toward the sky by the extra path (hazeM); a miss, a hit off screen or a rough patch keeps the sky.
export function ssrReflections(scenePass, { hazeM, debug = null, steps = 16, near = 1, far = 16000 } = {}) {
  const colorTex = scenePass.getTextureNode('output'), depthTex = scenePass.getTextureNode('depth');
  const wTex = scenePass.getTextureNode('water'), sTex = scenePass.getTextureNode('waterSky');
  const q = Math.pow(far / near, 1 / (steps - 1));
  // the SCENE camera's matrices: inside the post pass, cameraProjectionMatrix & co. are the full-screen quad's
  const cam = scenePass.camera;
  const proj = reference('projectionMatrix', 'mat4', cam), projInv = reference('projectionMatrixInverse', 'mat4', cam);
  const view = reference('matrixWorldInverse', 'mat4', cam);
  const camNear = reference('near', 'float', cam), camFar = reference('far', 'float', cam);
  return Fn(() => {
    const uv = screenUV, col = colorTex.sample(uv).toVar(), w = wTex.sample(uv);
    If(w.a.greaterThan(0.5).and(w.z.greaterThan(0.002)), () => {
      const skyW = sTex.sample(uv);
      const d0 = depthTex.sample(uv).r;
      const vp = getViewPosition(uv, d0, projInv);
      const ny = sqrt(max(float(1).sub(w.x.mul(w.x)).sub(w.y.mul(w.y)), 0));
      const nW = normalize(vec3(w.x.mul(0.6), ny, w.y.mul(0.6)));   // the waves bend the mirror, damped
      // reflect in world space and keep the ray above the horizon: at grazing angles a small wave tilt would send
      // it down into the water, where it finds only more water (it would copy the water's own sky colour back)
      const camW = view.transpose();   // the view matrix is a rotation + translation: its rotation's inverse
      const vW = normalize(camW.mul(vec4(normalize(vp), 0)).xyz);
      const rW = reflect(vW, nW);
      const R = normalize(view.mul(vec4(normalize(vec3(rW.x, max(rW.y, 0.004), rW.z)), 0)).xyz).toVar();
      const hitUV = vec2(-1).toVar(), hitT = float(0).toVar(), tPrev = float(0).toVar();
      Loop(steps, ({ i }) => {
        const t = float(near).mul(pow(float(q), float(i)));
        const P = vp.add(R.mul(t));
        const suv = getScreenPosition(P, proj);
        If(suv.x.lessThan(0).or(suv.x.greaterThan(1)).or(suv.y.lessThan(0)).or(suv.y.greaterThan(1)), () => { Break(); });
        const sd = depthTex.sample(suv).r;
        const sz = perspectiveDepthToViewZ(sd, camNear, camFar);
        const thick = t.sub(tPrev).mul(1.5).add(1);
        const onWater = wTex.sample(suv).a.greaterThan(0.5);   // water never reflects water here: march on
        If(sd.lessThan(0.99999).and(onWater.not()).and(P.z.lessThan(sz)).and(P.z.greaterThan(sz.sub(thick))), () => {
          // bisect between the last miss and this hit
          const lo = tPrev.toVar(), hi = t.toVar();
          Loop(5, () => {
            const mid = lo.add(hi).mul(0.5), Pm = vp.add(R.mul(mid));
            const um = getScreenPosition(Pm, proj);
            const zm = perspectiveDepthToViewZ(depthTex.sample(um).r, camNear, camFar);
            If(Pm.z.lessThan(zm), () => { hi.assign(mid); }).Else(() => { lo.assign(mid); });
          });
          hitT.assign(hi);
          hitUV.assign(getScreenPosition(vp.add(R.mul(hi)), proj));
          Break();
        });
        tPrev.assign(t);
      });
      if (debug === 'ssr') col.assign(vec4(hitUV.max(0), hitUV.x.greaterThanEqual(0).select(1, 0), 1));   // r, g = hit uv; b = hit
      If(hitUV.x.greaterThanEqual(0), () => {
        const edge = smoothstep(0, 0.06, hitUV.x).mul(smoothstep(1, 0.94, hitUV.x)).mul(smoothstep(0, 0.06, hitUV.y)).mul(smoothstep(1, 0.94, hitUV.y));
        // rough water still mirrors at grazing angles, blurred and stretched up and down the screen: three taps
        // spread vertically by the unresolved slope; only very rough water (rms slope > 0.5) loses the reflection
        const conf = edge.mul(smoothstep(0.8, 0.4, skyW.a));
        const spread = vec2(0, skyW.a.mul(0.04));
        const taps = colorTex.sample(hitUV).rgb.mul(0.5)
          .add(colorTex.sample(hitUV.add(spread)).rgb.mul(0.25)).add(colorTex.sample(hitUV.sub(spread)).rgb.mul(0.25));
        const hit = mix(taps, skyW.rgb, float(1).sub(exp(hitT.div(-hazeM))));
        col.rgb.addAssign(hit.sub(skyW.rgb).mul(w.z).mul(conf));
      });
    });
    return col;
  })();
}


// Clouds in the reflection (T3c): the clouds are a post pass after the reflections, so a second, cheap stage runs
// after them. For each water pixel, the mirrored ray's sky direction is projected to the screen; where that pixel is
// sky, the clouds' contribution there (the after-clouds colour minus the water's own sky reflection) is added,
// weighted as the reflection. Off-screen directions fade out. withClouds: the colour node after the cloud pass.
export function cloudReflections(scenePass, withClouds) {
  // OPT-IN: it costs ≈ 2.3–2.5 ms on this Mac (cam E, min of 3 runs of 60-frame medians), the after-clouds image
  // drawn to a texture and sampled again; a quarter-resolution copy cost the same (the chain ran twice). Cheap
  // would need the cloud pass to expose its march for one direction (T2), or its output as a texture.
  const tex = convertToTexture(withClouds);
  const depthTex = scenePass.getTextureNode('depth');
  const wTex = scenePass.getTextureNode('water'), sTex = scenePass.getTextureNode('waterSky');
  const cam = scenePass.camera;
  const proj = reference('projectionMatrix', 'mat4', cam), projInv = reference('projectionMatrixInverse', 'mat4', cam);
  const view = reference('matrixWorldInverse', 'mat4', cam);
  return Fn(() => {
    const uv = screenUV, col = tex.sample(uv).toVar(), w = wTex.sample(uv);
    If(w.a.greaterThan(0.5).and(w.z.greaterThan(0.002)), () => {
      const vp = getViewPosition(uv, depthTex.sample(uv).r, projInv);
      const ny = sqrt(max(float(1).sub(w.x.mul(w.x)).sub(w.y.mul(w.y)), 0));
      const nW = normalize(vec3(w.x.mul(0.6), ny, w.y.mul(0.6)));
      const vW = normalize(view.transpose().mul(vec4(normalize(vp), 0)).xyz);
      const rW = reflect(vW, nW);
      const rV = view.mul(vec4(normalize(vec3(rW.x, max(rW.y, 0.004), rW.z)), 0)).xyz;
      const suv = getScreenPosition(rV.mul(30000), proj);
      const on = smoothstep(0, 0.06, suv.x).mul(smoothstep(1, 0.94, suv.x)).mul(smoothstep(0, 0.06, suv.y)).mul(smoothstep(1, 0.94, suv.y));
      const isSky = depthTex.sample(suv.clamp(0, 1)).r.greaterThanEqual(0.99999);
      If(isSky.and(on.greaterThan(0)), () => {
        const delta = max(tex.sample(suv).rgb.sub(sTex.sample(uv).rgb), vec3(0));   // clouds only brighten here
        col.rgb.addAssign(delta.mul(w.z).mul(on));
      });
    });
    return col;
  })();
}
