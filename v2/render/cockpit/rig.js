// The cockpit's rig (M4, pure: no DOM, no GPU): v1's cockpit3d.js set() replayed on the baked nodes (asset.js), the wheel and
// the winches as helmStation.js turns them, the compass card on the heading, the PRO cover's baked frames, the camera
// (v1's cockpitView, src/stations/sloop/cockpitView.js) and the projections the station's hit layer reads. It owns the
// material state too (which LED or ring material a mesh wears, the lit amber, the label maps by day and night, the faces'
// backlight), so the GPU side (render/cockpit.js) only uploads what changed: rig.dirty.{nodes, mats, cover}.
//   const rig = createCockpitRig(json, { coverFrames })
//   rig.layout({ w, h, phone }) → { view, rect }; rig.set(states, dt) → moved; rig.wheel(a); rig.winch(side, { drum, fly, run }); rig.heading(h)
//   rig.project(name) | rig.projectRest(name) | rig.projectPart(role, [x, y, z]) → { x, y } css px
//   rig.slotCam(key, cam, rect) → { vp, camPos, yaw, root, rect }; rig.projectSlot(key, role, [x, y, z]) → { x, y } css px (an upright phone's slots)
//   rig.world (Float32Array 16 × nodes), rig.drawn (visible per node), rig.matOf (material per mesh), rig.matState (per material)
import { composeNodes, setRotation } from './asset.js';
import { COCKPIT, cockpitView } from '../../../src/stations/sloop/cockpitView.js';
import { perspectiveReversed, multiply, mat4, lookDir } from '../../engine/math.js';

const DEG = Math.PI / 180;
export const LAMP_LIFT = 0.003;   // m: a switch lamp's lift off its plate (below)
export const CK_NEAR = 3, CK_FAR = 40;
// the anchorage cue (owner, 2026-11-18): inside a charted anchorage, or by a free mooring ball, the ANCHOR lamp glows
// faintly: amberOn's own material at this share of its glow (amber is the lit colour; a faint lamp is not "on")
export const CUE_GLOW = 0.3;   // cockpit3d.js layout(): everything on screen is 6.5 to 12 m away
const toward = (v, to, dt, rate) => (Math.abs(to - v) < 1e-4 ? to : v + Math.sign(to - v) * Math.min(Math.abs(to - v), dt * rate));

