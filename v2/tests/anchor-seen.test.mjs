// The anchor seen (owner, 2026-11-17: "Do we have an anchor animation? I have never seen the anchor work once."): v2/sim/seamanship.js
// on v2's boat, v2/sim/anchorages.js on the planner's depth grid. Too fast, the crew stops her and it goes; too deep, the skipper
// names the nearest charted anchorage, really 3–20 m deep; the chart's anchorages are 3–20 m and the baked file is a fresh bake;
// the splash where the anchor meets the water and the break-out on the way up; the Boat view's ease toward the bow (Calm camera
// too), handed back only by the player's own look (a drag or the wheel through the follow camera, never a click or a key); "Anchor's holding." once the chain is taut and still, "We're dragging" once it moves after that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { createSeamanship, ANCHORING } from '../sim/seamanship.js';
import { nearestAnchorage, spotLine, relBearing, sayDistance } from '../sim/anchorages.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { steadyWind } from '../../src/sim/boat.js';
import { SEA_NOTES as NOTES } from '../ui/seamanship.js';
import { keeps } from '../../src/ui/phoneQuiet.js';

const flat = waterFor(() => 0);
const SPOTS = JSON.parse(readFileSync(new URL('../sim/anchorages.json', import.meta.url), 'utf8')).spots.map(([x, z, depth, shelter, name]) => ({ x, z, depth, shelter, name }));
const WORLD = JSON.parse(readFileSync(new URL('../cruise/chartWorld.json', import.meta.url), 'utf8'));
const chart = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(new URL('../ui/planChart.bin', import.meta.url))))), chartInputs(WORLD));

// a boat on flat water; wind(): { kn, from } read every sample (a test may change it); depthAt the bottom
function boat({ depthAt = () => 8, wind = { kn: 10, from: 0 }, x = 0, z = 0, heading = 90, speed = 0, anchorages = [] } = {}) {
  const B = createBoatSim({ water: flat, heightAt: (px, pz) => -depthAt(px, pz), wind: { sample: (px, pz, t) => steadyWind(wind.kn * KN, wind.from)(px, pz, t) }, start: { x, z, headingDeg: heading, speed } });
  const said = [];
  const sea = createSeamanship({ B, depthAt, say: (id, key, d) => said.push({ id, d }), timeScale: 1, anchorages });
  B.sea = sea;
  const ids = () => said.map((s) => s.id);
  const run = (secs, each = null) => { for (let i = 0; i < Math.round(secs * 60); i++) { B.step(1 / 60, { steer: 0, pull: 0 }); if (each?.(i / 60) === true) return true; } return false; };
  return { B, sea, said, ids, run, wind };
}

test('too fast: the crew rounds her up, takes the way off and lets go under 1 kn (no refusal)', () => {
  const { B, sea, ids, run } = boat({ speed: 2.6, wind: { kn: 10, from: 0 } });
  run(5);
  assert.ok(B.state.sog > 2 * sea.A.dropMs, `she sails at ${(B.state.sog / KN).toFixed(1)} kn`);
  assert.equal(sea.actions.anchor(), 'stopping');
  assert.deepEqual(ids(), ['rounding'], 'one line: "Rounding up to anchor"');
  assert.match(NOTES.rounding.text, /^Rounding up to/);
  let sogAtDrop = null;
  const twa0 = Math.abs(B.state.trueWind.angle);
  const dropped = run(30, () => { if (sea.tackle.state.anchor.phase !== 'stowed') { sogAtDrop = B.state.sog; return true; } return false; });
  assert.ok(dropped, 'the anchor goes within 30 s');
  assert.ok(sogAtDrop < sea.A.dropMs, `let go at ${(sogAtDrop / KN).toFixed(2)} kn (under 1 kn)`);
  assert.ok(Math.abs(B.state.trueWind.angle) < twa0 - 0.2, 'she rounds up toward the wind');
  assert.ok(sea.engine.lever < 0 && B.state.u < 0.25, 'the engine astern as her way comes off: she backs onto the chain');
  assert.ok((B.state.furl ?? 0) > 0.5, 'the sails down');
  assert.ok(!ids().includes('fast'), 'never the "under 1 kn" refusal');
});

