// The cockpit overlay's materials and light (feat/cockpit-materials; owner 2026-11-06: "too shiny, too fake, too plastic, too
// new. We had some treatment for the boat. Do the same or even better for the cockpit."). Halcyon's own cockpit: the boat's
// builders (src/boat/hullMaterials.js: the gelcoat's ivory and print-through, the teak, the stainless) at the boat's age (15–20
// years, cared-for), lit only by the world (the sun, the sky's environment, the scene's exposure and AgX) plus a soft deck
// bounce that is diffuse only (a hemisphere: no highlight of its own, no rim).
//
//   gelcoat   satin, not glossy: a thin clear coat with broad soft reflections over the print-through; warm ivory with a slow tonal
//             drift; a faint grey film in the corners, a duller patch where hands rest under the cap, a few hairline scuffs low
//   teak      the boat's teak a few more summers on: silver-tan with the grain, matte and oiled; the sole's planks run fore and aft
//             with black caulked seams; the cap one solid plank; a slight raised grain
//   stainless brushed (a wide, soft highlight), faint water spots; the winch drums knurled and worn at their shoulders
//   powder    the recesses' plates: matte black powder coat, a fine orange-peel speckle
//   glass     the instruments' glass: a faint reflection, salt haze creeping in from the rim
//   rope      the sheets: a braid with a strand relief and a little grime
// Ambient occlusion: the shell carries its own (u, y, head) per vertex (attribute 'sh': u out from the face, y up the face, the
// recess's or face's head), so the crevices are found per pixel: under the cap's lip, at the sole, in the recesses' corners; the
// sole reads a small baked map (the coaming's foot, the pedestal's, the lever post's). No SSAO.
// Lite (a phone, coarse pointer): no print-through, no grain relief, no knurl (the cockpit renders on change anyway).
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, max, min, mix, smoothstep, fract, uv, uniform, attribute, texture, positionLocal, positionView,
  normalView, faceDirection, mx_noise_float, atan, length,
} from 'three/tsl';
import { printThrough, GEL_IVORY, ALBEDO_MAX, stainless, teakDeck, TEAK_W } from '../../boat/hullMaterials.js';

const CKMAT = {
  albedo: 0.70,           // the gelcoat's albedo (× ivory): the boat's own gelcoat median (hullMaterials: 0.70, capped 0.72)
  rough: 0.40, coat: 0.28, coatRough: 0.26, spec: 0.6,   // satin: the clear coat thin and soft, the base's own sheen lower
  weather: 0.40,          // the teak's added silver bloom (silver-tan, not honey)
  bounce: 12,             // the deck bounce by day (hemisphere, diffuse only) × the scene's luminance (lum = 0.6 / exposure)
  lamp: 0.35,             // the deck lamp's directional share kept on the cockpit by day (it put a highlight on every curve)
};

// a procedural height's relief: the normal bent by its screen-space gradient (Mikkelsen's surface gradient), k in metres
function relief(H, k) {
  const sx = positionView.dFdx(), sy = positionView.dFdy(), n = normalView;
  const r1 = sy.cross(n), r2 = n.cross(sx), det = sx.dot(r1).mul(faceDirection);
  const g = det.sign().mul(r1.mul(H.dFdx()).add(r2.mul(H.dFdy()))).mul(k);
  return det.abs().mul(n).sub(g).normalize();
}

// the sole's AO: a small map over the sole's plan (x across, z fore and aft), from the coaming's plan line, the pedestal and the
// lever's post. pts: the coaming's plan [[x, z], …]; box: { x0, x1, z0, z1 }; posts: [[x, z, r, k], …]
export function soleAoData(pts, box, posts, W = 192, H = 96) {
  const d = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const z = box.z0 + (box.z1 - box.z0) * (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const x = box.x0 + (box.x1 - box.x0) * (i + 0.5) / W;
      let dm = 1e9;
      for (let q = 0; q < pts.length - 1; q++) {
        const [ax, az] = pts[q], [bx, bz] = pts[q + 1], ex = bx - ax, ez = bz - az, L = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L)), dx = x - ax - ex * t, dz = z - az - ez * t;
        dm = Math.min(dm, dx * dx + dz * dz);
      }
      let ao = 1 - 0.5 * Math.exp(-Math.sqrt(dm) / 0.09);     // the coaming's foot: a soft dark band, ≈ 10 cm
      for (const [px, pz, r, k] of posts) { const e = Math.max(0, Math.hypot(x - px, z - pz) - r); ao *= 1 - k * Math.exp(-e / (r * 1.6 + 0.03)); }
      const v = Math.round(255 * Math.max(0, Math.min(1, ao))), o = 4 * (j * W + i);
      d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
  }
  return d;
}