export function createCockpitRig(json, { coverFrames = null } = {}) {
  const R = json.roles, A = json.anchors;
  // the cue's faint lamp: a copy of amberOn appended once to the asset's materials (the GPU side sizes its table after the rig)
  if (R.amberOn != null && R.amberFaint == null) { json.materials.push({ ...json.materials[R.amberOn], name: 'amberFaint' }); R.amberFaint = json.materials.length - 1; }
  const nodes = json.nodes.map((n) => ({ ...n, p: [...n.p], q: [...n.q], s: [...n.s], r: [...(n.r ?? [0, 0, 0])] }));
  const base = json.nodes;
  // the switches' lamps sit 0.8 mm off the plate in the bake (v1's cockpit3d.js toggleOn): inside the cockpit's narrow depth band
  // that loses to the plate, so a lit lamp (amberOn) showed only where it happened to win (SAILS), never ANCHOR's or REEF's
  // (2026-11-16); lifted LAMP_LIFT m along the plate's normal (the node's own z), still under its steel bezel's front
  for (const L of [...Object.values(R.toggles ?? {}).map((t) => t.led), R.pro?.toggle?.led]) if (L != null && nodes[L]) nodes[L].p[2] += LAMP_LIFT;
  const world = new Float32Array(16 * nodes.length), work = new Float64Array(16 * nodes.length);
  const visible = new Uint8Array(nodes.length);
  const matOf = json.meshes.map((m) => m.mat);
  const meshOfNode = new Map(); json.meshes.forEach((m, i) => meshOfNode.set(m.node, i));
  // per material: emissive scale and map rect override (labels by night), colour scale (the faces' backlight, a night plate)
  const matState = json.materials.map((m) => ({ emissive: m.emissiveIntensity ?? 1, emissiveColor: m.emissive ? [...m.emissive] : [0, 0, 0], colorScale: 1, map: m.map, emissiveMap: m.emissiveMap, run: 0 }));
  if (R.amberFaint != null) matState[R.amberFaint].emissive *= CUE_GLOW;   // faint before the first setNight too
  const dirty = { nodes: true, mats: true, cover: false };
  const mark = () => { dirty.nodes = true; };
  const setVis = (i, v) => { if (i == null) return false; if (nodes[i].visible === v) return false; nodes[i].visible = v; mark(); return true; };
  const setMat = (node, mat) => { const mi = meshOfNode.get(node); if (mi == null || matOf[mi] === mat) return false; matOf[mi] = mat; dirty.mats = true; return true; };

  // ---- the camera (cockpit3d.js layout) ----
  let view = null, rect = null, phoneNow = false, W = 1, Hh = 1;
  const camView = mat4(), proj = mat4(), vp = mat4(), camPos = [0, 0, 0];
  function layout({ w, h, phone = false }) {
    view = cockpitView({ w, h, phone }); phoneNow = phone; W = w; Hh = h;
    camPos[0] = 0; camPos[1] = view.yc; camPos[2] = COCKPIT.camZ;
    // the view: the camera at (0, yc, camZ) pitched down th (rotation.x = −th), looking down −z
    const c = Math.cos(view.th), s = Math.sin(view.th);
    // inverse of T(camPos) · Rx(−th): Rx(th) · T(−camPos)
    camView.fill(0);
    camView[0] = 1; camView[5] = c; camView[6] = s; camView[9] = -s; camView[10] = c; camView[15] = 1;
    camView[12] = 0; camView[13] = -(c * camPos[1] - s * camPos[2]); camView[14] = -(s * camPos[1] + c * camPos[2]);
    perspectiveReversed(proj, view.vfov, w / h, CK_NEAR, CK_FAR);
    multiply(vp, proj, camView);
    const top = Math.max(0, Math.floor(view.y({ y: 1.15, z: -1.6 }) - 8));
    rect = { x: 0, y: top, w, h: h - top };
    restAt = null;
    return { view, rect };
  }

  // ---- the states (cockpit3d.js set()) ----
  const toggles = Object.fromEntries(Object.keys(R.toggles).map((id) => [id, { k: -1, on: null }]));
  const proT = { k: -1, on: null };
  let reefWordK = -1, proK = -1, moorSt, tackKey = null, toolKey = {}, sliderF = {}, sliderHv = {}, nightK = -1, expNow = 1, coverE = -1, sinkNow = -1;
  const glow = { chart: 1, wind: 1 };
  let helmShown = true;
  function setNight(k, exp) {
    if (Math.abs(k - nightK) < 1e-3 && Math.abs(exp - expNow) / Math.max(1e-6, exp) < 0.05) return false;
    nightK = k; expNow = exp;
    const e = 1 / Math.max(1e-6, exp);
    for (const L of R.labels) {
      if (L.cap) continue;
      const nn = k >= 0.5, floor = L.plate && !nn, S = matState[L.mat];
      S.map = nn ? L.night : L.day; S.emissiveMap = floor ? L.day : L.night;
      S.emissiveColor = floor ? [1, 1, 1] : [1, 0.3564, 0.2159];   // INK.night #FF9F80, linear
      S.emissive = nn && L.plate ? 1.3 * e : floor ? (L.floorK ?? COCKPIT.wordFloor) * e : 0;
      S.colorScale = nn && L.plate ? 0.08 : 1;
    }
    matState[R.cardMat].emissive = 0.12 * k * e;
    matState[R.amberOn].emissive = (2.2 - 1.0 * k) * Math.min(1, 6 * e / 6);
    if (R.amberFaint != null) matState[R.amberFaint].emissive = matState[R.amberOn].emissive * CUE_GLOW;
    faceLight();
    dirty.mats = true;
    return true;
  }
  function faceLight() {
    const e = 1 / Math.max(1e-6, expNow);
    for (const side of ['chart', 'wind']) matState[R.inst[side].faceMat].colorScale = (COCKPIT.faceGain[0] * (1 - nightK) + COCKPIT.faceGain[1] * nightK) * glow[side] * e;
    dirty.mats = true;
  }
  function set(s, dt = 0) {
    let moved = false;
    if (helmShown !== !s.helm) { helmShown = !s.helm; setVis(R.helm, helmShown); moved = true; }
    for (const [id, T] of Object.entries(toggles)) {
      const rot = !!R.toggles[id].rotary;   // REEF's rotary selector: k 0, ⅓, ⅔, 1 = A, 0, 1, 2; the lamp is lit on A
      const v = s.toggles?.[id], to = typeof v === 'number' ? Math.max(0, Math.min(1, v)) : v ? 1 : 0, on = (rot ? to < 0.01 : typeof v === 'number' ? to >= 1 : to > 0) || (id === 'reef' && !!s.reefWarn), was = T.k;   // K2: the knockdown's warning lights REEF's lamp   // a number: the REEF selector (0, ⅓, ⅔ for the reefs 0, 1, 2; 1 = A, auto, lit amber)
      T.k = T.k < 0 ? to : toward(T.k, to, dt, 8); if (T.k !== was) moved = true;
      if (T.k !== was) { if (rot) setRotation(nodes, R.toggles[id].pivot, 'z', -(-120 + 240 * T.k) * DEG); else setRotation(nodes, R.toggles[id].pivot, 'x', 0.95 + (1 - T.k) * (Math.PI - 1.9)); mark(); }
      const lamp = on ? 'on' : s.cue?.[id] && R.amberFaint != null ? 'cue' : 'off';   // s.cue.anchor: the anchorage cue's faint glow while the toggle is off
      if (T.on !== lamp) { setMat(R.toggles[id].led, lamp === 'on' ? R.amberOn : lamp === 'cue' ? R.amberFaint : R.ledOff); T.on = lamp; moved = true; }
    }
    if (R.reefWords?.length) { const k = Math.round((s.toggles?.reef ?? 1 / 3) * 3); if (k !== reefWordK) { reefWordK = k; R.reefWords.forEach((n, i) => setVis(n, i === k)); moved = true; } }   // REEF · AUTO | 0 | 1 | 2 under the selector
    const mo = s.moor ?? null, P2 = R.moor;
    if (moorSt !== mo) { moorSt = mo; setVis(P2.g, !!mo); setVis(P2.lines, mo === 'lines'); setVis(P2.dawn, mo === 'dawn'); if (P2.plate != null) setVis(P2.plate, !!mo); moved = true; }
    const keyTo = s.engine === 'cranking' ? 0.75 : s.engine === 'running' ? 0 : -0.65, kn = nodes[R.key];
    const kz = toward(-kn.r[2], keyTo, dt, 6); if (kz !== -kn.r[2]) { setRotation(nodes, R.key, 'z', -kz); mark(); moved = true; }
    for (const [id, T] of Object.entries(R.tools ?? {})) {
      const pn = nodes[T.ring]?.parent; if (pn != null && pn >= 0) moved = setVis(pn, s.hideTool?.[id] !== true) || moved;   // s.hideTool: a tool's push-button (its ring and cap) off the face (v2: no binoculars for a finger)
      const on = !!s.pro?.lit?.[id], hv = s.hover === id, k2 = `${on}|${hv}`;
      if (toolKey[id] !== k2) { toolKey[id] = k2; setMat(T.ring, on ? R.amberOn : R.ringOff); matState[T.capMat].emissive = hv ? 0.25 : 0; dirty.mats = true; moved = true; }
    }
    const la = -(s.lever ?? 0) * 0.6 - 0.08;
    if (Math.abs(la - nodes[R.stem].r[0]) > 1e-3) { setRotation(nodes, R.stem, 'x', la); mark(); moved = true; }
    const T2 = R.tack, offer = !!s.tack?.offer, active = !!s.tack?.active, gybe = s.tack?.kind === 'gybe', tkey = `${offer}|${active}|${gybe}`;
    if (T2 && tackKey !== tkey) { tackKey = tkey; setMat(T2.ring, offer || active ? R.amberOn : R.ringOff); nodes[T2.cap].p[1] = active ? 0.012 : 0.02; mark(); setVis(T2.tack, !gybe); setVis(T2.gybe, gybe); moved = true; }
    if (s.night != null) moved = setNight(s.night, s.exposure ?? expNow) || moved;
    // the fold: the whole object tips away and sinks (cockpit3d.js COCKPIT.fold)
    const sk = s.sink ?? 0;
    if (Math.abs(sk - sinkNow) > 1e-5) { sinkNow = sk; const c = nodes[R.content]; c.p[1] = -sk * COCKPIT.fold.sink; setRotation(nodes, R.content, 'x', -sk * COCKPIT.fold.tilt); mark(); moved = true; }
    // the PRO recess: the cover (its baked frames), the cars on their values, the ribs' glow, PRO's toggle
    if (R.pro) {
      const P3 = s.pro ?? {}, to = P3.open ? 1 : 0;
      const k = proK < 0 ? to : toward(proK, to, dt, 1 / COCKPIT.pro.openS);
      if (k !== proK) { proK = k; cover(k * k * (3 - 2 * k)); moved = true; }
      for (const [id, S3] of Object.entries(R.pro.sliders)) {
        const f = Math.min(1, Math.max(0, P3.f?.[id] ?? 0.5));
        if (sliderF[id] == null || Math.abs(f - sliderF[id]) > 2e-4) { sliderF[id] = f; nodes[S3.car].p[0] = base[S3.car].p[0] + (f - 0.5) * S3.travel; mark(); moved = true; }
        const hv = s.hover === id;
        if (sliderHv[id] !== hv) { sliderHv[id] = hv; matState[S3.ridgeMat].emissive = hv ? COCKPIT.carHover : 0; dirty.mats = true; moved = true; }
      }
      if (R.pro.toggle) {
        const T = proT, was = T.k, on = !!P3.open;
        T.k = T.k < 0 ? (on ? 1 : 0) : toward(T.k, on ? 1 : 0, dt, 8); if (T.k !== was || T.on !== on) moved = true;
        if (T.k !== was) { setRotation(nodes, R.pro.toggle.pivot, 'x', 0.95 + (1 - T.k) * (Math.PI - 1.9)); mark(); }
        if (T.on !== on) { setMat(R.pro.toggle.led, on ? R.amberOn : R.ledOff); T.on = on; }
      }
    }
    for (const side of ['jib', 'main']) moved = setVis(R.winch[side].at, s.hideWinch?.[side] !== true) || moved;
    if (R.inst) moved = setVis(R.inst.g, s.inst?.show !== false) || moved;
    let gl = false;
    for (const side of ['chart', 'wind']) { const v = Math.max(1, s.inst?.glow?.[side] ?? 1); if (Math.abs(v - glow[side]) > 1e-3) { glow[side] = v; gl = true; } }
    if (gl) { faceLight(); moved = true; }
    return moved;
  }
  // the cover's frames at e (cockpit3d.js PR.cover: vertices along the coaming's curve; the cars and words show past 0.02)
  const CV = json.cover, coverPos = CV ? CV.vertexCounts.map((n) => new Float32Array(3 * n)) : [];
  function cover(e) {
    if (!CV) return;
    coverE = e;
    const f = Math.min(CV.e.length - 1 - 1e-6, Math.max(0, e * (CV.e.length - 1))), i0 = Math.floor(f), t = f - i0, per = CV.vertexCounts.reduce((a, n) => a + 3 * n, 0);
    let o = 0;
    for (let m = 0; m < CV.meshNodes.length; m++) {
      const n3 = 3 * CV.vertexCounts[m], a = i0 * per + o, b = a + per;
      for (let k = 0; k < n3; k++) coverPos[m][k] = coverFrames ? coverFrames[a + k] * (1 - t) + coverFrames[b + k] * t : 0;
      o += n3;
    }
    const ix = Math.round(e * (CV.e.length - 1));
    for (const v of CV.visibility) setVis(v.node, v.on[ix]);
    dirty.cover = true;
  }
  // the wheel and the winches (helmStation.js update())
  function wheel(wa) { const n = R.wheelSpin; if (Math.abs(nodes[n].r[2] + wa) > 1e-5) { setRotation(nodes, n, 'z', -wa); mark(); } }
  function winch(side, { drum = 0, fly = 0, run = 0 } = {}) {
    const W = R.winch[side];
    if (Math.abs(nodes[W.spin].r[1] + drum) > 1e-5) { setRotation(nodes, W.spin, 'y', -drum); mark(); }
    const tl = nodes[W.tail];
    if (Math.abs(tl.r[1] + 2.4 * fly) > 1e-5) { setRotation(nodes, W.tail, 'y', -2.4 * fly); tl.p[1] = base[W.tail].p[1] + 0.05 * fly; mark(); }
    setVis(W.tail, fly < 0.97); setVis(W.turns, fly < 0.5);
    const hd = nodes[W.hd]; if (Math.abs(hd.p[1] - (base[W.hd].p[1] + 0.08 * fly)) > 1e-6) { hd.p[1] = base[W.hd].p[1] + 0.08 * fly; mark(); }
    setVis(W.hd, fly < 0.6);
    const rm = side === 'jib' ? 11 : 14;   // the sheet's rope material (the tail's fleck runs with it)
    if (json.materials[rm]?.name === 'ck_rope' && matState[rm].run !== run) { matState[rm].run = run; dirty.mats = true; }
  }
  let headingNow = 0;
  function heading(h) { headingNow = h; if (R.card != null && Math.abs(nodes[R.card].r[2] - h) > 1e-4) { setRotation(nodes, R.card, 'z', h); mark(); } }

  // ---- composing and projecting ----
  function compose() {
    if (!dirty.nodes && !composedOnce) return;
    composeNodes(nodes, world, work);
    for (let i = 0; i < nodes.length; i++) { const p = nodes[i].parent; visible[i] = nodes[i].visible && (p < 0 || visible[p]) ? 1 : 0; }
    composedOnce = false;
  }
  let composedOnce = true;
  const toScreen = (x, y, z) => {
    const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12], cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13], cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    return { x: (cx / cw + 1) / 2 * W, y: (1 - cy / cw) / 2 * Hh };
  };
  const pointOf = (m, o, p) => [m[o] * p[0] + m[o + 4] * p[1] + m[o + 8] * p[2] + m[o + 12], m[o + 1] * p[0] + m[o + 5] * p[1] + m[o + 9] * p[2] + m[o + 13], m[o + 2] * p[0] + m[o + 6] * p[1] + m[o + 10] * p[2] + m[o + 14]];
  function project(name) { compose(); const i = A[name]; const o = 16 * i; return toScreen(world[o + 12], world[o + 13], world[o + 14]); }
  function projectPart(role, p = [0, 0, 0]) {
    compose();
    const [kind, side, part] = role.split('.');
    const i = kind === 'winch' ? R.winch[side][part] : R[role];
    const q = pointOf(world, 16 * i, p); return toScreen(q[0], q[1], q[2]);
  }
  // an anchor with the content at rest (no sink): the fold mark's place, the instruments' boxes while folded
  let restAt = null;
  function projectRest(name) {
    if (!restAt) {
      const c = nodes[R.content], py = c.p[1], rx = c.r[0];
      c.p[1] = 0; setRotation(nodes, R.content, 'x', 0);
      const wv = composeNodes(nodes);
      restAt = {};
      for (const [k, i] of Object.entries(A)) { const o = 16 * i; restAt[k] = toScreen(wv[o + 12], wv[o + 13], wv[o + 14]); }
      c.p[1] = py; setRotation(nodes, R.content, 'x', rx);
    }
    return restAt[name];
  }
  // the sink that puts the cap's top 4 % over the screen's foot (cockpit3d.js peekSink)
  function peekSink() {
    if (!view) return 0.5;
    let lo = 0, hi = 1;
    const F = COCKPIT.fold, Y = COCKPIT.CH + COCKPIT.CAPT, Z = -1.6;
    const at = (m) => { const a = -m * F.tilt; return { y: Y * Math.cos(a) - Z * Math.sin(a) - F.sink * m, z: Y * Math.sin(a) + Z * Math.cos(a) }; };
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (view.y(at(m)) < view.h * 0.97) lo = m; else hi = m; }
    return lo;
  }
  // ---- an upright phone's slots (helmStation.js's grid form: the wheel and each winch alone in its own small view) ----
  // v1 renders its own wheel and winch items there through a camera fixed in the item's frame (wheelCam, the winch's cam). The
  // bake keeps those items (hud:wheel, hud:winch-jib, hud:winch-main) inside the cockpit, so a slot is the same item seen
  // through v1's camera placed in that item's frame: eye, target and up through the item's world matrix, near and far by its
  // scale. yaw: the item's turn in the cockpit frame (the light turns by heading + yaw, as v1's item turns by −heading alone)
  const itemNode = { wheel: base[R.wheelSpin].parent, jib: R.winch.jib.item, main: R.winch.main.item };
  const slotStore = {};
  function slotCam(key, cam, rect) {
    compose();
    const i = itemNode[key], o = 16 * i, m = world;
    const eye = pointOf(m, o, cam.eye), tg = pointOf(m, o, cam.target);
    const sc = Math.hypot(m[o], m[o + 1], m[o + 2]) || 1;
    const up = [m[o + 4] / sc, m[o + 5] / sc, m[o + 6] / sc];
    const fx = tg[0] - eye[0], fy = tg[1] - eye[1], fz = tg[2] - eye[2], fl = Math.hypot(fx, fy, fz) || 1;
    const S = slotStore[key] ??= { view: mat4(), proj: mat4(), vp: mat4(), camPos: [0, 0, 0], yaw: 0, root: i, rect: null, key };
    lookDir(S.view, eye, [fx / fl, fy / fl, fz / fl], up);
    perspectiveReversed(S.proj, cam.fovDeg * DEG, rect.w / Math.max(1, rect.h), cam.near * sc, cam.far * sc);
    multiply(S.vp, S.proj, S.view);
    S.camPos[0] = eye[0]; S.camPos[1] = eye[1]; S.camPos[2] = eye[2];
    S.yaw = Math.atan2(m[o + 8], m[o + 10]); S.rect = { ...rect };
    return S;
  }
  // a point in a node's own frame (role as projectPart's, or 'wheel.item') onto its slot's rect, css px
  function projectSlot(key, role, p = [0, 0, 0]) {
    compose();
    const S = slotStore[key]; if (!S) return null;
    const [kind, side, part] = role.split('.');
    const i = kind === 'winch' ? R.winch[side][part] : kind === 'wheel' ? itemNode.wheel : R[role];
    const q = pointOf(world, 16 * i, p), v = S.vp;
    const cx = v[0] * q[0] + v[4] * q[1] + v[8] * q[2] + v[12], cy = v[1] * q[0] + v[5] * q[1] + v[9] * q[2] + v[13], cw = v[3] * q[0] + v[7] * q[1] + v[11] * q[2] + v[15];
    return { x: S.rect.x + (cx / cw + 1) / 2 * S.rect.w, y: S.rect.y + (1 - cy / cw) / 2 * S.rect.h };
  }
  const grip = (side) => R.winch[side].grip;
  return {
    json, nodes, world, visible, matOf, matState, dirty, coverPos, compose, layout, slotCam, projectSlot, itemNode, set, wheel, winch, heading, project, projectRest, projectPart, peekSink, grip, cover,
    get view() { return view; }, get rect() { return rect; }, get vp() { return vp; }, get camPos() { return camPos; }, get headingNow() { return headingNow; }, get phone() { return phoneNow; },
    get anchorNames() { return Object.keys(A); }, has: (n) => A[n] != null,
    parts: { inst: !!R.inst, pro: !!R.pro }, get count() { return { tris: json.tris, meshes: json.meshes.length }; },
    get drawn() { return { wheel: -nodes[R.wheelSpin].r[2], main: -nodes[R.winch.main.spin].r[1], jib: -nodes[R.winch.jib.spin].r[1] }; },
    get sink() { return sinkNow; }, get proK() { return proK; }, get coverE() { return coverE; },
  };
}