test('too fast and the player cancels: J again lets it be, the sails as they were', () => {
  const { sea } = boat({ speed: 2.6 });
  assert.equal(sea.actions.anchor(), 'stopping');
  assert.equal(sea.actions.anchor(), 'cancel');
  assert.equal(sea.stopping, null); assert.equal(sea.furlWant, 0);
});

test('too deep: the skipper names the nearest charted anchorage, its distance and bearing, and it is 3–20 m deep', () => {
  // the middle of Emerald Bay east of the island (about 60 m of water on the chart), heading west
  const at = [250, -150];
  assert.ok(chart.depthAt(...at) > 20, `deep here: ${chart.depthAt(...at).toFixed(0)} m`);
  const { sea, said } = boat({ depthAt: (x, z) => chart.depthAt(x, z), x: at[0], z: at[1], heading: 270, anchorages: SPOTS });
  assert.equal(sea.actions.anchor(), 'deep');
  assert.equal(said.length, 1); assert.equal(said[0].id, 'deepSpot');
  const n = nearestAnchorage(SPOTS, at[0], at[1]);
  assert.ok(said[0].d.includes(n.spot.name), said[0].d);
  assert.match(said[0].d, /^\d+ m here\. .+, \d+ (m|km) (ahead|astern|to (port|starboard)|off the (port|starboard) (bow|quarter))$/, said[0].d);
  const d = chart.depthAt(n.spot.x, n.spot.z);
  assert.ok(d >= 3 && d <= 20, `${n.spot.name}: ${d.toFixed(1)} m on the chart`);
  assert.equal(sea.lastSpot, n.spot);
  // the line's words: tens of metres, then km; the bearing from the bow
  assert.equal(sayDistance(204), '200 m'); assert.equal(sayDistance(1430), '1.4 km');
  assert.equal(relBearing({ x: 0, z: 0, heading: 0 }, 0, -100), 'ahead'); assert.equal(relBearing({ x: 0, z: 0, heading: 0 }, 100, 0), 'to starboard');
  assert.equal(relBearing({ x: 0, z: 0, heading: Math.PI / 2 }, -100, 0), 'astern');
  assert.equal(spotLine({ name: 'Shallows by Fannette', x: 0, z: -200 }, { x: 0, z: 0, heading: 0 }), 'Shallows by Fannette, 200 m ahead');
  // with no chart the old line
  const bare = boat({ depthAt: () => 40 });
  assert.equal(bare.sea.actions.anchor(), 'deep'); assert.equal(bare.said[0].id, 'deep');
  // too shallow: as before
  const sh = boat({ depthAt: () => 2 });
  assert.equal(sh.sea.actions.anchor(), 'shallow');
});

test('the chart\'s anchorages: a few, spaced, 3–20 m deep with swinging room, on the lake\'s water; the file is a fresh bake', async () => {
  const { bakeAnchorages } = await import('../../tools/v2-anchorage-bake.mjs');
  assert.equal(readFileSync(new URL('../sim/anchorages.json', import.meta.url), 'utf8'), bakeAnchorages(), 'v2/sim/anchorages.json is tools/v2-anchorage-bake.mjs\'s output');
  assert.ok(SPOTS.length >= 6 && SPOTS.length <= 14, `${SPOTS.length} spots`);
  assert.ok(SPOTS.filter((s) => s.x > -1300 && s.x < 1800 && s.z > -2000 && s.z < 500).length >= 2, 'at least two in Emerald Bay');
  for (const s of SPOTS) {
    const d = chart.depthAt(s.x, s.z);
    assert.ok(d >= 3 && d <= 20, `${s.name}: ${d.toFixed(1)} m`);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, q = chart.depthAt(s.x + Math.cos(a) * 30, s.z + Math.sin(a) * 30); assert.ok(q >= 3 && q <= 20, `${s.name}: ${q.toFixed(1)} m 30 m off`); }
    assert.ok(chart.shoreAt(s.x, s.z) >= 50, `${s.name}: room off the shore`);
    for (const o of SPOTS) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= 1500, `${s.name} and ${o.name} 1.5 km apart`);
  }
  assert.equal(new Set(SPOTS.map((s) => s.name)).size, SPOTS.length, 'one spot a name');
});

