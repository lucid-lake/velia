// G1, G2 (the world audit, 2026-11-14): v1's landmarks and shore flags for v2, baked from v1's own code on v1's terrain.
//   src/landmarks.js createLandmarks   the tea-house ruin on Fannette's summit, the stone house with the sod roof at the bay's
//                                      head, the waterfall's ribbon and its plunge foam (v1's three.js geometry, run here in
//                                      node, flattened to world-space triangles; the boulders are v2's own: render/rocks.js)
//   src/shoreFlags.js flagSites        the five flagpoles (the stone house's lawn, two pier heads, the club's lawn, the harbour's
//                                      pier) on v1's layouts (src/shoreline-layout.js with the towns' real piers, as
//                                      src/core/world.js; src/harbour-layout.js), and v1's pole mesh
// Each part keeps v1's material as numbers v2's shader reads (render/landmarks.js): kind 0 plain (colour a), 1 v1's
// stoneMaterial (dark b to base a by the stones' noise, the mortar's lines), 2 the sod (b to a by the ground's noise), 3 the
// waterfall's streaming ribbon (uv), 4 the plunge foam; the roughness; double (v1's DoubleSide).
//   node tools/v2-landmarks-bake.mjs [--check]   → v2/assets/towns/landmarks.json (positions to 1 mm; --check demands the bytes)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LANDMARKS_FILE = resolve(ROOT, 'v2/assets/towns/landmarks.json');
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;

// v1's materials, by the meshes' order in createLandmarks (ruin: four walls, the window, the door, the gable; house: the
// body, the roof, two gables, seven × two windows and lintels, the wing, the cap; waterfall: the ribbon, the foam)
const STONE_RUIN = { kind: 1, a: 0x6f6c66, b: 0x45433f, rough: 0.92 }, STONE_HOUSE = { kind: 1, a: 0x7a766d, b: 0x4a4741, rough: 0.92 };
const DARK = { kind: 0, a: 0x15140f, rough: 1 }, GABLE = { kind: 0, a: 0x6f6c66, rough: 0.92, double: true };
const SOD = { kind: 2, a: 0x5a6436, b: 0x3d4a2a, rough: 1 }, TIMBER = { kind: 0, a: 0x3a2a1c, rough: 0.85 }, TIMBER2 = { ...TIMBER, double: true };
const GLASS = { kind: 0, a: 0x1a1d20, rough: 0.3 };
const FALL = { kind: 3, a: 0xf2f5f4, b: 0xb9c3c6, rough: 0.4, double: true }, FOAM = { kind: 4, a: 0xe6ecec, rough: 0.6, double: true };
const POLE = { kind: 0, a: 0xd8d2c4, rough: 0.55 };

function flatten(THREE, mesh, mat) {
  const g = mesh.geometry.index ? mesh.geometry : mesh.geometry;
  mesh.updateWorldMatrix(true, false);
  const M = mesh.matrixWorld, N = new THREE.Matrix3().getNormalMatrix(M);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const pos = [], nrm = [], uvs = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(M); pos.push(r3(v.x), r3(v.y), r3(v.z));
    if (n) { w.fromBufferAttribute(n, i).applyMatrix3(N).normalize(); nrm.push(r4(w.x), r4(w.y), r4(w.z)); } else nrm.push(0, 1, 0);
    if (mat.kind === 3) uvs.push(r4(uv.getX(i)), r4(uv.getY(i)));
  }
  const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i);
  return { ...mat, double: !!mat.double, pos, nrm, ...(uvs.length ? { uv: uvs } : {}), idx };
}

