// The living lake's plug-ins (refactor round 3, Phase C step C2; the contract: engine/plugins.js). Each feature is one object
// here and one row per anchor in ORDER; boot() calls plugins.run(anchor) where it called the feature by hand before.
// ORDER is boot()'s order before the move, anchor by anchor (tests/plugins.test.mjs asserts it): a moved feature keeps its place
// between the hand-wired calls round it (the boat, the water, the sky), so the step and draw order is the same frame for frame.
//   create.<x>   where it is made (its pipelines declared there: the pipeline order unchanged)
//   attach       after the boat (its clocks, the boat's tick)
//   boat         the boat's tick (B.sea.addPost), in the order the posts were added
//   audio        the page's sound handed over (after the first frame's audio is made)
//   compute.water   the water-sim pass (after the wake's and Tessie's maps)
//   fill.boats / fill.living / fill.birds   the frame's CPU fill (records up), round the boat's update, Tessie's fill
//   night.lights the lit records (reduce: the count so far → the count after)
//   scene.*      the scene pass's draw slots (sceneDraw), each between the same hand-wired draws as before
//   sim.living   the living clock's step (after the camera, before the stage and Tessie)
//   prime.<x>    the data in before the first frame (capture, ?filmui=1, live: each plug-in's prime.paths)
//   stats.<x>    its keys in hook._stats at the same place
import { createKayaksPlugin } from './kayaks.js';
import { createTourBoatPlugin } from './tourBoat.js';
import { createPaddlePlugin } from './paddleWheeler.js';
import { createPowerPlugin } from './powerBoats.js';
import { trafficOf } from '../sim/regions.js';
import { pageSettings } from '../ui/settingsStore.js';   // Tessie's row: her sound's switches, her key hints
import { reducedNow } from '../sim/steadyCamera.js';
import { createBusyLake, BUSY, bumpAt } from './busyLake.js';
import { createAnchoredBoats, ANCHORED_BOATS } from '../sim/anchoredBoats.js';
import { packTint, MAX_NEAR_RIVALS } from '../render/boat.js';
import { packArt } from '../render/sailArt.js';
import { createRivalFloats } from '../regatta/rivalFloat.js';
import { fleetLod, LOD_BANDS, lodState } from '../regatta/lod.js';
import { DEG } from '../engine/math.js';
import { actById } from '../stage/acts.js';
import { REGIONS, residentKayaks, regionsWithBirthplaces, regionLoaded } from './busyLake.js';
import { supsLoaded } from './sup.js';
import { polyline } from '../../src/sim/kayaks/routes.js';
import { listBirthplaces } from '../sim/birthplace.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

// the draw slots' and fills' shared frame state: s = { race, uw } (sceneDraw), f = { eye, focal, race } (fill)
const KAYAKS = {
  id: 'kayaks', group: 'kayaks', createAt: 'living', statsAt: 'living',
  // the living lake: v1's fleet and its first pair in view at the start, v1's paddlers and strokes (?kayaks=0 off: create → null)
  on: (c) => c.boatOn,
  create: (c) => createKayaksPlugin({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, shadow: c.shadow, hdrTarget: c.hdrTarget, msaa: c.P.msaa, depthFormat: c.depthFormat, errors: c.errors, flags: c.flags, P: c.P, tBase: c.tBase, manifest: c.manifest, terrain: c.terrain, mirrors: c.feature('boatMirrors').tier === 'all', under: c.under,
    sup: c.feature('paddleboards').tier !== 'off' && supsLoaded(c.levelKey) ? { tier: c.feature('paddleboards').tier, loaded: c.levelKey } : null }),   // the paddleboarders: only a start in a region with its own level and boards (South Lake), on a tier that has them
  at: {
    // round B: the shore launch (v2/living/kayakLaunch.js); the kayakers watch Tessie; birth: Sail's first birth pose (busyLake.js
    // birthLane: a pair passes within a minute; fixed now, a move never re-places them); its downloads wait for its group too;
    // L2: v1's fleet.js storm (no day kayakers while a storm runs); v1's fleet.js EVENING: the show's evening, no first pair
    attach: (k, c) => {
      if (!c.B) return;
      const { B, clock, P, sailBirth, startPose, birthRow } = c;
      k.attach({ B, water: c.water, clock, windField: c.windField, ui: () => c.m4.ui, start: startPose, evening: () => c.plugins.has('fireworks') && clock.hour > 20.5 && clock.hour < 22.67, storm: () => !!c.storm.running, firstPair: () => !!actById('kayaks')?.opening, hold: () => !c.cockpitIn || !c.pipeQ.has('kayaks'),
        residents: c.feature('regionKayaks').on ? ((birth) => (hour) => residentKayaks(REGIONS, listBirthplaces(CURRENT_WATERS), { seed: P.seed, hour, polyline, birth, loaded: c.levelKey }))(sailBirth ? { x: startPose.x, z: startPose.z, headingDeg: startPose.headingDeg, speed: startPose.speed, region: birthRow.region, hour: clock.hour } : null) : null,
        launch: { regions: regionsWithBirthplaces(REGIONS, listBirthplaces(CURRENT_WATERS)).filter((r) => regionLoaded(r, c.levelKey)), race: () => !!c.regatta?.on, mode: () => c.modeNow(), player: () => c.player.pose() }, tessie: () => c.plugins.get('tessie')?.sim?.state ?? null });
    },
    audio: (k, c, audio) => k.setAudio(audio),   // a capsize's splash on the page's sound (v2/living/kayaks-sound.js)
    'fill.living': (k, c, f) => { if (!f.race) k.fill(f.eye, f.focal); },   // the palettes and the instance records (a race cuts them)
    'scene.solid': (k, c, pass, cc, s) => { if (c.L.kayaks && !s.race && c.PG.kayaks) k.draw(pass, cc); },   // opaque, before the water (the boat's order)
    'scene.mirror': (k, c, pass, cc, s) => { if (c.L.water && !s.race && c.PG.kayaks && !s.uw) k.drawMirror(pass, cc); },   // the kayakers' mirrors
    'sim.living': (k, c, dt) => { if (!c.regatta?.on) k.step(dt, c.kView()); },   // v1 paddles on the wall clock (not Sail's 2 ×), after the camera
  },
  // the shore grids and the asset in, the fleet made, the first pair laid in view (v1's capture start); a live page streams its own
  prime: { stage: 'boat', paths: ['capture', 'filmui'], run: (k, c) => k.prime(c.kView()) },
  stats: (k) => ({ kayaks: k?.stats() ?? null }),
  hook: (k) => ({ kayaks: k }),   // the fleet (stats, live, draws) and its renderer
};