test('the splash where the anchor meets the water, the break-out with drips on the way up; the events drain once', () => {
  const { B, sea, run } = boat({ wind: { kn: 4, from: 0 } });
  assert.equal(sea.drain().length, 0);
  assert.equal(sea.actions.anchor(), 'drop');
  const ev = [];
  run(4, () => { ev.push(...sea.drain()); });
  const kinds = ev.map((e) => e.kind);
  assert.deepEqual(kinds, ['letgo', 'splash'], kinds.join(','));
  const sp = ev[1];
  assert.equal(sp.at[1], 0, 'on the water');
  const bow = [B.state.x + Math.sin(B.state.heading) * sea.A.bowX, B.state.z - Math.cos(B.state.heading) * sea.A.bowX];
  assert.ok(Math.hypot(sp.at[0] - bow[0], sp.at[2] - bow[1]) < 1.5, 'at the bow');
  assert.equal(sea.drain().length, 0, 'drained');
  run(60);
  sea.actions.anchor();   // weigh
  const up = [];
  run(240, () => { up.push(...sea.drain()); return sea.tackle.state.anchor.phase === 'stowed'; });
  assert.ok(up.some((e) => e.kind === 'break'), `the anchor breaks the surface: ${up.map((e) => e.kind).join(',')}`);
});

test('the Boat view eases toward the bow and stays there while she lies to it; back on the player\'s own look or after the weighing', () => {
  const pose = () => ({ pos: [0, 4, 14], target: [0, 1, -10], fov: 50, near: 0.5 });
  const look = (sea) => sea.camera(1 / 60, pose());
  const dirTo = (q) => { const d = [q.target[0] - q.pos[0], q.target[1] - q.pos[1], q.target[2] - q.pos[2]], n = Math.hypot(...d); return d.map((v) => v / n); };
  {
    const { B, sea, run } = boat({ wind: { kn: 6, from: 0 }, heading: 0 });
    B.viewOf = () => 'follow';
    globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) });   // Reduce Motion: the bow look still runs (owner 2026-11-18: "I did not see the camera move")
    sea.actions.anchor(); run(5, () => { look(sea); });
    const c = look(sea), p0 = pose();
    assert.ok(sea.bowLook, 'the bow look runs');
    assert.ok(dirTo(c)[1] < dirTo(p0)[1] - 0.02, 'it looks down toward the bow');
    assert.ok(Math.abs(c.fov - 50) < 1e-9, 'no zoom, no shake: one smooth blend');
    // it stays: 40 s at anchor, the camera still at the bow (the wide arrival shot never takes over)
    run(40, () => { look(sea); });
    assert.ok(sea.bowLook && dirTo(look(sea))[1] < dirTo(p0)[1] - 0.02, 'still at the bow while she lies to it');
    assert.equal(sea.arrival, null, 'no wide shot');
    // a key or a click (sea.touched: the page's keydown and pointerdown) is not a look: it stays
    sea.touched(); run(0.5, () => { look(sea); });
    assert.ok(sea.bowLook && sea.bowLook.out == null, 'a key or a click is not a hand on the camera: it stays');
    // the follow camera with no hands on it: still no look
    B.camera(1 / 60); run(0.5, () => { look(sea); });
    assert.ok(sea.bowLook && sea.bowLook.out == null, 'the follow camera alone hands nothing back');
    // a drag on the view (the follow camera's orbit): eased back over 6 s, a little longer where the 14°/s cap holds the ease's clock
    B.input({ orbit: [0.02, 0] }); B.camera(1 / 60); run(14, () => { look(sea); });
    assert.deepEqual(look(sea), pose(), 'back to the Boat view after a drag on the view');
    assert.equal(sea.bowLook, null);
    delete globalThis.matchMedia;
  }
  {
    // the wheel's zoom on the view is a look too
    const { B, sea, run } = boat({ wind: { kn: 6, from: 0 }, heading: 0 });
    B.viewOf = () => 'follow';
    sea.actions.anchor(); run(8, () => { look(sea); });
    assert.ok(sea.bowLook);
    B.input({ zoom: 1.1 }); B.camera(1 / 60); run(1, () => { look(sea); });
    assert.ok(sea.bowLook?.out != null, 'the wheel on the view: easing back');
  }
  // after the weighing: it holds through the weighing shot, then eases back
  const { B, sea, run } = boat({ wind: { kn: 6, from: 0 }, heading: 0 });
  B.viewOf = () => 'follow';
  sea.actions.anchor(); run(30, () => { look(sea); });
  sea.actions.anchor();
  run(10, () => { look(sea); });
  assert.ok(sea.bowLook, 'the weighing in view');
  run(120, () => { look(sea); return sea.bowLook == null; });
  assert.equal(sea.tackle.state.anchor.phase, 'stowed');
  assert.deepEqual(look(sea), pose(), 'back after the anchor is up');
});

