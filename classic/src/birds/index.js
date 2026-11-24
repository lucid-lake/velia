// Emerald Bay's birds (owner, 2026-11-05: "an eagle over the bay … a high quality, beautiful, real bird system";
//). The cast, mid-June to early July (the highlight day, 2026-07-04, and the normal day): an osprey pair (one hunts round the boat: hover, plunge, carry; one soars
// high), a bald eagle on the thermals over the walls (and now and then a low glide past the boat), a second eagle
// perched on a snag at Emerald Point, a flock of California gulls, and a raft of Canada geese on the water that run and
// splash off when the boat comes close.
//
//   const birds = createBirds({ terrain, water, wind, seed, tier, boat: () => state, audio });
//   scene.add(birds.group); every frame: birds.update(sceneTime, camera)
//   birds.setShelter(0..1)   the storm's hook: airborne birds leave for the shore (1: none in the air); hunting stops
//   birds.cue('plunge' | 'lowpass' | 'takeoff', opts)   the director (captures, the film): see cue() below
// ?birds=0 leaves them out. Captures (?headless) leave them out unless ?birds=1 (the goldens never see a bird).
// Deterministic: the scene clock and the seed (no Math.random(), no wall clock); src/birds/flight.js flies them.
import * as THREE from 'three/webgpu';
import { Bird, stepSoar, stepHunt, stepFlock, stepRaft, stepPerch, stepLowPass, rng, hashSeed, rotate } from '../../../src/birds/flight.js';
import { SPECIES } from '../../../src/birds/species.js';
import { createSpeciesMesh, BIRD_SUN } from './mesh.js';
import { createSpray } from './spray.js';
import { createBirdShadows } from './shadows.js';
import { createSnag } from './snag.js';
import { clamp01 } from '../../../src/sim/core/math.js';

const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const NAMES = ['osprey', 'eagle', 'gull', 'goose'];
const TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

// The owner's rule (2026-11-05): birds keep their distance. No bird comes within KEEP_M of the camera, in any behaviour:
// inside SOFT_M a flying bird turns away and climbs, a bird on the water paddles off, and a hard floor slides it outward
// (continuously: a step's own motion, never a jump or a fade by the lens). The perched eagle leaves its snag first.
export const KEEP_M = 40, SOFT_M = 75;
export function keepAway(b, cam, dt) {
  const dx = b.pos[0] - cam[0], dy = b.pos[1] - cam[1], dz = b.pos[2] - cam[2];
  const d = Math.hypot(dx, dy, dz);
  if (d >= SOFT_M) return d;
  const h = Math.hypot(dx, dz), ux = h > 1e-3 ? dx / h : 1, uz = h > 1e-3 ? dz / h : 0;
  const w = Math.min(1, (SOFT_M - d) / (SOFT_M - KEEP_M));
  const onWater = b.mode === 'raft' && b.state.phase !== 'fly' && b.state.phase !== 'land';
  if (dt > 0 && b.mode !== 'perch') {
    if (!onWater) { b.yaw = wrapPi(b.yaw + Math.max(-1, Math.min(1, wrapPi(Math.atan2(ux, uz) - b.yaw))) * w * dt * 3); b.vy += w * 2.5 * dt; }
    // the slide: a few m/s outward at most, growing as it nears the floor
    const v = w * w * 6 * dt;
    b.pos[0] += ux * v; b.pos[2] += uz * v;
  }
  // the floor itself: on the 40 m sphere, outward in the horizontal (a cut or a teleported camera is the only jump)
  const d2 = Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]);
  if (d2 < KEEP_M && b.mode !== 'perch') {
    const ry = b.pos[1] - cam[1], need = Math.sqrt(Math.max(0, KEEP_M * KEEP_M - ry * ry)) + 0.01;
    b.pos[0] = cam[0] + ux * need; b.pos[2] = cam[2] + uz * need;
  }
  return d2;
}

// the tier's share of the birds (src/quality/tiers.js has no bird row: the table's floor rules; phones get fewer)
export const BIRD_TIERS = {
  high: { gulls: 12, geese: 7, near: 70, cull: 1100, drops: 700, shadows: true },
  balanced: { gulls: 10, geese: 7, near: 55, cull: 900, drops: 500, shadows: true },
  low: { gulls: 6, geese: 5, near: 32, cull: 650, drops: 260, shadows: false },
};

