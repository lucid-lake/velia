// M4: the baked cockpit assets (tools/v2-cockpit-bake.mjs → v2/assets/cockpit/*.ckb.gz) read by v2's reader (render/cockpit/asset.js):
// the container, every index in range, every mesh's node and material, the roles set() needs, the anchors the hit layer projects,
// the triangle count against v1's own, and composeNodes against the world position the bake recorded for the hub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseCockpit, composeNodes, setRotation, quatFromEulerXYZ } from '../render/cockpit/asset.js';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'cockpit');
// the bake's count (cockpit3d.js count(), every mesh under the root) of v1's cockpit with v2's seams (owner 2026-11-16: the engine key
// outboard, no TACK on the cap): 56,633 on a desktop at 1280 x 720 (v1's own 58,627 − TACK); the phone's read at its bake
const V1_TRIS = { desktop: 57087, phone: 57023 };   // the cockpit as baked (rotary REEF, no engine dial; the switch panel off VHF and the dials 17 % larger, 2026-11-17)
const ANCHORS = ['hub', 'wheelTop', 'capMid', 'guardTop', 't:sails', 't:anchor', 't:reef', 'key', 'lever', 'knob', 'tack', 'moor', 'binos', 'vhf',
  ...['chart', 'wind'].flatMap((s) => [`i:${s}`, `i:${s}:t`, `i:${s}:b`, `i:${s}:l`, `i:${s}:r`]),
  ...['traveller', 'jibLead', 'vang', 'backstay'].flatMap((id) => [`p:${id}:a`, `p:${id}:b`]), 'p:btn:pro', 'p:g0', 'p:r0', 'p:r1'];

const load = async (kind) => parseCockpit(readFileSync(resolve(DIR, `${kind}.ckb.gz`)));