test('"Anchor\'s holding." once the chain is taut and still; "We\'re dragging" when it moves after that', () => {
  const { sea, said, ids, run, wind } = boat({ speed: 2.6, wind: { kn: 10, from: 0 } });
  sea.actions.anchor();
  const held = run(90, () => ids().includes('holding'));
  assert.ok(held, `holding within 90 s: ${ids().join(',')}`);
  assert.equal(NOTES.holding.speak, 'Anchor’s holding.');
  const a = sea.tackle.state.anchor;
  assert.equal(a.phase, 'held'); assert.ok(a.H > ANCHORING.holdN, `the rode taut: ${a.H.toFixed(0)} N`);
  assert.ok(!ids().includes('dragging'), 'the creep while it set is not dragging');
  assert.ok(ids().filter((i) => i === 'holding').length === 1);
  // a squall: 40 kn on the bow drags a 7 kg anchor
  wind.kn = 40;
  const dragged = run(120, () => ids().includes('dragging'));
  assert.ok(dragged, `"We're dragging": ${ids().join(',')}`);
  assert.match(NOTES.dragging.text, /^We’re dragging/);
  assert.ok(said.every((s) => s.id !== 'fast'));
  // a phone keeps them (they answer the Anchor tap)
  for (const id of ['rounding', 'deepSpot', 'holding', 'dragging']) assert.ok(keeps(`sea.${id}`, true), id);
});

test('the splash\'s droplets: a crown at the bow when the anchor hits the water, gone in about 2 s; drips after the break-out; nothing otherwise', async () => {
  const { createAnchorWaterFx, ANCHOR_SPLASH } = await import('../render/anchorSplash.js');
  const fx = createAnchorWaterFx({ seed: 1 });
  assert.equal(fx.live, false, 'nothing until an event');
  const { B, sea, run } = boat({ wind: { kn: 4, from: 0 } });
  sea.actions.anchor();
  let sp = null;
  run(4, () => { for (const e of sea.drain()) { if (e.kind === 'splash') sp = e; fx.emit(e); } fx.step(1 / 60, sea.anchorAt); return !!sp; });
  assert.ok(sp, 'the splash event');
  fx.step(1 / 60, sea.anchorAt);
  assert.ok(fx.count >= 60 && fx.count <= ANCHOR_SPLASH.max, `${fx.count} droplets`);
  let up = 0;
  for (const d of fx.sim.P) { assert.ok(Math.hypot(d.x - sp.at[0], d.z - sp.at[2]) < 0.6, 'at the anchor'); up = Math.max(up, d.vy); }
  assert.ok(up > 1, 'flung up');
  let maxY = 0;
  for (let i = 0; i < 150; i++) { fx.step(1 / 60, sea.anchorAt); for (const d of fx.sim.P) maxY = Math.max(maxY, d.y); }
  assert.ok(maxY > 0.2 && maxY < 0.8, `up to ${maxY.toFixed(2)} m`);
  assert.equal(fx.live, false, 'all fallen back by 2.5 s');
  // the break-out: a few drops and drips off the anchor while it rises (it hangs above the water)
  fx.emit({ kind: 'break', at: [B.state.x, 0, B.state.z] });
  for (let i = 0; i < 60; i++) fx.step(1 / 60, [B.state.x, 0.4, B.state.z]);
  assert.ok(fx.dripping && fx.count > 0, 'dripping');
  for (let i = 0; i < 240; i++) fx.step(1 / 60, [B.state.x, 0.9, B.state.z]);
  assert.equal(fx.live, false, 'done');
});