// the glass boat (owner, 2026-11-18): a tour pontoon and her clear kayaks on a natural schedule through the bay; two
// pipelines in the boat effects' group, her paddlers on the kayaks' skin pipeline; a phone never makes her (src/core/features.js glassBoat)
const glassOn = (c, s) => (!s.race || c.regatta.glassRace) && c.PG.boatfx;   // nothing in a race but Glass Boat Chase
const TOUR = {
  id: 'tour', group: 'boatfx', createAt: 'living', statsAt: 'lake',
  on: (c) => c.boatOn && c.feature('glassBoat').tier !== 'off',
  create: (c) => createTourBoatPlugin({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, shadow: c.shadow, hdrTarget: c.hdrTarget, msaa: c.P.msaa, depthFormat: c.depthFormat, kayaks: c.plugins.get('kayaks'), P: c.P, flags: c.flags, tier: c.feature('glassBoat').tier, mirrors: c.feature('boatMirrors').tier !== 'off', mirrorKayaks: c.feature('boatMirrors').tier === 'all', errors: c.errors, wake: c.wake }),
  at: {
    // a first birth places her to be seen within a minute (sim/tourBoat.js birthPhase); a later move never re-places her; her run,
    // the yield, the bump in the boat's tick
    boat: (t, c) => {
      const { B } = c;
      if (!B || !c.boatR) return;
      t.attach({ B, water: c.water, terrain: c.terrain, windField: c.windField, clock: c.clock, onBump: (e) => c.beds?.cue('thud', { v: e.speed, mat: 'wood' }), birth: c.sailBirth ? { x: c.birthRow.x, z: c.birthRow.z } : null });
      B.sea?.addPost?.((st, dt, tt) => t.post(st, dt, tt));
    },
    'audio.late': (t, c, audio) => t.setAudio(audio),
    'compute.water': (t, c, pass, cc) => { if (c.PG.boatfx && (!c.regatta?.on || c.regatta.glassRace)) t.runWater(pass, cc); },   // her wake map
    'fill.boats': (t, c, f) => t.fill(f.eye, f.focal, f.sun.elevDeg, f.race && !c.regatta.glassRace, [f.sun.x, f.sun.y, f.sun.z]),   // her records
    'night.lights': (t, c, n, out, o) => (o.on && (!c.regatta?.on || c.regatta.glassRace) ? n + t.lights(out, n * 8, { sunElevDeg: o.sunElevDeg, heightAt: o.heightAt }) : n),   // her nav lights (0 by day)
    'scene.solid3': (t, c, pass, cc, s) => { if (glassOn(c, s)) t.drawSolid(pass, cc, c.plugins.has('kayaks') && c.PG.kayaks); },   // the pontoon, the kayaks' rims and seats, her paddlers (opaque)
    'scene.water': (t, c, pass, cc, s) => { if (glassOn(c, s) && c.L.water && !s.uw) t.drawMirror(pass, cc); },   // her mirror in the surface
    'scene.clear': (t, c, pass, cc, s) => { if (glassOn(c, s) && !s.uw) t.drawClear(pass, cc); },   // the clear hulls, the windows, the LEDs' pools, her wake
  },
  prime: { stage: 'boat', paths: ['capture', 'filmui'], run: (t) => t.prime() },   // her paddlers' asset in
  stats: (t) => ({ tour: t?.stats() ?? null }),
  hook: (t) => ({ tour: t }),
};

// the paddle-wheeler (South Lake's birthplace, phase C): a generic 46 m stern-wheeler, one model for every paddle-wheeler on the lake;
// one pipeline and one draw in the boat effects' group, the vessels' wake map (hers or the nearest runabout's; yielding it to the glass
// boat when hers is live), her nav lights. In play she runs her route (the south-lake region's traffic row of kind 'paddle': Ski Run ↔
// off Emerald Bay) on every start, drawn wherever her route lies within the draw distance; a first birth in her region meets her
// within 2 minutes; ?paddle=x,z,heading[,kn] places her straight for review (src/core/features.js paddleWheeler: full on a desktop or
// a tablet at L0-L1; lite, the mid and far LODs only, at L2-L3 and on a phone)
const paddleRow = () => trafficOf(CURRENT_WATERS, 'paddle')[0] ?? null;
const birthIn = (c, region) => (c.sailBirth && c.birthRow?.region === region ? { x: c.startPose.x, z: c.startPose.z, headingDeg: c.startPose.headingDeg ?? 0, look: c.birthRow.look ?? null } : null);
const PADDLE = {
  id: 'paddle', group: 'boatfx', createAt: 'living', statsAt: 'lake',
  on: (c) => c.boatOn && c.feature('paddleWheeler').tier !== 'off',
  create: (c) => createPaddlePlugin({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, shadow: c.shadow, hdrTarget: c.hdrTarget, msaa: c.P.msaa, depthFormat: c.depthFormat, flags: c.flags, tier: c.feature('paddleWheeler').tier, wake: c.wake, row: paddleRow() }),
  at: {
    boat: (p, c) => {
      const { B } = c;
      if (!B) return;
      p.attach({ depthAt: (x, z) => -c.terrain.field.height(x, z), hour: c.clock.hour, seed: c.P.seed, birth: birthIn(c, paddleRow()?.region), onBump: (e) => c.beds?.cue('thud', { v: e.speed, mat: 'wood' }) });
      B.sea?.addPost?.((st, dt) => p.post(dt, st));
    },
    'compute.water': (p, c, pass, cc) => { if (c.PG.boatfx) p.runWater(pass, cc); },   // the vessels' map (after the glass boat's)
    'fill.boats': (p, c, f) => p.fill(f.eye, f.sun.elevDeg, { heightAt: (x, z) => c.water.heightAt(x, z), race: f.race, wakeBusy: !!c.plugins.get('tour')?.wakeStats?.on, extra: (eye) => c.plugins.get('power')?.wakeEmitters(eye) ?? null }),
    'night.lights': (p, c, n, out, o) => (o.on && !c.regatta?.on ? n + p.lights(out, n * 8, { sunElevDeg: o.sunElevDeg, heightAt: o.heightAt }) : n),   // her nav lights (0 by day)
    'scene.solid3': (p, c, pass, cc, s) => { if (!s.race && c.PG.boatfx) p.draw(pass, cc); },   // her hull, decks and wheel (opaque, one draw)
  },
  stats: (p) => ({ paddle: p?.stats() ?? null }),
  hook: (p) => ({ paddle: p }),
};