// the bay's places, found on the real terrain once: thermals over the sunny walls, the snag on Emerald Point, the
// osprey's nest tree on the north shore, a raft spot for the geese
export function bayPlaces(terrain, seed = 1) {
  const r = rng(hashSeed(seed, 4041));
  const h = terrain.heightAt, sd = terrain.shoreDistance ?? (() => -100);
  const thermals = [];
  for (let k = 0; k < 64 && thermals.length < 8; k++) {
    const a = r() * Math.PI * 2, d = 700 + r() * 900, x = 400 + Math.cos(a) * d, z = -500 + Math.sin(a) * d;
    const y = h(x, z);
    if (y > 80 && y < 520) thermals.push([x, z]);
  }
  const near = (x0, z0, ok, R = 300) => { let best = null, bd = 1e9; for (let z = z0 - R; z <= z0 + R; z += 10) for (let x = x0 - R; x <= x0 + R; x += 10) { if (!ok(x, z)) continue; const d = Math.hypot(x - x0, z - z0); if (d < bd) { bd = d; best = [x, z]; } } return best ?? [x0, z0]; };
  // the snag: on the point's low granite tip, a few metres above the water, by the shore
  const snag = near(1400, -1450, (x, z) => h(x, z) > 1.5 && h(x, z) < 8 && sd(x, z) > 6 && sd(x, z) < 25, 160);
  const nest = near(700, -1450, (x, z) => h(x, z) > 25 && h(x, z) < 90, 400);
  const raft = near(1020, -1240, (x, z) => h(x, z) < -3 && sd(x, z) < -35 && sd(x, z) > -70, 300);
  return { thermals, snag, nest, raft };
}

// The one switch for the dive (fix/bird-splash): the osprey's hover-and-plunge and the water thrown in the air (the
// crown, the spout, the geese's foot slaps). Round 3 turned it off (owner, 2026-11-05: the puffs read as cotton balls);
// the splashes are rebuilt (src/birds/spray.js, src/birds/water.js), so it is on again. Flip diveDefault to false to turn
// it off everywhere; ?birddive=0|1 overrides it per page. Off, the birds still leave their marks on the water.
export const BIRDS = { diveDefault: true };