test('the anchor\'s sound: the rattle rises with the chain\'s speed and is silent when it stops; the level by distance', async () => {
  const { rattleMix, anchorGain } = await import('../audio/anchorSound.js');
  assert.equal(rattleMix(0).gain, 0); assert.equal(rattleMix(0.02).gain, 0);
  assert.ok(rattleMix(1.6).gain > rattleMix(0.3).gain && rattleMix(0.3).gain > 0, 'louder as it runs faster');
  assert.ok(rattleMix(-1.2).gain > 0, 'coming in too');
  assert.ok(rattleMix(1.6).rate > rattleMix(0.3).rate);
  assert.equal(anchorGain(0), 1); assert.ok(anchorGain(20) > 0.7 && anchorGain(20) < 0.8); assert.ok(anchorGain(200) < 0.1);
});

test('the chart: an anchorage under a tap (the nearest within 16 px), none past it', async () => {
  const { anchorageAt, ANCHOR_GLYPH } = await import('../../src/ui/chartplotter.js');
  const toPx = (x, z) => [x / 10 + 200, z / 10 + 200];   // 10 m a px round (0, 0) at (200, 200)
  const list = SPOTS.slice(0, 2);
  const a = list[0], q = toPx(a.x, a.z);
  assert.equal(anchorageAt(list, toPx, q[0] + 6, q[1] - 5), a);
  assert.equal(anchorageAt(list, toPx, q[0] + ANCHOR_GLYPH.hitPx + 1, q[1]), null);
  assert.equal(anchorageAt([], toPx, q[0], q[1]), null);
});

test('weighing feels complete: the chain in, the break-out, then she goes back to what she was doing, "Anchor\'s up."', () => {
  // under sail: the sails back up
  const a = boat({ speed: 2.6, wind: { kn: 8, from: 0 } });
  a.sea.actions.anchor(); a.run(40);
  assert.equal(a.sea.tackle.state.anchor.phase, 'held');
  assert.equal(a.sea.actions.anchor(), 'weigh');
  const ev = [];
  const up = a.run(90, () => { ev.push(...a.sea.drain()); return a.ids().includes('up'); });
  assert.ok(up, `"Anchor's up" within 90 s: ${a.ids().join(',')}`);
  assert.ok(ev.some((e) => e.kind === 'break'), 'the anchor broke the surface');
  assert.equal(a.sea.tackle.state.anchor.phase, 'stowed');
  assert.equal(a.sea.furlWant, 0, 'the sails go back up');
  a.run(5);
  assert.ok(!a.sea.engine.on, 'the engine the crew started is off again');
  assert.equal(NOTES.up.speak, 'Anchor’s up.');
  // motoring with the sails down: the engine idles after, the sails stay down
  const m = boat({ wind: { kn: 4, from: 0 } });
  m.sea.actions.sails(); m.sea.actions.engine(); m.run(2); m.sea.actions.step(1); m.run(10);
  m.sea.actions.anchor(); m.run(40);
  m.sea.actions.anchor(); m.run(90, () => m.ids().includes('up'));
  m.run(2);
  assert.ok(m.sea.engine.on && m.sea.engine.lever === 0, 'the engine at idle, the player\'s again');
  assert.equal(m.sea.furlWant, 1, 'the sails stay down');
});

test('ANCHOR to "Anchor\'s holding." in about 12–15 s of play at Sail\'s 2 × (6–9 m, 8 kn)', () => {
  for (const depth of [6, 9]) {
    const B = createBoatSim({ water: flat, heightAt: () => -depth, wind: { sample: (px, pz, t) => steadyWind(8 * KN, 200)(px, pz, t) }, start: { x: 0, z: 0, headingDeg: 251, speed: 2.6 } });
    const said = [];
    const sea = createSeamanship({ B, depthAt: () => depth, say: (id) => said.push(id), timeScale: 2 });
    B.sea = sea;
    for (let i = 0; i < 120; i++) B.step(2 / 60, { steer: 0, pull: 0 }, 1 / 60);
    sea.actions.anchor();
    let at = null;
    for (let i = 0; i < 30 * 60 && at == null; i++) { B.step(2 / 60, { steer: 0, pull: 0 }, 1 / 60); if (said.includes('holding')) at = i / 60; }
    assert.ok(at != null && at >= 10 && at <= 16, `${depth} m: holding after ${at?.toFixed(1)} s of play`);
  }
});