// South Lake's power traffic (phase C; living/powerBoats.js, living/powerTraffic.js): two runabouts out of the Tahoe Keys and a jet ski
// off Ski Run on the busy lake's rules, made only for a start in their region (the region's level loaded: a bay start makes nothing);
// one pipeline, an instanced draw per kind and LOD; their wakes in the paddle-wheeler's vessels' map (their own when she has none);
// the nearest one's engine heard (src/core/features.js powerBoats: 3 boats on a desktop or a tablet at L0-L1, 2 at L2-L3, 1 on a phone)
const powerRows = (c) => trafficOf(CURRENT_WATERS).filter((r) => r.region === c.levelKey && (r.kind === 'power' || r.kind === 'jetski'));
const POWER_SIDE = new WeakMap();
const POWER_BOATS = {
  id: 'power', group: 'boatfx', createAt: 'living', statsAt: 'lake',
  on: (c) => c.boatOn && c.feature('powerBoats').tier !== 'off' && powerRows(c).length > 0,
  create: (c) => createPowerPlugin({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, shadow: c.shadow, hdrTarget: c.hdrTarget, msaa: c.P.msaa, depthFormat: c.depthFormat, tier: c.feature('powerBoats').tier, rows: powerRows(c), wake: c.wake, ownWake: !c.plugins.get('paddle')?.hasWake, headless: !!c.P.headless }),
  at: {
    boat: (p, c) => {
      const { B } = c;
      if (!B) return;
      p.attach({ seed: c.P.seed, hour: c.clock.hour, birth: birthIn(c, c.levelKey), depthAt: (x, z) => -c.terrain.field.height(x, z), onBump: (e) => c.beds?.cue('thud', { v: e.speed, mat: 'wood' }) });
      // what they give way to: the paddle-wheeler (her right of way), the lake's sailboats (power gives way to sail), the kayakers, Tessie seen
      const side = { others: [], pool: [], kay: null, kayT: -1e9 }; POWER_SIDE.set(p, side);
      const A = p.K.avoid;
      B.sea?.addPost?.((st, dt, t) => {
        const { others, pool } = side; others.length = 0; let n = 0;
        const put = (x, z, heading, u, m, seeM = null) => { const o = (pool[n++] ??= {}); o.x = x; o.z = z; o.heading = heading; o.u = u; o.m = m; o.seeM = seeM; others.push(o); };
        const PW = c.plugins.get('paddle')?.sim; if (PW?.routed) put(PW.boat.x, PW.boat.z, PW.boat.heading, PW.boat.v, A.paddleM);
        const L = c.plugins.get('busy'); if (L?.active) for (const b of L.liveBoats) { const q = b.phys.state; put(q.x, q.z, q.heading, Math.max(0, q.u ?? 0), A.boatM); }
        const K = c.plugins.get('kayaks'); if (K?.fleet && (t - side.kayT > 0.5 || !side.kay)) { side.kayT = t; side.kay = K.fleet.marks(); }
        if (side.kay) for (const k of side.kay) put(k.x, k.z, k.heading ?? 0, 1.2, A.kayakM);
        p.post(st, dt, t, { hour: c.clock.hour, race: !!c.regatta?.on, others });
      });
    },
    'audio.late': (p, c, audio) => p.setAudio(audio),
    'compute.water': (p, c, pass, cc) => { if (c.PG.boatfx) p.runWater(pass, cc); },   // their own map (only when the paddle-wheeler has none)
    'fill.boats': (p, c, f) => p.fill(f.eye, { focal: f.focal, heightAt: (x, z) => c.water.heightAt(x, z), race: f.race, wakeBusy: !!c.plugins.get('tour')?.wakeStats?.on || !!c.plugins.get('paddle')?.hasWake }),
    'scene.solid3': (p, c, pass, cc, s) => { if (!s.race && c.PG.boatfx) p.draw(pass, cc); },
  },
  stats: (p) => ({ power: p?.stats() ?? null }),
  hook: (p) => ({ power: p }),
};

// birds: v1's ospreys, eagles (one on the snag), gulls and geese (render/birds.js, sim/birds.js). ?birds=0 off; captures and automated
// browsers leave them out unless ?birds=1 (v1's rule: the goldens see none); the registry's birdsTier (a phone, a tablet, L2–L3 or the
// phone terrain) takes v1's 'low' tier. Their chunks are fetched early by boot (birdsModP, beside the switch); the flock is made once
// the terrain's heights are whole (prime 'terrain': a capture and a film before the first frame, a live page after the stream)
const BIRD = new WeakMap();   // the flock's own parts: its sound door, the storm's shelter, the make guard
const BIRDS = {
  id: 'birds', group: 'birds', createAt: 'birds', statsAt: 'birds',
  on: (c) => c.birdsOn,
  load: (c) => c.birdsModP,
  create: (c, [{ createBirds }, { shelterOf }, { createAudio, withGullCries }, { createBirdSound, BIRD_SOUNDS }]) => {
    const { P } = c;
    const audio = createAudio({ on: !P.headless });   // the birds' own sound door (v2/engine/birdAudio.js)
    const sound = !P.headless ? createBirdSound({ audio, base: new URL('audio/birds/', document.baseURI).href, fetchFn: (u, o) => fetch(u, o), sounds: withGullCries(BIRD_SOUNDS) }) : null;
    const b = createBirds({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, shadow: c.shadow, hdrTarget: c.hdrTarget, msaa: P.msaa, depthFormat: c.depthFormat, tier: c.feature('birds').tier === 'gulls' ? 'phone' : c.feature('birdsTier').tier, sound, wake: c.wake, dive: c.ospreyDiveOn, seed: P.seed });
    BIRD.set(b, { audio, shelterOf, making: false });
    return b;
  },
  at: {
    'audio.prepare': (b) => BIRD.get(b).audio.prepare(),   // its AudioContext at the page's first idle moment (refactor round 3 B6a)
    music: (b, c, music) => BIRD.get(b).audio.attach(({ master }) => music.follow(master, 1)),   // the birds' own door: the sound switch and M mute it too
    'compute.water': (b, c, pass, cc) => b.runWater(pass, cc),   // #24: the osprey's rings when the map is the birds'
    // the flock on real time (v1's scene time, never Sail's 2 ×), its records up, its calls; in the storm's rain they go to shelter (L1);
    // #24: the dive director on a live page; the splash's droplets
    'fill.birds': (b, c, f) => { if (!f.race) b.frame(c.livingNow(), f.eye, c.fwd, c.up, c.sunNow, BIRD.get(b).shelterOf(c.storm.rain), c.B && c.flags.filmui !== true && (!c.P.headless || c.stage?.state.on) ? c.birdBeat : null, f.focal); },
    'scene.solid2': (b, c, pass, cc, s) => { if (c.L.birds && !s.race && !s.uw) b.draw(pass, cc); },   // the snag and the flock, opaque (a dithered fade)
    'scene.water': (b, c, pass, cc, s) => { if (c.L.birds && !s.race && !s.uw) b.drawAfterWater(pass, cc); },   // the low birds' soft shadows on the water
  },
  // the lake's terrain: v1's (v2/sim/lake.js, through the kayaks' plug-in: the shore distance for the snag and the raft); without the
  // kayaks, heightAt over v2's grids and v1's fallback places; #24: no dive at all off a desktop (the registry's ospreyDive; ?birddive=0 too)
  prime: { stage: 'terrain', paths: ['capture', 'filmui', 'live'], run: async (b, c) => {
    const side = BIRD.get(b);
    if (b.sim || side.making) return;
    side.making = true;
    if (c.pipesDefer) await c.pipeQ.ready('birds');   // perf(v2) iOS pipelines: the flock once its pipelines are built
    const lake = await c.plugins.get('kayaks')?.lakeReady().catch(() => null);
    b.make({ terrain: lake ?? { heightAt: (x, z) => c.terrain.field.height(x, z) }, waterAt: (x, z) => c.water.heightAt(x, z), seed: c.P.seed,
      wind: c.windField,   // v1's WindField (the one wind: the birds read it twice a second, as v1's)
      boat: () => c.hook.boat?.state ?? null, dive: c.ospreyDiveOn });
  } },
  stats: (b, c) => ({ birds: b ? { ...b.stats, sim: b.sim ? { ...b.sim.stats } : null, tier: c.feature('birds').tier === 'gulls' ? 'phone' : c.feature('birdsTier').tier, gulls: b.sim?.circle?.state ?? null, dive: b.sim?.director ?? null, splash: b.splash ? { ...b.splash.stats } : null, ospreyDive: c.ospreyDiveOn } : null }),   // #24: the dive director and its splash
  // the flock for the harness (v1's director cues through sim.cue, find); frame(dt, aim): a capture's film step on the scene clock, then
  // the camera aimed by aim() → { pos, target, fov } (the goldens' birds recipe, v1's long lens)
  hook: (b, c) => ({ birds: b ? { get sim() { return b.sim; }, stats: () => b.stats, splash: b.splash, async frame(dt, aim) {
    const n = c.clock.advance(dt); c.simFrame(n, dt);
    const { eye, fwd } = c;
    b.frame(c.livingNow(), eye, fwd, c.up, c.sunNow, BIRD.get(b).shelterOf(c.storm.rain));
    const a = aim?.(b.sim);
    if (a) { eye[0] = a.pos[0]; eye[1] = a.pos[1]; eye[2] = a.pos[2]; const d = a.target.map((v, i) => v - a.pos[i]), l = Math.hypot(...d) || 1; fwd[0] = d[0] / l; fwd[1] = d[1] / l; fwd[2] = d[2] / l; if (a.fov) c.fovDeg = a.fov; }
    c.drawFrame(); await c.graph.settle();
  } } : null }),
};

