// Tessie's water (owner, 2026-11-17: "a Tessie logo … to draw the user's attention to visit that area"): the
// stage's area row (deep water inside the bay), the chart mark's rows (desktop only, none in a race, the ring until the first
// visit, kept on the device), the tap's skipper line, the chartplotter's areas layer (a tap on the glyph is a named pick that
// carries the area) and the stage (v2/stage/director.js with her act: near her water the sightings are inside it and every 1–2
// min; elsewhere rarer after the opening, which keeps its 25 s). Behaviour only: the modules are called, their output read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain } from './helpers/ground.mjs';
import { AREAS, areaOf, inArea, distToArea } from '../stage/areas.js';
import { createTessieMark, tessieMarkSvg, tessieDialSvg, TESSIE_MARK } from '../ui/tessieMark.js';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createStageDirector, STAGE } from '../stage/director.js';
import { actById } from '../stage/acts.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';

const T = makeTerrain({ seed: 1 });
const depth = (x, z) => -T.heightAt(x, z);
const W = areaOf('tessieWaters');

test('the area row: the deep water between Fannette Island and the north wall, 40 m deep or more, inside the bay', () => {
  assert.ok(W && AREAS.includes(W), 'the tessieWaters row');
  assert.equal(W.lake, 'tahoe-emerald');
  assert.ok(W.r >= 150 && W.r <= 250, `about 400 m across (${W.r * 2} m)`);
  assert.ok(depth(W.x, W.z) >= 40, `the centre ${depth(W.x, W.z).toFixed(1)} m deep`);
  let n = 0, wet = 0, deep = 0;
  for (let a = 0; a < 360; a += 10) for (const f of [0.2, 0.4, 0.6, 0.8, 1]) {
    const d = depth(W.x + Math.cos(a * Math.PI / 180) * W.r * f, W.z + Math.sin(a * Math.PI / 180) * W.r * f);
    n++; if (d > 0) wet++; if (d >= 40) deep++;
  }
  assert.equal(wet, n, 'the whole disc is water');
  assert.ok(deep / n >= 0.9, `${(100 * deep / n).toFixed(0)} % of it 40 m or deeper`);
  // in the bay: north of the island (z < 0), west of the mouth's sill, and the bay's north wall (land) within 700 m north
  assert.ok(W.z < 0 && Math.hypot(W.x, W.z) < 600, 'by the island, to its north');
  const m = T.mouth, side = (x, z) => Math.sign((m.b[0] - m.a[0]) * (z - m.a[1]) - (m.b[1] - m.a[1]) * (x - m.a[0]));
  assert.equal(side(W.x, W.z), side(0, 0), 'on the island\'s side of the mouth');
  let wall = null; for (let z = W.z; z > W.z - 900; z -= 10) if (depth(W.x, z) <= 0) { wall = W.z - z; break; }
  assert.ok(wall != null && wall < 700, `the north wall ${wall} m north of the centre`);
  assert.ok(inArea(W, W.x, W.z) && !inArea(W, W.x + W.r + 1, W.z) && distToArea(W, W.x, W.z) === -W.r);
});

