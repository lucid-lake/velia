// The cockpit in 3D (owner, 2026-11-06: the cream cockpit, direction A, round 2's single object; renders/mockups/panel3d/).
// Stage 1: a desktop in Sail and Regatta. One object seen from behind the wheel, across the bottom of the screen: a curved
// ivory gelcoat coaming with a continuous teak cap, the teak sole, the pedestal with the wheel and the compass, the switch
// and engine panels recessed into the face, the winches, the single lever and TACK on the cap. Real three.js geometry in
// the hud3d scene (hud3d.js), lit by the scene's sun, sky and environment at its exposure; one slot, one camera.
//
// The camera is a full-frame 50° lens 8 m aft of the pedestal, cropped to the slot (setViewOffset), so the whole object is
// one perspective; its height and pitch are solved so the wheel's hub and the cap's lip land on fixed shares of the screen
// height (cockpitView, pure: tests/cockpit3d.test.mjs). The station (helmStation.js) owns the wheel and the winches (the
// boat's own, cut from its glb) and re-parents them in; it drives the setters each frame and projects the anchors for its
// DOM hit layer (the old controls' DOM, invisible, ≥ 44 px targets).
// The dials (feat/cockpit-dials, owner's placement (a)): two instruments set flush into the coaming's ends, the chart to port and
// the wind to starboard; the ends turn through a straight facet, step up and lean back to hold them; their faces are canvases the
// station draws (dialFaces.js), laid on as a backlit emissive map (faceDrawn(side) uploads one; set({ inst }) shows them and sets
// the backlight's glow).
//
//   const ck = createCockpit3d({ boat, wheel: wheelItem, winches: { jib, main }, faces: { chart, wind } });   // faces: canvases
//   ck.layout({ w, h })            // the camera and the slot rect for this viewport (rebuilds the shell if the width class changes)
//   ck.set({ … })                  // the controls' states (see set()); returns true if the picture changed
//   ck.anchors                     // world points to project for the hit layer (Object3D each)
//   ck.root, ck.camera, ck.rect    // the slot's object, camera and css-px rect
import { feature } from '../../../../src/core/features.js';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCockpitMaterials, createCockpitLight } from './cockpitMaterials.js';

import { COCKPIT, COCKPIT_PHONE, cockpitConsts, LABEL_MODES, labelConsts, cockpitView } from '../../../../src/stations/sloop/cockpitView.js';
export { COCKPIT, COCKPIT_PHONE, cockpitConsts, LABEL_MODES, labelConsts, cockpitView };

const DEG = Math.PI / 180;

// ---- the build -----------------------------------------------------------------------------------------------------------
const FONT = (px, wgt = 500) => `${wgt} ${px}px "Atkinson Hyperlegible Next", sans-serif`;
const INK = { day: '#1C2340', plate: '#EFE6D2', night: '#FF9F80', nightFace: '#8E1E12' };
const TPM = 1100;   // canvas px per metre for the engraved words (≥ 2.4 px per screen px at 2x)

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = Math.max(2, w); c.height = Math.max(2, h);
  const g = c.getContext('2d'); draw(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
// an engraved word's fill, worn: fine seeded specks rubbed out of it (deterministic: the seed is the word), never enough to lose a
// letter (≈ 6 % of the fill, each speck under a tenth of the stroke)
function worn(g, w, h, fs, text) {
  let sd = 7; for (const ch of text) sd = (sd * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0, n = Math.round(w * h / (fs * fs) * 60); i < n; i++) { g.globalAlpha = 0.25 + rnd() * 0.35; g.beginPath(); g.arc(rnd() * w, rnd() * h, fs * (0.012 + rnd() * 0.025), 0, 7); g.fill(); }
  g.restore();
}
const blobTex = () => canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.45, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });

// the station's materials: the boat's own stainless and rubber where it has them
const findMat = (root, re) => { let m = null; root?.traverse((o) => { if (!m && o.isMesh && re.test(o.material?.name ?? '')) m = o.material; }); return m; };