// --- the lake's boats: the boats at anchor and the busy lake share the boat's rival slots (nearest first), so one fill places both
// (fillLake: run by the first of them that is on, once a frame); its records are the page's (LAKE: one set per ctx) ---
const LAKE = new WeakMap();
const lakeOf = (c) => {
  let k = LAKE.get(c);
  if (!k) LAKE.set(c, k = { anchoredPoses: Array.from({ length: MAX_NEAR_RIVALS }, () => ({ x: 0, z: 0, heave: 0, heading: 0, heel: 0, pitch: 0, tint: 0, bare: 1, key: null })), anchoredShown: 0,
    nearPoses: Array.from({ length: MAX_NEAR_RIVALS }, () => ({})), lakePoses: [], cands: [], lodOut: [], lodPts: [], lodSt: lodState(), n: { near: 0, mid: 0, far: 0 }, floatT: null, floats: null, art: new Map() });
  return k;
};
const BUSY_DRAW_M = 2600;
const rgbaOf = (hex) => { const h = parseInt(String(hex).replace('#', ''), 16); return (0xff000000 | ((h & 255) << 16) | (h & 0xff00) | ((h >> 16) & 255)) >>> 0; };   // render/raceProps.js rgbaOf (its chunk loads later)
// the lake's boats on the slots and the props, once a frame (no race on)
function fillLake(c) {
  const { boatR, eye, water } = c, anchored = c.plugins.get('anchored'), busy = c.plugins.get('busy'), k = lakeOf(c), busyN = k.n;
  if (!boatR || (!anchored && !busy)) return;
  const race = !!c.regatta?.on, raceProps = c.raceProps;
  if (anchored) anchored.active = !race;
  if (race) { k.anchoredShown = 0; busyN.near = busyN.mid = busyN.far = 0; if (raceProps?.stats.lake) { raceProps.lakeBegin(); raceProps.lakeEnd(); } return; }   // the race's rivals hold the slots (regatta/index.js setRivals)
  const cands = k.cands;
  cands.length = 0;
  const wy = (x, z) => water.heightAt(x, z);
  const near = anchored ? anchored.near(eye, MAX_NEAR_RIVALS) : [];
  for (let i = 0; i < near.length; i++) {
    const b = near[i].boat, o = k.anchoredPoses[i], x = b.x + b.ox, z = b.z + b.oz, fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
    const yb = wy(x + fx * 3, z + fz * 3), ys = wy(x - fx * 3, z - fz * 3), yp = wy(x - fz * 1.4, z + fx * 1.4), yst = wy(x + fz * 1.4, z - fx * 1.4);
    o.x = x; o.z = z; o.heading = b.heading; o.heave = (yb + ys + yp + yst) / 4; o.pitch = Math.atan2(yb - ys, 6) * 0.6; o.heel = Math.atan2(yp - yst, 2.8) * 0.5 + (b.kheel || 0);
    o.tint = packTint(b.tint); o.key = b.id;
    cands.push({ d: near[i].d, pose: o, live: null });
  }
  // the cruising boats: their band (Regatta's LOD: near only when she crosses inward over 150 m), the float on the boat's sim clock
  const live = busy?.active ? busy.liveBoats : [];
  busyN.near = busyN.mid = busyN.far = 0;
  if (raceProps) raceProps.lakeBegin();
  if (live.length) {
    k.lodPts.length = live.length; for (let i = 0; i < live.length; i++) k.lodPts[i] = live[i].phys.state;
    fleetLod(eye, k.lodPts, k.full ? LOD_BANDS.mac : LOD_BANDS.lite, k.lodOut, k.lodSt);
    const bt = c.B.t, fdt = k.floatT == null ? 0 : bt - k.floatT; k.floatT = bt;
    let nn = 0;
    for (let i = 0; i < live.length; i++) {
      const b = live[i], q = b.phys.state, f0 = k.floats.step(b.id, q, bt, fdt), bk = bumpAt(b, bt), d = Math.hypot(q.x - eye[0], q.z - eye[2]);
      const f = bk ? { ...f0, heave: f0.heave + bk.heave, roll: f0.roll + bk.roll, pitch: f0.pitch + bk.pitch } : f0;   // play as Tessie: the jolt where her jaw meets it
      b.float = f;
      if (k.lodOut[i] === 'near' && nn < k.nearPoses.length) {
        const o = k.nearPoses[nn++];
        o.x = q.x; o.z = q.z; o.heave = f.heave; o.heading = q.heading; o.heel = (q.heel ?? 0) + f.roll; o.pitch = f.pitch; o.boomAngle = q.boomAngle ?? 0; o.jibAngle = q.jibAngle ?? 0;
        o.mainFill = q.mainFill ?? 1; o.jibFill = q.jibFill ?? 1; o.mainDraft = q.mainDraft ?? 1; o.jibDraft = q.jibDraft ?? 1; o.jibBacked = q.jibBacked; o.rudderAngle = q.rudderAngle ?? 0;
        o.tint = b.tintP ??= packTint(b.tint); o.key = b.id; o.bare = b.bare; o.art = k.art.get(b.id)?.i ?? 0;
        cands.push({ d, pose: o, live: b });
      } else if (d < BUSY_DRAW_M && raceProps) { raceProps.lakePut(k.lodOut[i] === 'far' ? 'far' : 'sloop', q.x, f.heave, q.z, q.heading, (q.heel ?? 0) + f.roll, q.boomAngle ?? 0, b.rgba ??= rgbaOf(b.tint), f.pitch, k.art.get(b.id)?.packed ?? null); busyN[k.lodOut[i] === 'far' ? 'far' : 'mid']++; }
    }
  }
  // the slots, nearest first; a cruising boat that finds none draws as the lite boat
  cands.sort((a, b) => a.d - b.d);
  const lakePoses = k.lakePoses;
  lakePoses.length = 0; k.anchoredShown = 0;
  for (const cd of cands) {
    if (lakePoses.length < MAX_NEAR_RIVALS) { lakePoses.push(cd.pose); if (cd.live) busyN.near++; else k.anchoredShown++; }
    else if (cd.live && raceProps) { const q = cd.live.phys.state, f = cd.live.float; raceProps.lakePut('sloop', q.x, f.heave, q.z, q.heading, (q.heel ?? 0) + f.roll, q.boomAngle ?? 0, cd.live.rgba ??= rgbaOf(cd.live.tint), f.pitch, k.art.get(cd.live.id)?.packed ?? null); busyN.mid++; }
  }
  if (raceProps) raceProps.lakeEnd();
  if (busy && !raceProps && live.length) c.raceKit();   // the far boats' pipeline: Regatta's props (their chunk after the first frame)
  boatR.setRivals(lakePoses.length, lakePoses);
}