test('the anchor light: one white all-round light at the masthead while anchored after dark, no sidelights; off when weighed', async () => {
  const { navLights, GLOW_FLOATS } = await import('../sim/night.js');
  const { DEFAULT_DIMS } = await import('../../src/sim/boat/dims.js');
  const mast = [0, DEFAULT_DIMS.HULL.mastStepY + DEFAULT_DIMS.RIG.mastTop, DEFAULT_DIMS.HULL.mastStepZ];
  const out = new Float32Array(4 * GLOW_FLOATS), pose = { x: 0, z: 0, heading: 0, heave: 0, pitch: 0, heel: 0 };
  const lit = (o) => [0, 1, 2, 3].map((i) => o[i * GLOW_FLOATS + 7]);
  navLights(out, { pose: { ...pose, anchorLight: true }, sunElevDeg: -10, eye: [0, 3, -60], dims: DEFAULT_DIMS.HULL, anchored: true, mastHead: mast });
  let L = lit(out);
  assert.ok(L[3] > 0 && L[0] === 0 && L[1] === 0 && L[2] === 0, `anchored: the masthead only (${L.join(', ')})`);
  assert.ok(Math.abs(out[3 * GLOW_FLOATS + 1] - mast[1]) < 0.01, 'at the masthead');
  navLights(out, { pose, sunElevDeg: -10, eye: [0, 3, -60], dims: DEFAULT_DIMS.HULL, anchored: false, mastHead: mast });
  L = lit(out);
  assert.ok(L[3] === 0 && (L[0] > 0 || L[1] > 0), 'under way: the sidelights, no anchor light');
  navLights(out, { pose, sunElevDeg: 20, eye: [0, 3, -60], dims: DEFAULT_DIMS.HULL, anchored: true, mastHead: mast });
  assert.equal(lit(out)[3], 0, 'by day: dark');
  // the pose flag from the seamanship
  const { B, sea, run } = boat({ wind: { kn: 4, from: 0 } });
  sea.actions.anchor(); run(20);
  assert.equal(B.pose.anchorLight, true);
  sea.actions.anchor(); run(120, () => sea.tackle.state.anchor.phase === 'stowed'); run(0.1);
  assert.equal(B.pose.anchorLight, false, 'weighed: off');
});

test('the anchor\'s lines are voiced: every SEA_NOTES line has its clip in audio/skipper-v2/, both formats, from the same words', async () => {
  const { existsSync } = await import('node:fs');
  const { seaLines } = await import('../../tools/v2-sea-lines.mjs');
  const dir = new URL('../../audio/skipper-v2/', import.meta.url);
  const man = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));
  const lines = seaLines();
  assert.equal(lines.length, Object.keys(NOTES).length, 'one line a note');
  for (const l of lines) {
    assert.equal(man.clips[l.hash]?.text, l.text, `${l.ids}: a clip of these words`);
    for (const ext of ['opus', 'm4a']) assert.ok(existsSync(new URL(`${l.hash}.${ext}`, dir)), `${l.hash}.${ext}`);
  }
  assert.deepEqual(Object.keys(man.clips).sort(), lines.map((l) => l.hash).sort(), 'no stale clip');
  assert.ok(!/\d/.test(NOTES.deepSpot.speak), 'the deep line speaks its fixed part (no depth, no distance)');
});