export function createCockpitMaterials({ C, lite = false } = {}) {
  const DS = THREE.DoubleSide;
  const day = uniform(1);   // the night set darkens the gelcoat and the teak (a lamp's red would wash them pink)
  const p = positionLocal;
  const sh = attribute('sh', 'vec3'), su = sh.x, sy = sh.y, top = sh.z;
  const { CH, CAPT, RY0, RD } = C;

  // ---- the shell's own occlusion, per pixel ----
  const onFace = smoothstep(0.004, 0.0005, su);                                   // the outer face (u ≈ 0)
  const inside = smoothstep(0.003, 0.012, su);                                    // in a recess (u → RD)
  const lip = onFace.mul(smoothstep(top.sub(0.10), top.sub(0.002), sy));          // under the cap's lip (the face's head)
  const foot = smoothstep(0.14, 0.0, sy).mul(onFace);                             // where the face meets the sole
  const edge = min(sy.sub(RY0), top.sub(sy)).max(0);
  const corner = inside.mul(smoothstep(0.05, 0.0, edge).mul(0.6).add(su.div(RD).clamp(0, 1).mul(0.35)));   // the recess's corners and walls
  const shellAo = float(1).sub(lip.mul(0.42)).sub(foot.mul(0.38)).sub(corner.mul(0.55)).clamp(0.25, 1);

  // ---- gelcoat: satin ----
  const gel = new THREE.MeshPhysicalNodeMaterial({ name: 'ck_gelcoat', metalness: 0, roughness: CKMAT.rough, clearcoat: CKMAT.coat,
    clearcoatRoughness: CKMAT.coatRough, ior: 1.54, specularIntensity: CKMAT.spec, side: DS });
  if (!lite) gel.clearcoatNormalNode = printThrough(0.024);
  {
    const drift = mx_noise_float(p.mul(vec3(0.55, 0.9, 0.42)).add(3.1));           // metres-long patches, −1..1
    const drift2 = mx_noise_float(p.mul(vec3(1.7, 2.2, 1.3)).add(9.7));
    const wear = smoothstep(0.25, 0.9, mx_noise_float(p.mul(0.9)).mul(0.5).add(0.5));
    // where hands rest: under the cap's lip, either side of the wheel, a duller, very slightly greyer band
    const hands = onFace.mul(smoothstep(CH - 0.09, CH - 0.03, sy)).mul(smoothstep(0.25, 0.45, p.x.abs())).mul(smoothstep(1.45, 1.1, p.x.abs()))
      .mul(mx_noise_float(p.mul(vec3(3.0, 6.0, 3.0))).mul(0.3).add(0.75));
    // hairline scuffs low on the face (shoes, fenders handed down): thin, sparse, light grey
    const sl = mx_noise_float(vec3(p.x.mul(2.2).add(p.z.mul(2.2)), sy.mul(38.0), p.z.mul(0.7)));
    const line = smoothstep(0.035, 0.0, sl.abs()).mul(smoothstep(0.30, 0.04, sy)).mul(onFace)
      .mul(smoothstep(0.55, 0.75, mx_noise_float(vec3(p.x.mul(1.1), 0.0, p.z.mul(1.1)).add(6.3)).mul(0.5).add(0.5)));
    let base = vec3(...GEL_IVORY).mul(CKMAT.albedo).mul(float(1).add(drift.mul(0.05))).mul(mix(vec3(1, 1, 1), vec3(0.985, 0.975, 0.95), wear));
    base = mix(base, base.mul(vec3(0.93, 0.92, 0.89)).add(0.01), smoothstep(-0.2, 0.7, drift2).mul(0.35));          // a faint chalk
    base = mix(base, base.mul(vec3(0.80, 0.81, 0.80)), float(1).sub(shellAo).mul(0.55));                              // the grey film in the corners
    base = mix(base, base.mul(vec3(0.95, 0.945, 0.93)), hands.mul(0.6));
    base = mix(base, vec3(0.50, 0.50, 0.49), line.mul(0.35));
    gel.colorNode = min(base, vec3(ALBEDO_MAX, ALBEDO_MAX, ALBEDO_MAX)).mul(mix(float(1), shellAo, 0.45)).mul(day);
    gel.aoNode = shellAo;
    gel.roughnessNode = float(CKMAT.rough).add(wear.mul(0.08)).add(hands.mul(0.16)).add(line.mul(0.2));
    gel.clearcoatNode = float(CKMAT.coat).mul(float(1).sub(hands.mul(0.6)).sub(wear.mul(0.25)));
  }

  // ---- teak: the cap (one plank, grain along the coaming) and the sole (planks fore and aft, caulked) ----
  const capAo = mix(float(0.55), float(1), smoothstep(CH, CH + CAPT * 0.8, sy));
  const teak = teakDeck({ name: 'ck_teak_cap', ao: vec3(capAo, capAo, capAo), weather: CKMAT.weather, seams: false,
    t: vec2(uv().y.mul(0.5).add(0.25), uv().x), trodden: float(0) });
  const soleAoTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  soleAoTex.needsUpdate = true; soleAoTex.magFilter = soleAoTex.minFilter = THREE.LinearFilter;
  const soleBox = uniform(new THREE.Vector4(-4, 4, -2, 2));   // x0, x1, z0, z1
  const soleUv = vec2(p.x.sub(soleBox.x).div(soleBox.y.sub(soleBox.x)), p.z.sub(soleBox.z).div(soleBox.w.sub(soleBox.z)));
  const soleTexNode = texture(soleAoTex, soleUv);
  // the pedestal's foot (not baked: the helm view hides the pedestal); its column at (0, −0.049), r 0.095 m (cockpit3d's helm)
  const ped = uniform(1);
  const pe = length(vec2(p.x, p.z.add(0.049))).sub(0.095).max(0);
  const soleAo = soleTexNode.r.mul(float(1).sub(ped.mul(0.5).mul(pe.div(-0.16).exp())));
  // the sole: the planks' uv from the plan (u across in planks, v fore and aft in metres); feet go either side of the pedestal
  const trod = smoothstep(1.2, 0.3, p.x.abs()).mul(smoothstep(-1.5, -0.6, p.z)).mul(0.8);
  const sole = teakDeck({ name: 'ck_teak_sole', ao: vec3(soleAo, soleAo, soleAo), weather: CKMAT.weather, t: vec2(p.x.div(TEAK_W).add(0.5), p.z), trodden: trod });
  for (const m of [teak, sole]) {
    m.side = DS;
    m.colorNode = m.colorNode.mul(day);
    if (!lite) { const T = m.userData.teak; m.normalNode = relief(T.late.mul(0.6).sub(T.seam.mul(1.5)), 0.0009); }   // raised grain, sunk seams
  }
  sole.aoNode = soleAo; teak.aoNode = capAo;

  // ---- stainless: brushed, with faint water spots ----
  const brushedSteel = (name, rough) => stainless({ name, rough, extra: (m, { spot }) => {
    const q = positionLocal;
    const brush = mx_noise_float(q.mul(vec3(900.0, 6.0, 900.0))).mul(0.5).add(0.5);              // the brushing's fine lines
    const ws = smoothstep(0.74, 0.82, mx_noise_float(q.mul(55.0).add(3.3)).mul(0.5).add(0.5)).mul(smoothstep(0.0, 0.6, mx_noise_float(q.mul(5.0).add(1.7))));
    m.colorNode = mix(m.colorNode.mul(float(0.95).add(brush.mul(0.08))), vec3(0.66, 0.66, 0.64), ws.mul(0.4));
    m.roughnessNode = m.roughnessNode.add(brush.mul(0.05)).add(ws.mul(0.2)).sub(spot.mul(0.1));
  } });
  const steel = brushedSteel('ck_stainless', [0.30, 0.40]);
  const polished = brushedSteel('ck_stainless_tube', [0.24, 0.32]);   // the column, the guard: a finer brush, still not chrome
  const brushed = brushedSteel('ck_stainless_brushed', [0.34, 0.44]);

  // the winch drum: brushed, knurled on its waist (a diamond grid, darker and rougher in its grooves), the shoulders worn bright
  const knurl = () => brushedSteel('ck_winch', [0.26, 0.36]);
  const winchMat = new Map();
  const winchDrum = (spec) => {
    if (winchMat.has(spec)) return winchMat.get(spec);
    const m = knurl();
    if (!lite) {
      const q = positionLocal, a = atan(q.z, q.x), [, ya, yb] = spec.drum;
      const r = length(vec2(q.x, q.z));
      const band = smoothstep(ya - 0.03 - 0.004, ya - 0.03, q.y).mul(smoothstep(yb + 0.004, yb, q.y)).mul(smoothstep(spec.drum[0] * 0.8, spec.drum[0] * 0.95, r));
      const k1 = fract(a.mul(36 / Math.PI).add(q.y.mul(260.0))), k2 = fract(a.mul(36 / Math.PI).sub(q.y.mul(260.0)));
      const groove = max(smoothstep(0.15, 0.0, min(k1, float(1).sub(k1))), smoothstep(0.15, 0.0, min(k2, float(1).sub(k2)))).mul(band);
      m.colorNode = m.colorNode.mul(float(1).sub(groove.mul(0.35)));
      m.roughnessNode = m.roughnessNode.add(groove.mul(0.25)).add(band.mul(0.06));
    }
    winchMat.set(spec, m);
    return m;
  };

  // ---- the recesses' plates: matte black powder coat; the instruments' bezels anodised, satin ----
  const powder = new THREE.MeshStandardNodeMaterial({ name: 'ck_powder', roughness: 0.78, metalness: 0, side: DS });
  {
    const peel = mx_noise_float(p.mul(260.0)).mul(0.5).add(0.5);
    powder.colorNode = vec3(0.026, 0.028, 0.031).mul(float(0.9).add(peel.mul(0.2))).mul(mix(float(1), shellAo, 0.5));
    powder.roughnessNode = float(0.74).add(peel.mul(0.1));
    powder.aoNode = shellAo;
  }
  const bezel = new THREE.MeshStandardNodeMaterial({ name: 'ck_bezel', color: '#23262b', metalness: 0.4, roughness: 0.52, side: DS });

  // ---- the instruments' glass: a faint reflection, salt haze creeping in from the rim ----
  const glass = new THREE.MeshPhysicalNodeMaterial({ name: 'ck_glass', roughness: 0.08, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12,
    specularIntensity: 0.6, transparent: true, depthWrite: false });
  const haze = uniform(1);
  {
    const r = length(uv().sub(0.5)).mul(2);
    const salt = smoothstep(0.62, 1.0, r).mul(mx_noise_float(vec3(uv().mul(14.0), 2.0)).mul(0.35).add(0.75));
    glass.colorNode = mix(vec3(0.012, 0.016, 0.022), vec3(0.62, 0.63, 0.62), salt.mul(0.5));
    glass.opacityNode = float(0.07).add(salt.mul(0.13).mul(haze));
    glass.roughnessNode = float(0.08).add(salt.mul(0.4));
  }

  // ---- the sheet: a braid with a strand relief and a little grime (run: { u, len } uniforms, the station's) ----
  const ropes = new Map();
  const rope = (run) => {
    if (ropes.has(run)) return ropes.get(run);
    const m = new THREE.MeshStandardNodeMaterial({ name: 'ck_rope', roughness: 0.9, metalness: 0 });
    const t = uv(), along = t.x.mul(run.len);
    const fleck = smoothstep(0.86, 0.88, fract(along.add(t.y).add(run.u)));
    const s1 = fract(along.mul(9.0).add(t.y.mul(2.0)).add(run.u.mul(9.0))), s2 = fract(along.mul(9.0).sub(t.y.mul(2.0)).add(run.u.mul(9.0)));
    const strand = smoothstep(0.0, 0.5, min(s1, float(1).sub(s1))).mul(smoothstep(0.0, 0.5, min(s2, float(1).sub(s2))));   // a braid's bumps
    const grime = mx_noise_float(vec3(along.mul(0.7), t.y.mul(3.0), 0.5)).mul(0.5).add(0.5);
    const cream = mix(vec3(0.80, 0.77, 0.69), vec3(0.70, 0.67, 0.60), grime.mul(0.6));
    m.colorNode = mix(cream, vec3(0.03, 0.04, 0.11), fleck).mul(float(0.76).add(strand.mul(0.24)));
    m.roughnessNode = float(0.86).add(strand.mul(0.08));
    ropes.set(run, m);
    return m;
  };

  // ---- the night set ----
  // world: the world's light (look/cockpit-light): no red lamp to wash them pink, so the gelcoat and the teak keep their albedo,
  // as the boat's do; the night light alone dims them
  function setNight(k, world = false) {
    day.value = world ? 1 : 1 - 0.8 * k;
    haze.value = 1 - 0.85 * k;
  }
  // the sole's AO map for a shell (pts: the coaming's plan line; posts: [[x, z, r, k]])
  function soleAoFor(pts, posts) {
    const xs = pts.map((q) => q[0]), box = { x0: Math.min(...xs) - 0.2, x1: Math.max(...xs) + 0.2, z0: -2.0, z1: 1.6 };
    const W = lite ? 128 : 192, H = lite ? 64 : 96;
    const img = soleAoData(pts, box, posts, W, H);
    const tex = new THREE.DataTexture(img, W, H); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    const old = soleTexNode.value; soleTexNode.value = tex; if (old !== soleAoTex) old.dispose();
    soleBox.value.set(box.x0, box.x1, box.z0, box.z1);
  }
  const pedestal = (on) => { ped.value = on ? 1 : 0; };
  return { pedestal, gel, teak, sole, steel, polished, brushed, powder, bezel, glass, winchDrum, rope, setNight, soleAoFor, day,
    dispose() { if (soleTexNode.value !== soleAoTex) soleTexNode.value.dispose(); } };
}