// boats at anchor (src/core/features.js anchoredBoats: desktop and tablet): swung to the wind in the boat's tick, drawn on
// the boat's rival slots while no race holds them, their riding lights on the night's list
const ANCHORED = {
  id: 'anchored', createAt: 'anchorage', statsAt: 'lake',
  on: (c) => !!c.B && !!c.boatR && c.feature('anchoredBoats').on,
  create: (c) => createAnchoredBoats(ANCHORED_BOATS, { depthAt: (x, z) => -c.terrain.field.height(x, z), balls: c.ballBodies.bodies, onBump: (e) => c.beds?.cue('thud', { v: e.speed, mat: 'wood' }) }),
  at: {
    boat: (a, c) => { if (c.B?.sea?.addPost) c.B.sea.addPost((st, dt, t) => a.post(st, dt, t, (x, z) => c.windField.dirAt(x, z, t))); },
    'fill.boats': (a, c) => fillLake(c),
    'night.lights': (a, c, n, out, o) => (o.on && a.active ? n + a.lights(out, n * 8, { sunElevDeg: o.sunElevDeg, heightAt: o.heightAt, mastHead: o.mastHead }) : n),   // the riding light (0 by day)
  },
  stats: (a, c) => ({ anchored: { boats: a?.boats.length ?? 0, shown: lakeOf(c).anchoredShown, bumps: a?.stats.bumps ?? 0 } }),
  hook: (a, c) => ({ anchored: { get boats() { return a?.boats ?? []; }, get shown() { return lakeOf(c).anchoredShown; }, get stats() { return a?.stats ?? null; }, get on() { return !!a; } } }),
};

// the busy lake (owner, 2026-11-18: "make it natural; it's a busy lake"; v2/living/busyLake.js; src/core/features.js busyLake):
// sailboats cruising the birthplace regions round the player on v1's physics and skipper, stepped in the boat's tick; near the eye on
// the rival slots (shared with the boats at anchor, nearest first), farther as Regatta's lite and far boats (raceProps' lake layer)
const busyTier = (c) => (c.B && c.boatR ? c.feature('busyLake').tier : 'off');
const BUSY_SIDE = new WeakMap();   // its tick's records (the others it keeps clear of, reused)
const BUSY_LAKE = {
  id: 'busy', createAt: 'anchorage', statsAt: 'lake',
  on: (c) => busyTier(c) !== 'off',
  create: (c) => {
    const { startPose, windField, P, boatR } = c, anchored = c.plugins.get('anchored');
    const starts = [[startPose.x, startPose.z], ...(CURRENT_WATERS.start ? [[CURRENT_WATERS.start.x, CURRENT_WATERS.start.z]] : [])];
    const windO = { vx: 0, vz: 0 }, windAt = (x, z, t) => { const w = windField.sample(x, z, t); if (w.vx != null) { windO.vx = w.vx; windO.vz = w.vz; } else { const to = (w.dirDeg + 180) * DEG; windO.vx = Math.sin(to) * w.speed; windO.vz = -Math.cos(to) * w.speed; } return windO; };   // the lake's wind (WindField: no player's staged gust)
    const anch = anchored ? anchored.boats.map((b) => ({ x: b.ax, z: b.az })) : [];
    const busy = createBusyLake({ seed: P.seed, birthplaces: listBirthplaces(CURRENT_WATERS), depthAt: (x, z) => -c.terrain.field.height(x, z), windAt, tier: busyTier(c), starts, anchored: anch, onBump: (e) => c.beds?.cue('thud', { v: e.speed, mat: 'wood' }) });
    const k = lakeOf(c); k.full = busyTier(c) === 'full';
    k.floats = createRivalFloats({ heightAt: (x, z, o) => c.water.heightAt(x, z, o), now: () => c.clock.t });
    // their mainsails (busyLake.js REGIONS sail; render/sailArt.js): the near boats' records after Regatta's five (boat.js setRivalArt:
    // records 6 on, so a race's numbers never move), the lite and far boats' packed print on the props' lake layer
    if (boatR?.setRivalArt) {
      const list = [null, null, null, null, null];
      for (const b of busy.boats) if (b.row.sail) { list.push(b.row.sail); k.art.set(b.id, { i: list.length, packed: packArt(b.row.sail) }); }
      boatR.setRivalArt(list);
    }
    // the glass boat and the lake's boats keep clear of each other: hers and her kayaks' places in the lake's others (always kept clear),
    // the lake's boats in her yield (v2/sim/tourBoat.js setOthers: rule 18, she is the power-driven one)
    const others = [];
    BUSY_SIDE.set(busy, { ctx: { eye: [0, 0, 0], hour: 12, race: false, show: false, anchored: anchored ? anchored.boats : [], others }, others, pool: [], states: [], kay: null, kayT: -1e9 });
    return busy;
  },
  at: {
    boat: (busy, c) => {
      const { B } = c, s = BUSY_SIDE.get(busy), { others, pool, states } = s, bc = s.ctx;
      if (!B?.sea?.addPost) return;
      const otherAt = (i, x, z, heading, u, m, seeM = null) => { const o = (pool[i] ??= {}); o.x = x; o.z = z; o.heading = heading; o.u = u; o.m = m; o.seeM = seeM; others.push(o); };
      B.sea.addPost((st, dt, t) => {
        // fwd: a capsized boat rights only out of the camera's view; in a race the lake's boats stand down (they were stepped unseen,
        // their contacts live, while Regatta's rivals held the slots); show stays false: the show falls after the DAY hours
        bc.eye = c.eye; bc.fwd = c.fwd; bc.hour = c.clock.hour; bc.race = !!c.regatta?.on;
        others.length = 0;
        const T = c.plugins.get('tour')?.sim;
        let nO = 0;
        if (T?.active) { const g = T.boat; otherAt(nO++, g.x, g.z, g.heading, g.v ?? 0, BUSY.avoid.tourM); for (const k of T.kayaks) otherAt(nO++, k.x, k.z, k.heading ?? 0, k.a?.v ?? 0, BUSY.avoid.kayakM); }
        const PW = c.plugins.get('paddle')?.sim; if (PW?.routed) otherAt(nO++, PW.boat.x, PW.boat.z, PW.boat.heading, PW.boat.v, BUSY.avoid.paddleM);   // the paddle-wheeler: right of way (the sailboats keep clear)
        const K = c.plugins.get('kayaks'); if (K?.fleet && (t - s.kayT > 0.5 || !s.kay)) { s.kayT = t; s.kay = K.fleet.marks(); }   // the kayakers (the regions' and v1's), read twice a second
        if (s.kay) for (const k of s.kay) otherAt(nO++, k.x, k.z, k.heading ?? 0, 1.2, BUSY.avoid.kayakM);
        if (K?.sup) for (const m of K.sup.marks()) otherAt(nO++, m.x, m.z, m.heading, 0.85, BUSY.avoid.kayakM);   // the paddleboarders: kept clear as the kayakers are
        { const th = c.player.threat(); if (th) otherAt(nO++, th.x, th.z, th.heading, th.u, th.m, th.seeM); }   // the played thing (Tessie): the boats bear away from it once they see it
        busy.post(st, dt, t, bc);
        if (T?.setOthers) { states.length = 0; if (busy.active) for (const b of busy.boats) if (b.live) states.push(b.phys.state); if (PW?.routed) states.push(PW.boat); T.setOthers(states); }   // the glass boat yields to the paddle-wheeler too
      });
    },
    'fill.boats': (busy, c) => { if (!c.plugins.has('anchored')) fillLake(c); },   // the anchored boats' row fills both when it is on
  },
  stats: (busy, c) => { const n = lakeOf(c).n; return { busy: busy ? { tier: busyTier(c), live: busy.stats.live, near: n.near, mid: n.mid, far: n.far, stepUs: +busy.stats.stepUs.toFixed(1), evades: busy.stats.evades, contacts: busy.stats.contacts } : null }; },
  hook: (busy, c) => ({ busy: { get lake() { return busy; }, get tier() { return busyTier(c); }, get bands() { return lakeOf(c).n; }, get boats() { return busy ? busy.liveBoats.map((b) => ({ id: b.id, region: b.region, x: b.phys.state.x, z: b.phys.state.z, heading: b.phys.state.heading, u: b.phys.state.u, bare: b.bare, motoring: b.motoring })) : []; } } }),
};

