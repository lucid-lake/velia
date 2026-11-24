// The water's look map (2026-10-29): one camera-centred render target, drawn once a frame by a
// full-screen pass, that the water fragment reads once per pixel. It carries the wind lanes (wind-cues.js streakAt),
// which were two noise taps a pixel inside the heavy water shader:
//   G  the wind lanes, −1..1
// (R was whitecap foam with age, B its injection, from 2026-10-29 22:51 to 23:59; the owner saw the aged-foam lace as
// snow and the whitecaps went back to the per-pixel Jacobian caps of 5f40509:, fix/water-snow.)
// The map lives in the surface's drift frame (the lanes ride the surface drift, ≈ 3 % of the wind). It has mipmaps:
// far off, the fragment's footprint picks a coarse level and the lanes average into a soft brightness and roughness
// instead of aliasing into salt and pepper.
//
//   const look = createLookMap({ lanesAt })        // lanesAt: a TSL builder from water.js (rest point → −1..1)
//   each frame: look.update(renderer, t, camera, U, dirTo)    (t: scene seconds; U: the mean wind, m/s)
//   look.at(restXZ) → { streak, inside }                       (TSL, in the water fragment)
import * as THREE from 'three/webgpu';
import { Fn, uniform, texture, uv, vec2, vec4, float, abs, max, smoothstep } from 'three/tsl';

export const LOOK = {
  size: 1024, extentM: 256,   // 0.25 m texels over ±128 m
  ahead: 0.3,                 // the centre sits 0.3 × the extent ahead of the camera, along its horizontal view
  driftK: 0.03,               // the surface drift: 3 % of the wind (the classic wind-drift factor)
};

export function createLookMap({ lanesAt, size = LOOK.size, extentM = LOOK.extentM } = {}) {
  const rt = new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter; rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  // anisotropic: the sail camera sees the water at 3–15°, where an isotropic mip is picked by the long (along the
  // view) footprint and smeared every lane into the map's mean 15 m from the boat (2026-10-29)
  rt.texture.anisotropy = 16;
  const uCentre = uniform(new THREE.Vector2());
  const uDrift = uniform(new THREE.Vector2());   // the drift frame's offset: rest point = frame point + uDrift
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    // a render target's uv() runs v the other way from a texture lookup's (WebGPU's top-left origin): flip it
    const st = vec2(uv().x, float(1).sub(uv().y));
    const p = uCentre.add(st.sub(0.5).mul(extentM)).add(uDrift);
    return vec4(0, lanesAt(p), 0, 1);
  })();
  const quad = new THREE.QuadMesh(mat);
  const read = texture(rt.texture);
  const drift = new THREE.Vector2(), cell = extentM / size;
  let lastT = null;
  function update(renderer, t, camera, U, dirTo) {
    const dt = lastT == null || t < lastT || t - lastT > 0.5 ? 0 : t - lastT;
    lastT = t;
    drift.x += dirTo[0] * U * LOOK.driftK * dt; drift.y += dirTo[1] * U * LOOK.driftK * dt;
    // the centre: ahead of the camera along its horizontal view, in the drift frame, snapped to whole texels
    const e = camera.matrixWorld.elements, fx = -e[8], fz = -e[10], fl = Math.hypot(fx, fz) || 1;
    const cx = camera.position.x + fx / fl * extentM * LOOK.ahead - drift.x, cz = camera.position.z + fz / fl * extentM * LOOK.ahead - drift.y;
    uCentre.value.set(Math.round(cx / cell) * cell, Math.round(cz / cell) * cell);
    uDrift.value.copy(drift);
    const was = renderer.getRenderTarget(), mrt = renderer.getMRT();
    renderer.setMRT(null);
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    renderer.setRenderTarget(was);
    renderer.setMRT(mrt);
  }
  // at a rest point (TSL): the lanes and the weight of the map there (1 inside, 0 past its rim). The sample is
  // mip-mapped by the hardware from the rest point's screen derivatives: the pixel's footprint picks the level.
  const at = (rest) => {
    const d = rest.sub(uDrift).sub(uCentre);
    const m = read.sample(d.div(extentM).add(0.5));
    const r = max(abs(d.x), abs(d.y)).div(extentM * 0.5);
    const inside = float(1).sub(smoothstep(0.78, 0.96, r));
    return { streak: m.g.mul(inside), inside };
  };
  return { update, at, size, extentM, uniforms: { uCentre, uDrift }, textures: () => [rt], current: () => rt };
}
