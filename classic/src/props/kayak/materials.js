// The kayak's materials: procedural TSL, no textures, so a colour or wear change
// is a uniform write and never a rebuild.
//
//   rotomould   linear low-density polyethylene, colour through the wall: one colour, a two-tone deck over a light hull
//               (P2) or a two-colour swirl along the length (P1); semi-matte (roughness ≈ 0.5) with a waxy sheen when new,
//               slight tonal mottling, light through the thin gunwale and stems when backlit (a subsurface hint), a hexagon
//               non-slip on the seat and footwell floors
//   sun side    AgX turns a bright saturated face pastel (red to salmon); on sunlit faces the albedo is darkened and its
//               chroma raised (COMP), on shaded faces partly white-balanced, so both land on the photos' hue (K2 § Colour)
//   ageing      one 0–1 knob (wear: 0 a new rental, 1 an old fleet boat): a smooth UV fade, strongest and even on the flats
//               facing the sky (lighter, chalky, duller), fine scratches dense along the keel, sponsons, chines and stems,
//               a fine even scuff on the edges, grime in the wells' feet and round every fitting, a grey polish on the seat,
//               lighter wear round the handles, a faint tide line at the loaded waterline; the wet band darkens
//   nylon       black moulded hardware (handles, toggles, pad-eyes, the drain plug, the skid plate): greys at the edges with age
//   cord        black shock cord (bungee) and toggle line
//   hole        the scuppers' throats: dark
//   pad         the strap-on seat back's nylon cover
//   shaft       anodised black aluminium; blade  polypropylene, its own colour uniform
//
// The wear masks come from the geometry (shape.js 'kwear': cavity, edge, contact, touch), the noise from the kayak frame
// (positionLocal) offset by the seed: deterministic.
import * as THREE from 'three/webgpu';
import {
  uniform, attribute, vec2, vec3, float, mix, smoothstep, max, min, pow, dot, normalize, luminance, saturate, abs, fract, select,
  mx_noise_float, positionLocal, normalLocal, positionWorld, normalWorld, cameraPosition,
} from 'three/tsl';
import { KAYAK_COLOURS, KAYAK_SCHEMES } from '../../../../src/props/kayak/dims.js';
import { printThrough } from '../../boat/hullMaterials.js';

export const ALBEDO_MAX = 0.82;   // no real plastic is whiter (art bible § 2)
export const COMP = { sat: 3.6, dark: 0.10 };   // the sun-side compensation, tuned against the photos P1, P2 (K2 § Colour)

// a colour by preset name or any CSS colour, as linear RGB
export function kayakColour(c) {
  return new THREE.Color(KAYAK_COLOURS[c] ?? c);
}
// a scheme by name ('sunset', 'orange-white' …), a colour preset or a CSS colour → { mode 0|1|2, a, b } (linear)
export const MODES = { single: 0, twotone: 1, swirl: 2 };
export function kayakScheme(c) {
  const s = typeof c === 'object' && c ? c : KAYAK_SCHEMES[c];
  if (s) return { mode: MODES[s.mode] ?? 0, a: kayakColour(s.a), b: kayakColour(s.b ?? s.a) };
  const k = kayakColour(c);
  return { mode: 0, a: k, b: k.clone() };
}