// --- Tessie's row (refactor round 3, Phase C step C3) and her played thing (the played seam: engine/player.js). The row is wiring
// only, here and not in a tessie* file, so a phone (no Tessie) requests none of her files, as when this wiring sat in main.js. Her chunk (living/tessie.js: the plug-in and the player) is fetched by boot() where feature('tessie')
// is on (c.tessieModP) and made in her deferred pipeline group 'tessie' (built after the first frame). Every call boot() made by hand
// (M1) is an anchor here, at the same place in ORDER (living/lakePlugins.js), so the frame is the same:
//   create.tessie   after the living lake's (kayaks, the glass boat), before the fireworks
//   compute.water   her creature map after the wake's, before the glass boat's
//   scene.solid     opaque, before the water, after the kayaks (her shadow on the bed and her drops)
//   scene.mirror    her mirror in the surface and the mist of her big splashes, after the kayakers' mirrors (not under the water)
//   fill.living     the spine and her water's sources, after the kayaks'
//   attach          after the kayaks': the boat, the race and the stage's hold; then the player (play as Tessie) where
//                   feature('playTessie') is on, added to the played seam as 'tessie'
//   audio           her breath, water and splashes, after the kayaks' splash
//   sim.tessie      the living clock (her director holds her during a race), after the stage
//   prime.tessie    a capture's and a film's: her model in (?tessie=now places a sighting now)
const TESSIE_SIDE = new WeakMap();   // the plug-in → { mod: her chunk, play: the player or null }

// her played thing (engine/player.js): the player's swap, camera, hands and threat under the seam's names; her bubbles (phase 2b,
//: her run, a sharp turn, a fast dive, the breach and its fall) as the seam's bubble sources
function playedTessie(P, t) {
  const was = { psi: null, phase: null, fell: false };
  return {
    get active() { return P.active; },
    dives: true,   // the eye goes under with her (feature('tessieUnder'))
    swap: (entry, at) => P.become(entry, at),
    back: (o) => P.back(o),
    camera: (dt, c, orbit) => P.camera(dt, c, orbit),
    step: (dt) => P.step(dt),
    threat: () => P.threat(),
    view: () => ({ view: P.view, cam: P.cam }),
    pose() { const sp = t.sim?.state?.spine; return sp ? { x: sp[0], z: sp[2] } : null; },   // her head (the kayaks' launch: "no kayaker near the player")
    bubbles(dt) {
      const s = t.sim?.state;
      if (!(P.active && !!s?.visible && !!s.nose && !!s.spine)) { was.psi = null; was.phase = null; was.fell = false; return null; }
      const st = P.ctl.state, sp = s.spine, nz = s.nose, L = st.lunge;
      const yawRate = was.psi == null ? 0 : Math.atan2(Math.sin(nz.psi - was.psi), Math.cos(nz.psi - was.psi)) / dt;
      const breachStart = !!L && L.phase === 'breach' && was.phase !== 'breach', fell = !!L?.fell;
      const N = sp.length / 8;
      const out = { spine: sp, N, girth: (i) => P.girthAt(i, N), speed: nz.speed, sprint: st.sprint, climb: st.climb, yawRate, nose: st.nose, breachStart, fall: fell && !was.fell ? { x: nz.x - Math.sin(nz.psi) * 3, z: nz.z + Math.cos(nz.psi) * 3 } : null };
      was.psi = nz.psi; was.phase = L?.phase ?? null; was.fell = fell;
      return out;
    },
  };
}