// The light the overlay adds to the world's own (hud3d.js: the AtmosphereLight and the sky's environment): a deck bounce from the
// sole and the side decks, diffuse only (a HemisphereLight has no specular: it lifts the shade without a highlight on any curve).
// lamp: the hud's deck lamp (a DirectionalLight from the viewer); its directional share drops on the cockpit (k), its energy goes
// into the bounce. Call each frame the cockpit draws, after the lamp is set.
//
// world: true (look/cockpit-light, owner 2026-11-12: "the lighting for the cockpit needs to match the real light condition on that
// boat … too bright now"): the cockpit is lit exactly as the boat is: the sun, the sky's environment and, by night, the world's
// night light (src/core/milkyway.js, the boat's long-exposure light, mirrored into the bounce), at the scene's exposure. No bounce
// and no lamp of its own: both were set in screen terms (× lum = 0.6 / exposure), the bounce worth about 1.6 x the boat's shaded
// gelcoat at 17:30 and the lamp growing 15 x after dusk, so the cockpit held near noon's level while the boat and the lake went dark.
export function createCockpitLight(root, { world = false } = {}) {
  const bounce = new THREE.HemisphereLight(0x73777c, 0xc9b79a, 0);   // a dim sky above (the environment has the sky), the teak and gelcoat's warm grey below
  bounce.position.set(0, 1, 0); root.add(bounce);
  return {
    bounce, world,
    apply(lamp, { night = 0, light = 1, lum = 0.1, nightLight = null } = {}) {
      if (!lamp) return;
      if (world) {
        // the world's lights only: the sun and the sky's environment (hud3d.js, the boat's own) and the night light; no bounce, no lamp
        // (with the day's old bounce the gelcoat in shade read 1.6 x the boat's transom at 17:30; without it, within 5 %)
        const nI = nightLight?.intensity ?? 0;
        bounce.intensity = nI;
        if (nightLight) { bounce.color.copy(nightLight.color); bounce.groundColor.copy(nightLight.groundColor); }
        lamp.intensity = 0;
        return;
      }
      const L = lamp.intensity, day = Math.min(1, Math.max(0, light));
      // by day the sunlit sole and side decks throw a warm light up into the coaming's shade (≈ CKMAT.bounce × the scene's
      // luminance, so the exposure leaves it where it is); after dusk the lamp's share
      bounce.intensity = CKMAT.bounce * lum * day * (1 - night) + L * 0.9 * (1 + 2 * night);
      bounce.groundColor.setRGB(0.80, 0.70 - 0.03 * night, 0.56 - 0.05 * night);
      lamp.intensity = L * (CKMAT.lamp + (1 - CKMAT.lamp) * night * 0.5);
    },
  };
}