for (const kind of ['desktop', 'phone']) {
  test(`${kind}: the container, the buffers and the counts`, async () => {
    const raw = gunzipSync(readFileSync(resolve(DIR, `${kind}.ckb.gz`)));
    assert.equal(raw.subarray(0, 4).toString('latin1'), 'CKB1');
    const a = await load(kind), b = await parseCockpit(raw);   // gzipped and plain read the same
    assert.deepEqual(a.json, b.json);
    const { json, indices, streams, atlasPng } = a;
    assert.equal(json.kind, kind);
    assert.equal(json.pageKind, kind === 'phone' ? 'phone-land' : 'desktop');
    assert.equal(indices.length % 3, 0);
    const n = json.layout.vertexCount;
    assert.equal(streams.position.length, 3 * n); assert.equal(streams.normal.length, 4 * n); assert.equal(streams.uv.length, 2 * n); assert.equal(streams.sh.length, 3 * n);
    for (const v of streams.position) assert.ok(Number.isFinite(v));
    let max = 0; for (const i of indices) if (i > max) max = i;
    assert.ok(max < n, `index ${max} ≥ ${n} vertices`);
    let tris = 0;
    for (const m of json.meshes) {
      assert.ok(m.node >= 0 && m.node < json.nodes.length, `mesh node ${m.node}`);
      assert.ok(m.mat >= 0 && m.mat < json.materials.length, `mesh material ${m.mat}`);
      assert.ok(m.first >= 0 && m.first + m.count <= indices.length && m.count % 3 === 0);
      for (let k = m.first; k < m.first + m.count; k++) assert.ok(indices[k] >= m.vfirst && indices[k] < m.vfirst + m.vcount);
      tris += m.count / 3;
    }
    assert.equal(tris, json.tris);
    assert.ok(Math.abs(tris - V1_TRIS[kind]) <= 0.02 * V1_TRIS[kind], `${tris} tris vs v1's ${V1_TRIS[kind]}`);
    assert.equal(json.v1Count.tris, V1_TRIS[kind]);
    // the atlas: a PNG of the stated size; every rect inside it
    assert.deepEqual([...atlasPng.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(atlasPng.buffer, atlasPng.byteOffset);
    assert.equal(dv.getUint32(16), json.atlas.w); assert.equal(dv.getUint32(20), json.atlas.h);
    assert.ok(json.atlas.w <= 4096 && json.atlas.h <= 4096);
    const inUnit = (r) => r === null || (r.length === 4 && r[0] >= 0 && r[1] >= 0 && r[2] <= 1 && r[3] <= 1 && r[0] < r[2] && r[1] < r[3]);
    for (const m of json.materials) { assert.ok(inUnit(m.map) && inUnit(m.emissiveMap), m.name); }
    for (const L of json.roles.labels) assert.ok(L.day && L.night && inUnit(L.day) && inUnit(L.night), L.text);
    assert.ok(json.soleAo?.rect && inUnit(json.soleAo.rect) && json.soleAo.box.length === 4);
  });

  test(`${kind}: the roles and the anchors`, async () => {
    const { json, coverFrames } = await load(kind);
    const R = json.roles, nN = json.nodes.length, nM = json.materials.length;
    const node = (i, what) => assert.ok(Number.isInteger(i) && i >= 0 && i < nN, `${what}: node ${i}`);
    const mat = (i, what) => assert.ok(Number.isInteger(i) && i >= 0 && i < nM, `${what}: material ${i}`);
    for (const k of ['content', 'helm', 'wheelSpin', 'card', 'key', 'stem']) node(R[k], k);
    for (const k of ['cardMat', 'amberOn', 'ledOff', 'ringOff']) mat(R[k], k);
    assert.equal(new Set([R.amberOn, R.ledOff, R.ringOff]).size, 3);
    for (const id of ['sails', 'anchor', 'reef']) { node(R.toggles[id].pivot, id); node(R.toggles[id].led, id); }
    for (const k of ['g', 'ring', 'lines', 'dawn']) node(R.moor[k], `moor.${k}`);
    for (const id of ['binoculars', 'radio']) { node(R.tools[id].ring, id); node(R.tools[id].cap, id); mat(R.tools[id].capMat, id); }
    assert.equal(R.tack, null, 'no TACK on the cap: TACK is the helm readout\'s button (ui/autopilot.js)');
    node(R.pro.toggle.pivot, 'pro.toggle'); node(R.pro.toggle.led, 'pro.led');
    for (const id of ['traveller', 'jibLead', 'vang', 'backstay']) { const S = R.pro.sliders[id]; node(S.car, id); assert.ok(S.travel > 0); mat(S.ridgeMat, id); }
    for (const side of ['jib', 'main']) {
      const W = R.winch[side];
      for (const k of ['at', 'item', 'spin', 'body', 'turns', 'tail', 'hd']) node(W[k], `winch.${side}.${k}`);
      assert.equal(json.nodes[W.at].name, `winch-${side}`); assert.equal(json.nodes[W.hd].name, 'handle');
      assert.equal(json.nodes[W.spin].parent, W.item); assert.equal(json.nodes[W.hd].parent, W.spin);
      assert.equal(W.grip.length, 3);
    }
    node(R.inst.g, 'inst');
    for (const side of ['chart', 'wind']) { node(R.inst[side].g, side); node(R.inst[side].face, side); mat(R.inst[side].faceMat, side); assert.equal(json.materials[R.inst[side].faceMat].mapImage, 'liveFace'); }
    assert.ok(R.labels.length >= 10);
    for (const L of R.labels) { node(L.mesh, L.text); mat(L.mat, L.text); }
    for (const a of ANCHORS) node(json.anchors[a], `anchor ${a}`);
    // the PRO cover: frames for each e and moved mesh, the moved meshes' vertex counts as drawn
    const C = json.cover, per = C.vertexCounts.reduce((s, v) => s + v, 0) * 3;
    assert.equal(coverFrames.length, per * C.e.length);
    for (const [i, nd] of C.meshNodes.entries()) { const m = json.meshes.find((x) => x.node === nd); assert.equal(m.vcount, C.vertexCounts[i]); }
  });

  test(`${kind}: composeNodes reproduces the baked hub`, async () => {
    const { json } = await load(kind);
    const W = composeNodes(json.nodes), h = 16 * json.anchors.hub;
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(W[h + 12 + k] - json.check.hub[k]) < 1e-5, `hub ${k}: ${W[h + 12 + k]} vs ${json.check.hub[k]}`);
  });
}

test('setRotation rebuilds q from r (Euler XYZ)', async () => {
  const { json } = await load('desktop');
  const nodes = structuredClone(json.nodes);
  for (const nd of nodes) { const q = quatFromEulerXYZ(...nd.r); const d = Math.abs(q[0] * nd.q[0] + q[1] * nd.q[1] + q[2] * nd.q[2] + q[3] * nd.q[3]); assert.ok(Math.abs(d - 1) < 1e-5, `r and q agree: ${nd.name}`); }
  const i = json.roles.wheelSpin;
  setRotation(nodes, i, 'z', -0.7);
  assert.equal(nodes[i].r[2], -0.7);
  const q = nodes[i].q;
  assert.ok(Math.abs(q[2] - Math.sin(-0.35)) < 1e-12 && Math.abs(q[3] - Math.cos(-0.35)) < 1e-12);
  // a vertex of the wheel (a mesh under wheelSpin) turns about the hub: it moves, its distance from the hub is kept
  const { streams } = await load('desktop');
  const under = (n) => { for (let k = n; k >= 0; k = nodes[k].parent) if (k === i) return true; return false; };
  const m = json.meshes.find((x) => under(x.node));
  assert.ok(m, 'a mesh under wheelSpin');
  const A = composeNodes(json.nodes), B = composeNodes(nodes), hb = 16 * json.anchors.hub;
  const v = Array.from(streams.position.subarray(3 * m.vfirst, 3 * m.vfirst + 3));
  const at = (M) => { const o = 16 * m.node; return [0, 1, 2].map((r) => M[o + r] * v[0] + M[o + 4 + r] * v[1] + M[o + 8 + r] * v[2] + M[o + 12 + r]); };
  const pa = at(A), pb = at(B), d = (p, M) => Math.hypot(p[0] - M[hb + 12], p[1] - M[hb + 13], p[2] - M[hb + 14]);
  assert.ok(Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) > 1e-3, 'the vertex moved');
  assert.ok(Math.abs(d(pa, A) - d(pb, B)) < 1e-5);
});

