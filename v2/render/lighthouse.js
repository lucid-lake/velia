// The Rubicon Point light (the Rubicon Point birthplace's hero): the small wooden light on the cliff at D.L. Bliss, about
// 12 ft (3.7 m) tall, square, with no lantern room of its own (built 1916, dark since about 1921, rebuilt by the park).
// Kept modest and generic: a weathered timber tower on a granite footing, a small glazed lamp box and a low pyramid cap, a
// door toward the lake. Every piece is a box or the cap's four faces; drawn by render/landmarks.js's own pipeline (kind 6:
// the plain colour, trimmed by night; kind 5: the stone), no new pipeline. Its own chunk: main.js imports it only for a start
// on its level (v2/terrain/region.js levelKeyOfBirth: the tahoe-west region's Rubicon level), as the tea house's parts.
// Pure: no DOM, no GPU, no Math.random.
//   LIGHTHOUSE                     the spot (world m: x east, z south), the sizes, the level it belongs to, the baked seat
//   lighthouseSeat(heightAt)       → { floor, foot } from the terrain under the footing (the test re-checks the baked seat)
//   lighthouseFor(levelKey)        → LIGHTHOUSE on its own level, else null (a start anywhere else never fetches it)
//   lighthouseParts({ L })         → { parts: [{ who, kind, a, b, rough, pos, nrm, idx }], stats: { boxes, triangles } }
//   lighthouseTop(L)               → the cap's top over the lake (m)

export const LIGHTHOUSE = Object.freeze({
  // Rubicon Point Light (Wikipedia, read 2026-11-25): 38.99583 N, 120.09472 W, a 12 ft (3.7 m) square wooden tower. That spot
  // in our frame (src/sim/geo.js) is (498, -4626), 66 m back from the water on the 4 m level; the light stands on the cliff's
  // edge, so it sits 32 m east of it, where the 4 m grid's cliff top is 39 m over the lake and 33 m from the water
  x: 530, z: -4640,
  yaw: Math.PI / 2,     // the door faces east, to the lake (the house's +z turned to world +x)
  level: 'tahoe-west',  // the region whose detail level carries it (the region table's tahoe-west row: terrain/rubicon)
  footM: 2.3,           // the granite footing, square
  bodyM: 1.8,           // the timber tower, square
  bodyH: 2.4,           // its walls over the floor
  lampM: 1.1, lampH: 0.65,   // the glazed lamp box on top
  capM: 1.5, capH: 0.65,     // the low pyramid cap
  // the seat on the shipped Rubicon level (lighthouseSeat on terrain/rubicon's desktop heights; v2/tests/rubicon.test.mjs
  // re-checks it): the floor over the footing's highest ground, the footing down below its lowest
  seat: Object.freeze({ floor: 40.17, foot: 37.25 }),
});

// the footing's points (world x, z) every `step` m, edges included
export function footingPoints(step = 0.25, L = LIGHTHOUSE) {
  const h = L.footM / 2, n = Math.max(1, Math.round(L.footM / step)), out = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out.push([L.x - h + (i / n) * L.footM, L.z - h + (j / n) * L.footM]);
  return out;
}
// the floor 5 cm over the highest ground under the footing, the footing 0.4 m under its lowest (no corner on air)
export function lighthouseSeat(heightAt, L = LIGHTHOUSE) {
  const hs = footingPoints(0.25, L).map(([x, z]) => heightAt(x, z)).sort((a, b) => a - b);
  return { floor: +(hs.at(-1) + 0.05).toFixed(2), foot: +(hs[0] - 0.4).toFixed(2), groundMin: hs[0], groundMax: hs.at(-1) };
}
export const lighthouseFor = (levelKey, L = LIGHTHOUSE) => (levelKey === L.level ? L : null);
export const lighthouseTop = (L = LIGHTHOUSE) => L.seat.floor + L.bodyH + L.lampH + L.capH;

// the palette (sRGB): weathered timber, its white trim, the lamp's glass, the cap's dark shingle, the granite footing
const PAL = Object.freeze({ timber: 0x8c7a66, trim: 0xe4ded2, glass: 0x22282c, cap: 0x4a2f26, door: 0x3a2d22, stone: 0x9a968e, grain: 0x6c6862 });
const KIND = Object.freeze({ stone: 5, plain: 6 });   // render/landmarks.js: the tea house's stone and plain kinds

