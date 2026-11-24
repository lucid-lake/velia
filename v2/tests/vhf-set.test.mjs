// #35: v1's VHF set on v2's pedestal (render/boatInstruments.js: the face, the body and the strap in the vhf slot; ui/captain.js
// createLcd: the LCD's view from the radio's state). Against v1's own three model (src/boat/vhf.js createVhf, built here on a
// stub canvas): the set sits where v1's sits (the face's corners, the body's and the strap's boxes, to 1e-6 m in the HULL
// frame), with v1's materials; and the LCD shows what v1's shows, frame for frame, through a whole forecast and a harbour call
// (v1's captainTools.update tail fed the same radio state).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createVhf, VHF, lcdView } from '../../classic/src/boat/vhf.js';
import { faceMesh, solidMesh, vhfLocal, VHF_LOOK } from '../render/boatInstruments.js';
import { createCaptain, createLcd } from '../ui/captain.js';
import { hexLinear } from '../render/boat/models.js';
import { mat4 } from '../engine/math.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { sailWindOptions } from '../sim/wind.js';
import { heightAt } from './helpers/ground.mjs';

const DEG = Math.PI / 180;
// a canvas that takes every 2D call (v1's createVhf draws its idle face at once)
const ctx2d = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
function v1Set() {
  const had = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
  try { const v = createVhf(); v.group.updateMatrixWorld(true); return v; } finally { if (had === undefined) delete globalThis.document; else globalThis.document = had; }
}
const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const closeTo = (a, b, e, why) => a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= e, `${why}: ${a.map((v) => v.toFixed(5))} vs ${b.map((v) => v.toFixed(5))}`));