export function createBirds({ terrain, water = null, wind = null, seed = 1, tier = 'high', boat = () => null, audio = null, sound = null, start = null, dive = BIRDS.diveDefault } = {}) {
  const T = BIRD_TIERS[tier] ?? BIRD_TIERS.high;
  const group = new THREE.Group(); group.name = 'birds';
  const places = bayPlaces(terrain, seed);
  const meshes = {};
  const counts = { osprey: 3, eagle: 3, gull: T.gulls, goose: T.geese };
  for (const n of NAMES) {
    meshes[n] = { near: createSpeciesMesh(n, { max: counts[n] }), far: createSpeciesMesh(n, { max: counts[n], far: true }) };
    group.add(meshes[n].near.mesh, meshes[n].far.mesh);
  }
  const spray = createSpray({ max: T.drops, seed, density: T.drops / BIRD_TIERS.high.drops });
  group.add(spray.group);
  const shadows = T.shadows ? createBirdShadows({ max: 12 }) : null;
  if (shadows) group.add(shadows.mesh);
  const snag = createSnag({ terrain, at: places.snag, seed });
  group.add(snag.group);

  // --- the cast -------------------------------------------------------------------------------------------------
  const s0 = start ?? [1200, -1050];
  const birds = [];
  const make = (name, mode, opts) => { const b = new Bird(name, birds.length, seed, opts); b.mode = mode; birds.push(b); return b; };
  const hunter = make('osprey', 'hunt', { pos: [s0[0] - 120, 38, s0[1] - 80], yaw: 1.2 });
  const osprey2 = make('osprey', 'soar', { pos: [200, 160, -300], yaw: 0 });
  osprey2.state.centre = [200, -300];
  const eagle = make('eagle', 'soar', { pos: [places.thermals[0]?.[0] ?? 0, 230, places.thermals[0]?.[1] ?? 400], yaw: 0 });
  eagle.state.centre = [...(places.thermals[0] ?? [0, 400])];
  const perch = [...snag.perch];
  const perched = make('eagle', 'perch', { pos: [...snag.perch] });
  perched.yaw = snag.perchYaw;
  const gulls = [];
  for (let i = 0; i < T.gulls; i++) { const r = rng(hashSeed(seed, 900 + i)); gulls.push(make('gull', 'flock', { pos: [s0[0] + 150 + (r() - 0.5) * 60, 30 + r() * 15, s0[1] - 250 + (r() - 0.5) * 60], yaw: r() * 6.28 })); }
  const geese = { members: [], alarm: null, dest: null };
  for (let i = 0; i < T.geese; i++) {
    const a = i * 2.4, rr = 2.5 + 1.6 * Math.sqrt(i);
    const g = make('goose', 'raft', { pos: [places.raft[0] + Math.cos(a) * rr, 0, places.raft[1] + Math.sin(a) * rr], yaw: a * 1.7, speed: 0.3 });
    g.state.home = [places.raft[0], places.raft[1]];
    geese.members.push(g);
  }

  // --- the world the birds read -----------------------------------------------------------------------------------
  const events = [];      // this frame's (sound, spray)
  const log = [];         // every event with its time (the film's sound track: tools/birds_film.mjs)
  let simT = 0, lastT = null, shelter = 0, sunElev = 30, windAt = null;
  const sunDir = new THREE.Vector3(0.3, 0.8, 0.2);
  const surf = () => water?.surface ?? null;
  const env = {
    heightAt: terrain.heightAt,
    waterAt: (x, z) => { const s = surf(); try { return s ? s.heightAt(x, z, simT) : 0; } catch { return 0; } },
    wind: [0, 0], camera: [0, 0, 0], sunElev: 30, shelter: 0, dive,
    boat: () => { const s = boat(); return s && Number.isFinite(s.x) ? { x: s.x, z: s.z, sog: s.sog ?? Math.hypot(s.u ?? 0, s.v ?? 0), heading: s.heading ?? 0 } : null; },
    emit: (e) => { e.t = simT; events.push(e); log.push(e); if (log.length > 4000) log.splice(0, 1000); },
    thermals: places.thermals.length ? places.thermals : [[0, 600], [1200, 300]],
    nest: places.nest,
    gooseDest: (b) => {
      const r = b.r;
      for (let k = 0; k < 40; k++) {
        const a = r() * 6.28, d = 500 + r() * 500, x = b.pos[0] + Math.cos(a) * d, z = b.pos[2] + Math.sin(a) * d;
        const sd = terrain.shoreDistance?.(x, z) ?? -60;
        if (terrain.heightAt(x, z) < -3 && sd < -30 && sd > -110) return [x, z];
      }
      return [places.raft[0], places.raft[1]];
    },
  };
  // the gulls' roaming goal: a slow loop over the bay's water near the boat
  const flockGoal = () => {
    const b = env.boat() ?? { x: s0[0], z: s0[1] };
    return [b.x + Math.sin(simT * 0.031) * 220 + 80, 30 + 12 * Math.sin(simT * 0.05), b.z + Math.cos(simT * 0.023) * 180 - 60];
  };

  // the director: cues for captures and the film (and the logbook, one day)
  const lowpass = { bird: null, S: null };
  function cue(kind, o = {}) {
    if (kind === 'plunge') {
      // the hunter, near (x, z), hovering soon and certain to stoop and catch
      const x = o.x ?? s0[0], z = o.z ?? s0[1];
      Object.assign(hunter.pos, [x - Math.sin(o.yaw ?? 0) * (o.back ?? 35), o.y ?? 26, z - Math.cos(o.yaw ?? 0) * (o.back ?? 35)]);
      hunter.yaw = o.yaw ?? 0; hunter.speed = 8; hunter.vy = 0;
      hunter.state = { phase: 'patrol', t: 0, next: o.after ?? 4, wp: [x, z], alt: o.y ?? 26, force: true };
      hunter.fade = 1;
    } else if (kind === 'lowpass') {
      const b = o.bird === 'osprey' ? osprey2 : eagle;
      lowpass.bird = b; lowpass.S = { offset: o.offset, height: o.height, side: o.side, direct: !!o.from };
      if (o.from) { Object.assign(b.pos, o.from); b.yaw = o.yaw ?? b.yaw; }
      b.mode = 'lowpass';
    } else if (kind === 'takeoff') {
      geese.alarm = simT; geese.hold = false;
      for (const g of geese.members) if (g.state.phase === 'rest') { g.state.phase = 'alarm'; g.state.t = 0; g.state.delay = g.rand(0.1, 0.9); g.state.runYaw = o.yaw ?? null; }
    } else if (kind === 'raft') {
      // move the resting geese to (x, z)
      geese.members.forEach((g, i) => { const a = i * 2.4, rr = 2.5 + 1.6 * Math.sqrt(i); g.state = { phase: 'rest', t: 0, home: [o.x, o.z] }; g.pos = [o.x + Math.cos(a) * rr, 0, o.z + Math.sin(a) * rr]; g.yaw = o.yaw ?? a * 1.7; });
      geese.alarm = null; geese.dest = null; geese.hold = !!o.hold;   // hold: they stay put until a 'takeoff' cue
    } else if (kind === 'flock') {
      for (const g of gulls) { g.pos[0] += (o.x ?? 0) - g.pos[0] + (g.id % 4) * 5; g.pos[2] += (o.z ?? 0) - g.pos[2] + (g.id % 3) * 6; g.pos[1] = o.y ?? g.pos[1]; }
    } else if (kind === 'place') {
      const b = { hunter, osprey2, eagle, perched }[o.who];
      if (b) { if (o.pos) b.pos = [...o.pos]; if (o.yaw != null) b.yaw = o.yaw; if (o.mode) b.mode = o.mode; if (o.state) b.state = { ...o.state }; }
    }
  }

  // --- the step: fixed substeps on the scene clock ----------------------------------------------------------------
  const H = 1 / 60;
  function stepAll(dt) {
    simT += dt;
    env.simT = simT;
    const day = smooth(-4, 3, sunElev);
    for (const b of birds) {
      b.t += dt;
      // shelter: airborne birds with a low rank leave for the shore and fade out (a storm's rain); they come back after
      const airborne = b.mode !== 'raft' && b.mode !== 'perch';
      const rank = ((b.id * 0.618034) % 1) * 0.9 + 0.05;
      const away = airborne && (shelter > rank || day < 0.5);
      b.fadeTarget = away || b.homing ? 0 : 1;
      b.fade += Math.max(-dt / 6, Math.min(dt / 6, b.fadeTarget - b.fade));
      // the perched eagle lifts off its snag before anyone comes close; it comes back when the coast is clear
      if (b === perched) {
        const dc = Math.hypot(perch[0] - env.camera[0], perch[1] - env.camera[1], perch[2] - env.camera[2]);
        if (b.mode === 'perch' && dc < SOFT_M + 25) { b.mode = 'soar'; b.yaw = Math.atan2(perch[0] - env.camera[0], perch[2] - env.camera[2]); b.speed = 6; b.vy = 1.5; b.forceFlap = 1; b.state = { centre: [perch[0] + Math.sin(b.yaw) * 160, perch[2] + Math.cos(b.yaw) * 160], top: 140, phase: 'glide', next: [perch[0] + Math.sin(b.yaw) * 160, perch[2] + Math.cos(b.yaw) * 160] }; b.left = simT; }
        else if (b.mode === 'soar' && dc > 320 && simT - b.left > 60 && Math.hypot(b.pos[0] - env.camera[0], b.pos[2] - env.camera[2]) > 300) { b.homing = true; if (b.fade < 0.01) { b.mode = 'perch'; b.pos = [...perch]; b.yaw = snag.perchYaw; b.state = {}; b.homing = false; } }
      }
      switch (b.mode) {
        case 'hunt': stepHunt(b, dt, env, b.state); break;
        case 'soar': stepSoar(b, dt, env, b.state); break;
        case 'perch': stepPerch(b, dt, env, b.state); break;
        case 'raft': stepRaft(b, dt, env, b.state, geese); break;
        case 'lowpass': if (stepLowPass(b, dt, env, lowpass.S) === 'done') { b.mode = 'soar'; b.state = { centre: [b.pos[0] + 60, b.pos[2]], top: 160 }; } break;
      }
      keepAway(b, env.camera, dt);
      b.update(dt);
    }
    stepFlock(gulls, dt, env, flockGoal);
    for (const g of gulls) { keepAway(g, env.camera, dt); g.update(dt); }
    for (const e of events) spray.emit(dive ? e : { ...e, ringsOnly: true });
  }

  // --- the frame ------------------------------------------------------------------------------------------------
  const camPos = new THREE.Vector3();
  const stats = { birds: birds.length, drawn: 0, near: 0, far: 0, drops: 0, ms: 0 };
  function update(t, camera) {
    const t0 = (globalThis.performance?.now?.() ?? 0);
    camera.getWorldPosition(camPos);
    env.camera[0] = camPos.x; env.camera[1] = camPos.y; env.camera[2] = camPos.z;
    if (wind && (windAt == null || Math.abs(t - windAt) > 0.5)) {   // the one wind field, read twice a second
      windAt = t;
      try { const w = wind.sample(camPos.x, camPos.z, t); env.wind[0] = w.vx; env.wind[1] = w.vz; } catch { /* no wind here */ }
    }
    env.sunElev = sunElev; env.shelter = shelter;
    events.length = 0;
    let dt = lastT == null ? 0 : t - lastT;
    lastT = t;
    if (!(dt > 0) || dt > 10) dt = 0;   // a jump (a reset, a scrub): hold, do not fast-forward
    let n = Math.ceil(dt / H);
    if (n > 40) n = 40;                  // a 4× clock on a slow frame: coarser steps, never a stall
    for (let i = 0; i < n; i++) stepAll(dt / n);
    for (const b of birds) { if (keepAway(b, env.camera, 0) < KEEP_M - 1e-6 && b.mode === 'perch') { /* on its snag: it leaves on the next step */ } b.update(0); }
    api.sound?.update?.(events, camera, t);

    // draw: the near and far meshes, cross-faded with hysteresis by distance; faded out at the edge of sight
    for (const name of NAMES) { meshes[name].near.begin(); meshes[name].far.begin(); }
    let nn = 0, nf = 0;
    shadows?.begin();
    for (const b of birds) {
      const sp = SPECIES[b.name];
      const d = Math.hypot(b.pos[0] - camPos.x, b.pos[1] - camPos.y, b.pos[2] - camPos.z);
      const nearD = sp.spanM * T.near, cull = sp.spanM * T.cull;
      // hysteresis: switch to far beyond 1.1 × near, back to near inside 0.9 ×; the switch itself fades over 0.6 s
      if (b.lod === 0 && d > nearD * 1.1) b.lod = 1; else if (b.lod === 1 && d < nearD * 0.9) b.lod = 0;
      b.lodT += Math.max(-dt / 0.6, Math.min(dt / 0.6, b.lod - b.lodT));
      if (dt === 0) b.lodT = b.lod;
      const vis = b.fade * smooth(cull, cull * 0.8, d);
      if (vis < 0.01) continue;
      if (b.lodT < 0.999) { meshes[b.name].near.push(b, vis * (1 - b.lodT)); nn++; }
      if (b.lodT > 0.001) { meshes[b.name].far.push(b, vis * b.lodT); nf++; }
      // a soft shadow on the water under a low bird, cast along the sun
      if (shadows && sunDir.y > 0.05 && b.pos[1] < 30 && d < 250) shadows.push(b, sunDir, env.waterAt(b.pos[0], b.pos[2]), vis * smooth(30, 4, b.pos[1]) * smooth(0.05, 0.25, sunDir.y));
    }
    for (const name of NAMES) { meshes[name].near.commit(); meshes[name].far.commit(); }
    shadows?.commit();
    spray.update(dt, env.waterAt);
    snag.update?.(camPos);
    stats.near = nn; stats.far = nf; stats.drawn = nn + nf; stats.drops = spray.pool.count;
    stats.ms = (globalThis.performance?.now?.() ?? 0) - t0;
  }

  // the daylight: the sun's height (none in the air at night) and its direction (the shadows)
  group.userData.daylight = (f) => { sunElev = f.elevDeg ?? sunElev; if (f.sunDir) { sunDir.copy(f.sunDir); BIRD_SUN.value.copy(f.sunDir); } if (f.light != null) spray.setLight(f.light); };

  const api = {
    sunDir,
    group, update, cue, places, birds, stats, log, spray, sound,
    setShelter(s) { shelter = clamp01(s); },
    get shelter() { return shelter; },
    get dive() { return dive; },
    get time() { return simT; },
    find: (who) => ({ hunter, osprey2, eagle, perched, gulls, geese: geese.members })[who],
    // a point on a bird in the world (the film's cameras aim at the head, not the centre)
    pointOn: (b, v = [0, 0, 0]) => { const r = rotate(b.quat, v); return [b.pos[0] + r[0], b.pos[1] + r[1], b.pos[2] + r[2]]; },
    dispose() { group.removeFromParent(); },
  };
  return api;
}