export function lighthouseParts({ L = LIGHTHOUSE } = {}) {
  const parts = [], floor = L.seat.floor, cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
  let boxes = 0, tris = 0;
  // the house's frame (x across, y up over the floor, z toward the door) into the world
  const W = (lx, ly, lz) => [+(L.x + lx * cy + lz * sy).toFixed(4), +(floor + ly).toFixed(4), +(L.z - lx * sy + lz * cy).toFixed(4)];
  const N = (nx, ny, nz) => [+(nx * cy + nz * sy).toFixed(4), ny, +(-nx * sy + nz * cy).toFixed(4)];
  const part = (kind, a, b, rough) => { const p = { who: 'lighthouse', kind, a, b, rough, pos: [], nrm: [], idx: [] }; parts.push(p); return p; };
  const quad = (p, n, q) => { const base = p.pos.length / 3; for (const c of q) { p.pos.push(...W(...c)); p.nrm.push(...N(...n)); } p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); tris += 2; };
  // a box: centre (x, y, z) in the house's frame, size (sx, sy, sz); faces counter-clockwise seen from outside (landmarks.js's)
  function box(x, y, z, sx, syz, sz, kind, a, b = a, rough = 0.85) {
    const p = part(kind, a, b, rough), X = sx / 2, Y = syz / 2, Z = sz / 2, o = (q) => q.map(([u, v, w]) => [x + u, y + v, z + w]);
    quad(p, [1, 0, 0], o([[X, -Y, Z], [X, -Y, -Z], [X, Y, -Z], [X, Y, Z]]));
    quad(p, [-1, 0, 0], o([[-X, -Y, -Z], [-X, -Y, Z], [-X, Y, Z], [-X, Y, -Z]]));
    quad(p, [0, 1, 0], o([[-X, Y, Z], [X, Y, Z], [X, Y, -Z], [-X, Y, -Z]]));
    quad(p, [0, -1, 0], o([[-X, -Y, -Z], [X, -Y, -Z], [X, -Y, Z], [-X, -Y, Z]]));
    quad(p, [0, 0, 1], o([[-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z]]));
    quad(p, [0, 0, -1], o([[X, -Y, -Z], [-X, -Y, -Z], [-X, Y, -Z], [X, Y, -Z]]));
    boxes++;
  }
  const foot = L.seat.foot - floor;   // negative: the footing's depth under the floor
  box(0, foot / 2, 0, L.footM, -foot, L.footM, KIND.stone, PAL.stone, PAL.grain, 0.92);                 // the granite footing
  box(0, L.bodyH / 2, 0, L.bodyM, L.bodyH, L.bodyM, KIND.plain, PAL.timber);                             // the timber tower
  box(0, 0.06, 0, L.bodyM + 0.08, 0.12, L.bodyM + 0.08, KIND.plain, PAL.trim);                           // the sill board
  box(0, L.bodyH - 0.07, 0, L.bodyM + 0.12, 0.14, L.bodyM + 0.12, KIND.plain, PAL.trim);                 // the eave board
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * (L.bodyM / 2), L.bodyH / 2, sz * (L.bodyM / 2), 0.1, L.bodyH, 0.1, KIND.plain, PAL.trim);   // the corner boards
  box(0, 0.95, L.bodyM / 2 + 0.02, 0.7, 1.8, 0.05, KIND.plain, PAL.door);                                // the door, to the lake
  const ly = L.bodyH + L.lampH / 2;
  box(0, ly, 0, L.lampM, L.lampH, L.lampM, KIND.plain, PAL.glass, PAL.glass, 0.25);                      // the lamp box's glass
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * (L.lampM / 2), ly, sz * (L.lampM / 2), 0.08, L.lampH, 0.08, KIND.plain, PAL.trim);   // its posts
  // the cap: four sloped faces to the apex over the lamp box (counter-clockwise from outside), and its eave underside
  const p = part(KIND.plain, PAL.cap, PAL.cap, 0.8), y0 = L.bodyH + L.lampH, h = L.capM / 2, top = [0, y0 + L.capH, 0];
  const s = Math.hypot(h, L.capH), ny = h / s, nh = L.capH / s;
  for (const [nx, nz, a, b] of [[0, 1, [-h, y0, h], [h, y0, h]], [1, 0, [h, y0, h], [h, y0, -h]], [0, -1, [h, y0, -h], [-h, y0, -h]], [-1, 0, [-h, y0, -h], [-h, y0, h]]]) {
    const base = p.pos.length / 3;
    for (const c of [a, b, top]) { p.pos.push(...W(...c)); p.nrm.push(...N(nx * nh, ny, nz * nh)); }
    p.idx.push(base, base + 1, base + 2); tris++;
  }
  quad(p, [0, -1, 0], [[-h, y0, -h], [h, y0, -h], [h, y0, h], [-h, y0, h]]);
  return { parts, stats: { boxes, triangles: tris } };
}