export const TESSIE = {
  id: 'tessie', group: 'tessie', createAt: 'tessie', statsAt: 'tessie',
  // made only where the policy allows (a desktop at L0–L2) and the page has a boat
  on: (c) => c.boatOn && c.tessieOn,
  load: (c) => c.tessieModP,
  create: (c, mod) => {
    const t = mod.createTessiePlugin({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, shadow: c.shadow, hdrTarget: c.hdrTarget, msaa: c.P.msaa, depthFormat: c.depthFormat, wake: c.wake, errors: c.errors, flags: c.flags, P: c.P, depthAt: (x, z) => -c.terrain.field.height(x, z), under: c.under });
    TESSIE_SIDE.set(t, { mod, play: null });
    return t;
  },
  at: {
    'compute.water': (t, c, pass, cc) => { if (c.PG.tessie) t.runWater(pass, cc); },   // her creature map after the wake's
    'scene.solid': (t, c, pass, cc) => { if (c.L.tessie && c.PG.tessie) { t.draw(pass, cc); t.drawFx(pass, cc); } },   // opaque (under the surface: the column's tint); her shadow on the bed, her drops
    'scene.mirror': (t, c, pass, cc, s) => { if (c.L.tessie && c.PG.tessie && !s.uw) { t.drawMirror(pass, cc); t.drawMist(pass, cc); } },   // her mirror (its Fresnel share), the mist of her big splashes
    'fill.living': (t, c, f) => t.fill(c.PG.tessie && c.L.tessie, f.eye, f.focal),   // nothing written while she is not in the water
    attach: (t, c) => {
      const { B } = c;
      if (!B) return;
      // a race sends her down (Tessie's Deep,: she may rise in her own race); when she rises is the stage's
      t.attach({ B, ui: () => c.m4.ui, hold: () => !c.pipeQ.has('tessie'), race: () => !!c.regatta?.on && !c.regatta.tessieRace, sun: () => { const s = c.sunNow; return [s.x, s.y, s.z]; },
        mode: () => c.modeNow(), reduced: () => reducedNow(),   // TK: her revenge is Sail's; no gloom under reduced motion
        // M3: the hour (the sunset breach), the storm's arc second and next strikes (the lightning neck), Cruise (its camera cut)
        hour: () => c.clock.hour, cruise: () => !!c.cruise?.on,
        storm: () => { const storm = c.storm; if (!storm?.running || !storm.frame?.ran) return null; const s = storm.frame.s; return { s, strikes: storm.strikesFrom(s, 6) }; } });
      // play as Tessie (owner, 2026-11-20; living/tessiePlayer.js): the swap, her keys, her camera, the hits; only
      // where feature('playTessie') is on (a desktop or a tablet at L0-L2: never a phone)
      if (!c.feature('playTessie').on) return;
      const side = TESSIE_SIDE.get(t), { canvas, terrain, water, plugins } = c;
      side.play = side.mod.createTessiePlayer({ plugin: t, B, depthAt: (x, z) => -terrain.field.height(x, z),
        busy: () => plugins.get('busy'), tour: () => plugins.get('tour')?.sim ?? null, kayaks: () => plugins.get('kayaks')?.fleet ?? null, sups: () => plugins.get('kayaks')?.sup ?? null,
        traffic: () => [plugins.get('paddle')?.sim ?? null, plugins.get('power')?.sim ?? null].filter(Boolean),   // South Lake: the paddle-wheeler, the runabouts, the jet ski
        anchored: () => plugins.get('anchored') ?? null, chatter: () => c.flags?.chatter !== false,   // the RPG, phase 6: the boats at anchor as targets; the lookout's lines under ?chatter
        birthplaces: { moveTo: (id) => c.birthplaces?.moveTo(id) ?? Promise.resolve({ ok: false, why: 'unknown' }) },
        veil: (op, secs) => c.sea?.hooks?.veil?.(op, secs), canvas, mode: () => c.modeNow(), race: () => !!c.regatta?.on, knocked: () => !!c.kdGame && c.kdGame.state !== 'sailing',
        reduced: () => reducedNow(), keyHints: () => pageSettings()?.get?.('keyHints') !== false,   // Setup › key hints: her legend as Sail's (the UI audit)
        services: () => c.m4.ui?.services ?? null, touch: () => c.feature('tessieTouch').on, headless: !!c.P.headless, rpg: c.flags?.tessierpg === true,   // the Tessie RPG (phase 1)
        waterAt: (x, z) => { const v = water.heightAt(x, z, { coarse: true }); return Number.isFinite(v) ? v : 0; }, floorAt: (x, z) => terrain.field.height(x, z), underOn: c.under,   // phase 2a: the eye under the water
        focal: () => 0.5 * (canvas.clientHeight || canvas.height) / Math.tan(0.5 * c.fovDeg * DEG),
        project: (x, y, z, out = null) => { const m = c.viewProj, w = m[3] * x + m[7] * y + m[11] * z + m[15]; if (!(w > 1e-3)) return null; const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
          const o = out ?? [0, 0, 0]; o[0] = (cx * 0.5 + 0.5) * (canvas.clientWidth || canvas.width); o[1] = (0.5 - cy * 0.5) * (canvas.clientHeight || canvas.height); o[2] = w; return o; } });   // out: the caller's array (no allocation: the RPG's world marks)
      c.player.add('tessie', playedTessie(side.play, t));
    },
    audio: (t, c, audio) => t.setAudio(audio, pageSettings()),   // her synthesised breath, water and splashes (living/tessie-sound.js)
    'sim.tessie': (t, c, dt) => t.step(dt, c.kView(), c.Q.level),
  },
  prime: { stage: 'tessie', paths: ['capture', 'filmui'], run: (t, c) => t.prime(c.kView()) },   // a capture only with ?tessie=
  stats: (t, c) => ({ tessie: t ? t.stats() : { off: c.tessieOn ? 'no boat' : 'the registry: feature(tessie) off' } }),   // off: the policy's reason
  // the director, the body and the renderer; the player (the swap, the controller, the hits; null on a phone); tessiePose (phase 2b,
  // tools/v2-perf.mjs's underwater poses, the evidence): you become her at a fixed spot (x, z, heading; else 150 m abeam of the boat),
  // her nose held at `nose` m and the look at `lookDeg` (+ down), swimming on (swim) or at a drift, `settle` s of frames stepped (a
  // capture's clock: deterministic); flee false leaves the Halcyon where she lies. → the eye's state after it
  hook: (t, c) => {
    const tp = t ? TESSIE_SIDE.get(t).play : null;
    return { tessie: t, tessiePlay: tp, tessiePose: async ({ x = null, z = null, heading = 0, nose = 0.75, lookDeg = 0, settle = 8, flee = true, swim = false, sprint = false, chase = false, yawDeg = null } = {}) => {
      if (!tp) return { ok: false, why: 'no tessie' };
      if (!tp.active) { const r = tp.become('menu', x != null && z != null ? { x, z, heading: heading * DEG } : null); if (!r.ok) return r; }
      if (!flee && c.B.driven) c.B.drive(null);
      tp.pin({ nose, look: lookDeg * DEG, swim, sprint, chase, yaw: yawDeg == null ? null : yawDeg * DEG });
      const n = Math.round(settle / c.clock.dt);
      for (let i = 0; i < n; i++) await c.hook.renderOnce();
      return { ok: true, under: c.hook.under(), nose: +tp.ctl.state.nose.toFixed(2), eye: c.eye.map((v) => +v.toFixed(2)) };
    } };
  },
};