// the Boat view as v2's follow camera keeps it: 14 m behind her and 4 m up, aimed 10 m ahead, turning with her heading
const followPose = (s) => { const fx = Math.sin(s.heading), fz = -Math.cos(s.heading); return { pos: [s.x - fx * 14, 4, s.z - fz * 14], target: [s.x + fx * 10, 1, s.z + fz * 10], fov: 50, near: 0.5 }; };
const dirOf = (q) => { const d = [q.target[0] - q.pos[0], q.target[1] - q.pos[1], q.target[2] - q.pos[2]], n = Math.hypot(...d); return d.map((v) => v / n); };
const angDeg = (a, b) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
// in, a swing at anchor, out: the view's turn rate (deg/s) and its change frame to frame, at a frame rate
function bowRun(fps, secs = 60, { speed = 2.6, kn = 10 } = {}) {
  const { B, sea } = boat({ speed, wind: { kn, from: 0 } });
  B.viewOf = () => 'follow';
  sea.actions.anchor();
  const dt = 1 / fps, rates = [], poses = [];
  let prev = null, bowSeen = false;
  for (let i = 0; i < secs * fps; i++) {
    B.step(dt, { steer: 0, pull: 0 }, dt);
    if (i === Math.round(40 * fps)) sea.looked();   // the player's hand on the view at 40 s: eased back
    const c = sea.camera(dt, followPose(B.state)), d = dirOf(c);
    bowSeen ||= !!sea.bowLook;
    if (prev) rates.push(angDeg(prev, d) / dt);
    prev = d; poses.push({ t: (i + 1) * dt, pos: c.pos.slice(), d });
  }
  // the follow camera's own turn (her swing) is the reference: the bow look may not add to it beyond the cap
  return { rates, poses, bowSeen, sea };
}

test('the bow camera is slow and smooth: the view turns at most 15°/s, no jolt, the same at 30 and 144 fps, and back calmly', () => {
  const a = bowRun(60);
  assert.ok(a.bowSeen, 'the bow look ran');
  const max = Math.max(...a.rates);
  assert.ok(max <= ANCHORING.bow.maxDegS, `max turn rate ${max.toFixed(1)}°/s`);
  // smooth: the turn rate changes by little between frames (no step from a linear start or a cut): ≤ 40°/s² over the run
  let jerk = 0;
  for (let i = 1; i < a.rates.length; i++) jerk = Math.max(jerk, Math.abs(a.rates[i] - a.rates[i - 1]) * 60);
  assert.ok(jerk <= 40, `the turn rate changes at most ${jerk.toFixed(1)}°/s²`);
  assert.equal(a.sea.bowLook, null, 'back to the Boat view after the hand on the view');
  // framerate-independent: the pose at the same moment within a few cm and a fraction of a degree
  const b = bowRun(30, 12, { speed: 0, kn: 3 }), c = bowRun(144, 12, { speed: 0, kn: 3 });   // from rest: the boat's own path the same at both rates
  for (const T of [2, 5, 8, 11]) {
    const pb = b.poses.find((p) => p.t >= T - 1e-9), pc = c.poses.find((p) => p.t >= T - 1e-9);
    const dp = Math.hypot(pb.pos[0] - pc.pos[0], pb.pos[1] - pc.pos[1], pb.pos[2] - pc.pos[2]);
    assert.ok(dp < 0.5 && angDeg(pb.d, pc.d) < 1.5, `${T} s: ${dp.toFixed(2)} m, ${angDeg(pb.d, pc.d).toFixed(2)}° apart at 30 and 144 fps`);
  }
});

test('the anchor\'s voice speaks a line only once the skipper\'s row shows it; the lines carry explicit kinds for the lean skipper', async () => {
  const { createShownVoice, SEA_KINDS } = await import('../ui/seamanship.js');
  let row = '', clock = 0;
  const spoken = [];
  const v = createShownVoice({ speak: (t) => spoken.push(t), shownText: () => row, now: () => clock });
  // the row shows it: spoken once
  v.say('holding'); v.poll(); assert.deepEqual(spoken, [], 'not before the row shows it');
  row = 'Anchor’s holding.'; v.poll(); v.poll();
  assert.deepEqual(spoken, ['Anchor’s holding.'], 'spoken when shown, once');
  // a line the row drops (another line stays up): never spoken
  row = 'Sails coming down…'; v.say('rounding');
  for (let i = 0; i < 40; i++) { clock += 0.1; v.poll(); }
  assert.deepEqual(spoken, ['Anchor’s holding.'], 'a dropped line is never voiced');
  assert.equal(v.pending, null, 'given up after its wait');
  // the kinds: deepSpot and dragging must be acted on, holding teaches once, the rest is chatter
  assert.deepEqual(SEA_KINDS, { 'sea.rounding': 'chat', 'sea.deepSpot': 'must', 'sea.holding': 'tip', 'sea.dragging': 'must', 'sea.up': 'chat', 'sea.anchorage': 'chat' });
});