// the registry row the mark reads (src/core/features.js 'tessie'): desktop only
const tessieOn = (dev) => {
  const win = { ...DEVICES[dev], location: { search: '' } };
  return createFeatures({ profile: { get: () => profileOf(readFacts(win), {}, { gpu: 1 }), on: () => {} }, doc: null }).configure({ headless: false, flags: {} }).feature('tessie').on;
};
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('the mark: only where feature(tessie) is on (a desktop or a tablet; never a phone), none in a race', () => {
  for (const [dev, want] of [['desktop', 1], ['touchLaptop', 1], ['iphoneTurned', 0], ['androidSideways', 0], ['ipadTrackpad', 1]]) {
    const on = tessieOn(dev);
    const M = createTessieMark({ on: () => on, area: W, boat: () => ({ x: 1200, z: -1050 }), store: memStore() });
    assert.equal(M.areas().length, want, `${dev}: ${want ? 'the mark' : 'no mark'}`);
  }
  let mode = 'sail';
  const M = createTessieMark({ on: () => true, area: W, mode: () => mode, store: memStore() });
  const [row] = M.areas();
  assert.equal(row.id, 'tessieWaters'); assert.equal(row.name, "Tessie's water"); assert.equal(row.x, W.x); assert.equal(row.z, W.z);
  // world-sized: a vignette smaller than Fannette Island (162 m at its 0 m contour), with a floor where it still reads and a cap
  let isl = 0; const pts = [];
  for (let x = -150; x <= 150; x += 3) for (let z = -150; z <= 150; z += 3) if (T.heightAt(x, z) > 0) pts.push([x, z]);
  for (let a = 0; a < 180; a += 5) { const c = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180); let lo = 1e9, hi = -1e9; for (const [x, z] of pts) { const v = x * c + z * sn; lo = Math.min(lo, v); hi = Math.max(hi, v); } isl = Math.max(isl, hi - lo); }
  assert.ok(row.lenM >= 0.6 * isl && row.lenM <= 0.7 * isl, `${row.lenM} m long: 60–70 % of the island's ${isl.toFixed(0)} m`);
  // at the default zooms (the enlarged chart 2.4 km half-height on 550 px; the small chart 1 km on 172 px) the clamped glyph is
  // smaller than the island drawn at the same scale
  const px = (lim, mpp) => Math.min(lim.max, Math.max(lim.min, row.lenM / mpp));
  for (const [lim, mpp, what] of [[row.px.big, 2400 / 275, 'the enlarged chart'], [row.px.small, 1000 / 86, 'the small chart']]) {
    assert.ok(px(lim, mpp) < isl / mpp, `${what}: ${px(lim, mpp).toFixed(1)} px under the island's ${(isl / mpp).toFixed(1)} px`);
  }
  assert.ok(row.px.big.min >= 14 && row.px.big.max <= 64 && row.px.small.min >= 12 && row.px.small.max <= 20, 'floors and caps');
  // a tap's waypoint: inside her edge toward the boat, clear of her glyph (more than half its length from the centre)
  const w = row.pickAt(1200, -1050), dc = Math.hypot(w.x - W.x, w.z - W.z);
  assert.ok(dc > row.lenM && dc <= W.r - 30 && Math.hypot(1200 - w.x, -1050 - w.z) < Math.hypot(1200 - W.x, -1050 - W.z), `the waypoint ${dc.toFixed(0)} m from her centre, toward the boat`);
  assert.deepEqual(row.pickAt(W.x + 10, W.z), { x: W.x, z: W.z }, 'from inside her water: the centre');
  mode = 'cruise'; assert.equal(M.areas().length, 1, 'Cruise charts her water too');
  mode = 'race'; assert.equal(M.areas().length, 0, 'a race: the course tool owns the chart');
});