// BACKLOG-v2 #46: an ultrawide desktop loads the wide bake, its coaming v1's longer shell (hw 3.3 × aspect / (16:9) at 8:3)
test('#46: the wide bake: a desktop wider than 2.05:1 loads it; its shell is v1\'s at 1920 × 720 (hw 4.95), the instruments further out', async () => {
  const { cockpitBake, WIDE_AT } = await import('../render/cockpit.js');
  assert.equal(cockpitBake({ w: 1280, h: 720 }), 'desktop'); assert.equal(cockpitBake({ w: 2560, h: 1080 }), 'wide'); assert.equal(cockpitBake({ w: 3840, h: 1080 }), 'wide');
  assert.equal(cockpitBake({ phone: true, w: 3000, h: 1000 }), 'phone'); assert.ok(WIDE_AT > 16 / 9);
  const [d, w] = [await load('desktop'), await load('wide')];
  assert.equal(w.json.kind, 'wide'); assert.deepEqual(w.json.viewport, [1920, 720]);
  assert.ok(Math.abs(w.json.hw - 4.95) < 1e-6 && Math.abs(d.json.hw - 3.3) < 1e-6, `hw ${d.json.hw} → ${w.json.hw}`);
  assert.equal(w.json.meshes.length, d.json.meshes.length, 'the same parts');
});