// worldLight (look/cockpit-light; ?cockpitlight=0 the old look): lit by the world's light only, in the world's terms (cockpitMaterials.js
// createCockpitLight); the lit amber and the backlights stay in screen terms (a lamp holds its own level, as real backlit instruments do)
export function createCockpit3d({ boat, wheel, winches, faces = null, labels = 'b', worldLight = false }) {
  const DS = THREE.DoubleSide;
  const cockpitGlb = boat.modules.cockpit;
  // the boat's own materials at the boat's age (cockpitMaterials.js, feat/cockpit-materials): satin gelcoat, weathered teak,
  // brushed stainless, powder-coated recesses; a phone takes the lite set (no print-through, grain relief or knurl)
  const lite = feature('cockpitMaterials').tier === 'lite';   // src/core/features.js: a phone, a tablet or L2–L3
  const mats = createCockpitMaterials({ C: COCKPIT, lite });
  const steel = mats.steel;
  const black = findMat(cockpitGlb, /near_black|^rubber/) ?? new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.7 });
  const polished = mats.polished, brushed = mats.brushed;
  // the lever's box: satin anodised aluminium (pale: it stands out from the dark sole and the water behind)
  const leverBox = new THREE.MeshStandardNodeMaterial({ name: 'ck_lever_box', color: 0xc4c6c8, metalness: 0.35, roughness: 0.55 });
  const matt = new THREE.MeshStandardNodeMaterial({ color: 0x15171b, roughness: 0.7, metalness: 0, side: DS });
  const brass = new THREE.MeshStandardNodeMaterial({ color: 0xb8924e, metalness: 1, roughness: 0.45 });
  const gel = mats.gel;
  const dome = new THREE.MeshPhysicalNodeMaterial({ color: '#eef2f6', roughness: 0.12, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.1, specularIntensity: 0.35, transparent: true, opacity: 0.16, depthWrite: false });
  const cream = new THREE.MeshStandardNodeMaterial({ color: '#E6DDCB', roughness: 0.6 });
  // look C3's two tool buttons: each its own cap, so a hover lifts only its own (a faint warm glow, as the helm view's parts)
  const toolCap = { binoculars: new THREE.MeshStandardNodeMaterial({ name: 'ck_binos_cap', color: 0xe2e5e8, metalness: 0.85, roughness: 0.38, emissive: '#ffb070', emissiveIntensity: 0 }),
    radio: new THREE.MeshStandardNodeMaterial({ name: 'ck_vhf_cap', color: 0xe2e5e8, metalness: 0.85, roughness: 0.38, emissive: '#ffb070', emissiveIntensity: 0 }) };
  const rangeInk = new THREE.MeshStandardNodeMaterial({ name: 'ck_range_ink', color: '#C4C8CE', roughness: 0.6 });   // the sliders' − and +: pale grey paint, quieter than the names on the dark plate
  const scaleInk = new THREE.MeshStandardNodeMaterial({ name: 'ck_scale_ink', color: '#FFFFFF', roughness: 0.4 });   // the PRO recess's scales (the wedges, marks, pin holes): white paint, so they read on the dark plate
  const amberOn = new THREE.MeshStandardNodeMaterial({ color: '#ffb13b', emissive: '#ff9a1f', emissiveIntensity: 2.2, roughness: 0.3 });
  const ledOff = new THREE.MeshStandardNodeMaterial({ color: '#3a2a18', roughness: 0.3 });
  const ringOff = new THREE.MeshStandardNodeMaterial({ color: '#3B2C26', roughness: 0.4 });
  const teak = mats.teak, sole = mats.sole;
  const blobT = blobTex();
  const blobMats = new Map();
  const blobMat = (a) => { if (!blobMats.has(a)) blobMats.set(a, new THREE.MeshBasicNodeMaterial({ map: blobT, color: 0x000000, transparent: true, opacity: a, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); return blobMats.get(a); };
  const dial = (draw) => new THREE.MeshStandardNodeMaterial({ map: canvasTex(512, 512, draw), roughness: 0.5, emissive: '#000000', emissiveIntensity: 0 });
  // the instruments: the bezel anodised graphite; the glass smoked and nearly clear (a faint sky in it, never a sheet of white);
  // the faces backlit and unlit: their dial (faces: { chart, wind } canvases, drawn by the station) at the backlight's level in
  // screen terms (÷ the exposure), so neither the sun nor the deck lamp greys them; brighter while it matters
  const bezel = mats.bezel, glass = mats.glass;
  const faceTex = {}, faceMat = {}, glow = { chart: 1, wind: 1 };
  for (const side of ['chart', 'wind']) {
    const cv = faces?.[side] ?? Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
    const t = faceTex[side] = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    faceMat[side] = new THREE.MeshBasicNodeMaterial({ map: t });   // unlit: a backlit display takes no sheen from the deck lamp (a lit face went milky where it faced the key)
  }
  const faceLight = () => { const e = 1 / Math.max(1, expNow); for (const side of ['chart', 'wind']) faceMat[side].color.setScalar((COCKPIT.faceGain[0] * (1 - nightK) + COCKPIT.faceGain[1] * nightK) * glow[side] * e); };

  const root = new THREE.Group(); root.name = 'hud:cockpit';
  const content = new THREE.Group(); root.add(content);              // what sinks (the Calm HUD)
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 3, 40); root.add(camera);
  // the light: the world's own (hud3d.js: the sun, the sky's environment, the exposure) and a deck bounce, diffuse only (no key, no
  // rim: cockpitMaterials.js); light(lamp) each frame it draws
  const rig = createCockpitLight(root, { world: worldLight });

  // the parts the station drives, rebuilt with the shell
  let shell = null, built = null;
  const anchors = {};   // name → Object3D (world points for the hit layer)
  const anchor = (name, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); anchors[name] = o; return o; };
  // the helm: the pedestal and the wheel, scaled as one (hidden in the helm view: the real wheel is there)
  const helm = new THREE.Group(); helm.name = 'helm'; content.add(helm);
  const S = COCKPIT.helmScale;
  helm.scale.setScalar(S); helm.position.set(0, COCKPIT.hub.y - 0.72 * S, COCKPIT.hub.z - 0.14 * S);
  const wheelAt = new THREE.Group(); wheelAt.position.set(0, 0.72, 0.14); helm.add(wheelAt);
  let card = null;
  const helmParts = { lub: null };
  {
    const M = (geo, mat, x = 0, y = 0, z = 0, parent = helm) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    M(new THREE.CylinderGeometry(0.058, 0.07, 1.2, 28), polished, 0, 0.35, 0);
    M(new THREE.CylinderGeometry(0.12, 0.08, 0.05, 36), matt, 0, 0.92, 0);
    M(new THREE.LatheGeometry([[0, 0], [0.135, 0], [0.145, 0.03], [0.14, 0.07], [0.115, 0.085], [0, 0.085]].map(([r, y]) => new THREE.Vector2(r, y)), 48), matt, 0, 0.945, 0);
    M(new THREE.TorusGeometry(0.117, 0.004, 10, 48), polished, 0, 1.03, 0).rotation.x = Math.PI / 2;
    const cardTex = canvasTex(512, 512, (g) => {
      g.fillStyle = '#F3EDDD'; g.beginPath(); g.arc(256, 256, 250, 0, 7); g.fill();
      g.strokeStyle = '#141A30'; g.fillStyle = '#141A30'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let d = 0; d < 360; d += 5) { const a = d * DEG, l = d % 90 ? (d % 30 ? (d % 10 ? 14 : 26) : 40) : 52; g.lineWidth = d % 30 ? 5 : 8; g.beginPath(); g.moveTo(256 + 246 * Math.sin(a), 256 - 246 * Math.cos(a)); g.lineTo(256 + (246 - l) * Math.sin(a), 256 - (246 - l) * Math.cos(a)); g.stroke(); }
      const put = (t, d, r, fs) => { const a = d * DEG; g.save(); g.translate(256 + r * Math.sin(a), 256 - r * Math.cos(a)); g.rotate(a); g.font = FONT(fs, 500); g.fillText(t, 0, 0); g.restore(); };
      ['N', 'E', 'S', 'W'].forEach((t, i) => put(t, i * 90, 150, 120));
      [3, 6, 12, 15, 21, 24, 30, 33].forEach((t) => put(String(t), t * 10, 170, 56));
      g.beginPath(); g.arc(256, 256, 18, 0, 7); g.fill();
    });
    const cardMat = new THREE.MeshStandardNodeMaterial({ map: cardTex, roughness: 0.55, emissive: '#ff5a40', emissiveMap: cardTex, emissiveIntensity: 0 });
    const tilt = new THREE.Group(); tilt.position.set(0, 1.05, 0); tilt.rotation.x = -Math.PI / 2 + 0.3; helm.add(tilt);
    card = M(new THREE.CircleGeometry(0.095, 48), cardMat, 0, 0, 0, tilt);
    const domeM = M(new THREE.SphereGeometry(0.112, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2), dome, 0, 1.03, 0); domeM.scale.y = 0.8; domeM.renderOrder = 5;
    helmParts.lub = M(new THREE.BoxGeometry(0.004, 0.028, 0.004), amberOn, 0, 1.06, 0.09); helmParts.lub.rotation.x = 0.5;
    // the guard: one bent stainless tube (feet, a rounded top bar across), a lower bar; real tube, not a frame
    const gx = 0.26, gz = -0.12, top = 1.12, rr = 0.06;
    const path = new THREE.CurvePath();
    const V = (x, y) => new THREE.Vector3(x, y, gz);
    path.add(new THREE.LineCurve3(V(-gx, -0.3), V(-gx, top - rr)));
    path.add(new THREE.QuadraticBezierCurve3(V(-gx, top - rr), V(-gx, top), V(-gx + rr, top)));
    path.add(new THREE.LineCurve3(V(-gx + rr, top), V(gx - rr, top)));
    path.add(new THREE.QuadraticBezierCurve3(V(gx - rr, top), V(gx, top), V(gx, top - rr)));
    path.add(new THREE.LineCurve3(V(gx, top - rr), V(gx, -0.3)));
    M(new THREE.TubeGeometry(path, 96, 0.015, 14, false), polished);
    anchor('guardTop', helm, 0, top + 0.015, gz);   // the guard's top bar (a phone's fold tab rides over it)
    const bar = M(new THREE.CylinderGeometry(0.012, 0.012, 2 * gx, 14), polished, 0, 0.42, gz); bar.rotation.z = Math.PI / 2;
    wheelAt.add(wheel);   // the boat's own wheel (the station's wheelItem, its spin inside)
    anchor('hub', wheelAt); anchor('wheelTop', wheelAt, 0, COCKPIT.wheelR, 0);
  }
  anchor('capMid', content, 0, COCKPIT.CH + COCKPIT.CAPT, -1.75 + COCKPIT.LIP);   // the cap's top edge at the centre (the fold tab)
  // the winches (the station's items): on the cap, scaled; their positions set with the shell
  const winchAt = {};
  for (const side of ['jib', 'main']) { const g = new THREE.Group(); g.name = `winch-${side}`; content.add(g); g.add(winches[side].item); winchAt[side] = g; }

  // ---- the shell: the coaming, the sole, the recesses, the hardware on the face and the cap -------------------------------
  function buildShell(hw, C = COCKPIT) {
    const { CH, CAPT, CAPO, LIP, RY0, RY1, RD } = C;
    const g0 = new THREE.Group(); g0.name = 'shell';
    const stat = new THREE.Group();   // static meshes: merged by material at the end
    const live = new THREE.Group();   // the moving and switching parts
    g0.add(stat, live);
    const parts = { toggles: {}, labels: [] };
    const M = (geo, mat, x = 0, y = 0, z = 0, parent = stat) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
    // the plan curve: port aft → forward → across → starboard aft
    const k = hw / 3.3;
    // the ends turn through a straight 45° facet (four points in a line: the span between the middle two is straight), where
    // the instruments sit flush
    const END = [[1.5, -1.64], [2.08, -1.52], [2.42, -1.35], [2.62, -1.15], [2.98, -0.79], [3.18, -0.59], [3.28, -0.22], [3.3, 0.25], [3.3, 1.2], [3.3, 6]];   // eased in and out of the facet (no hard corner)
    const plan = [...END.map(([x, z]) => [-x, z]).reverse(), [0, -1.75], ...END];
    const curve = new THREE.CatmullRomCurve3(plan
      .map(([x, z]) => new THREE.Vector3(Math.abs(x) >= 2.4 ? x * k : x * (1 + (k - 1) * Math.abs(x) / 2.4), 0, z)), false, 'centripetal');
    const NS = 400, pts = curve.getSpacedPoints(NS), SM = [];
    for (let i = 0; i <= NS; i++) {
      const p = pts[i], q = pts[Math.min(NS, i + 1)], r = pts[Math.max(0, i - 1)];
      const t = new THREE.Vector3().subVectors(q, r).setY(0).normalize(), n = new THREE.Vector3(t.z, 0, -t.x);
      SM.push({ p, t, n, s: i === 0 ? 0 : SM[i - 1].s + p.distanceTo(pts[i - 1]), w: 0 });
    }
    // the ends step up and lean back about the instruments (w 0 → 1 → 0): y ≥ the lip's shadow
    // rises by I.rise·w, and above I.y0 the face leans back (outboard, +u) by (y − y0)·tan(lean)·w; one rule for every strip
    const I = C.inst, TANL = Math.tan(I.lean), sMid = SM[NS].s / 2;
    const iC = (() => { let best = 0, bd = 1e9; for (let i = NS >> 1; i <= NS; i++) { const d = Math.abs(SM[i].p.x - C.x.inst * k); if (SM[i].p.z < 0 && d < bd) { bd = d; best = i; } } return best; })();
    const dC = SM[iC].s - sMid, d1 = dC - I.R - I.pad, d0 = d1 - I.ramp;
    // a console about each instrument: up over the ramp before it, level across it, and down again aft of it (the side coamings
    // keep their height)
    const d2 = dC + I.R + I.pad, d3 = d2 + I.down, sm = (f) => { f = Math.min(1, Math.max(0, f)); return f * f * f * (f * (6 * f - 15) + 10); };   // smootherstep: the cap's rise and fall moulded, no crease where it starts or levels
    for (const S1 of SM) { const d = Math.abs(S1.s - sMid); S1.w = sm((d - d0) / (d1 - d0)) * (1 - sm((d - d2) / (d3 - d2))); }
    const lift = (w, y) => (y >= CH - 0.035 ? y + I.rise * w : y);
    const leanU = (w, y) => (y > I.y0 ? (y - I.y0) * TANL * w : 0);
    const at = (i, u, y) => { const w = SM[i].w, yy = lift(w, y), uu = u + leanU(w, yy); return [SM[i].p.x + SM[i].n.x * uu, yy, SM[i].p.z + SM[i].n.z * uu]; };
    // sh (cockpitMaterials.js): each vertex's (u, y, head) on the shell, before the ends' lift and lean: the materials find the
    // crevices from it per pixel (under the lip, at the sole, in a recess's corners)
    const strip = (i0, i1, a, b, mat, parent = stat, top = CH) => {
      const pos = [], uv = [], idx = [], shA = [];
      for (let i = i0; i <= i1; i++) { pos.push(...at(i, a[0], a[1]), ...at(i, b[0], b[1])); uv.push(SM[i].s, 0, SM[i].s, 1); shA.push(a[0], a[1], top, b[0], b[1], top); }
      for (let i = 0; i < i1 - i0; i++) { const q = 2 * i; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('sh', new THREE.Float32BufferAttribute(shA, 3)); g.setIndex(idx); g.computeVertexNormals();
      return M(g, mat, 0, 0, 0, parent);
    };
    const quad = (i, a, b, c, d, mat, top = CH) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...at(i, ...a), ...at(i, ...b), ...at(i, ...c), ...at(i, ...d)], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2)); g.setAttribute('sh', new THREE.Float32BufferAttribute([...a, top, ...b, top, ...c, top, ...d, top], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return M(g, mat); };
    const iAtX = (x) => { let best = 0, bd = 1e9; for (let i = 0; i <= NS; i++) { if (SM[i].p.z > -0.4) continue; const d = Math.abs(SM[i].p.x - x); if (d < bd) { bd = d; best = i; } } return best; };
    const atS = (sv, u, y) => { let lo = 0, hi = NS; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (SM[mid].s <= sv) lo = mid; else hi = mid; } const A = SM[lo], B = SM[hi], kk = Math.min(1, Math.max(0, (sv - A.s) / Math.max(1e-6, B.s - A.s))); const n = A.n.clone().lerp(B.n, kk).normalize(), p = A.p.clone().lerp(B.p, kk), w = A.w + (B.w - A.w) * kk, yy = lift(w, y), uu = u + leanU(w, yy); return [p.x + n.x * uu, yy, p.z + n.z * uu]; };
    // the recesses
    // [x0, x1, head, foot]: a foot under the sole (the PRO recess in look A) goes down into a shallow footwell let into the sole
    const holes = Object.values(C.holes).map(([x0, x1, hd, ft]) => ({ i0: iAtX(x0), i1: iAtX(x1), ry1: hd ?? RY1, ry0: ft ?? RY0 }));
    const inHole = (i) => holes.some((h) => i >= h.i0 && i < h.i1);
    let run = null;
    // the face: split at the lean's foot (vertical below y0, leaning back above it where the ends lean)
    for (let i = 0; i <= NS; i++) { if (!inHole(i) && i < NS) { run ??= i; } else { if (run != null && i > run) { strip(run, i, [0, -0.4], [0, I.y0], gel); strip(run, i, [0, I.y0], [0, CH], gel); } run = null; } }
    const matPlate = mats.powder;
    for (const h of holes) {
      const R1 = h.ry1, R0 = h.ry0;
      strip(h.i0, h.i1, [0, -0.4], [0, R0], gel); strip(h.i0, h.i1, [0, R1], [0, CH], gel);
      strip(h.i0, h.i1, [RD, R0], [RD, R1], matPlate, stat, R1);
      strip(h.i0, h.i1, [RD, R1], [0, R1], gel, stat, R1); strip(h.i0, h.i1, [0, R0], [RD, R0], gel, stat, R1);
      quad(h.i0, [0, R0], [0, R1], [RD, R1], [RD, R0], gel, R1); quad(h.i1, [0, R0], [RD, R0], [RD, R1], [0, R1], gel, R1);
      const hl = 0.006;
      strip(h.i0, h.i1, [-0.002, R1], [-0.002, R1 + hl], brushed); strip(h.i0, h.i1, [-0.002, R0 - hl], [-0.002, R0], brushed);
      quad(h.i0, [-0.002, R0 - hl], [-0.002, R1 + hl], [-0.002 - hl, R1 + hl], [-0.002 - hl, R0 - hl], brushed); quad(h.i1, [-0.002, R0 - hl], [-0.002, R1 + hl], [-0.002 - hl, R1 + hl], [-0.002 - hl, R0 - hl], brushed);
      if (R0 < 0) {   // the footwell: the sole steps down in front of the recess (its floor, its two ends; the aft riser faces away)
        const WD = C.well?.d ?? 0.32, WY = R0 - (C.well?.below ?? 0.05);
        strip(h.i0 - 2, h.i1 + 2, [-0.001, WY], [-WD, WY], mats.sole, stat, 0);
        strip(h.i0 - 2, h.i1 + 2, [-WD, WY], [-WD, 0], gel, stat, 0);
        quad(h.i0 - 2, [0, WY], [-WD, WY], [-WD, 0], [0, 0], gel, 0); quad(h.i1 + 2, [0, WY], [0, 0], [-WD, 0], [-WD, WY], gel, 0);
      }
    }
    // the cap: a teak rail with a lip, continuous; a shadow line under the lip
    strip(0, NS, [-LIP, CH], [-LIP, CH + CAPT], teak); strip(0, NS, [-LIP, CH + CAPT], [CAPO, CH + CAPT], teak); strip(0, NS, [CAPO, CH + CAPT], [CAPO, CH], teak); strip(0, NS, [-LIP, CH], [0, CH], teak);
    strip(0, NS, [CAPO, CH], [CAPO, -0.4], gel);
    // the sole
    { const shp = new THREE.Shape(), wellAt = (i) => holes.find((h) => h.ry0 < 0 && i >= h.i0 - 2 && i <= h.i1 + 2);
      SM.forEach((S2, i) => { const [x, , z] = at(i, wellAt(i) ? -(C.well?.d ?? 0.32) : -0.001, 0); if (i === 0) shp.moveTo(x, z); else shp.lineTo(x, z); }); shp.lineTo(3.3 * k, 9); shp.lineTo(-3.3 * k, 9); shp.closePath();
      const g = new THREE.ShapeGeometry(shp, 1); g.rotateX(Math.PI / 2); const uvA = g.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) / 2, uvA.getY(i) / 2);
      M(g, sole, 0, -0.001, 0);
      // its occlusion: the coaming's foot and the lever's post (the pedestal's is the material's own: the helm view hides it)
      mats.soleAoFor(SM.map((S2, i) => { const [x, , z] = at(i, 0, 0); return [x, z]; }), [[C.lever.x, C.lever.z, 0.035, 0.4]]); }

    const capTop = (x) => { const i = iAtX(x); return { i, p: new THREE.Vector3(...at(i, (CAPO - LIP) / 2, CH + CAPT)), n: SM[i].n }; };
    // a pair of frames at one place: s (static: merged) and l (live: moves or switches), +z toward the cockpit, +x along the coaming
    const frame = (p, n, sc = 1) => {
      const zAxis = n.clone().negate(), xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), zAxis));
      const mk = (parent) => { const g = new THREE.Group(); g.position.copy(p); g.quaternion.copy(q); g.scale.setScalar(sc); parent.add(g); return g; };
      return { s: mk(stat), l: mk(live) };
    };
    const facing = (x, y, u) => { const i = iAtX(x); return frame(new THREE.Vector3(...at(i, u, y)), SM[i].n); };
    const onCap = (x, sc = 1) => { const c = capTop(x); return frame(c.p, c.n, sc); };
    const blob = (rx, ry, x, y, z, { parent = stat, a = 0.5, up = false } = {}) => { const m = M(new THREE.PlaneGeometry(2 * rx, 2 * ry), blobMat(a), x, y, z, parent); if (up) m.rotation.x = -Math.PI / 2; return m; };
    // an engraved word on the face (or a plate): a strip of the curve; two textures (day, night), the night one red-amber and lit
    const FPX = 211.8;   // the face's px per metre at 1920 x 1080 (the letter size is set at that frame; the rest scales with it)
    // s: the place by arc length (else x); left: s is the word's left end; ls: the letter spacing (em)
    const word = (text, px, { x, y, u = 0, ink = INK.day, s: sAt = null, left = false, ls = 0.08 }) => {
      const fs = px / FPX * TPM, c0 = document.createElement('canvas').getContext('2d'); c0.font = FONT(fs); c0.letterSpacing = `${ls}em`;
      const tw = c0.measureText(text).width + fs * 0.6, th = fs * 1.5, wm = tw / TPM, hm = th / TPM;
      const draw = (glow, inkC) => (g, w, h) => {
        g.font = FONT(fs); g.letterSpacing = `${ls}em`; g.textBaseline = 'middle'; g.textAlign = 'center';
        if (glow) { g.shadowColor = inkC; g.shadowBlur = fs * 0.14; g.fillStyle = inkC; g.fillText(text, w / 2, h / 2); g.shadowBlur = 0; }
        else if (inkC === INK.plate) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillText(text, w / 2, h / 2 + fs * 0.04); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillText(text, w / 2, h / 2 - fs * 0.03); }
        else { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(text, w / 2, h / 2 + fs * 0.045); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillText(text, w / 2, h / 2 - fs * 0.035); }
        g.fillStyle = inkC; g.fillText(text, w / 2, h / 2);
        if (!glow) { g.strokeStyle = inkC; g.lineWidth = fs * 0.045; g.lineJoin = 'round'; g.strokeText(text, w / 2, h / 2); }   // a touch bolder: the cut reads at screen size
        if (!glow) worn(g, w, h, fs, text);   // years of hands and washing: the fill a little worn
      };
      const plate = ink === INK.plate;   // a word on a dark plate is backlit by night; a word on the gelcoat is cut deep red into it
      const day = canvasTex(Math.ceil(tw), Math.ceil(th), draw(false, ink)), night = canvasTex(Math.ceil(tw), Math.ceil(th), plate ? draw(true, INK.night) : draw(false, INK.nightFace));
      const sc = (sAt ?? SM[iAtX(x)].s) + (left ? wm / 2 - fs * 0.3 / TPM : 0), N2 = 10, pos = [], uv = [], idx = [];
      for (let q = 0; q <= N2; q++) { const sv = sc - wm / 2 + wm * q / N2; pos.push(...atS(sv, u - 0.0008, y - hm / 2), ...atS(sv, u - 0.0008, y + hm / 2)); uv.push(q / N2, 0, q / N2, 1); }
      for (let q = 0; q < N2; q++) { const b = 2 * q; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      const mat = new THREE.MeshStandardNodeMaterial({ map: day, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, side: DS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, emissive: INK.night, emissiveMap: night, emissiveIntensity: 0 });
      const m = M(g, mat, 0, 0, 0, live);
      const capM = (c0.measureText('H').actualBoundingBoxAscent || fs * 0.7) / TPM;
      const L = { m, mat, day, night, plate, wm, hm, text, capM, c: new THREE.Vector3(...atS(sc, u - 0.0008, y)) }; parts.labels.push(L); return L;
    };

    // a name (JIB, MAIN, TACK and GYBE, MOOR and DAWN): on the band (C.band 'face', ?cockpitlabels=a), or engraved on its own
    // placard (C.band 'plate'): a dark powder-coated plate with a thin polished rim, screwed to the teak cap's edge under its part
    // and hanging over the face's head; it follows the coaming's curve. Its words share one placard (TACK and GYBE switch on it).
    // The letters are cut as the panels' words (word(): cream, a shadow above, a light edge below, a little worn; backlit by night).
    // live: the placard switches with its part (MOOR)
    const slab = (s0, s1, u0, u1, y0, y1, mat, parent) => {
      const N2 = 10, pos = [], idx = [], sh = [];
      const side = (a, b) => {   // a strip along the arc between two (u, y) corners of the profile
        const base = pos.length / 3;
        for (let q = 0; q <= N2; q++) { const sv = s0 + (s1 - s0) * q / N2; pos.push(...atS(sv, ...a), ...atS(sv, ...b)); sh.push(a[0], a[1], y1, b[0], b[1], y1); }
        for (let q = 0; q < N2; q++) { const k2 = base + 2 * q; idx.push(k2, k2 + 2, k2 + 1, k2 + 1, k2 + 2, k2 + 3); }
      };
      side([u0, y0], [u0, y1]); side([u0, y1], [u1, y1]); side([u1, y0], [u0, y0]);
      for (const sv of [s0, s1]) {   // the ends
        const base = pos.length / 3;
        for (const [uu, yy] of [[u0, y0], [u0, y1], [u1, y1], [u1, y0]]) { pos.push(...atS(sv, uu, yy)); sh.push(uu, yy, y1); }
        idx.push(...(sv === s0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('sh', new THREE.Float32BufferAttribute(sh, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0.5), 2)); g.setIndex(idx); g.computeVertexNormals();
      return M(g, mat, 0, 0, 0, parent);
    };
    // a name cut into the teak cap's top (C.names 'cap'; owner 2026-11-12: the upright placards were "very eye catching"): lying flat
    // in the cap, the letters' tops toward the bow and the line running left to right as seen from the wheel, cut a little darker into
    // the wood with no paint fill (never the brightest thing near it:, principle 14). s: its centre along the coaming; the
    // letters' box `capH` m deep across the cap, centred on the cap's middle line. Its words share the spot (TACK and GYBE switch)
    const capWord = (text, sAt) => {
      const px = C.capPx, fs = px / FPX * TPM, c0 = document.createElement('canvas').getContext('2d'); c0.font = FONT(fs, 600); c0.letterSpacing = '0.12em';
      const tw = c0.measureText(text).width + fs * 0.6, th = fs * 1.5, wm = tw / TPM, hm = th / TPM;
      const tex = canvasTex(Math.ceil(tw), Math.ceil(th), (g, w, h) => {
        g.font = FONT(fs, 600); g.letterSpacing = '0.12em'; g.textBaseline = 'middle'; g.textAlign = 'center';
        g.fillStyle = 'rgba(38,20,8,.62)'; g.fillText(text, w / 2, h / 2);                    // the cut: the teak a little darker, no paint
        worn(g, w, h, fs, text);
      });
      const uM = (CAPO - LIP) / 2 + (C.capDu ?? 0), yT = CH + CAPT + 0.0006, N2 = 10, pos = [], uv = [], idx = [];
      for (let q = 0; q <= N2; q++) { const sv = sAt - wm / 2 + wm * q / N2; pos.push(...atS(sv, uM - hm / 2, yT), ...atS(sv, uM + hm / 2, yT)); uv.push(q / N2, 0, q / N2, 1); }   // v 0 aft (the letters' feet, toward the helm), 1 forward
      for (let q = 0; q < N2; q++) { const b = 2 * q; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      // unlit: the cut only darkens the teak under it (a lit fill took the sun and read lighter than the wood around it)
      const mat = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false, side: DS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const m = M(g, mat, 0, 0, 0, live);
      const L = { m, mat, day: tex, night: tex, plate: false, cap: true, wm, hm, text, capM: hm * 0.47, c: new THREE.Vector3(...atS(sAt, uM, yT)) }; parts.labels.push(L); return L;
    };
    const named = (x, texts, { live: lv = false, dx = 0, cap = false } = {}) => {
      if (cap && C.names === 'cap') { const sc = SM[iAtX(x)].s + (C.capDx?.[texts[0].toLowerCase()] ?? 0); return { plate: null, words: texts.map((t) => capWord(t, sc)) }; }
      if (C.band !== 'plate') return { plate: null, words: texts.map((t) => word(t, C.bandPx, { x, y: C.bandY })) };
      const y0 = RY1 + C.plateGap, y1 = CH + CAPT - 0.002, yc = (y0 + y1) / 2, uF = -LIP - 0.006, rim = 0.004;
      const sc = SM[iAtX(x)].s + dx, words = texts.map((t) => word(t, C.platePx, { s: sc, y: yc, u: uF, ink: INK.plate, ls: 0.1 }));
      const fsM = C.platePx / FPX, wm = Math.max(...words.map((L) => L.wm)) + 0.1 * fsM;
      const g = new THREE.Group(); (lv ? live : stat).add(g);
      slab(sc - wm / 2, sc + wm / 2, uF, -LIP, y0 + rim, y1 - rim, mats.powder, g);                    // the plate
      slab(sc - wm / 2 - rim, sc + wm / 2 + rim, uF + 0.0015, -LIP, y0, y1, polished, g);             // its polished rim, a step behind
      const corners = [[sc - wm / 2 - rim, y0], [sc + wm / 2 + rim, y0], [sc - wm / 2 - rim, y1], [sc + wm / 2 + rim, y1]].map(([sv, yy]) => new THREE.Vector3(...atS(sv, uF, yy)));
      for (const L of words) { L.plate2 = g; L.corners = corners; }   // the placard and its corners (the page test projects them)
      return { plate: g, words };
    };
    // the port recess: SAILS · ANCHOR · REEF, marine toggles (a hex nut, a boot, the bat up for on), a tell-tale over each
    // a marine toggle on a recess's plate (frame { s, l } at y 0): a hex nut, a boot, the bat (up for on), a tell-tale beside it
    const toggleOn = ({ s: g, l }, ny) => {
      g.scale.setScalar(C.toggleScale); l.scale.setScalar(C.toggleScale); g.position.y += ny * (1 - C.toggleScale); l.position.y += ny * (1 - C.toggleScale);
      M(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 6), steel, 0, ny, 0.006, g).rotation.x = Math.PI / 2;
      M(new THREE.CylinderGeometry(0.019, 0.019, 0.01, 20), black, 0, ny, 0.014, g).rotation.x = Math.PI / 2;
      const pivot = new THREE.Group(); pivot.position.set(0, ny, 0.014); l.add(pivot);
      M(new THREE.CylinderGeometry(0.011, 0.007, 0.11, 14), steel, 0, 0.055, 0, pivot);
      M(new THREE.SphereGeometry(0.0115, 14, 10), steel, 0, 0.112, 0, pivot);
      const led = M(new THREE.CircleGeometry(0.009, 16), ledOff, 0.06, ny + 0.06, 0.0008, l);
      M(new THREE.TorusGeometry(0.0105, 0.002, 8, 24), steel, 0.06, ny + 0.06, 0.001, g);
      blob(0.05, 0.05, 0, ny - 0.005, 0.0004, { parent: g, a: 0.4 });
      return { pivot, led, k: -1 };
    };
    // C.reefDial (v2, baked; v1 never sets it; owner 2026-11-17): REEF is a marine rotary selector, A · 0 · 1 · 2 engraved cream on a navy
    // face in a stainless bezel, a black skirted knob with a cream pointer, a lamp beside it lit amber on A (auto). Its four stops sit
    // at −120°, −40°, +40°, +120° from straight up (clockwise): A, 0, 1, 2. The knob (`pivot`) turns about the face's normal.
    const REEF_STOPS = [-120, -40, 40, 120];
    const rotaryOn = ({ s: g, l }, cy, x) => {
      const NY = -0.015, RR = 0.14, R0 = 0.082, RF = 0.075, CAP = 0.07;   // NY: the name plate's height (the recess reaches below the sole's line here)   // the letters' ring, the bezel, the face, the glyphs' cap height (m)
      const at = (d) => [RR * Math.sin(d * DEG), RR * Math.cos(d * DEG)];   // each stop's letter on a ring round the knob, evenly by stop
      M(new THREE.CylinderGeometry(R0, R0 + 0.004, 0.012, 56), steel, 0, cy, 0.006, g).rotation.x = Math.PI / 2;           // the bezel
      M(new THREE.CircleGeometry(RF, 56), dial((gg) => { gg.fillStyle = '#1D3A6B'; gg.beginPath(); gg.arc(256, 256, 256, 0, 7); gg.fill(); }), 0, cy, 0.0125, g);   // the navy face under the knob
      // the engraving: heavy cream letters on the plate, a dark recess under and round each (A larger than the digits)
      const PXM = 2000, TW = 800, TH = 600;
      const eng = canvasTex(TW, TH, (gg) => {
        gg.textAlign = 'center'; gg.textBaseline = 'middle'; gg.lineJoin = 'round';
        REEF_STOPS.forEach((d, i) => {
          const [ex, ey] = at(d), tx = TW / 2 + PXM * ex, ty = TH / 2 - PXM * ey, t = ['A', '0', '1', '2'][i], S = (i ? CAP : CAP * 1.15) / 0.72 * PXM;
          gg.font = FONT(S, 800);
          gg.fillStyle = 'rgba(0,0,0,.7)'; gg.fillText(t, tx + 5, ty + 8);
          gg.strokeStyle = 'rgba(8,16,38,.95)'; gg.lineWidth = 20; gg.strokeText(t, tx, ty);
          gg.strokeStyle = '#F2E9D6'; gg.lineWidth = 8; gg.strokeText(t, tx, ty);
          gg.fillStyle = '#F2E9D6'; gg.fillText(t, tx, ty);
        });
      });
      const em = new THREE.MeshStandardNodeMaterial({ map: eng, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      M(new THREE.PlaneGeometry(TW / PXM, TH / PXM), em, 0, cy, 0.0128, g);
      const pivot = new THREE.Group(); pivot.position.set(0, cy, 0.0135); l.add(pivot);
      M(new THREE.CylinderGeometry(0.066, 0.07, 0.024, 48), black, 0, 0, 0.012, pivot).rotation.x = Math.PI / 2;           // the skirt
      for (let q = 0; q < 24; q++) { const a = q / 24 * Math.PI * 2; M(new THREE.BoxGeometry(0.007, 0.008, 0.02), steel, Math.sin(a) * 0.07, Math.cos(a) * 0.07, 0.012, pivot).rotation.z = -a; }   // the grip
      M(new THREE.CylinderGeometry(0.052, 0.056, 0.009, 48), black, 0, 0, 0.028, pivot).rotation.x = Math.PI / 2;           // the cap
      M(new THREE.BoxGeometry(0.024, 0.066, 0.002), cream, 0, 0.033, 0.0335, pivot);                                          // the pointer, from the middle to the skirt
      M(new THREE.CircleGeometry(0.012, 20), brass, 0, 0, 0.0345, pivot);
      const lx = 0, ly = cy + 0.118;   // the lamp: an amber lens above the knob between 0 and 1, lit on A
      const led = M(new THREE.CircleGeometry(0.016, 20), ledOff, lx, ly, 0.0008, l);
      M(new THREE.TorusGeometry(0.0195, 0.003, 8, 28), steel, lx, ly, 0.0012, g);
      blob(0.22, 0.14, 0, cy - 0.012, 0.0004, { parent: g, a: 0.4 });
      // the name plate under it shows the state: REEF · AUTO, REEF · 0, · 1, · 2 (one shows; the rig swaps them), centred under the knob
      const words = ['AUTO', '0', '1', '2'].map((t) => word(`REEF · ${t}`, C.togglePx * (C.wordScale ?? 1), { x, y: NY, u: RD, ink: INK.plate, ls: 0.02 }));
      words.forEach((L, i) => { L.m.visible = i === 1; });
      parts.reefWords = words;
      return { pivot, led, k: -1, rotary: true };
    };
    for (const [id, text, x] of C.toggles) {
      const dialHere = C.reefDial && id === 'reef';
      if (!dialHere) word(text, C.togglePx * (C.wordScale ?? 1), { x, y: RY0 + 0.03, u: RD, ink: INK.plate, ls: 0.03 });
      const fr = facing(x, 0, RD), ny = C.toggleY;
      parts.toggles[id] = dialHere ? rotaryOn(fr, 0.157, x) : toggleOn(fr, ny);
      anchor(`t:${id}`, fr.l, 0, dialHere ? 0.157 : ny - 0.02, 0);
    }
    // the engine recess beside the lever: the key switch, the tachometer, ENGINE
    {
      const [x0, x1] = C.holes.engine, xc = (x0 + x1) / 2;
      // C.keyOut (v2, baked; v1 never sets it): the key at the recess's outboard end, the tach inboard (owner 2026-11-16: the key
      // nearer the right, easier to reach)
      const kIn = x0 + 0.115 - xc, kOut = x1 - 0.115 - xc;
      const { s: g, l } = facing(xc, 0, RD), kx = C.noTach ? 0 : C.keyOut ? kOut : kIn, ky = 0.15;   // the key 0.115 m in from the recess's inboard end, the tach at its outboard end
      M(new THREE.CylinderGeometry(0.052, 0.056, 0.012, 40), steel, kx, ky, 0.006, g).rotation.x = Math.PI / 2;
      M(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 32), black, kx, ky, 0.013, g).rotation.x = Math.PI / 2;
      const key = new THREE.Group(); key.position.set(kx, ky, 0.015); l.add(key);
      M(new THREE.BoxGeometry(0.009, 0.062, 0.003), steel, 0, -0.02, 0.004, key);
      M(new THREE.CylinderGeometry(0.022, 0.022, 0.004, 24), brass, 0, -0.062, 0.004, key).rotation.x = Math.PI / 2;
      for (const d of [-0.65, 0, 0.75]) M(new THREE.BoxGeometry(0.004, 0.012, 0.0015), cream, kx + Math.sin(d) * 0.062, ky + Math.cos(d) * 0.062, 0.0012, g).rotation.z = -d;
      blob(0.085, 0.085, kx, ky - 0.01, 0.0004, { parent: g, a: 0.45 });
      if (!C.noTach) {   // C.noTach (v2, baked; owner 2026-11-17: the engine dial goes; the key stays)
        const tx = C.keyOut ? kIn : kOut, ty = 0.14, tr = 0.075;
        const tachMat = dial((gg) => {
          gg.fillStyle = '#0F1114'; gg.beginPath(); gg.arc(256, 256, 256, 0, 7); gg.fill();
          gg.strokeStyle = '#EFE6D2'; gg.fillStyle = '#EFE6D2'; gg.textAlign = 'center'; gg.textBaseline = 'middle';
          for (let i = 0; i <= 40; i++) { const a = (-135 + i * 6.75) * DEG, l = i % 10 ? (i % 5 ? 14 : 24) : 36; gg.lineWidth = i % 10 ? 3 : 6; gg.beginPath(); gg.moveTo(256 + 222 * Math.sin(a), 256 - 222 * Math.cos(a)); gg.lineTo(256 + (222 - l) * Math.sin(a), 256 - (222 - l) * Math.cos(a)); gg.stroke(); }
          gg.font = FONT(58); for (let q = 0; q <= 4; q++) { const a = (-135 + q * 67.5) * DEG; gg.fillText(String(q), 256 + 160 * Math.sin(a), 256 - 160 * Math.cos(a)); }
          gg.font = FONT(30); gg.fillText('RPM ×1000', 256, 340);
        });
        tachMat.emissive.set('#ff6a4a'); tachMat.emissiveMap = tachMat.map;
        M(new THREE.CylinderGeometry(tr + 0.012, tr + 0.016, 0.014, 48), steel, tx, ty, 0.007, g).rotation.x = Math.PI / 2;
        M(new THREE.CircleGeometry(tr, 48), tachMat, tx, ty, 0.0145, g);
        const needle = new THREE.Group(); needle.position.set(tx, ty, 0.0152); l.add(needle);
        M(new THREE.BoxGeometry(0.005, 0.08, 0.001), cream, 0, 0.03, 0, needle);
        M(new THREE.CircleGeometry(0.008, 16), brushed, 0, 0, 0.0008, needle);
        const gl = M(new THREE.CircleGeometry(tr + 0.006, 48), dome, tx, ty, 0.017, g); gl.renderOrder = 6;
        blob(0.125, 0.125, tx, ty - 0.012, 0.0004, { parent: g, a: 0.45 });
        parts.needle = needle; parts.tach = tachMat;
      }
      parts.key = key;
      anchor('key', l, kx, ky, 0); if (!C.noTach) anchor('tach', l, C.keyOut ? kIn : kOut, 0.14, 0);
    }
    // MOOR: a stainless push-button on the cap beyond the MAIN winch (as TACK is beyond the JIB's), shown only while a mooring or
    // a pier is near (or DAWN at anchor after dark), its word engraved on the band under it
    {
      const { l } = onCap(C.x.moor, C.moorScale), g = new THREE.Group(); l.add(g);
      M(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 40), steel, 0, 0.01, 0, g);
      const ring = M(new THREE.TorusGeometry(0.05, 0.006, 10, 40), ringOff, 0, 0.021, 0, g); ring.rotation.x = Math.PI / 2;
      const cap = M(new THREE.SphereGeometry(0.046, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), brushed, 0, 0.02, 0, g); cap.scale.y = 0.45;
      blob(0.08, 0.08, 0, 0.0008, 0.01, { parent: g, a: 0.5, up: true });
      const nm = named(C.x.moor, ['MOOR', 'DAWN'], { live: true }), [w1, w2] = nm.words;
      parts.moor = { g, ring, w1, w2, plate: nm.plate }; g.visible = false; w1.m.visible = false; w2.m.visible = false; if (nm.plate) nm.plate.visible = false;
      anchor('moor', l, 0, 0.03, 0);
    }
    // the single lever (stage 1b; fix/cockpit-lever): a satin control box on a stainless post standing on the sole to starboard of
    // the pedestal; the stem rises out of a fore-aft gate in the box's top and tips forward for ahead. No words: the shape explains
    // it (owner 2026-11-11: "the lever should be self explain")
    {
      const L0 = C.lever, S2 = C.leverScale, [bw, bh, bd] = L0.box, ts = Math.tan(L0.slope), py = bh - L0.pivot, T = bh + 0.004;
      const g = new THREE.Group(); g.position.set(L0.x, L0.y, L0.z); g.scale.setScalar(S2); live.add(g);
      M(new THREE.CylinderGeometry(0.022, 0.028, L0.y / S2 + 0.02, 16), polished, 0, -(L0.y / S2) / 2, 0, g);
      // the box's side profile (u forward, v up): its top slopes down toward the helmsman by `slope`, so the gate in it faces the eye
      { const hA = bh - bd / 2 * ts, hF = bh + bd / 2 * ts, pts = [[-bd / 2, 0], [bd / 2, 0], [bd / 2, hF], [-bd / 2, hA]], r = 0.014, s2 = new THREE.Shape();
        const P2 = (i) => pts[(i + 4) % 4], toward = (p, q, d) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); return [p[0] + dx / l * d, p[1] + dy / l * d]; };
        for (let i = 0; i < 4; i++) { const p = P2(i), a0 = toward(p, P2(i - 1), r), a1 = toward(p, P2(i + 1), r); if (i === 0) s2.moveTo(...a0); else s2.lineTo(...a0); s2.quadraticCurveTo(p[0], p[1], ...a1); }
        s2.closePath();
        M(new THREE.ExtrudeGeometry(s2, { depth: bw, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 6 }).translate(0, 0, -bw / 2).rotateY(Math.PI / 2), leverBox, 0, 0, 0, g); }
      // the gate: a polished trim plate on the sloped top with a black slot down its length, from where the stem crosses the top at
      // full ahead to where it crosses at full astern (the pivot `pivot` under the top), a stem's width to spare at each end
      const cross = (a) => { const t = (T - py) / (Math.cos(a) - Math.sin(a) * ts); return -t * Math.sin(a); };   // a: the stem's lean forward, rad
      const z0 = cross(0.6 + 0.08), z1 = cross(-(0.6 - 0.08)), cs = Math.cos(L0.slope), zl = (z1 - z0) / cs + 0.032, zc = (z0 + z1) / 2, dy = T - py;
      const gate = new THREE.Group(); gate.position.set(0, T - zc * ts, zc); gate.rotation.x = L0.slope; g.add(gate);
      M(new THREE.BoxGeometry(0.05, 0.003, zl + 0.024), polished, 0, 0.0015, 0, gate);
      M(new THREE.BoxGeometry(0.022, 0.0034, zl), black, 0, 0.0019, 0, gate);
      const stem = new THREE.Group(); stem.position.set(0, py, 0); g.add(stem);
      M(new THREE.CylinderGeometry(0.011, 0.014, L0.stem, 16), steel, 0, L0.stem / 2, 0, stem);
      M(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 20), black, 0, dy + 0.012, 0, stem);   // a rubber collar over the gate
      const ky = L0.stem + L0.knob * 0.7;
      M(new THREE.SphereGeometry(L0.knob, 32, 22), black, 0, ky, 0, stem);
      parts.stem = stem;
      anchor('lever', g, 0, bh / 2, bd / 2); anchor('knob', stem, 0, ky, 0);
    }
    // C.tackOff (v2, baked; v1 never sets it): no TACK on the cap (v2's pilot head carries TACK, owner 2026-11-16)
    if (C.tackOff) { parts.tack = null; anchor('tack', onCap(C.x.tack, C.tackScale).l, 0, 0.03, 0); }   // the anchor stays (v1's hit layer reads it at the bake)
    else {
      const { s: g, l } = onCap(C.x.tack, C.tackScale);
      M(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 40), steel, 0, 0.01, 0, g);
      const ring = M(new THREE.TorusGeometry(0.05, 0.006, 10, 40), ringOff, 0, 0.021, 0, l); ring.rotation.x = Math.PI / 2;
      const cap = M(new THREE.SphereGeometry(0.046, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), brushed, 0, 0.02, 0, l); cap.scale.y = 0.45;
      blob(0.08, 0.08, 0, 0.0008, 0.01, { parent: g, a: 0.5, up: true });
      const nm = named(C.x.tack, ['TACK', 'GYBE'], { cap: true });
      parts.tack = { ring, cap, tack: nm.words[0], gybe: nm.words[1] };
      parts.tack.gybe.m.visible = false;
      anchor('tack', l, 0, 0.03, 0);
    }
    // BINOS and VHF (look C3, owner 2026-11-12): small stainless push-buttons in TACK's style (a ring, a domed cap), set on the face
    // between each instrument and its recess, facing the helmsman; the word engraved under each (cut into the gelcoat as the old
    // band's words). BINOS's ring amber while the glasses are up, VHF's while the radio is on
    parts.tools = {};
    for (const [id, x, text] of [['binoculars', C.x.binos, 'BINOS'], ['radio', C.x.vhf, 'VHF']]) {
      const onTop = C.toolOn === 'cap', { s: g, l } = onTop ? onCap(x) : facing(x, C.toolY, 0), k = C.toolScale;
      const up = (o) => { if (!onTop) o.rotation.x = Math.PI / 2; o.scale.setScalar(k); return o; };   // TACK's parts stand on +y: on the face they face +z
      const gs = up(new THREE.Group()), ls = up(new THREE.Group()); g.add(gs); l.add(ls);
      M(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 40), steel, 0, 0.01, 0, gs);
      const ring = M(new THREE.TorusGeometry(0.05, 0.006, 10, 40), ringOff, 0, 0.021, 0, ls); ring.rotation.x = Math.PI / 2;
      const cap = M(new THREE.SphereGeometry(0.046, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), toolCap[id], 0, 0.02, 0, ls); cap.scale.y = 0.45;
      if (onTop) blob(0.08 * k, 0.08 * k, 0, 0.0008, 0, { parent: g, a: 0.5, up: true }); else blob(0.06 * k * 1.4, 0.06 * k * 1.4, 0, -0.006, 0.0004, { parent: g, a: 0.4 });
      if (!onTop) word(text, C.toolPx, { s: SM[iAtX(x)].s + (x < 0 ? -1 : 1) * 0.03, y: C.toolY - 0.095, u: -0.004, ink: INK.day, ls: 0.08 });   // each word a little outboard of its button (off the switch recess's rim), mirrored
      parts.tools[id] = { ring, cap, on: null };
      anchor(id === 'binoculars' ? 'binos' : 'vhf', l, 0, onTop ? 0.03 * k : 0, onTop ? 0 : 0.014);
    }
    // ---- the PRO recess (stage 2, owner 2026-11-06): to starboard of the engine panel, full height. A smoked-glass cover slides
    // aside along the face (into the coaming, behind its skin) and shows the trim controls (TRAVELLER and JIB LEAD cars on
    // tracks over PRO's button and the VANG and BACKSTAY cars, look C3), every word engraved on the plate. Clean: the cover stays flush.
    {
      const P = C.pro, [x0, x1, hd0, ft0] = C.holes.pro, hd = hd0 ?? RY1, ft = ft0 ?? RY0, s0 = SM[iAtX(x0)].s, s1 = SM[iAtX(x1)].s, W = s1 - s0, pitch = W / P.sliders.length;
      const colS = (c) => s0 + pitch * (c + 0.5);
      // a frame on the plate at arc s: +x along the coaming, +z out toward the cockpit
      const frameS = (sv, y, u) => { const a = new THREE.Vector3(...atS(sv, u, y)), b = new THREE.Vector3(...atS(sv, u + 1, y)); return frame(a, b.sub(a).normalize()); };
      const pro = { k: -1, sliders: {}, buttons: {}, words: [], s0, s1, W };
      // the four trim controls as their real deck hardware (look/pro-panel; owner 2026-11-12: "first time user will hard to get how
      // to adjust them"): each a car on a track, the car a polished block with a black knob standing out of it (the handle), its
      // white index line on the scale; the scale says what the control is, with no extra word:
      //   traveller  a traveller track with a sheave block at each end (its control lines) and a centre mark
      //   pins       a jib-lead T-track: a row of pin-stop holes along it, a plunger on the car
      //   tension    the vang and the backstay: a wedge engraved under the track, thin at ease and thick at full on
      // look C3 (owner 2026-11-12: "the 4 sliders need to match each other, make PRO a toggle"): PRO's toggle in its own column at
      // the recess's outboard end, the full height of both rows; then a strict 2 x 2 grid of identical sliders (TRAVELLER, JIB LEAD
      // over VANG, BACKSTAY): equal columns, the same track, car and scale, each word the same height over its track, the rows on one
      // pitch. The cover slides over the grid only: the toggle stands for every player (down: basic, the cover closed)
      const isC = P.layout === 'c', tW = isC ? P.toggleW : 0, cw = (W - tW) / 2, g0 = s0 + tW;
      const L = isC ? cw - 2 * P.trackMargin : P.track, travel = L * 0.88, CW = P.car?.[0] ?? 0.04, CHh = P.car?.[1] ?? 0.034, KR = P.knob ?? 0.0075, kindOf = P.kinds ?? {};
      const GRID = { traveller: [0, 0], jibLead: [1, 0], vang: [0, 1], backstay: [1, 1] };
      const spot = (id, c) => {
        if (!isC) return { s: colS(c), y: P.trackY };
        const [j, r] = GRID[id], y = P.trackY - r * P.rowPitch;
        return { s: g0 + cw * (j + 0.5), y, wy: y + (P.wordY - P.trackY) };
      };
      P.sliders.forEach(([id, text], c) => {
        const kind = kindOf[id] ?? 'plain', at0 = spot(id, c);
        const { s: g, l } = frameS(at0.s, at0.y, RD);
        const TH = P.trackH ?? 0.016, SC = P.scaleH ?? 0.012, sy = -(TH / 2 + 0.006);   // the track's height; the scale's height and top, under it
        M(new THREE.BoxGeometry(L, TH, 0.006), black, 0, 0, 0.003, g);                                   // the track: black anodised
        for (const yy of [-1, 1]) M(new THREE.BoxGeometry(L, TH * 0.16, 0.0068), brushed, 0, yy * TH * 0.42, 0.0034, g);   // its two bright edges
        if (kind === 'rail') {   // look/pro-sliders: the rail, its slot, its stops (each with a screw), three ticks, − and + at its ends
          M(new THREE.BoxGeometry(L, TH, 0.008), brushed, 0, 0, 0.004, g);
          M(new THREE.BoxGeometry(L * 0.995, TH * 0.46, 0.0084), black, 0, 0, 0.0043, g);
          for (const xx of [-1, 1]) {
            M(new THREE.BoxGeometry(0.018, TH * 1.35, 0.022), black, xx * (L / 2 + 0.009), 0, 0.011, g);
            M(new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 12), steel, xx * (L / 2 + 0.009), 0, 0.0225, g).rotation.x = Math.PI / 2;
          }
          for (const q of [0.25, 0.5, 0.75]) { const h2 = SC * (q === 0.5 ? 1 : 0.65); M(new THREE.BoxGeometry(q === 0.5 ? 0.007 : 0.005, h2, 0.001), scaleInk, (q - 0.5) * travel, sy - h2 / 2, 0.0008, g); }
          const my = -(TH / 2 + 0.04), mw = 0.028, mt = 0.007;   // − and +: the car's range, faint (rangeInk), under the car's two end places
          M(new THREE.BoxGeometry(mw, mt, 0.001), rangeInk, -travel / 2, my, 0.0008, g);
          M(new THREE.BoxGeometry(mw, mt, 0.001), rangeInk, travel / 2, my, 0.0008, g); M(new THREE.BoxGeometry(mt, mw, 0.001), rangeInk, travel / 2, my, 0.0009, g);
        } else if (kind === 'traveller') {
          for (const xx of [-1, 1]) {   // an end block with its sheave: the control line leads out of each end
            M(new THREE.BoxGeometry(TH * 0.9, TH * 1.7, 0.02), polished, xx * (L / 2 + TH * 0.45), 0, 0.01, g);
            M(new THREE.CylinderGeometry(TH * 0.42, TH * 0.42, 0.022, 20), black, xx * (L / 2 + TH * 0.45), 0, 0.012, g);
          }
          M(new THREE.BoxGeometry(0.005, SC * 1.5, 0.001), scaleInk, 0, sy - SC * 0.75, 0.0008, g);   // the centre mark
          for (const q of [-1, -0.5, 0.5, 1]) M(new THREE.BoxGeometry(0.0035, SC * (Math.abs(q) === 1 ? 1 : 0.7), 0.001), scaleInk, q * travel / 2, sy - SC * (Math.abs(q) === 1 ? 0.5 : 0.35), 0.0008, g);
        } else {
          for (const xx of [-1, 1]) M(new THREE.BoxGeometry(0.014, TH * 1.5, 0.014), steel, xx * (L / 2 + 0.007), 0, 0.007, g);   // the end stops
          if (kind === 'ticks') for (let q = 0; q <= 4; q++) M(new THREE.BoxGeometry(q === 2 ? 0.005 : 0.0035, SC * (q % 2 ? 0.6 : q === 2 ? 1.2 : 0.9), 0.001), scaleInk, (q / 4 - 0.5) * travel, sy - SC * (q % 2 ? 0.3 : q === 2 ? 0.6 : 0.45), 0.0008, g);   // the scale: five ticks, the middle longer
        }
        if (kind === 'pins') for (let q = 0; q <= 8; q++) M(new THREE.CylinderGeometry(TH * 0.17, TH * 0.17, 0.001, 12), scaleInk, (q / 8 - 0.5) * travel, 0, 0.0062, g).rotation.x = Math.PI / 2;   // the pin-stop holes, bright in the dark track
        if (kind === 'tension') {   // the wedge: a cream triangle under the track, ease (thin) to on (thick), in the car's direction of travel
          const sg = new THREE.Shape();
          sg.moveTo(-travel / 2, sy - SC * 0.12); sg.lineTo(travel / 2, sy); sg.lineTo(travel / 2, sy - SC * 1.5); sg.lineTo(-travel / 2, sy - SC * 0.24); sg.closePath();
          M(new THREE.ShapeGeometry(sg), scaleInk, 0, 0, 0.0008, g);
        }
        const car = new THREE.Group(); car.position.set(0, 0, kind === 'rail' ? 0.008 : 0.006); car.scale.setScalar(P.car ? 1 : C.carScale); l.add(car);
        let ridge = null;
        if (kind === 'rail') {   // the car (look/pro-sliders): a polished block, a black grip bed, stainless ribs across it (its own material: it brightens on reach)
          ridge = new THREE.MeshStandardNodeMaterial({ name: 'ck_car_ridge', color: 0xd9dde1, metalness: 0.85, roughness: 0.34, emissive: '#ffe6c4', emissiveIntensity: 0 });
          M(new THREE.BoxGeometry(CW, CHh, 0.014), polished, 0, 0, 0.007, car);
          M(new THREE.BoxGeometry(CW * 0.8, CHh * 0.8, 0.01), black, 0, 0, 0.019, car);
          const n = P.ridges ?? 7, pw = CW * 0.68 / (n - 1);
          for (let q = 0; q < n; q++) M(new THREE.CylinderGeometry(0.0034, 0.0034, CHh * 0.72, 10), ridge, (q - (n - 1) / 2) * pw, 0, 0.0245, car);
        } else {
          M(new THREE.BoxGeometry(CW, CHh, 0.018), polished, 0, 0, 0.009, car);                            // the car: polished stainless, the bright thing on the dark track
          M(new THREE.BoxGeometry(0.004, CHh * 1.02, 0.0184), black, 0, 0, 0.009, car);                   // its index line (where it stands on the scale)
          M(new THREE.CylinderGeometry(KR, KR * 1.1, 0.026, 28), black, 0, 0, 0.031, car).rotation.x = Math.PI / 2;   // the knob: the handle
          M(new THREE.SphereGeometry(KR, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), black, 0, 0, 0.044, car).rotation.x = Math.PI / 2;
        }
        if (kind === 'pins') M(new THREE.CylinderGeometry(0.005, 0.005, 0.016, 12), steel, 0, CHh / 2 + 0.007, 0.009, car);   // the plunger
        blob(L * 0.6, 0.03 + CHh * 0.35, 0, -0.006, 0.0003, { parent: g, a: 0.28 });
        const nm = word(text, P.px, { s: at0.s, y: at0.wy ?? P.wordY, u: RD, ink: INK.plate, ls: 0.02 }); if (P.wordFloor) nm.floorK = P.wordFloor;
        pro.words.push(nm);
        pro.sliders[id] = { car, f: -1, travel, ridge, hv: null };
        anchor(`p:${id}:a`, l, -travel / 2, 0, 0); anchor(`p:${id}:b`, l, travel / 2, 0, 0);
      });
      if (isC) {
        const ts = s0 + tW / 2, fr = frameS(ts, 0, RD);
        pro.toggle = toggleOn(fr, C.toggleY);   // at the switches' own height, its placard at theirs
        word('PRO', C.togglePx, { s: ts, y: RY0 + 0.03, u: RD, ink: INK.plate, ls: 0.03 });   // its placard, as SAILS · ANCHOR · REEF
        anchor('p:btn:pro', fr.l, 0, C.toggleY - 0.02, 0);
        anchor('p:g0', live, ...atS(g0, 0, P.trackY));   // the grid's outboard edge (the hit layer's PRO column ends there)
      }
      if (!isC) P.buttons.forEach(([id, text], c) => {
        const below = (P.btnWord ?? C.btnWord) === 'below', cs = below ? colS(c) : colS(c) - pitch * (P.btnDx ?? 0.32), { s: g, l } = frameS(cs, P.btnY, RD);
        g.scale.setScalar(C.btnScale); l.scale.setScalar(C.btnScale);
        M(new THREE.CylinderGeometry(0.024, 0.026, 0.008, 32), steel, 0, 0, 0.004, g).rotation.x = Math.PI / 2;
        const ring = M(new THREE.TorusGeometry(0.018, 0.0035, 8, 32), ringOff, 0, 0, 0.009, l);
        const cap = M(new THREE.SphereGeometry(0.016, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), brushed, 0, 0, 0.008, l); cap.rotation.x = Math.PI / 2; cap.scale.y = 0.4;
        blob(0.04, 0.04, 0, -0.003, 0.0003, { parent: g, a: 0.4 });
        pro.words.push(below ? word(text, P.btnPx, { s: cs, y: P.btnWordY, u: RD, ink: INK.plate, ls: 0.04 })
          : word(text, P.btnPx ?? P.px, { s: cs + (P.btnWordDx ?? 0.034), y: P.btnY, u: RD, ink: INK.plate, left: true, ls: 0.06 }));
        pro.buttons[id] = { ring, cap, on: null };
        anchor(`p:btn:${id}`, l, 0, 0, 0);
      });
      anchor('p:r0', live, ...atS(s0, 0, hd)); anchor('p:r1', live, ...atS(s1, 0, ft));
      // the cover: smoked glass on a track just behind the face's skin, sliding along the curve; PRO engraved on it
      const cs0 = s0 + tW, cW = s1 - cs0, NC = 40, coverGeo = new THREE.BufferGeometry(), cpos = new Float32Array((NC + 1) * 2 * 3), cuv = [], cidx = [];
      for (let q = 0; q <= NC; q++) cuv.push(q / NC, 0, q / NC, 1);
      for (let q = 0; q < NC; q++) { const b = 2 * q; cidx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      coverGeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3)); coverGeo.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2)); coverGeo.setIndex(cidx);
      const smoke = new THREE.MeshPhysicalNodeMaterial({ color: '#1A2233', roughness: 0.1, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.97, side: DS });
      const cover = M(coverGeo, smoke, 0, 0, 0, live); cover.renderOrder = 4;
      const lab = word('PRO', P.px + 4, { s: cs0 + cW / 2, y: (ft + hd) / 2, u: 0.0025, ink: INK.plate, ls: 0.3 });   // centred on the closed cover (C3: hidden; the toggle's placard says it)
      const labPos = lab.m.geometry.attributes.position, lab0 = Float32Array.from(labPos.array);
      const labS = []; for (let q = 0; q <= 10; q++) labS.push(cs0 + cW / 2 - lab.wm / 2 + lab.wm * q / 10 - 0.0002);
      pro.cover = (e) => {
        const d = e * cW * 1.03;
        for (let q = 0; q <= NC; q++) { const sv = cs0 + d + cW * q / NC; cpos.set(atS(sv, 0.003, ft - 0.002), 6 * q); cpos.set(atS(sv, 0.003, hd + 0.002), 6 * q + 3); }
        coverGeo.attributes.position.needsUpdate = true; coverGeo.computeVertexNormals(); coverGeo.computeBoundingSphere();
        for (let q = 0; q <= 10; q++) { const sv = labS[q] + d; for (const [j, yy] of [[0, lab0[6 * q + 1]], [1, lab0[6 * q + 4]]]) labPos.array.set(atS(sv, 0.0025, yy), 6 * q + 3 * j); }
        labPos.needsUpdate = true; lab.m.geometry.computeBoundingSphere();
        cover.visible = e < 0.999; lab.m.visible = !isC && e < 0.999;
        const open = e > 0.02;   // closed: nothing shows through the smoke (no word, no lit ring)
        for (const L of pro.words) L.m.visible = open;
        for (const B of Object.values(pro.buttons)) B.ring.visible = B.cap.visible = open;
        for (const S4 of Object.values(pro.sliders)) S4.car.visible = open;
      };
      pro.cover(0);
      parts.pro = pro;
    }
    for (const side of ['jib', 'main']) {
      const x = C.x[side], c = capTop(x);
      parts[side] = { p: c.p.clone(), n: c.n.clone() };
      blob(0.16 * C.winchScale, 0.16 * C.winchScale, c.p.x, c.p.y + 0.0008, c.p.z, { up: true, a: 0.5 });
      named(x, [side.toUpperCase()], { dx: C.plateDx?.[side] ?? 0, cap: true });   // cut into the cap beside its own winch
    }
    // the instruments: the chart to port, the wind to starboard, each flush in its end's facet and angled up to the helmsman by the
    // face's lean; a slim dark bezel with a stainless lip, a rubber gasket, the face (the dial drawn to a texture: dialFaces.js)
    // under a smoked glass with a faint reflection. Their own group (not merged): ?dials=top hides them
    const instG = new THREE.Group(); instG.name = 'instruments'; g0.add(instG);
    parts.inst = { g: instG };
    {
      const up = new THREE.Vector3(0, 1, 0), cL = Math.cos(I.lean), sL = Math.sin(I.lean), RB = I.R + 0.026;
      const bezelGeo = new THREE.LatheGeometry([[I.R - 0.003, -0.001], [I.R + 0.001, 0.0055], [I.R + 0.011, 0.0068], [I.R + 0.017, 0.0035], [I.R + 0.018, 0]].map(([r, z]) => new THREE.Vector2(r, z)), 128).rotateX(Math.PI / 2);
      for (const [side, i] of [['chart', NS - iC], ['wind', iC]]) {
        const n = SM[i].n, zA = n.clone().multiplyScalar(-cL).addScaledVector(up, sL), yA = up.clone().multiplyScalar(cL).addScaledVector(n, sL), xA = new THREE.Vector3().crossVectors(yA, zA);
        const u0 = (I.y - I.y0) * TANL, g = new THREE.Group(); g.position.set(SM[i].p.x + n.x * u0, I.y, SM[i].p.z + n.z * u0); g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA)); instG.add(g);   // on the leaning face (not through at(): the centre is under the lift's line)
        const m = (geo, mat, z = 0) => { const o = new THREE.Mesh(geo, mat); o.position.z = z; g.add(o); return o; };
        g.position.addScaledVector(zA, 0.006);                                           // the instrument stands 6 mm proud (its bezel's height)
        const gk = m(new THREE.CylinderGeometry(RB, RB + 0.002, 0.014, 128, 1, true), black, -0.006); gk.rotation.x = Math.PI / 2;   // the gasket: a rubber band into the gelcoat
        m(new THREE.RingGeometry(I.R + 0.016, RB, 128), black, 0.0012);
        const bz = m(bezelGeo, bezel); bz.position.z = 0.0008;                           // the bezel's shallow profile
        m(new THREE.TorusGeometry(I.R + 0.0005, 0.0026, 8, 128), polished, 0.0042);       // its stainless lip
        const face = m(new THREE.CircleGeometry(I.R, 96), faceMat[side], -0.002);         // the face, just behind the glass
        const gl = m(new THREE.CircleGeometry(I.R + 0.001, 96), glass, 0.0036); gl.renderOrder = 6;
        anchor(`i:${side}`, g); anchor(`i:${side}:t`, g, 0, RB, 0); anchor(`i:${side}:b`, g, 0, -RB, 0); anchor(`i:${side}:l`, g, -RB, 0, 0); anchor(`i:${side}:r`, g, RB, 0, 0);
        parts.inst[side] = { g, face };
      }
    }
    // merge the static meshes by material (the shell: ≈ 20 draws instead of ≈ 120)
    stat.updateMatrixWorld(true);
    const inv = stat.matrixWorld.clone().invert(), byMat = new Map(), mw = new THREE.Matrix4();
    stat.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(mw.multiplyMatrices(inv, o.matrixWorld));
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.sh) { const a = new Float32Array(g.attributes.position.count * 3); for (let q = 0; q < a.length; q += 3) { a[q + 1] = 0.2; a[q + 2] = C.CH; } g.setAttribute('sh', new THREE.Float32BufferAttribute(a, 3)); }   // open face: no occlusion
      for (const k2 of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'sh'].includes(k2)) g.deleteAttribute(k2);
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    });
    g0.remove(stat);
    const merged = new THREE.Group(); merged.name = 'merged';
    for (const [mat, list] of byMat) { const geo = mergeGeometries(list, false); if (geo) merged.add(new THREE.Mesh(geo, mat)); for (const g of list) g.dispose(); }
    g0.add(merged);
    return { g: g0, parts };
  }

  // ---- layout: the camera for the viewport, the slot rect ----------------------------------------------------------------
  let view = null, rect = null, hwNow = 0, phoneNow = false;
  // phone: a phone held sideways (COCKPIT_PHONE: its lens and shares)
  function layout({ w, h, phone = false }) {
    view = cockpitView({ w, h, phone });
    if (!shell || Math.abs(view.hw - hwNow) > 0.05 || phone !== phoneNow) {
      phoneNow = phone;
      if (shell) { content.remove(shell.g); shell.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
      hwNow = view.hw; shell = buildShell(hwNow, labelConsts(labels, cockpitConsts(phone))); content.add(shell.g); built = shell.parts;
      for (const side of ['jib', 'main']) {
        const P = built[side], g = winchAt[side];
        g.position.copy(P.p); g.scale.setScalar(COCKPIT.winchScale);
        g.rotation.set(0, side === 'jib' ? -2.25 : -0.9, 0);   // the tails lead aft and inboard toward the helmsman
      }
      setNight(nightK, true);
    }
    camera.fov = view.vfov / DEG; camera.aspect = w / h; camera.near = 3; camera.far = 40;   // everything on screen is 6.5 to 12 m away: a near plane at 3 m keeps the depth fine enough for the instruments' millimetres
    camera.position.set(0, view.yc, COCKPIT.camZ); camera.rotation.set(-view.th, 0, 0);
    // the slot: from over the tallest part (a winch's handle, the lever's knob) to the screen's foot
    const top = Math.max(0, Math.floor(view.y({ y: 1.15, z: -1.6 }) - 8));
    rect = { x: 0, y: top, w, h: h - top };
    camera.setViewOffset(w, h, rect.x, rect.y, rect.w, rect.h);
    camera.updateProjectionMatrix();
    root.updateMatrixWorld(true);
    return { view, rect };
  }

  // ---- the states -------------------------------------------------------------------------------------------------------
  const toward = (v, to, dt, rate) => (Math.abs(to - v) < 1e-4 ? to : v + Math.sign(to - v) * Math.min(Math.abs(to - v), dt * rate));
  let nightK = 0;
  // k: the night set 0..1; exp: the scene's exposure (the backlights are set in screen terms: a lamp, not a light source)
  let expNow = 1;
  function setNight(k, force = false, exp = expNow) {
    if (!force && Math.abs(k - nightK) < 1e-3 && Math.abs(exp - expNow) / exp < 0.05) return false;
    nightK = k; expNow = exp;
    const e = 1 / Math.max(1, exp);
    mats.setNight(k, worldLight);   // the gelcoat, the teak and the sole darker by night (the red deck lamp would wash them pink)
    // by night a word is its backlight only. By the world's light (look/cockpit-light) a plate's cream letters also keep a small
    // floor of their own by day (their day texture as a faint emissive, in screen terms): in the coaming's shade at 17:30-20:00 the
    // lit letters alone fell to 2.1:1 on the dark plate; with the floor every word holds 3:1 (tools/cockpit_light.mjs)
    if (built) for (const L of built.labels) {
      if (L.cap) continue;   // the names cut into the cap (look C3) are unlit, one texture day and night: nothing to switch
      const nn = k >= 0.5, floor = worldLight && L.plate && !nn, map = nn ? L.night : L.day, em = floor ? L.day : L.night;
      if (L.mat.map !== map || L.mat.emissiveMap !== em) { L.mat.map = map; L.mat.emissiveMap = em; L.mat.needsUpdate = true; }
      L.mat.emissive.set(floor ? 0xffffff : INK.night);
      L.mat.emissiveIntensity = nn && L.plate ? 1.3 * e : floor ? (L.floorK ?? COCKPIT.wordFloor) * e : 0;
      L.mat.color.setScalar(nn && L.plate ? 0.08 : 1);
    }
    card.material.emissiveIntensity = 0.12 * k * e;
    if (built?.tach) built.tach.emissiveIntensity = 0.2 * k * e;
    // the lit amber (TACK offered, a toggle's LED, a PRO button): by the world's light its own small glow, held on screen (× 6 / exposure:
    // at the night exposure the old value read 360 × its day level, a blown-out disc)
    amberOn.emissiveIntensity = (2.2 - 1.0 * k) * (worldLight ? Math.min(1, 6 / Math.max(1e-6, exp)) : 1);
    faceLight();
    return true;
  }
  // s: { helm: bool (the helm view: no pedestal), toggles: { sails, anchor, reef }, moor: 'lines'|'dawn'|null,
  //      pro: { open, f: { traveller, jibLead, vang, backstay } 0..1, lit: { pro, binoculars, radio, logbook } },
  //      engine: 'off'|'cranking'|'running'|'stopping', rpm, lever, tack: { offer, active, kind }, night 0..1, sink 0..1, peek: { jib, main },
  //      hover: 'binoculars'|'radio'|null (look C3: the tool buttons; pro.lit lights their rings),
  //      inst: { show, glow: { chart, wind } ≥ 1 } }
  // dt: the frame's step (the bats, the key and the needle move, they do not jump). Returns true while something moved.
  function set(s, dt = 0) {
    if (!built) return false;
    let moved = false;
    if (helm.visible !== !s.helm) { helm.visible = !s.helm; mats.pedestal(!s.helm); moved = true; }
    for (const [id, T] of Object.entries(built.toggles)) {
      const on = !!s.toggles?.[id], to = on ? 1 : 0, was = T.k;
      T.k = T.k < 0 ? to : toward(T.k, to, dt, 8); if (T.k !== was || T.on !== on) moved = true;
      T.pivot.rotation.x = 0.95 + (1 - T.k) * (Math.PI - 1.9);   // the bat up (on) or down, leaning to the helmsman
      if (T.on !== on) { T.led.material = on ? amberOn : ledOff; T.on = on; }
    }
    // MOOR (or DAWN): only while it can be used
    const mo = s.moor ?? null, P2 = built.moor;
    if (P2.st !== mo) { P2.st = mo; P2.g.visible = !!mo; P2.w1.m.visible = mo === 'lines'; P2.w2.m.visible = mo === 'dawn'; if (P2.plate) P2.plate.visible = !!mo; moved = true; }
    // the engine key: OFF −0.65 rad, ON 0, START +0.75 while cranking; the tach's needle on the rpm (0 … 4000 over 270°)
    const keyTo = s.engine === 'cranking' ? 0.75 : s.engine === 'running' ? 0 : -0.65;
    const kz = toward(-built.key.rotation.z, keyTo, dt, 6); if (kz !== -built.key.rotation.z) { built.key.rotation.z = -kz; moved = true; }
    const na = -(-135 + Math.min(4000, Math.max(0, s.rpm ?? 0)) / 4000 * 270) * DEG;
    if (Math.abs(na - built.needle.rotation.z) > 0.004) { built.needle.rotation.z = na; moved = true; }
    // BINOS and VHF (look C3): each ring amber while lit; a hover lifts its cap a little
    for (const [id, T] of Object.entries(built.tools ?? {})) {
      const on = !!s.pro?.lit?.[id], hv = s.hover === id, k2 = `${on}|${hv}`;
      if (T.on !== k2) { T.on = k2; T.ring.material = on ? amberOn : ringOff; toolCap[id].emissiveIntensity = hv ? 0.25 : 0; moved = true; }
    }
    // the lever: + ahead tips the stem forward (−z)
    const la = -(s.lever ?? 0) * 0.6 - 0.08;
    if (Math.abs(la - built.stem.rotation.x) > 1e-3) { built.stem.rotation.x = la; moved = true; }
    // TACK: the ring lit while a tack (or gybe) is offered, the cap down while the assist runs; the word follows the kind
    const T2 = built.tack ?? { key: null, ring: {}, cap: { position: {} }, tack: { m: {} }, gybe: { m: {} } }, offer = !!s.tack?.offer, active = !!s.tack?.active, gybe = s.tack?.kind === 'gybe';
    const tkey = `${offer}|${active}|${gybe}`;
    if (T2.key !== tkey) { T2.key = tkey; T2.ring.material = offer || active ? amberOn : ringOff; T2.cap.position.y = active ? 0.012 : 0.02; T2.tack.m.visible = !gybe; T2.gybe.m.visible = gybe; moved = true; }
    if (s.night != null) moved = setNight(s.night, false, s.exposure ?? expNow) || moved;
    // the Calm HUD and the fold: the whole object tips away and sinks (the camera stays: the water comes down to the frame's
    // edge); a peek rises to the cap
    const sk = s.sink ?? 0, y = -sk * COCKPIT.fold.sink, rx = -sk * COCKPIT.fold.tilt;
    if (Math.abs(content.position.y - y) > 1e-4 || Math.abs(content.rotation.x - rx) > 1e-4) { content.position.y = y; content.rotation.x = rx; moved = true; }
    // the PRO recess: the cover slides aside (0.4 s, eased), the cars stand on their values (f 0..1), the buttons' rings lit when on
    const PR = built.pro;
    if (PR) {
      const P3 = s.pro ?? {}, to = P3.open ? 1 : 0;
      const k = PR.k < 0 ? to : toward(PR.k, to, dt, 1 / COCKPIT.pro.openS);
      if (k !== PR.k) { PR.k = k; PR.cover(k * k * (3 - 2 * k)); moved = true; }
      for (const [id, S3] of Object.entries(PR.sliders)) {
        const f = Math.min(1, Math.max(0, P3.f?.[id] ?? 0.5));
        if (Math.abs(f - S3.f) > 2e-4) { S3.f = f; S3.car.position.x = (f - 0.5) * S3.travel; moved = true; }
        const hv = s.hover === id;   // look/pro-sliders: under the pointer, the focus or a press its ribs brighten (a lamp's glow, held on screen)
        if (S3.ridge && (S3.hv !== hv || (hv && S3.exp !== expNow))) { S3.hv = hv; S3.exp = expNow; S3.ridge.emissiveIntensity = hv ? COCKPIT.carHover * Math.min(1, 6 / Math.max(1e-6, expNow)) : 0; moved = true; }
      }
      if (PR.toggle) {
        const T = PR.toggle, was = T.k, on = !!P3.open;
        T.k = T.k < 0 ? (on ? 1 : 0) : toward(T.k, on ? 1 : 0, dt, 8); if (T.k !== was || T.on !== on) moved = true;
        T.pivot.rotation.x = 0.95 + (1 - T.k) * (Math.PI - 1.9);   // as the switches: the bat up (on) or down
        if (T.on !== on) { T.led.material = on ? amberOn : ledOff; T.on = on; }
      }
      for (const [id, B] of Object.entries(PR.buttons)) {
        const on = !!P3.lit?.[id];
        if (B.on !== on) { B.on = on; B.ring.material = on ? amberOn : ringOff; B.cap.position.z = on ? 0.006 : 0.008; moved = true; }
      }
    }
    for (const side of ['jib', 'main']) { const v = s.hideWinch?.[side] !== true; if (winchAt[side].visible !== v) { winchAt[side].visible = v; moved = true; } }
    // the instruments: shown (?dials=top hides them), their backlight brighter while it matters (glow ≥ 1)
    const IN = built.inst, show = s.inst?.show !== false;
    if (IN && IN.g.visible !== show) { IN.g.visible = show; moved = true; }
    let gl = false;
    for (const side of ['chart', 'wind']) { const v = Math.max(1, s.inst?.glow?.[side] ?? 1); if (Math.abs(v - glow[side]) > 1e-3) { glow[side] = v; gl = true; } }
    if (gl) { faceLight(); moved = true; }
    return moved;
  }
  // a face's canvas was redrawn: its texture goes up with the next draw
  function faceDrawn(side) { if (faceTex[side]) faceTex[side].needsUpdate = true; }
  // the compass card follows the heading (the root turns with the boat for the sun; the card turns back by the heading)
  function heading(rad) { if (card) card.rotation.z = rad; }

  // the boat's own wheel, winches and sheets, shared with the boat: dressed in the cockpit's materials while they stand in it (the
  // stainless brushed, the drums knurled, the sheets braided), their own given back by undress() (the grid form, dispose)
  const dressed = new Map();
  function dress() {
    const swap = (o, m) => { if (!dressed.has(o)) dressed.set(o, o.material); o.material = m; };
    wheel.traverse((o) => { if (o.isMesh && /stainless|chrome/.test(o.material?.name ?? '')) swap(o, steel); });
    for (const side of ['jib', 'main']) {
      const W = winches[side];
      W.item.traverse((o) => {
        if (!o.isMesh) return;
        const n = dressed.get(o)?.name ?? o.material?.name ?? '';
        if (/chrome/.test(n)) swap(o, mats.winchDrum(W.spec)); else if (/stainless/.test(n)) swap(o, steel);
      });
      if (W.run) for (const r of [W.turns, W.tail]) if (r) swap(r, mats.rope(W.run));
    }
  }
  function undress() { for (const [o, m] of dressed) o.material = m; dressed.clear(); }

  let tris = 0, meshes = 0;
  const count = () => { tris = 0; meshes = 0; root.traverse((o) => { if (o.isMesh) { meshes++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } }); return { tris: Math.round(tris), meshes }; };
  // the sink depth that puts the cap's top at the screen's foot (the peek): from the view's own projection
  const peekSink = () => {
    if (!view) return 0.5;
    // the sink s for which the cap's top (y = CH + CAPT − 2 s at z −1.6) lands 4 % of the height over the screen's foot
    let lo = 0, hi = 1;
    const F = COCKPIT.fold, Y = COCKPIT.CH + COCKPIT.CAPT, Z = -1.6;
    const at = (m) => { const a = -m * F.tilt; return { y: Y * Math.cos(a) - Z * Math.sin(a) - F.sink * m, z: Y * Math.sin(a) + Z * Math.cos(a) }; };
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (view.y(at(m)) < view.h * 0.97) lo = m; else hi = m; }
    return lo;
  };
  return {
    root, content, camera, helm, anchors, layout, set, heading, setNight, count, peekSink, faceDrawn,
    attach() { wheelAt.add(wheel); for (const side of ['jib', 'main']) winchAt[side].add(winches[side].item); dress(); },
    detach: undress,
    // the deck lamp (hud3d's fill, set for this frame): its directional share drops, its energy goes into the diffuse bounce
    light(lamp, level) { rig.apply(lamp, { night: nightK, ...level }); },
    get rect() { return rect; }, get view() { return view; }, get parts() { return built; },
    get faces() { return { tex: faceTex, mat: faceMat, glow: { ...glow } }; },
    dispose() { undress(); mats.dispose(); shell?.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); for (const t of Object.values(faceTex)) t.dispose(); for (const side of ['jib', 'main']) winchAt[side].remove(winches[side].item); wheelAt.remove(wheel); },
  };
}