// --- the fireworks' row (refactor round 3 follow-up): the July 4th show (living/fireworksPlugin.js) at the anchors where boot() called
// it by hand. Its chunk is fetched by boot() early (fetch: plugins.js fetchChunks) where feature('fireworks') is on (a phone fetches
// none of it), made after Tessie in its pipeline group 'fireworks'; fireworksOn(flags) (the highlight day, ?fireworks not 0) is the
// switch: off → create null, every anchor skipped. Its four couplings, as hooks:
//   the music door   ctx.musicDoor (the page's music bus, null where the page has no music: a capture, a film, ?music=0)
//   the post pass    graph.post: its own pass after the scene and the under-water split, before the bloom (as before)
//   the start        start.pose: the start code asks the list for a show's start and facing (a page opened, a birth, a cut in the show)
//   the salute       race.salute: Regatta's onSalute is an event the list fans out (plugins.some), no import of the show
const shown = (fw, c) => !c.regatta?.on || fw.saluting || c.regatta.showRace;   // a race cuts the show but its salute and a show race
export const FIREWORKS = {
  id: 'fireworks', group: 'fireworks', createAt: 'fireworks', statsAt: 'show',
  fetch: (feature) => (feature('fireworks').on ? import('./fireworksPlugin.js') : null),
  on: (c) => c.chunks.fireworks != null,
  load: (c) => c.chunks.fireworks,
  create: (c, mod) => (mod.fireworksOn(c.flags) ? mod.createFireworksPlugin({ device: c.device, reg: c.reg, frameBGL: c.frameBGL, frameStruct: c.frameStruct, sky: c.sky, hdrTarget: c.hdrTarget, msaa: c.P.msaa, msaaCounts: c.msaaCounts, depthFormat: c.depthFormat, flags: c.flags, P: c.P, water: c.water, errors: c.errors,
    audioCore: c.musicDoor, race: () => !!c.regatta?.on, heightAt: (x, z) => c.terrain.field.height(x, z) }) : null),   // L3: no solid props in a race
  at: {
    // the pipelines a boot draws in its first frames: an evening page's show (and a pinned ?fwt, a night page)
    'boot.night': (fw, c) => c.flags.fwt != null,
    'boot.pipes': (fw, c, evening) => { if (evening || c.flags.fwt != null) c.reg.release('fireworks'); },
    // the show's own post after the scene (render/fireworks.js POST: the bloom, the far land's silhouette, the bursts' wash on the land
    // and the boat; the stars' target the water's reflection reads next frame), only while the show is in the air at night; offsets() is read at encode time (the frame block's offset moves
    // every frame)
    'graph.post': (fw, c, graph, { frameBG, offsets }) => graph.addPass({ name: 'fw-post', kind: 'custom', encode(enc, ctx, cc, ts) { return c.L.fireworks && c.PG.fireworks && shown(fw, c) ? fw.encodePost(enc, cc, ts, frameBG, offsets(), graph.targets, graph.msaa) : false; } }),
    'compute.forest': (fw, c, pass, cc) => { if (c.PG.fireworks) fw.run(pass, cc); },   // v1's star step, after the forest's and the boulders'
    'scene.depth': (fw, c) => c.L.fireworks && c.PG.fireworks && shown(fw, c) && fw.wantsDepth(),   // the scene pass keeps its depth for the post
    'scene.solid2': (fw, c, pass, cc, s) => { if (c.L.fireworks && (!s.race || fw.saluting) && c.PG.fireworks && !s.uw) fw.drawSolid(pass, cc); },   // the barges, tugs and patrol boats (their evening only), after the birds
    'scene.light': (fw, c, pass, cc, s) => { if (c.L.fireworks && (!s.race || fw.saluting) && c.PG.fireworks && !s.uw) fw.drawLight(pass, cc); },   // the stars and their reflection, the smoke, the glow, the lamps (additive), after the sky
    // the fireworks scene faces the show (sim/fireworksSite.js): in the show's window, the show's start and the heading toward it; a
    // cut asks at its own hour (no pin), the boot and a birth at the page's (a pinned ?fwt is in the show)
    'start.pose': (fw, c, hour, { cut = false } = {}) => (fw.site && fw.inScene(hour, !cut && c.flags.fwt != null) ? { at: () => fw.startAt(), facing: (x, z, windFromDeg) => fw.facing(x, z, windFromDeg) } : null),
    attach: (fw, c) => fw.attach(c.B, c.windField, { thud: (k, o) => c.beds?.cue(k, o) }),   // the show's wind; L3: the solids in the boat's tick, a bump's thud
    'camera.cruise': (fw, c, pose, dt, o) => fw.cruiseCamera(dt, pose, o()),   // Cruise in the show: the rig's shot turned toward the bursts
    'camera.race': (fw, c, pose, dt, o) => (fw.saluting ? fw.saluteCamera(dt, pose, o) : pose),   // Pass the Channel's salute in the frame
    'race.salute': (fw) => !!fw.salute?.(),   // a place race's finish: the barges' salute
    'show.t': (fw) => fw.showT,   // the show's clock (null outside it): the day clock, the night's cover
    // before the graph, every frame: the show's clock, the GPU's step, the look, the sound; a race cuts it (its stars, smoke, post and
    // sound cleared once) but its salute and a show race
    'sim.show': (fw, c, race, o) => { if (!race || fw.saluting || c.regatta?.showRace) fw.frame(o()); else fw.idle(); },
    'post.bloom': (fw, c, k) => k * fw.mainBloom(),   // the page's bloom's share while the show's own post blooms the stars
  },
  prime: { stage: 'show', paths: ['capture'], run: (fw, c, simT) => fw.prime(simT) },   // a capture: the show seeked to its pinned time before the first frame
  stats: (fw) => ({ fireworks: fw ? fw.stats() : null }),
  hook: (fw) => ({ fireworks: fw }),   // the show (stats, the state, the GPU side)
};

export const LAKE_PLUGINS = [KAYAKS, TOUR, PADDLE, POWER_BOATS, TESSIE, FIREWORKS, BIRDS, ANCHORED, BUSY_LAKE];

export const ORDER = {
  'create.living': ['kayaks', 'tour', 'paddle', 'power'],
  'create.birds': ['birds'],
  'create.tessie': ['tessie'],
  'create.fireworks': ['fireworks'],
  'create.anchorage': ['anchored', 'busy'],
  boat: ['anchored', 'tour', 'busy', 'paddle', 'power'],
  'boot.night': ['fireworks'],
  'boot.pipes': ['fireworks'],
  'graph.post': ['fireworks'],
  'compute.forest': ['fireworks'],
  'scene.depth': ['fireworks'],
  'start.pose': ['fireworks'],
  attach: ['fireworks', 'kayaks', 'tessie'],
  audio: ['kayaks', 'tessie'],
  'audio.late': ['tour', 'power'],
  'audio.prepare': ['birds'],
  music: ['birds'],
  'compute.water': ['tessie', 'tour', 'paddle', 'power', 'birds'],
  'fill.boats': ['anchored', 'busy', 'tour', 'paddle', 'power'],
  'fill.living': ['kayaks', 'tessie'],
  'fill.birds': ['birds'],
  'night.lights': ['anchored', 'tour', 'paddle'],
  'scene.solid': ['kayaks', 'tessie'],
  'scene.solid2': ['birds', 'fireworks'],
  'scene.solid3': ['tour', 'paddle', 'power'],
  'scene.water': ['birds', 'tour'],
  'scene.mirror': ['kayaks', 'tessie'],
  'scene.light': ['fireworks'],
  'scene.clear': ['tour'],
  'sim.living': ['kayaks'],
  'sim.tessie': ['tessie'],
  'camera.cruise': ['fireworks'],
  'camera.race': ['fireworks'],
  'race.salute': ['fireworks'],
  'show.t': ['fireworks'],
  'sim.show': ['fireworks'],
  'post.bloom': ['fireworks'],
  'prime.terrain': ['birds'],
  'prime.boat': ['kayaks', 'tour'],
  'prime.tessie': ['tessie'],
  'prime.show': ['fireworks'],
  'stats.living': ['kayaks'],
  'stats.tessie': ['tessie'],
  'stats.birds': ['birds'],
  'stats.show': ['fireworks'],
  'stats.lake': ['anchored', 'busy', 'tour', 'paddle', 'power'],
};