test('the ring: until the first visit (the boat inside her water), then never again on this device; still under reduced motion', () => {
  const store = memStore();
  let boat = { x: 1200, z: -1050 }, reduced = false;
  const M = createTessieMark({ on: () => true, area: W, boat: () => boat, store, reduced: () => reduced });
  M.update();
  assert.equal(M.areas()[0].ring, true, 'far away: the ring');
  reduced = true; assert.equal(M.areas()[0].still, true, 'reduced motion: one still ring');
  boat = { x: W.x + W.r + 40, z: W.z }; M.update();
  assert.equal(M.areas()[0].ring, true, 'near but outside: still the ring');
  boat = { x: W.x + W.r - 10, z: W.z }; M.update();
  assert.equal(M.visited, true); assert.equal(M.areas()[0].ring, false, 'inside: the ring stops');
  boat = { x: 1200, z: -1050 }; M.update();
  assert.equal(M.areas()[0].ring, false, 'and stays off when she sails away');
  const again = createTessieMark({ on: () => true, area: W, boat: () => boat, store });
  assert.equal(again.areas()[0].ring, false, 'a reload on the same device: no ring');
  const blocked = createTessieMark({ on: () => true, area: W, boat: () => boat, store: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  assert.equal(blocked.areas()[0].ring, true, 'storage blocked: the ring, and no throw');
});

test('a tap on the mark: the skipper\'s line (once a minute at most); other picks say nothing', () => {
  const said = [];
  let t = 0;
  const M = createTessieMark({ on: () => true, area: W, say: (s) => said.push(s), now: () => t, store: memStore() });
  assert.equal(M.picked({ x: W.x, z: W.z, name: "Tessie's water", area: 'tessieWaters' }), TESSIE_MARK.line);
  assert.equal(said[0], 'Locals say she likes the deep water by the island.');
  t = 30; assert.equal(M.picked({ area: 'tessieWaters' }), null, 'not again within a minute');
  t = 61; assert.equal(M.picked({ area: 'tessieWaters' }), TESSIE_MARK.line);
  assert.equal(M.picked({ x: 1, z: 2, name: null }), null, 'a plain pick');
  const off = createTessieMark({ on: () => false, area: W, say: (s) => said.push(s), store: memStore() });
  assert.equal(off.picked({ area: 'tessieWaters' }), null, 'off: nothing');
});

test('the glyphs: original engraved SVG (her humps with gold scutes, her face, the sea), and the dial\'s silhouette', () => {
  const big = tessieMarkSvg(), dial = tessieDialSvg();
  for (const s of [big, dial]) { assert.match(s, /^<svg [^>]*viewBox="0 0 \d+ \d+"/); assert.ok(s.endsWith('</svg>')); assert.ok(!/NaN|undefined/.test(s), 'no bad numbers'); }
  assert.ok(big.includes('#c9a45a') && big.includes('#efe6d2') && big.includes('#1c2340'), 'the home card\'s gold, the cream ink, the navy');
  assert.ok((big.match(/clip-path="url\(#tm-/g) ?? []).length >= 4, 'the hatching clipped to her parts');
  assert.ok(big.length < 40000 && dial.length < 3000, `small enough: ${big.length} and ${dial.length} chars`);
});

// ---- the director with her water ----
const lake = (x, z) => (Math.hypot(x, z) < 60 ? -3 : 45);   // deep water but a small island at the origin
const view = (b) => ({ x: b.x - Math.sin(b.heading) * 32, z: b.z + Math.cos(b.heading) * 32, yaw: b.heading, hHalf: Math.atan(Math.tan(20.6 * Math.PI / 180) * 16 / 9) });
// a boat circling at radius rc about (cx, cz) (so it stays where it is put), u m/s; when she rises is the stage's (her act
// alone, its nearby row read against this area)
const TACT = actById('tessie');
function circle({ area, seed = 1, secs, dt = 1 / 10, cx, cz, rc = 120, u = 2.2 }) {
  const t = createTessie({ seed, depthAt: lake, area });
  let a = 0, b = null;
  const stage = createStageDirector({ acts: [TACT], seed, ctx: { tessie: { sim: t } }, near: (id, m) => !!b && Math.hypot(b.x - area.x, b.z - area.z) - area.r <= m });
  for (let k = 0, n = Math.round(secs / dt); k < n; k++) {
    a += u / rc * dt;
    // the tangent: forward (sin h, −cos h) along d/da (−sin a, cos a)
    b = { x: cx + Math.cos(a) * rc, z: cz + Math.sin(a) * rc, heading: Math.atan2(-Math.sin(a), -Math.cos(a)), speed: u };
    stage.step(dt, { playing: true });
    t.step(dt, { playing: true, boat: b, view: view(b) });
  }
  return t;
}
const area = { x: 1000, z: -800, r: 200 };

test('near her water (the stage\'s nearby row): the sightings are inside it, every 1–2 min; the opening keeps its 25 s', () => {
  for (const seed of [1, 2, 3]) {
    const t = circle({ area, seed, secs: 420, cx: area.x, cz: area.z });
    const s = t.sightings;
    assert.ok(s.length >= 4, `seed ${seed}: ${s.length} sightings in 7 min near her water`);
    assert.ok(Math.abs(s[0].breakAt - TACT.opening.atS) <= TACT.opening.jitterS + 0.2, `seed ${seed}: the opening at ${s[0].breakAt} s`);
    for (const q of s) assert.equal(q.inArea, true, `seed ${seed}: sighting ${q.n} at (${q.x}, ${q.z}) inside her water`);
    for (let i = 1; i < s.length; i++) {
      const gap = s[i].breakAt - s[i - 1].breakAt;
      assert.ok(gap >= TACT.nearby.gapS[0] && gap <= TACT.nearby.gapS[1] + 60, `seed ${seed}: ${gap.toFixed(0)} s between breaks`);
    }
  }
  // within 300 m of the edge counts as near (the boat circles 150–250 m outside it)
  const t = circle({ area, seed: 4, secs: 300, cx: area.x + area.r + 200, cz: area.z, rc: 50 });
  assert.ok(t.sightings.length >= 2 && t.sightings.every((q) => q.near && q.inArea), `near the edge: ${JSON.stringify(t.sightings.map((q) => [q.near, q.inArea]))}`);
});

test('away from her water: today\'s opening, then rarer (her 4 min cooldown), placed round the boat as before', () => {
  const t = circle({ area, seed: 2, secs: 560, cx: -1500, cz: 1500 });
  const s = t.sightings;
  assert.ok(Math.abs(s[0].breakAt - TACT.opening.atS) <= TACT.opening.jitterS + 0.2, `the opening at ${s[0].breakAt} s`);
  assert.equal(s[0].inArea, false); assert.equal(s[0].near, false);
  assert.ok(s.length >= 2, `${s.length} sightings`);
  const gap = s[1].breakAt - s[0].breakAt;
  assert.ok(gap >= TACT.random.cooldownS && gap <= TACT.random.cooldownS + STAGE.RANDOM_S[1] + 60, `${gap.toFixed(0)} s between breaks (rarer)`);
  // no area: the old cadence and placement, unchanged
  const plain = createTessie({ seed: 2, depthAt: lake });
  assert.equal(plain.area, null);
});