export async function bakeLandmarks() {
  const THREE = await import('three/webgpu');
  const { makeTerrain } = await import('../src/sim/terrain.js');
  const { makeGeo } = await import('../src/sim/geo.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const { createLandmarks } = await import('../classic/src/landmarks.js');
  const { flagSites, SHORE_FLAGS } = await import('../classic/src/shoreFlags.js');
  const { loadTownsData, buildTownsLayout } = await import('../classic/src/towns-layout.js');
  const { layoutShoreline } = await import('../src/shoreline-layout.js');
  const { harbourLayout } = await import('../src/harbour-layout.js');
  const terrain = makeTerrain({ seed: 1 });
  const lm = createLandmarks({ terrain, seed: 1 });
  lm.group.updateMatrixWorld(true);
  const byName = (n) => lm.group.children.find((c) => c.name === n);
  const ruin = byName('ruin'), house = byName('stone-house'), fall = byName('waterfall');
  const ruinMats = [STONE_RUIN, STONE_RUIN, STONE_RUIN, STONE_RUIN, DARK, DARK, GABLE];
  const houseMats = [STONE_HOUSE, SOD, TIMBER2, TIMBER2, ...Array.from({ length: 14 }, () => [GLASS, TIMBER]).flat(), STONE_HOUSE, SOD];
  if (ruin.children.length !== ruinMats.length) throw new Error(`ruin: ${ruin.children.length} meshes`);
  if (house.children.length !== houseMats.length) throw new Error(`house: ${house.children.length} meshes`);
  if (fall.children.length !== 2) throw new Error(`waterfall: ${fall.children.length} meshes`);
  const parts = [
    ...ruin.children.map((m, i) => ({ who: 'ruin', ...flatten(THREE, m, ruinMats[i]) })),
    ...house.children.map((m, i) => ({ who: 'house', ...flatten(THREE, m, houseMats[i]) })),
    { who: 'waterfall', ...flatten(THREE, fall.children[0], FALL) },
    { who: 'waterfall', ...flatten(THREE, fall.children[1], FOAM) },
  ];
  // the flags: v1's sites on v1's layouts, as src/core/world.js makes them (the shoreline with the towns' real piers)
  const towns = buildTownsLayout(await loadTownsData(), { heightAt: terrain.heightAt, lonLatToWorld: makeGeo(CURRENT_WATERS).lonLatToWorld });
  const shore = layoutShoreline(terrain, { seed: 1, realPiers: towns.osmPiers });
  const harbour = harbourLayout({ terrain, seed: 1 });
  const sites = flagSites({ terrain, harbour, shore }).map((s) => ({ name: s.name, x: r3(s.x), z: r3(s.z), y: r3(s.y), h: s.h, shape: s.shape, col: s.col, L: s.L, H: s.H }));
  // v1's pole: CylinderGeometry(0.035, 0.06, 1, 8, 1) from its foot, scaled (h / 6, h, h / 6) a site
  const pole = new THREE.CylinderGeometry(0.035, 0.06, 1, 8, 1); pole.translate(0, 0.5, 0);
  const poles = sites.map((s) => { const m = new THREE.Mesh(pole); m.position.set(s.x, s.y, s.z); m.scale.set(s.h / 6, s.h, s.h / 6); return { who: s.name, ...flatten(THREE, m, POLE) }; });
  const out = { v: 1, note: "v1's src/landmarks.js and src/shoreFlags.js on v1's terrain and layouts; tools/v2-landmarks-bake.mjs",
    stats: { ...lm.stats, boulders: undefined }, flags: { ...SHORE_FLAGS, anchors: undefined, sites }, parts, poles };
  return JSON.stringify(out) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await bakeLandmarks();
  const J = JSON.parse(text);
  if (process.argv.includes('--check')) {
    const shipped = readFileSync(LANDMARKS_FILE, 'utf8');
    if (shipped !== text) { console.error('landmarks.json differs from the bake'); process.exit(1); }
    console.log(`landmarks.json matches the bake (${J.parts.length} parts, ${J.flags.sites.length} flags)`);
  } else {
    mkdirSync(dirname(LANDMARKS_FILE), { recursive: true });
    writeFileSync(LANDMARKS_FILE, text);
    console.log(`v2/assets/towns/landmarks.json: ${J.parts.length} parts, ${J.parts.reduce((a, p) => a + p.pos.length / 3, 0)} verts, ${J.flags.sites.length} flags, ${text.length} B`);
    for (const s of J.flags.sites) console.log(`  ${s.name}: (${s.x}, ${s.y}, ${s.z}) h ${s.h}`);
  }
}