test('the set is placed as v1\'s: the face\'s corners, the body\'s and the strap\'s boxes in the HULL frame, and v1\'s materials', () => {
  const v1 = v1Set(), L = vhfLocal(mat4());
  // the set's frame: v1's set group (VHF.at, rotation.x −22°)
  closeTo([...L], v1.set.matrixWorld.elements, 1e-6, 'the set\'s frame');
  // the face: the quad's 4 corners against v1's PlaneGeometry through its mesh's world matrix
  const fm = faceMesh(), r = fm.ranges.vhf;
  const quad = new Set(); for (let i = r.first; i < r.first + r.count; i++) quad.add(fm.index[i]);
  const ours = [...quad].map((k) => apply(L, [fm.position[3 * k], fm.position[3 * k + 1], fm.position[3 * k + 2]])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pg = v1.face.geometry.attributes.position, fw = v1.face.matrixWorld.elements;
  const theirs = [0, 1, 2, 3].map((k) => apply(fw, [pg.getX(k), pg.getY(k), pg.getZ(k)])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  ours.forEach((p, i) => closeTo(p, theirs[i], 1e-6, `face corner ${i}`));
  // the face looks up and aft, toward the helm's eye
  const n = [0, 1, 2].map((i) => L[8 + i]); closeTo(n, [0, Math.sin(22 * DEG), Math.cos(22 * DEG)], 1e-6, 'the face\'s normal');
  // the body and the strap: each box's 8 corners against v1's BoxGeometry through its mesh
  const sm = solidMesh(), [body, strap] = v1.set.children.filter((c) => c.geometry?.type === 'BoxGeometry');
  const corners = (m) => { const g = m.geometry.parameters, w = m.matrixWorld.elements, out = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) out.push(apply(w, [sx * g.width / 2, sy * g.height / 2, sz * g.depth / 2]));
    return out.map((p) => p.map((x) => +x.toFixed(6)).join(',')).sort(); };
  const vr = sm.vhf, verts = new Set(); for (let i = vr.first; i < vr.first + vr.count; i++) verts.add(sm.index[i]);
  const ourPts = new Set([...verts].map((k) => apply(L, [sm.position[3 * k], sm.position[3 * k + 1], sm.position[3 * k + 2]]).map((x) => +x.toFixed(6)).join(',')));
  assert.equal(ourPts.size, 16, 'two boxes, 8 corners each');
  for (const p of [...corners(body), ...corners(strap)]) assert.ok(ourPts.has(p), `v1's corner ${p} is ours`);
  // the materials: the body MeshStandard 0x1b1e22 roughness 0.55 metal 0; the strap 0x9aa0a6 metal 0.9 roughness 0.35
  assert.equal(body.material.color.getHex(), VHF_LOOK.body); assert.equal(body.material.roughness, VHF_LOOK.bodyRough); assert.equal(body.material.metalness, 0);
  assert.equal(strap.material.color.getHex(), VHF_LOOK.strap); assert.equal(strap.material.roughness, VHF_LOOK.strapRough); assert.equal(strap.material.metalness, VHF_LOOK.strapMetal);
  const lin = (k) => [...sm.color.slice(3 * k, 3 * k + 3)];
  const ks = [...verts].sort((a, b) => a - b);
  closeTo(lin(ks[0]), hexLinear(VHF_LOOK.body), 1e-6, 'the body\'s colour'); closeTo(lin(ks.at(-1)), hexLinear(VHF_LOOK.strap), 1e-6, 'the strap\'s colour');
  assert.deepEqual([...sm.mr.slice(2 * ks[0], 2 * ks[0] + 2)].map((x) => +x.toFixed(3)), [0, 0.55]);
  assert.deepEqual([...sm.mr.slice(2 * ks.at(-1), 2 * ks.at(-1) + 2)].map((x) => +x.toFixed(3)), [0.9, 0.35]);
  // v1's face is unlit (MeshBasic) and its canvas 320 × 184
  assert.equal(v1.face.material.type, 'MeshBasicNodeMaterial'); assert.deepEqual(VHF.px, [320, 184]);
  // on the pedestal guard (its top 1.15–1.25 m at z 2.33, blender/m3_cockpit.py), starboard of the pod, clear of the binnacle
  const strapBottom = Math.min(...corners(strap).map((p) => +p.split(',')[1]));
  assert.ok(strapBottom > 1.15 && strapBottom < 1.25, `the strap on the guard's top (${strapBottom.toFixed(3)} m)`);
  assert.ok(VHF.at[0] > 0.12, 'starboard of the pod and the binnacle');
});

// v1's captainTools.update tail (src/sail/captainTools.js: the LCD's line follows the voice) on a radio state
function v1Lcd(vhf, channel, st, text, rx, kick, dt) {
  const plan = st.plan;
  let charAt = null;
  if (st.playing && plan && st.token >= 0) {
    const it = plan.items.find((i) => i.token === st.token), c0 = plan.charAt[st.token], c1 = plan.charAt[st.token + 1] ?? text.length;
    charAt = c0 + Math.min(1, Math.max(0, (st.at - it.at) / it.dur)) * (c1 - c0);
  }
  vhf.update({ channel, text, charAt, rx }, kick ? 1 : dt);
}

test('the LCD shows what v1\'s shows, frame for frame: the channel, RX, the spoken words scrolling at v1\'s rate', () => {
  const v1 = v1Set(), lcd = createLcd();
  const text = 'Lake forecast for this afternoon. Southwest 8 to 12 knots, gusts to 15.';
  const words = text.split(' ');
  let c = 0; const charAt = words.map((w) => { const a = c; c += w.length + 1; return a; });
  const plan = { items: words.map((w, i) => ({ id: w, at: i * 0.5, dur: 0.5, token: i })), charAt, dur: words.length * 0.5 + 0.3 };
  const st = { playing: false, chatter: false, at: 0, token: -1, plan: null };
  const key = () => `${lcd.out.view.big}|${lcd.out.view.tag}|${lcd.out.view.line}`;
  let lastRx = false, changes = 0, n0 = lcd.out.n, seen = new Set();
  const frame = (channel, dt) => {
    if (st.playing) { st.at += dt; let k = -1; for (const it of plan.items) if (it.at <= st.at) k = it.token; st.token = k; if (st.at >= plan.dur) { st.playing = false; st.token = -1; } }
    const rx = st.playing || st.chatter;
    v1Lcd(v1, channel, st, text, rx, rx !== lastRx, dt); lastRx = rx;
    if (lcd.step(channel, st, text, dt)) changes++;
    assert.equal(key(), v1.lcd, `t ${st.at.toFixed(2)}: v2 shows what v1 shows`);
    seen.add(lcd.out.view.line.trim());
  };
  for (let i = 0; i < 30; i++) frame('16', 1 / 60);
  assert.equal(lcd.out.view.big, '16'); assert.equal(lcd.out.view.tag, ''); assert.equal(lcd.out.view.line.trim(), '');
  st.plan = plan; st.playing = true; st.at = 0; st.token = -1;
  let frames = 0;
  while (st.playing) { frame('WX 1', 1 / 60); frames++; if (lcd.out.view.tag) assert.equal(lcd.out.view.big, 'WX 1'); }
  assert.ok([...seen].some((l) => l.includes('SOUTHWEST')), 'the forecast\'s words on the LCD, upper case');
  assert.ok([...seen].some((l) => l.includes('GUSTS')), 'scrolled to the end');
  // at most VHF.hz redraws a second (plus RX's two switches)
  assert.ok(changes <= Math.ceil((frames / 60) * VHF.hz) + 2, `${changes} redraws over ${(frames / 60).toFixed(1)} s`);
  assert.equal(lcd.out.n - n0, changes, 'n moves only on a change');
  for (let i = 0; i < 30; i++) frame('16', 1 / 60);
  assert.equal(lcd.out.view.tag, '', 'RX off once the voice ends'); assert.equal(lcd.out.view.line.trim(), '');
});

test('the captain drives the LCD from v2\'s radio: WX 1 and the forecast\'s words while it plays, the harbour call, back to 16', () => {
  const log = [], state = { playing: false, chatter: false, at: 0, token: -1, plan: null };
  const makeRadio = () => ({ state, ready: Promise.resolve(null),
    plan: (tokens) => { let c = 0; const charAt = tokens.map((t) => { const a = c; c += 1 + (t.show ?? t.say ?? '').length; return a; }); return { tokens, items: tokens.map((t, i) => ({ id: t.id, at: i * 0.4, dur: 0.4, token: i })), dur: tokens.length * 0.4 + 0.3, charAt }; },
    play(p) { state.plan = p; state.playing = true; state.at = 0; state.token = -1; log.push('play'); },
    stop() { state.playing = false; state.token = -1; },
    update(dt) { if (state.playing) { state.at += dt; let k = -1; for (const it of state.plan.items) if (it.at <= state.at) k = it.token; state.token = k; if (state.at >= state.plan.dur) { state.playing = false; state.token = -1; } } return state; },
    chatter() { return false; } });
  const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 15, rate: 0 }) }); w.setTerrain(heightAt);
  const B = { t: 0, vessel: CURRENT_VESSEL, pose: { x: 1200, z: -1050, heading: 0 }, state: { x: 1200, z: -1050, trueWind: { speed: 4 } } };
  const mem = new Map(), settings = { get: (k) => mem.get(k), set: (k, v) => mem.set(k, v), on: () => () => {} };
  const cap = createCaptain({ B, windField: w, terrain: { field: { height: heightAt } }, settings, live: true, dom: false, auto: false, makeRadio, flags: { chatter: false, hm: false } });
  assert.deepEqual(cap.lcd.view, lcdView({}), 'idle: v1\'s idle face (16)');
  cap.listen();
  let lines = new Set(), i = 0;
  while (!state.playing && i++ < 60) cap.update(1 / 60);
  assert.ok(state.playing, 'the forecast plays');
  const text = cap.forecast.text.toUpperCase();
  while (state.playing) { cap.update(1 / 60); const v = cap.lcd.view; if (v.tag === 'RX') { assert.equal(v.big, 'WX 1'); lines.add(v.line.trim()); } }
  assert.ok(lines.size > 10, `the line scrolled (${lines.size} views)`);
  for (const l of lines) if (l) assert.ok(text.includes(l), `"${l}" is a window of the forecast's text`);
  for (let k = 0; k < 60 * 5; k++) cap.update(1 / 60);
  assert.equal(cap.lcd.view.big, '16', 'back to 16 four seconds after'); assert.equal(cap.lcd.view.tag, '');
  // off (the Pro panel's VHF): the LCD stays on 16, quiet
  cap.setOn(false); for (let k = 0; k < 30; k++) cap.update(1 / 60);
  assert.deepEqual(cap.lcd.view, lcdView({ channel: '16' }));
});
