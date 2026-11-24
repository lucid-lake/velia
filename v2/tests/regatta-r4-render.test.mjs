// Regatta R4's fleet rendering (BACKLOG-v2 #12, § 10.1). No browser: the level of detail by distance (near, mid,
// far, the near cap), the near rivals on the boat renderer's own slots (no pipeline after load, no buffer made in a frame, nothing
// drawn with none set), the props' new meshes within their budgets (the committee boat, the far silhouette).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetLod, LOD_BANDS, lodState } from '../regatta/lod.js';
import { buildPropMeshes, PROP_KINDS, MAX_PROPS, rgbaOf, createRaceProps } from '../render/raceProps.js';
import { createBoat, MAX_NEAR_RIVALS, RIVAL_SLOT, packTint, rivalSailKey } from '../render/boat.js';

const tris = (m) => m.length / 8 / 3;

test('the LOD bands afresh by distance: near under nearM (the nearest maxNear only), mid under midM, far beyond', () => {
  const eye = [0, 6, 0], out = [];
  const boats = [{ x: 10, z: 0 }, { x: 0, z: 30 }, { x: 40, z: 0 }, { x: 0, z: 120 }, { x: 300, z: 0 }, { x: -1000, z: 0 }];
  assert.deepEqual(fleetLod(eye, boats, LOD_BANDS.mac, out), ['near', 'near', 'near', 'near', 'far', 'far'], 'the Mac: every rival within 150 m at full detail');
  assert.deepEqual(fleetLod(eye, boats, LOD_BANDS.lite, out), ['near', 'mid', 'mid', 'mid', 'far', 'far'], 'lite (a phone, L2-L3): 1 near, mid to 200 m');
  const same = fleetLod(eye, boats, LOD_BANDS.mac, out); assert.equal(same, out, 'the out array is the caller\'s, reused');
  assert.ok(LOD_BANDS.mac.maxNear <= MAX_NEAR_RIVALS && LOD_BANDS.lite.maxNear <= MAX_NEAR_RIVALS);
  assert.equal(LOD_BANDS.mac.maxNear, 5, 'the Mac: all five rivals of the six-boat cap');
});

// the race fixes (2026-11-18): no model swap in view. A pack wanders round the eye for 2 minutes (deterministic paths, some crossing
// in and out of the 150 m ring): a boat never changes band while she is within 150 m of the eye (only at a crossing of the ring, or
// beyond it), on the Mac and on a phone's one slot
test('the LOD never swaps a boat\'s model within 150 m of the eye (hysteresis; a phone keeps one slot)', () => {
  for (const bands of [LOD_BANDS.mac, LOD_BANDS.lite]) {
    const st = lodState(), out = [], eye = [0, 5, 0];
    const path = (i, t) => { const r = 20 + 45 * i + 70 * Math.sin(t * 0.05 + i), a = t * (0.03 + 0.01 * i) + i * 1.3; return { x: Math.cos(a) * r, z: Math.sin(a) * r }; };
    let prev = null, prevD = null, swaps = [], near = 0, inRing = 0;
    for (let f = 0; f < 120 * 60; f++) {
      const t = f / 60, boats = [0, 1, 2, 3, 4].map((i) => path(i, t));
      eye[0] = 3 * Math.sin(t * 0.1); eye[2] = 3 * Math.cos(t * 0.1);   // the camera's own small drift (no cut)
      fleetLod(eye, boats, bands, out, st);
      const d = boats.map((b) => Math.hypot(b.x - eye[0], b.z - eye[2]));
      if (prev) for (let i = 0; i < 5; i++) if (out[i] !== prev[i] && d[i] < 150 && prevD[i] < 150) swaps.push(`${i} ${prev[i]}→${out[i]} at ${d[i].toFixed(0)} m, ${t.toFixed(1)} s`);
      near = Math.max(near, out.filter((b) => b === 'near').length);
      inRing += d.filter((x) => x < 150).length;
      prev = out.slice(); prevD = d;
    }
    assert.deepEqual(swaps, [], `${bands.maxNear} slot(s): no swap inside 150 m`);
    assert.ok(near <= bands.maxNear, `at most ${bands.maxNear} near (${near})`);
    assert.ok(inRing > 5000, 'the pack spent time inside the ring');
  }
  // the Mac: a boat inside the ring is always full detail (every slot free); a boat walking out changes past 175 m, back in at 150 m
  const st = lodState(), out = [], seen = [];
  for (let d = 5; d < 400; d += 1) { fleetLod([0, 5, 0], [{ x: d, z: 0 }], LOD_BANDS.mac, out, st); if (seen.at(-1)?.[0] !== out[0]) seen.push([out[0], d]); }
  for (let d = 400; d > 5; d -= 1) { fleetLod([0, 5, 0], [{ x: d, z: 0 }], LOD_BANDS.mac, out, st); if (seen.at(-1)?.[0] !== out[0]) seen.push([out[0], d]); }
  assert.deepEqual(seen, [['near', 5], ['mid', 175], ['far', 266], ['mid', 234], ['near', 149]]);
  // a camera cut (the eye jumps): bands afresh at once
  fleetLod([0, 5, 0], [{ x: 300, z: 0 }], LOD_BANDS.mac, out, st); fleetLod([290, 5, 0], [{ x: 300, z: 0 }], LOD_BANDS.mac, out, st);
  assert.equal(out[0], 'near', 'a cut re-bands');
});