export function createKayakMaterials({ colour = 'yellow', wear = 0.35, seed = 1, blade = '#2B6CB0' } = {}) {
  const sc = kayakScheme(colour);
  const u = {
    colour: uniform(sc.a),          // the main (deck) colour
    colour2: uniform(sc.b),         // the hull's (two-tone) or the stern's (swirl)
    mode: uniform(sc.mode),         // 0 single, 1 two-tone, 2 swirl
    split: uniform(0.66),           // two-tone: the parting line, as a fraction up the side
    wear: uniform(wear),
    seed: uniform(new THREE.Vector3(((seed * 37.17) % 97) * 1.31, ((seed * 11.3) % 53) * 0.77, ((seed * 5.9) % 31) * 2.03)),
    waterY: uniform(0.05),           // the live waterline in the kayak frame (the wet band)
    stainY: uniform(0.105),          // the loaded waterline (the tide line)
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),   // world, toward the sun
    sunCol: uniform(new THREE.Color(1, 0.95, 0.88)),   // the backlight's colour × strength (stage.js sets it from the day)
    blade: uniform(kayakColour(blade)),
    sunK: uniform(1),                // the sun's strength 0..1 (stage.js: 0 below the horizon)
    comp: uniform(1),                // the sun-side compensation's strength (0 = off, for the A/B)
    compSat: uniform(COMP.sat),      // its chroma gain and its darkening (K2 § Colour)
    compDark: uniform(COMP.dark),
  };
  const p = positionLocal.add(u.seed);
  const n = (q) => mx_noise_float(q).mul(0.5).add(0.5);   // 0..1

  // ---- the hull and deck ----
  const hull = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_pe', roughness: 0.5, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.4, ior: 1.51, specularIntensity: 0.3 });
  const kw = attribute('kwear', 'vec4');
  const cav = kw.x, edge = kw.y, contact = kw.z, touch = kw.w;
  const W = u.wear;
  const up = smoothstep(0.30, 0.95, normalLocal.y);                       // faces the sky
  const side = float(1).sub(smoothstep(0.45, 0.85, normalLocal.y.abs()));   // a wall
  const down = smoothstep(0.2, 0.9, normalLocal.y.negate());                // the bottom
  // the scheme: one colour; a two-tone deck over a light hull (the parting line soft and a little wavy, as a mould's); or a
  // two-colour swirl, bow to stern, streaky along the length as rotomould powders mix (P1), never blotches
  const kp = attribute('kpart', 'vec2');
  const zt = positionLocal.z.div(3.4).add(0.5);
  const tw = smoothstep(u.split.sub(0.035), u.split.add(0.035), kp.x.add(n(p.mul(vec3(1.5, 1.5, 3.0))).sub(0.5).mul(0.05)));
  // streaks: the warp is long along the hull and short across it (the powders flow along the mould as it turns)
  const warp = n(p.mul(vec3(3.0, 4.0, 0.9)).add(7.0)).sub(0.5).mul(0.55).add(n(p.mul(vec3(10.0, 12.0, 1.6)).add(1.0)).sub(0.5).mul(0.28))
    .add(n(p.mul(vec3(26.0, 30.0, 3.5)).add(5.0)).sub(0.5).mul(0.08));
  const sw = smoothstep(0.44, 0.60, zt.add(warp));
  const pick = select(u.mode.lessThan(0.5), float(0), select(u.mode.lessThan(1.5), float(1).sub(tw), sw));
  let base = mix(vec3(u.colour), vec3(u.colour2), pick);
  // rotomould mottling: the wall's thickness varies, so the colour breathes ±2 % over a hand's width
  base = base.mul(float(0.98).add(n(p.mul(vec3(3.2, 3.2, 1.4))).mul(0.04)));
  // UV fade: a smooth gradient, strongest and even on the flats that face the sky, a little on the sides, none underneath;
  // the colour lifts toward a chalky pastel of itself and the surface dulls (no patches: owner, round 2)
  const fadeN = n(p.mul(0.45).add(4.0));
  const fade = W.mul(pow(up, 1.5).mul(0.85).add(side.mul(0.18))).mul(float(0.94).add(fadeN.mul(0.12))).min(1);
  const grey = vec3(luminance(base));
  const chalkTone = mix(grey.mul(1.12), vec3(0.72, 0.70, 0.66), 0.5);
  base = mix(base, chalkTone, fade.mul(0.55));
  // (the fade comes first: the compensation then darkens the faded colour by its own chroma, so the chalk stays chalky and
  // a lightly worn deck keeps its colour)
  // the sun's side, compensated (round 2): AgX pushes a bright saturated face toward white (red to salmon, yellow to butter)
  // while a camera keeps it saturated; on faces the sun lights, the albedo is darkened and its chroma raised so the tone
  // map lands on the photos' hue and saturation (K2 § Colour). Shade faces keep the plain albedo.
  const ndl = saturate(dot(normalWorld, u.sunDir)).mul(u.sunK).mul(u.comp);
  // the face's light, estimated: the sun by N·L plus the sky dome (a deck facing up sees all of it, a side half); the
  // compensation follows it, so the brightest faces (the sunlit deck) get the most and the shade almost none
  const lit = ndl.add(normalWorld.y.mul(0.5).add(0.5).mul(0.35).mul(u.sunK).mul(u.comp));
  const tl = smoothstep(0.05, 0.80, lit);
  // the gain scales with the colour's own chroma, so a white hull is not greyed; the chroma may push a channel a little
  // below zero (an inverse of AgX's channel crosstalk), floored at −0.04
  const lum0 = vec3(luminance(base));
  const cmax = max(base.x, max(base.y, base.z)), cmin = min(base.x, min(base.y, base.z));
  const chroma = saturate(cmax.sub(cmin).div(cmax.max(1e-3)));
  const rich = max(lum0.add(base.sub(lum0).mul(mix(float(1), u.compSat, chroma))), vec3(-0.5, -0.5, -0.5)).mul(mix(float(1), u.compDark, chroma));
  base = mix(base, rich, tl);
  // the shade side: the blue sky's light turns a yellow olive and a red maroon where a camera's white balance keeps them warm;
  // a partial white balance on the saturated colours (shade faces only)
  base = mix(base, base.mul(vec3(1.22, 0.68, 0.45)), float(1).sub(tl).mul(chroma).mul(u.sunK).mul(u.comp));
  // the moulded hexagon non-slip pad on the seat and footwell floors (P2): 4.5 cm cells, the grooves darker and rougher
  const hp = vec2(positionLocal.x, positionLocal.z).div(0.045);
  const hr = vec2(1.0, 1.7320508), hh = hr.mul(0.5);
  const ha = fract(hp.div(hr)).mul(hr).sub(hh), hb = fract(hp.sub(hh).div(hr)).mul(hr).sub(hh);
  const hg = select(dot(ha, ha).lessThan(dot(hb, hb)), ha, hb);
  const hd = max(dot(abs(hg), vec2(0.5, 0.8660254)), abs(hg.x));   // 0 at a cell's centre, 0.5 at its edge
  const groove = smoothstep(0.40, 0.47, hd).mul(kp.y);
  base = base.mul(float(1).sub(groove.mul(0.42)));
  // a fake ambient occlusion: the hull's tunnels, the panel's lower corner, the wells' feet (always, wear or not)
  base = base.mul(float(1).sub(cav.mul(0.28)));
  // scratches: fine lines dense along the keel strip, the sponsons, the chines and the stems (beaching, dragging), mostly
  // along the length, a few across; scuffed PE goes whitish and rough
  const sA = n(vec3(p.x.mul(320), p.y.mul(320), p.z.mul(6.0)));
  const sB = n(vec3(p.x.add(p.z).mul(170), p.y.mul(220), p.z.sub(p.x).mul(11.0)).add(3.3));
  const scrMask = pow(contact, 1.4).mul(W.mul(0.9).add(0.08));
  const scr = max(smoothstep(0.76, 0.88, sA), smoothstep(0.82, 0.92, sB).mul(0.6)).mul(scrMask);
  // scuffs: a fine, even wear on the edges (gunwale, recess lips, stems), never patches
  const scuff = edge.mul(W).mul(smoothstep(0.45, 0.80, n(p.mul(vec3(30, 30, 12)).add(6.1)))).mul(0.6);
  const scuffTone = mix(grey.mul(1.15), vec3(0.64, 0.63, 0.60), 0.5);
  base = mix(base, scuffTone, scr.mul(0.6).add(scuff.mul(0.35)).min(0.7));
  // grime: in the wells' feet, round the fittings, in the drains; heavier with age; fine-grained, never blotches
  const dirtN = n(p.mul(vec3(24, 24, 24)).add(2.2));
  const dirt = cav.mul(cav).mul(W.mul(0.8).add(0.08)).mul(float(0.75).add(dirtN.mul(0.35))).min(1);
  base = mix(base, base.mul(vec3(0.40, 0.37, 0.32)).add(vec3(0.045, 0.040, 0.030)), dirt.mul(0.7));
  // hips on the seat: the colour greys and polishes; hands at the handles: the edges wear lighter
  const rub = touch.mul(W.mul(0.8).add(0.1)).mul(float(0.8).add(n(p.mul(20.0)).mul(0.3))).min(1);
  base = mix(base, base.mul(0.80).add(grey.mul(0.08)), rub.mul(up).mul(0.45));
  base = mix(base, chalkTone.mul(1.04), rub.mul(side).mul(0.45));
  // the loaded waterline's tide line: a faint brownish band round the topsides (rental boats carry people)
  const yb = positionLocal.y;
  const tide = smoothstep(0.012, 0.0, yb.sub(u.stainY).abs()).mul(side.add(down.mul(0.3)).min(1)).mul(W.mul(0.7).add(0.05))
    .mul(float(0.7).add(n(vec3(p.z.mul(3.0), yb.mul(40), p.x)).mul(0.4)));
  base = mix(base, base.mul(vec3(0.72, 0.66, 0.55)), tide.min(1).mul(0.5));
  // the underside below the waterline: a little duller (algae film, never washed)
  const under = smoothstep(0.0, -0.02, yb.sub(u.waterY));
  base = mix(base, base.mul(vec3(0.86, 0.88, 0.84)), under.mul(W.mul(0.5).add(0.1)));
  // the wet band: the water's last 3 cm up the side darkens the plastic and makes it glossy
  const wet = smoothstep(0.03, 0.0, yb.sub(u.waterY)).mul(float(1).sub(up));
  base = base.mul(mix(float(1), float(0.72), wet));
  hull.colorNode = min(base, vec3(ALBEDO_MAX, ALBEDO_MAX, ALBEDO_MAX));
  // the mould's surface: a faint long-wave waviness (no rotomoulding is a mirror), only in the normal
  hull.normalNode = printThrough(0.022, positionLocal.mul(1.8).add(u.seed));
  // semi-matte; rougher where the sun has chalked it; the sun's side a touch rougher so the sheen doesn't wash the colour
  hull.roughnessNode = float(0.50).add(n(p.mul(5.0)).mul(0.06)).add(fade.mul(0.20)).add(scr.mul(0.22)).add(scuff.mul(0.10))
    .add(dirt.mul(0.15)).sub(rub.mul(up).mul(0.15)).add(tl.mul(0.08)).add(groove.mul(0.15)).mul(mix(float(1), float(0.30), wet)).clamp(0.08, 0.95);
  // the sheen: rotomoulding is semi-matte; on the lit faces the specular lobe is cut further so it can't whiten the colour
  hull.specularIntensityNode = float(0.3).mul(float(1).sub(tl.mul(0.65)));
  hull.clearcoatNode = float(0.08).mul(float(1).sub(W.mul(0.85))).mul(float(1).sub(dirt)).add(wet.mul(0.5)).min(1);
  // light through the thin gunwale and stems (≈ 4–5 mm wall) when the eye looks toward the sun: the colour glows
  const view = normalize(positionWorld.sub(cameraPosition));
  const back = pow(saturate(dot(view, u.sunDir)), 5.0);
  const away = saturate(dot(normalWorld, u.sunDir).negate().add(0.25));
  const thin = edge.mul(float(1).sub(down)).mul(float(1).sub(cav));
  hull.emissiveNode = mix(vec3(u.colour), vec3(u.colour2), pick).mul(vec3(u.sunCol)).mul(thin.mul(back).mul(away).mul(0.35));

  // ---- the hardware ----
  const nylon = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_nylon', roughness: 0.6, metalness: 0 });
  const ng = n(positionLocal.mul(40.0).add(u.seed));
  nylon.colorNode = mix(vec3(0.030, 0.030, 0.032), vec3(0.085, 0.085, 0.082), W.mul(ng).mul(0.8));
  nylon.roughnessNode = float(0.55).add(W.mul(0.2)).add(ng.mul(0.08));
  const cord = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_cord', roughness: 0.85, metalness: 0 });
  cord.colorNode = mix(vec3(0.022, 0.022, 0.024), vec3(0.075, 0.072, 0.068), W.mul(0.7));
  const hole = new THREE.MeshStandardNodeMaterial({ name: 'kayak_hole', color: new THREE.Color(0.010, 0.012, 0.013), roughness: 0.9, side: THREE.DoubleSide });
  const pad = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_pad', roughness: 0.95, metalness: 0 });
  pad.colorNode = mix(vec3(0.010, 0.011, 0.014), vec3(0.045, 0.046, 0.050), W.mul(0.6).mul(n(positionLocal.mul(18.0))));
  pad.specularIntensity = 0.35;
  const shaft = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_shaft', color: new THREE.Color(0.018, 0.018, 0.020), metalness: 0.25, roughness: 0.45 });
  shaft.roughnessNode = float(0.34).add(W.mul(0.18).mul(n(positionLocal.mul(30.0))));
  const bladeM = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_blade', roughness: 0.5, metalness: 0 });
  // nylon / glass-filled blue (P2): deep and saturated; the sun side darkened as the hull's so AgX keeps it blue, not powder;
  // a little light through the thin blade when backlit
  const bl = smoothstep(0.05, 0.5, saturate(dot(normalWorld, u.sunDir).abs()).add(0.2).mul(u.sunK));
  const bc = vec3(u.blade), bLum = vec3(luminance(bc));
  const bRich = max(bLum.add(bc.sub(bLum).mul(2.2)), vec3(0, 0, 0)).mul(0.22);
  bladeM.colorNode = min(mix(bc, bRich, bl).mul(float(0.95).add(n(positionLocal.mul(20.0)).mul(0.08))), vec3(ALBEDO_MAX, ALBEDO_MAX, ALBEDO_MAX));
  bladeM.specularIntensity = 0.5;
  bladeM.emissiveNode = vec3(u.blade).mul(vec3(u.sunCol)).mul(pow(saturate(dot(normalize(positionWorld.sub(cameraPosition)), u.sunDir)), 4.0).mul(0.25));
  const frame = new THREE.MeshPhysicalNodeMaterial({ name: 'kayak_frame', color: new THREE.Color(0.075, 0.078, 0.082), metalness: 0.5, roughness: 0.42 });

  // the contact band on the water: dark, faded outward (index.js skirt)
  const skirt = new THREE.MeshBasicNodeMaterial({ name: 'kayak_contact', transparent: true, depthWrite: false });
  const ka = pow(attribute('kalpha', 'float'), 1.6), kr = attribute('kring', 'float');
  skirt.colorNode = mix(vec3(0.004, 0.010, 0.018), vec3(u.sunCol).mul(0.22).add(vec3(0.02, 0.03, 0.04)), smoothstep(0.0, 0.3, kr));
  skirt.opacityNode = max(ka.mul(0.42), kr.mul(0.10).mul(u.sunK.mul(0.6).add(0.4)));

  return { u, hull, nylon, cord, hole, pad, shaft, blade: bladeM, skirt, frame };
}