test('the colour follows the boat: each near rival keeps her own slot (her tint, her sails) whatever the order; a newcomer fills at once', () => {
  const { device, reg } = gpu();
  const boat = createBoat({ device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' } });
  const pose = { x: 0, z: 0, heading: 0 };
  const P = (key, x, boom, hex) => ({ ...pose, key, x, z: 5, boomAngle: boom, jibAngle: boom * 0.8, tint: packTint(hex) });
  const a = P('tern', 10, 0.3, '#8a2a24'), b = P('heron', -10, -0.5, '#3d6f9e'), c = P('wren', 20, 0.1, '#1f2c4a');
  boat.setRivals(2, [a, b]); boat.update(pose, { t: 1 });
  const s0 = boat.rivals.slots.slice();
  boat.setRivals(2, [b, a]); boat.update(pose, { t: 1.02 });
  assert.deepEqual(boat.rivals.slots, s0, 'the order swapped: each boat on her own slot');
  const f0 = boat.rivals.fills;
  boat.setRivals(3, [b, c, a]); boat.update(pose, { t: 1.04 });
  assert.equal(boat.rivals.slots[s0.indexOf('tern')], 'tern'); assert.equal(boat.rivals.slots[s0.indexOf('heron')], 'heron');
  assert.ok(boat.rivals.slots.includes('wren'), 'the newcomer takes a free slot');
  assert.ok(boat.rivals.fills - f0 >= 1, 'her sails filled on her first frame');
  boat.setRivals(1, [c]); boat.update(pose, { t: 1.06 });
  assert.deepEqual(boat.rivals.slots.filter(Boolean), ['wren'], 'the others gone: their slots freed');
  boat.setRivals(0); assert.equal(boat.rivals.n, 0);
});

test('the props: a proper committee boat and a far silhouette within their budgets, one pipeline, the lite boat for mid', () => {
  const M = buildPropMeshes();
  assert.ok(PROP_KINDS.includes('far') && PROP_KINDS.includes('sloop') && PROP_KINDS.includes('committee'));
  assert.ok(tris(M.committee) > 150 && tris(M.committee) <= 1500, `committee ${tris(M.committee)} triangles`);
  assert.ok(tris(M.far) <= 16, `far ${tris(M.far)} triangles`);
  assert.ok(tris(M.far) < tris(M.sloop), 'the far silhouette is cheaper than the mid boat');
  for (const k of PROP_KINDS) assert.ok(M[k].every(Number.isFinite), `${k} finite`);
  assert.ok(MAX_PROPS >= 1 + 1 + 2 + 5);
  assert.equal(rgbaOf('#1f2c4a'), 0xff4a2c1f >>> 0, 'sRGB hex to the instance\'s rgba8 (r low)');
});

// a GPU stand-in that counts what is made and recorded
function gpu() {
  const n = { buffers: 0, pipelines: 0, textures: 0, writes: 0 };
  const obj = () => ({ createView: () => ({}) });
  const device = new Proxy({
    createBuffer: () => { n.buffers++; return obj(); }, createTexture: () => { n.textures++; return obj(); },
    createRenderPipeline: () => { n.pipelines++; return {}; }, createRenderPipelineAsync: async () => { n.pipelines++; return {}; },
    queue: { writeBuffer: () => { n.writes++; }, writeTexture: () => {}, copyExternalImageToTexture: () => {} },
  }, { get: (t, k) => (k in t ? t[k] : () => obj()) });
  const added = [];
  const reg = { shader: (l, code) => ({ l, code }), add: (name) => { added.push(name); }, get: (name) => ({ name }) };
  return { device, reg, added, n };
}
function pass() { const rec = []; const p = new Proxy({}, { get: (t, k) => (...a) => { rec.push([k, a]); } }); return { p, rec }; }
globalThis.GPUBufferUsage ??= { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
// the instruments' faces draw on a 2D canvas: a stand-in that takes every call
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {})), set: (t, k, v) => { t[k] = v; return true; } });
globalThis.OffscreenCanvas ??= class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctx2d; } };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

test('the near rivals: the boat\'s own pipelines (none after load), no buffer made in a frame, nothing drawn without them', () => {
  const { device, reg, added, n } = gpu();
  const boat = createBoat({ device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' } });
  const added0 = added.length, buffers0 = n.buffers, textures0 = n.textures;
  const pose = { x: 0, z: 0, heading: 0, heel: 0.1, boomAngle: 0.3, jibAngle: 0.2, mainFill: 1, jibFill: 1 };
  const draws = (rivals) => { boat.setRivals(rivals.length, rivals); boat.update(pose, { t: 1 }); const { p, rec } = pass(); boat.draw(p, { calls: 0, triangles: 0 }); return rec.filter(([k]) => k === 'drawIndexed').length; };
  const base = draws([]);
  const near = [{ ...pose, x: 12, z: 3, tint: packTint('#8a2a24') }, { ...pose, x: -15, z: 8, boomAngle: -0.4, tint: packTint('#1f2c4a') }];
  const two = draws(near);
  assert.ok(two > base, `two near rivals add their draws (${base} → ${two})`);
  // the draws bind the rivals' own records (their dynamic offsets past the player's 15 slots)
  boat.setRivals(2, near); boat.update(pose, { t: 2 });
  const { p, rec } = pass(); boat.draw(p, { calls: 0, triangles: 0 });
  const offs = rec.filter(([k, a]) => k === 'setBindGroup' && a[0] === 2).map(([, a]) => a[2][0] / 256);
  assert.ok(offs.some((o) => o >= boat.SLOT.rivals) && Math.max(...offs) < boat.SLOT.N, `rival slots bound (${Math.max(...offs)} < ${boat.SLOT.N})`);
  // a frame with rivals makes nothing: no pipeline, no buffer, no texture
  for (let f = 0; f < 30; f++) { near[0].x += 0.1; draws(near); }
  assert.equal(added.length, added0, 'no pipeline declared after load'); assert.equal(n.buffers, buffers0, 'no buffer made in a frame'); assert.equal(n.textures, textures0);
  // the sails refill at most one rival a frame, only when their trim moved
  const f0 = boat.rivals.fills; draws(near); assert.ok(boat.rivals.fills - f0 <= 1, 'one refill a frame at most');
  const f1 = boat.rivals.fills; for (let f = 0; f < 5; f++) draws(near); assert.ok(boat.rivals.fills - f1 <= 1, 'the same trim: no refill');
  // back to none (off a race): the draws are the player's alone
  assert.equal(draws([]), base, 'setRivals(0): no rival draw recorded');
  assert.equal(boat.rivals.n, 0);
  assert.equal(RIVAL_SLOT.n * MAX_NEAR_RIVALS + boat.SLOT.rivals, boat.SLOT.N);
});

test('the rivals\' tint and trim key: 0 is no tint (the player\'s boat unchanged), a quantised key that ignores a hair of trim', () => {
  assert.equal(packTint(null), 0); assert.equal(packTint('#000000'), 1); assert.equal(packTint('#ffffff'), 2 ** 24);
  const a = { boomAngle: 0.300, jibAngle: 0.2, mainFill: 1, jibFill: 0.98 };
  assert.equal(rivalSailKey(a), rivalSailKey({ ...a, boomAngle: 0.304 }), 'under the 0.02 rad step: the same key');
  assert.notEqual(rivalSailKey(a), rivalSailKey({ ...a, boomAngle: 0.34 }));
  assert.equal(typeof rivalSailKey(a), 'number', 'a number: a frame\'s compare allocates nothing');
});

test('the props draw the far kind in its own run with the same pipeline; nothing off a race', () => {
  const { device, reg, added } = gpu();
  const RP = createRaceProps({ device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' } });
  assert.deepEqual(added, ['race-props']);
  const c = { calls: 0, triangles: 0 };
  RP.begin(); RP.put('far', 400, 0, 0); RP.end(); let q = pass(); RP.draw(q.p, c); assert.equal(q.rec.length, 0, 'off a race: nothing');
  RP.setActive(true); RP.begin(); RP.put('sloop', 100, 0, 0, 0, 0, 0, rgbaOf('#2f5a3c')); RP.put('far', 400, 0, 0); RP.put('committee', 0, 0, 0); RP.end();
  q = pass(); RP.draw(q.p, c);
  assert.equal(q.rec.filter(([k]) => k === 'setPipeline').length, 1); assert.equal(q.rec.filter(([k]) => k === 'draw').length, 3, 'one run a kind present');
});

// the race fixes round 2 (owner 2026-11-18: "improve these props to at least the channel buoys' quality level"): the race marks are
// smooth meshes on the channel buoys' one pipeline (render/navAids.js), forwarded by the race props; within their budgets; nothing of
// theirs drawn by the race props' own pipeline while a sink is set
test('the race marks ride the channel buoys\' pipeline: smooth meshes in budget, forwarded by the props, numbered, a flag on the dan buoy', async () => {
  const { buildAidMeshes, AID_KINDS, AID_SPECS, createNavAids, RACE_KIND0 } = await import('../render/navAids.js');
  const M = buildAidMeshes(), t7 = (m) => m.length / 7 / 3;
  for (const k of ['raceCyl', 'raceTetra', 'danBuoy']) {
    assert.ok(AID_KINDS.indexOf(k) >= RACE_KIND0, `${k} after the channel's kinds`);
    assert.ok(M[k].every(Number.isFinite), `${k} finite`);
    assert.ok(t7(M[k]) > 1000 && t7(M[k]) <= 6000, `${k}: ${t7(M[k])} triangles (smooth, in budget)`);
  }
  const slots = (m) => new Set(Array.from({ length: m.length / 7 }, (_, i) => m[i * 7 + 6]));
  assert.ok(slots(M.danBuoy).has(6), 'the dan buoy has its flag (slot 6)');
  assert.ok(slots(M.raceCyl).has(8) && slots(M.raceCyl).has(7), 'the cylinder has its number band and anchor line');
  // the tops at the night lanterns' heights (v2/regatta/nightMarks.js): the cylinder 1.95, the tetrahedron 2.25, the pin's pole 3.85
  const top = (m) => { let y = -9; for (let i = 0; i < m.length; i += 7) if (m[i + 6] < 2 || m[i + 6] === 8) y = Math.max(y, m[i + 1]); return y; };
  assert.ok(Math.abs(top(M.raceCyl) - AID_SPECS.raceCyl.top) < 0.02, `cylinder top ${top(M.raceCyl)}`);
  assert.ok(Math.abs(top(M.raceTetra) - AID_SPECS.raceTetra.top) < 0.05, `tetrahedron apex ${top(M.raceTetra)}`);
  // the props forward their marks to the sink and draw only the rest
  const { device, reg } = gpu();
  const common = { device, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' } };
  const NA = createNavAids(common), RP = createRaceProps(common);
  RP.setMarkSink(NA); RP.setActive(true);
  NA.begin(); NA.put('aidCan', 0, 0, 0); NA.end();
  RP.begin(); RP.put('committee', 0, 0, 0); RP.put('pin', 10, 0, 0, 0.3); RP.put('markW', 50, 0, 50, 0, 0.05, 0, 0xffffffff, 1); RP.put('markI', 80, 0, 50, 0, 0, 0, 0xffffffff, 102); RP.end();
  assert.equal(RP.stats.instances, 1, 'the props draw the committee boat only');
  assert.equal(NA.stats.race, 3, 'three race marks on the buoys\' queue');
  assert.equal(NA.stats.instances, 4, 'with the channel\'s buoy');
  NA.begin(); NA.end(); assert.equal(NA.stats.instances, 3, 'the channel\'s frame keeps the race\'s marks');
  RP.setActive(false); assert.equal(NA.stats.instances, 0, 'off a race the marks are gone');
  const { p, rec } = pass(); NA.draw(p, { calls: 0, triangles: 0 }); assert.equal(rec.length, 0, 'nothing drawn');
});
