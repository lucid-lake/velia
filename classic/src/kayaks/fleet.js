// The kayaks on the lake (feat/kayaks-lake): step 1, placement, routes, levels of detail and cost; step 2, the
// kayakers' minds (src/kayaks/mind.js: they see the sailboat, predict its closest approach and give way) and the meetings
// (the first two timed onto the crossings the boat's way in passes over: src/kayaks/plan.js MEET). On by default (owner,
// 2026-11-08; ?kayaks=0 off: src/kayaks/on.js); loaded by a dynamic import, so the game's first bundle does not carry it.
// The quality tier sets the levels and the count (lod.js lodFor: Low and phones one full paddler, 3 out). On a live page the
// paddler figures (≈ 1.2 MB) load in the background: the kayaks show mid and far until they arrive (a capture waits).
//
//   const fleet = await attachKayakFleet(core, player);   // player: the 'player' service (src/core/player.js); Sail (src/modes/daysail/index.js)
//   fleet.update(dt, camDt)  a live frame (the mode's update): dt the kayaks' clock (Sail: the wall clock, as on 2026-11-08;
//                         Cruise: its own speed), camDt the real frame time (the notice shot's eases);
//                         fleet.step(dt) a film frame (the film's own step calls it)
// The first pair (src/kayaks/first.js): when play starts (ENTER on the home card, the staged first visit's first
// frame, a capture's start) two kayakers are placed in the camera's view ≈ 26 m off the boat, ahead and to port, full models
// built before ENTER; then they paddle their own route on the fleet's own minds. The skipper names them once.
//   fleet.stats()         { out, tiers: { full, mid, far }, cpuMs (mean), cpuMsP95, built }
//   fleet.dispose()
// ?kayaks=bench: six kayaks laid out ahead of the camera at 35 to 1,100 m (two of each tier), for the cost check.
//
// Who is out comes from src/kayaks/plan.js (the seed, the hour, the wind, a storm), where they paddle from routes.js, how
// they steer and move from agent.js (one hull model), which level of detail from lod.js. The levels:
//   full  the approved kayak and paddler (src/props/kayak, src/props/paddler: the rig, the baked clips, the planted-blade
//         surge, the splash) riding the real water (heave, pitch, roll from five heights, as the demo stage)
//   mid   instanced: a 300-triangle hull in the kayak's colour, a seated figure (PFD-coloured torso, a dark head) and a
//         paddle swung by a sine at the stroke rate; 4 draw calls for all of them
//   far   instanced: an upright sliver of the kayak's colour and a dark figure above it, turned to the camera; 2 draw calls
import * as THREE from 'three/webgpu';
import { planFleet, kayakCount, KAYAK_DAY } from '../../../src/sim/kayaks/plan.js';
import { createAgent, stepHull, applyDrive, coast } from '../../../src/sim/kayaks/agent.js';
import { createMind, think } from '../../../src/sim/kayaks/mind.js';
import { createNotice, NOTICE } from '../../../src/sim/kayaks/notice.js';
import { placePair, pairLooks, createSpotLine, FIRST } from '../../../src/sim/kayaks/first.js';
import { createBowRipple } from './ripple.js';
import { kayakContact, drift, wakeRock } from '../../../src/sim/kayaks/contact.js';
import { polyline } from '../../../src/sim/kayaks/routes.js';
import { uniform, vec3, vec4 } from 'three/tsl';
import { settingsNow } from '../../../src/ui/settings.js';
import { pickTier, capFull, pickSteps, lodFor } from '../../../src/sim/kayaks/lod.js';
import { kayaksOn } from '../../../src/sim/kayaks/on.js';
import { createKayak, KAYAK, KAYAK_COLOURS } from '../props/kayak/index.js';
import { kayakShape, buildShell } from '../props/kayak/shape.js';
import { PFD_COLOURS } from '../props/paddler/look.js';
import { dayWind } from '../../../src/sim/wind.js';
import { afterReady } from '../../../src/ui/deferLoad.js';

const MAX = KAYAK_DAY.max;
const SPAWN_CLEAR_M = 250, RETIRE_M = 400;   // a kayak appears or leaves only this far from the camera
const BUILD_M = 220;
const KAYAK_NEAR_M = 60, KAYAK_SHELL_M = 90;
const EVENING = [20.5, 22.67];   // h: the evening's kayakers out (the spectators' own window)
const LINES = Object.freeze({ close: 'Too close', bump: 'Bumped a kayak. Easy now' });
export const TRAFFIC = Object.freeze({ margin: 15, bowM: 12, bowMargin: 12 });   // m from the camera: the kayak's deck hardware and its fine shell                          // the full model is built (one a frame) once a kayak is this near

function parseKayaksFlag(v) { return v === 'bench' ? 'bench' : kayaksOn(v) ? 'on' : null; }

export async function attachKayakFleet(core, player, { notice: useNotice = true } = {}) {
  const { scene, camera, water, terrain, services, flags } = core;
  const mode = parseKayaksFlag(flags.kayaks);
  // the tier's levels and count (lod.js lodFor); the July 4th evening's resting kayakers up to 4 full on High (a rest step is cheap)
  const LODQ = lodFor(core.tier), EVENING_LOD = Object.freeze({ ...LODQ, maxFull: LODQ.tier === 'high' ? 4 : LODQ.maxFull });
  const seed = Number(core.SEED) || 1;
  // the sailboat at the start (the meetings are timed from here; a bench lays its kayaks out instead)
  const ps = player?.phys?.state;
  const start = mode === 'on' && ps && Number.isFinite(ps.x) ? { x: ps.x, z: ps.z, heading: ps.heading } : null;
  const slots = planFleet({ seed, terrain, start });
  // the camera that notices (notice.js): the follow camera's shot, low over the water by a kayak passing close; a drag on
  // the view (the follow camera's orbit input) lets go at once. Sail's follow camera only, not the bench
  const follow = mode === 'on' && useNotice ? player?.follow : null, notice = follow ? createNotice() : null;
  let dragAt = -1e9, unhookFollow = null;
  if (follow) {
    const off = follow.onInput((input) => { const o = input?.orbit; if (o && (Math.abs(o[0]) + Math.abs(o[1]) > 1e-6)) dragAt = core.time; });
    unhookFollow = () => { off(); follow.shot = null; };
  }
  // any player input (a key, a click or tap, the wheel) ends the notice shot at once, as a drag does; inputs before the pair
  // is placed (the ENTER that starts play) do not count. A plain mouse move is not an input to the game (the Calm HUD's wake)
  let inputAt = -1e9, layWall = Infinity;
  const onInput = () => { const t = performance.now(); if (t - layWall > 400) inputAt = t; };
  const INPUTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'];
  if (follow && !core.headless && globalThis.addEventListener) for (const e of INPUTS) addEventListener(e, onInput, { passive: true, capture: true });
  const unhookInput = () => { if (globalThis.removeEventListener) for (const e of INPUTS) removeEventListener(e, onInput, { capture: true }); };

  // ---- the shared parts: one built kayak (its geometry is shared by every full kayak), the mid and far meshes ----
  const ref = createKayak({ paddle: 'held', shared: true });
  const draft = ref.draft(KAYAK.mass.empty + KAYAK.mass.paddle + KAYAK.mass.paddler);
  const S = kayakShape(KAYAK), seatY = S.deck(0, KAYAK.seatZ).y, seatZ = KAYAK.seatZ;
  const group = new THREE.Group(); group.name = 'kayak-fleet';
  const uLamp = uniform(0), lampMat = new THREE.SpriteNodeMaterial({ sizeAttenuation: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  lampMat.colorNode = vec4(vec3(0.95, 0.97, 1).mul(uLamp), 1);
  scene.add(group);
  const mat = (o = {}) => { const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0, ...o }); return m; };
  const hullGeo = buildShell(S, { rows: 26, hull: 6, roll: 2, deck: 8 });
  for (const k of Object.keys(hullGeo.attributes)) if (k !== 'position' && k !== 'normal') hullGeo.deleteAttribute(k);
  const torsoGeo = new THREE.CylinderGeometry(0.15, 0.19, 0.52, 8, 1).translate(0, seatY + 0.30, seatZ - 0.02);
  const headGeo = new THREE.SphereGeometry(0.115, 10, 6).translate(0, seatY + 0.69, seatZ - 0.04);
  const paddleGeo = (() => {   // the shaft across x (2.2 m) and two blades, about the grips' middle
    const shaft = new THREE.CylinderGeometry(0.016, 0.016, 2.2, 5, 1).rotateZ(Math.PI / 2);
    const bl = (sx) => new THREE.BoxGeometry(0.42, 0.012, 0.17).translate(sx * 0.98, 0, 0);
    return mergeGeos([shaft, bl(1), bl(-1)]);
  })();
  // coloured: the per-kayak colour buffer from the start (fix/kayaks-mode-switch): three builds an instanced mesh's shader once,
  // with the colour buffer it has then; one first drawn or warmed before any kayak was in its tier drew that tier white for
  // the rest of the fleet's life
  const mk = (geo, m, name, coloured = false) => { const im = new THREE.InstancedMesh(geo, m, MAX); im.name = name; im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); if (coloured) im.setColorAt(0, new THREE.Color(1, 1, 1)); group.add(im); return im; };
  const midHull = mk(hullGeo, mat({ roughness: 0.45 }), 'kayak-mid-hull', true);
  const midTorso = mk(torsoGeo, mat({ roughness: 0.8 }), 'kayak-mid-torso', true);
  const midHead = mk(headGeo, mat({ color: 0x2a2622, roughness: 0.85 }), 'kayak-mid-head');
  const midPaddle = mk(paddleGeo, mat({ color: 0x23324a, roughness: 0.5 }), 'kayak-mid-paddle');
  // the far impostor: unit quads whose normals point up (lit as the water is, so they never read black against the sun)
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  { const n = quad.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0); }
  const farHull = mk(quad, mat({ roughness: 0.6, side: THREE.DoubleSide }), 'kayak-far-hull', true);
  const farFig = mk(quad, mat({ color: 0x2b2a2a, roughness: 0.9, side: THREE.DoubleSide }), 'kayak-far-figure');

  // ---- the paddler's figures load once (only when a kayak first comes near) ----
  let gltf = null, gltfP = null, P = null;
  let playing = false;   // a live page's first frame of play has run (update): the figures may load
  const warmLog = [], buildLog = [], figT = {};   // figT: when the figures' load started, loaded, were prepared (page ms; the bench)   // ms each full model took to build, and its warm-up (live pages: stats().buildMs, warmMs)
  // (a live page: each figure's shared shapes built ahead, one per idle task, before the first build may start, so a full
  // kayak's build is a few ms, not 55–95 ms in one frame; figure.js prepareFigure. A capture builds them in its first build)
  const idle = () => new Promise((r) => (globalThis.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 500 }) : setTimeout(r, 0)));
  // the next task for the figure steps: ahead of the page's plain tasks where the browser can say so (scheduler.postTask,
  // 'user-blocking'; the frames still draw between), else a timeout
  const nextTask = () => (globalThis.scheduler?.postTask ? globalThis.scheduler.postTask(() => {}, { priority: 'user-blocking' }) : new Promise((r) => setTimeout(r, 0)));
  const PREP_SLICE_MS = 40;
  const needFigures = () => { if (!gltfP) gltfP = (async () => {
    if (!core.headless) await afterReady();   // a live page: after the first live frame (perf/slow-loading: the mode's own frames before ready set playing, and the 1.2 MB shared the start's link)
    figT.start = Math.round(performance.now());
    P = await import('../props/paddler/index.js'); const g = await P.loadPaddlerGltf();
    figT.loaded = Math.round(performance.now());
    // (perf/enter-freeze: on a live page each figure's preparation in its ≈ 20 steps, run in tasks of at most
    // PREP_SLICE_MS: a phone ran each figure's in one 0.4–0.65 s task. Not a plain task per step: on a busy phone one
    // got its turn about once a frame, so 40 steps took 8–14 s and the pair came late (hence the slices, at user-blocking
    // priority); nor an idle callback per step (only at its 500 ms timeout on a page busy with the late warm-up). A film
    // page (?filmui, the goldens' HUD frames) keeps one task per figure: its frames run on a stepped clock, and the steps
    // moved the shot's timing)
    if (!core.headless && flags.filmui) for (const sex of ['male', 'female']) { await idle(); try { P.prepareFigure(g[sex], sex); } catch { /* the build makes them */ } }
    else if (!core.headless) {
      for (const sex of ['male', 'female']) {
        await idle();
        try {
          let t = performance.now();
          for (const _ of P.prepareFigureSteps(g[sex], sex)) if (performance.now() - t >= PREP_SLICE_MS) { await nextTask(); t = performance.now(); }
        } catch { /* the build makes them */ }
      }
    }
    gltf = g; figT.prepared = Math.round(performance.now());
  })(); return gltfP; };

  // ---- the kayaks out now ----
  const live = new Map();   // id → { a, slot, tier, full, d }
  const camXZ = () => [camera.position.x, camera.position.z];
  const distTo = (x, z) => { const [cx, cz] = camXZ(); return Math.hypot(x - cx, z - cz); };
  const hour = () => core.sun?.hour ?? 9;
  let windMs = null;
  // the habits follow the day's own wind (src/wind.js dayWind: the calm morning drift, the afternoon breeze, an advisory
  // day), not the sailed wind: Sail's wind level floors the bay's wind at its band all day (level 3: 7.2–9.2 m/s from
  // 06:30 to 20:00 at the bay's centre, a WindField probe on 2026-11-08), a game setting, not the lake's habit; level 4
  // (18–24 kn) counts as 1.6 × the day's wind
  const readWind = () => {
    const w = core.wind; if (!w) return 0;
    try { return dayWind(hour(), { seed: w.seed ?? 1, advisory: !!w.day?.advisory }).speedMs * ((w.lv?.level ?? 3) >= 4 ? 1.6 : 1); } catch { return 0; }
  };
  const storm = () => !!core.storm?.running;
  // ---- the July 4th evening (§ 10; fireworks S3's spectators): with the fireworks world up and the hour
  // 20:30–22:40, the live fleet's kayakers rest by the spectators' spots off the mouth, drifting, headlamps on; the show's
  // own static kayaks stand down (src/fireworks/world.js). Each a slot whose route is a 4 m circle round its spot and whose
  // rest never ends; the mind still sees the boat (a close call, a bump) ----
  const fwMods = flags.fireworks ? await Promise.all([import('../fireworks/spectators.js'), import('../../../src/fireworks/stage.js')]).catch(() => null) : null;
  const evening = { on: false, slots: [] };
  if (fwMods) {
    const [{ SPECTATORS }, { at, VIEW }] = fwMods;
    evening.slots = SPECTATORS.kayaks.map((k, i) => {
      const [x, z] = at(k.bearing, k.d, VIEW), pts = Array.from({ length: 12 }, (_, j) => [x + 4 * Math.sin(j / 12 * Math.PI * 2), z - 4 * Math.cos(j / 12 * Math.PI * 2)]);
      return { id: `kayak-eve-${i}`, slot: 100 + i, route: { id: `evening-${i}`, kind: 'evening', path: polyline(pts, true), rests: [] }, kind: 'evening', s0: 0, restLeft: 1e9,
        colour: ['red', 'yellow', 'orange', 'red'][i % 4], sex: i % 2 ? 'female' : 'male', pfd: k.pfd ?? 'red', personality: 'casual', seed: k.seed ?? i + 1, wear: 0.3, meet: null, spot: { x, z, heading: k.heading * Math.PI / 180 } };
    });
  }
  const eveningNow = () => evening.slots.length > 0 && !!services.get('fireworks') && hour() > EVENING[0] && hour() < EVENING[1];
  // ---- the first pair (first.js): placed in the camera's view when play starts, out while the boat is near them ----
  const first = { slots: [], looks: pairLooks(seed), laid: false, at: null, line: null, lineT: 0, rec: new Map(), near: true, playT: null, hd: [], place: null };
  // Cruise (no notice shot: its autopilot steers): laid once the autopilot has settled on its course (the heading steady
  // within FIRST_SETTLE.deg over FIRST_SETTLE.s, at least minS into play, at most maxS)
  const FIRST_SETTLE = Object.freeze({ s: 2, deg: 4, minS: 3, maxS: 15 });
  const settled = () => {
    if (useNotice) return true;
    const ps = player?.phys?.state; if (!ps) return false;
    first.playT ??= core.time;
    first.hd.push([core.time, ps.heading]); while (first.hd.length && core.time - first.hd[0][0] > FIRST_SETTLE.s) first.hd.shift();
    const since = core.time - first.playT, h0 = first.hd[0][1];
    const steady = first.hd.every(([, h]) => Math.abs(Math.atan2(Math.sin(h - h0), Math.cos(h - h0))) < FIRST_SETTLE.deg * Math.PI / 180);
    return since >= FIRST_SETTLE.maxS || (since >= FIRST_SETTLE.minS && steady);
  };
  // play has started: a capture at once; a live page once the loading card goes (ENTER on the home card: its dissolve, or the
  // staged first visit's): the card's own states before that (src/ui/loading.js). The boat sails behind the home card, so
  // the pair is placed from where the boat and the camera are at ENTER
  const playNow = () => {
    if (core.headless) return true;
    const st = globalThis.document?.getElementById?.('lk-load')?.dataset?.state;
    return st == null || st === 'out' || st === 'gone' || st === 'menu' || st === 'attract';
  };
  // A live page builds no full model of the day's kayakers until the loading card has been gone BUILD_AFTER_S: a warm-up that
  // overlapped the cockpit's first draws at ENTER left both the cockpit and the full kayaks undrawn (WebGPU: invalid render
  // pipelines, feat/kayak-first-minute); they show mid until then. The pair is built (and warmed, below) before ENTER instead
  // (prepPair), hidden. A capture builds at once.
  const BUILD_AFTER_S = 3;
  // perf/ready-first-frame: in play the warm-up is frame-safe (core.warmLive: src/core/warmup.js liveHooks; the invalid
  // pipelines came from its state held across live frames), so a full kayak's pipelines are built again before it shows,
  // ahead of the late warm-up's queue; ?kayakwarm=0 turns it off, =1 forces it (the old held-state warm-up with ?latewarm=boot)
  const WARM_KAYAKS = flags.kayakwarm === '1' || (flags.kayakwarm !== '0' && !!core.warmLive);
  let goneAt = null;
  const buildOk = () => {
    if (core.headless) return true;
    const st = globalThis.document?.getElementById?.('lk-load')?.dataset?.state;
    if (st == null || st === 'gone' || st === 'menu' || st === 'attract') goneAt ??= performance.now();
    return goneAt != null && performance.now() - goneAt > BUILD_AFTER_S * 1000;
  };
  // the pair's full models, built before play (the home card: the figures load after the first live frame, then one kayak a
  // frame), hidden in the stash, moved into the fleet when the pair is placed: the pair is never seen as the mid tier
  const stash = new Map();
  const PAIR_FULL_M = 150;   // m from the camera: the pair stays full inside this whatever the tier's cap (Low and phones: 1)
  function prepPair() {
    if (mode !== 'on' || evening.on) return;
    if (!gltf) { if (core.headless || playing) needFigures(); return; }
    for (const look of first.looks) {
      if (stash.get(look.id)?.full) continue;
      const it = stash.get(look.id) ?? { slot: { ...look, kind: 'first' }, a: null, m: null, tier: null, full: null, d: Infinity, acc: 0, slow: 1 };
      stash.set(look.id, it);
      buildFull(it); return;   // one a frame
    }
  }
  const pairReady = () => first.looks.every((l) => { const f = stash.get(l.id)?.full; return f && !f.warming; });   // built, and warmed when the warm-up is on (?kayakwarm): full from the first frame either way
  // the camera as it is now (the place is on its ray): where, its heading, its horizontal half-angle
  function viewNow() {
    const f = new THREE.Vector3(); camera.getWorldDirection(f);
    return { x: camera.position.x, z: camera.position.z, yaw: Math.atan2(f.x, -f.z), hHalf: Math.atan(Math.tan((camera.fov ?? 40) * Math.PI / 360) * (camera.aspect ?? 16 / 9)) };
  }
  function layFirst() {
    first.laid = true;
    const ps = player?.phys?.state;
    const drop = () => { for (const id of [...stash.keys()]) retire(id); };
    if (mode !== 'on' || !ps || !Number.isFinite(ps.x) || evening.on) return drop();
    const r = placePair({ seed, terrain, pose: { x: ps.x, z: ps.z, heading: ps.heading }, view: viewNow() });
    if (!r) return drop();
    first.slots = r.slots; first.at = core.time; first.place = { side: r.side, R: r.R, course: r.course }; layWall = performance.now();
    for (const s of first.slots) {
      const it = stash.get(s.id) ?? { tier: null, full: null, acc: 0, slow: 1 };
      stash.delete(s.id);
      Object.assign(it, { slot: s, a: createAgent({ slot: s, ...s.place }), m: createMind(s), tier: null, acc: 0 });
      it.d = distTo(it.a.x, it.a.z);
      live.set(s.id, it);
      first.rec.set(s.id, { id: s.id, startD: null, minD: Infinity, at: null });
    }
    // (the staged first visit hushes the status lines for its first minutes, R.'s notes still speak: there the line is a note)
    const spot = (text) => { const h = services.get('controls')?.hint; if (h?.hushed && h.note) { const ok = h.note(text, ''); if (ok) lines.push({ t: +core.time.toFixed(2), kind: 'spot', text }); return ok; } return say(text, 'spot'); };
    first.line = createSpotLine({ show: spot, free: () => services.get('controls')?.hint?.free ?? true });
  }
  function wanted() {
    if (mode === 'bench') return slots.slice(0, LODQ.maxOut);
    if (evening.on) return evening.slots.slice(0, LODQ.maxOut);
    const day = slots.slice(0, kayakCount({ hour: hour(), windMs: windMs ?? 0, storm: storm(), seed }));
    return (first.near ? [...first.slots, ...day] : day).slice(0, LODQ.maxOut);   // the first pair before the day's own (a tier's cap keeps them)
  }
  function spawn(slot, place = null) {
    const a = createAgent({ slot, ...(place ?? {}) });
    live.set(slot.id, { a, m: createMind(slot), slot, tier: null, full: null, d: distTo(a.x, a.z), acc: 0, slow: slot.kind === 'evening' ? 4 : 1 });
  }
  function retire(id) {
    const it = live.get(id) ?? stash.get(id); if (!it) return;
    stash.delete(id);
    if (it.full) { it.full.ripple.dispose(); group.remove(it.full.k.group); scene.remove(it.full.splash.mesh); scene.remove(it.full.splash.rings); it.full.p.dispose(); it.full.splash.dispose(); it.full.k.dispose(); }
    live.delete(id);
  }
  // the first fleet: everyone wanted, where the plan puts them (a capture's frame is the plan's own picture)
  windMs = readWind();
  if (mode === 'bench') {
    // six kayaks ahead of the camera: 35, 90 and 140 m (full), 300 and 480 m (mid), 1,100 m (far), each across the view
    const f = new THREE.Vector3(); camera.getWorldDirection(f); const h = Math.atan2(f.x, -f.z);
    // (the tier's count: Low lays out the first three)
    [[35, -6], [90, 10], [140, -14], [300, 30], [480, -40], [1100, 60]].slice(0, LODQ.maxOut).forEach(([d, o], i) => {
      const x = camera.position.x + Math.sin(h) * d + Math.cos(h) * o, z = camera.position.z - Math.cos(h) * d + Math.sin(h) * o;
      spawn(slots[i], { x, z, heading: h + Math.PI / 2 * (i % 2 ? 1 : -1) });
    });
  } else { evening.on = eveningNow(); for (const s of wanted()) spawn(s, s.spot ?? null); }

  // ---- the full model of one kayak: the shared kayak in its colour, its paddler, the water off the blades ----
  function buildFull(it) {
    const { slot } = it;
    // the hero distances (owner 2026-11-08: seen close and clear from the boat): the follow camera sits ≈ 25 m behind the
    // boat, so a kayak 20–60 m off the boat is 30–90 m from the camera: the fine shell to 90 m, the deck hardware to 60 m
    const k = createKayak({ paddle: 'held', shared: true, colour: slot.colour, wear: slot.wear, seed: slot.seed, nearPartsM: KAYAK_NEAR_M, shellLodM: KAYAK_SHELL_M });
    k.setWaterline(draft);
    const p = P.createPaddler({ gltf, kayak: k, seed: slot.seed, look: { sex: slot.sex, pfd: slot.pfd }, mode: 'rest' });
    const splash = P.createSplash({ seed: slot.seed, waterY: p.waterY });
    k.group.visible = false; group.add(k.group); scene.add(splash.mesh); scene.add(splash.rings);
    const ripple = createBowRipple({ length: KAYAK.length, waterY: draft }); k.group.add(ripple.mesh);   // the bow's small V (ripple.js)
    // the evening's kayakers at night: no shadow passes (the spectators' own GPU saving, fireworks polish round)
    if (slot.kind === 'evening') k.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const lamp = new THREE.Sprite(lampMat); lamp.scale.setScalar(0.0035); lamp.position.set(0, 0.98, 0.32); lamp.visible = false; k.group.add(lamp);   // a headlamp (the spectators' own size and place)
    it.full = { k, p, splash, ripple, lamp, last: null, acc: 0, dip: 0 };
    // a live page: its pipelines built first (core.warm, compileAsync), the kayak held at mid till then, so the first full
    // paddler never blocks a draw with a shader build (a capture keeps the draw's own build: its frames are unchanged).
    // Off from feat/kayak-first-minute to perf/ready-first-frame: the warm-up then held the renderer's state across live
    // frames and left 4–6 invalid WebGPU render pipelines ("Color target has no corresponding fragment stage output",
    // targets[1]) and the full kayaks undrawn, sometimes the cockpit too; the frame-safe warm-up (core.warmLive) has none
    if (!core.headless && core.warm && WARM_KAYAKS) {
      it.full.warming = true;
      const t0 = performance.now();
      // the splash's meshes (in the scene, not under the kayak) hidden till their pipelines are in (perf/enter-freeze: the
      // droplets were drawn the frame after this build, before the warm-up, and built their pipeline in it: 130-580 ms
      // on a phone); the warm-up builds hidden objects too, and the splash shows nothing before the first stroke
      const shown = [splash.mesh.visible, splash.rings.visible]; splash.mesh.visible = false; splash.rings.visible = false;
      Promise.resolve(core.warm([k.group, splash.mesh, splash.rings])).catch(() => null).then((r) => {
        splash.mesh.visible = shown[0]; splash.rings.visible = shown[1];
        // out of the water's probe till its probe draws are built too (perf/enter-freeze: a re-capture in between built
        // the kayak's 21 probe pipelines in one frame, 150-230 ms on a desktop); the probe misses it for a moment
        if (r?.probe) {
          const roots = [k.group, splash.mesh, splash.rings], was = roots.map((o) => o.userData.probe);
          for (const o of roots) o.userData.probe = false;
          r.probe.finally(() => roots.forEach((o, i) => { if (was[i] === undefined) delete o.userData.probe; else o.userData.probe = was[i]; }));
        }
        if (it.full) it.full.warming = false; warmLog.push([Math.round(performance.now() - t0), Math.round(t0)]);
      });
    }
  }

  // ---- per frame ----
  const sunCol = new THREE.Color(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1), local = new THREE.Matrix4();
  const COL = new Map(), colourOf = (c) => { if (!COL.has(c)) COL.set(c, new THREE.Color(KAYAK_COLOURS[c] ?? PFD_COLOURS[c] ?? c)); return COL.get(c); };
  const cpu = []; let lastCheck = -1e9;
  // where a step's time goes (ms summed since the last stats(); the cost check reads them)
  const parts = { paddler: 0, float: 0, hull: 0, steps: 0 };
  const L = KAYAK.length * 0.38, B = KAYAK.beam * 0.40;
  function heightAt(x, z) { return water.surface.heightAt(x, z, core.time, {}); }
  function light(full) {
    const e = core.sun?.elevationDeg ?? 30, dir = core.sun?.direction ?? core.sunWorld;
    const lum = 0.6 / (core.sun?.exposure ?? 6), g = THREE.MathUtils.smoothstep(e, -1, 8);
    sunCol.setRGB(1.0, 0.86 - 0.12 * (1 - THREE.MathUtils.smoothstep(e, 4, 25)), 0.72 - 0.2 * (1 - THREE.MathUtils.smoothstep(e, 4, 25))).multiplyScalar(lum * 3.9 * g);
    if (dir) full.k.setSun(dir, sunCol);
    full.k.materials.u.sunK.value = THREE.MathUtils.smoothstep(e, 0, 10);
  }
  // the full kayak on the water: heave, pitch and roll from five heights (the demo stage's float), a dip with each pull
  function floatFull(it, out, dt) {
    const { a, full } = it, k = full.k, ch = Math.cos(a.heading), sh = Math.sin(a.heading);
    const hAt = (lx, lz) => heightAt(a.x + ch * lx - sh * lz, a.z + sh * lx + ch * lz);
    const c = hAt(0, 0), bow = hAt(0, -L), stern = hAt(0, L), port = hAt(-B, 0), stbd = hAt(B, 0);
    const mean = (2 * c + bow + stern + port + stbd) / 6;
    if (out) full.dip += (Math.min(0.25, Math.abs(out.thrust) * 0.0025) - full.dip) * (1 - Math.exp(-6 * dt));
    k.group.position.set(a.x, mean - draft - full.dip * 0.03, a.z);
    k.group.rotation.set(Math.atan2(bow - stern, 2 * L) * 0.85 - full.dip * 0.01, -a.heading, Math.atan2(stbd - port, 2 * B) * 0.6 + (a.roll ?? 0), 'YXZ');
    k.group.updateMatrixWorld(true);
  }
  function splashes(full, out) {
    const { k, p, splash } = full;
    splash.setWater(k.group.position.y + p.waterY);
    for (const e of out.events) {
      const sp = Math.abs(out.blades[e.side].speed) + Math.abs(out.boat.v) * 0.5;
      if (e.type === 'catch') splash.catch(k.group.localToWorld(e.at.clone()), 0.4 + sp * 0.4);
      else { const side = e.side, last = full.last; splash.exit(() => k.group.localToWorld((last?.blades ?? out.blades)[side].tip.clone()), 0.5 + sp * 0.3); }
    }
  }
  function setTier(it, tier) {
    if (it.tier === tier) return;
    it.tier = tier;
    if (it.full) it.full.k.group.visible = tier === 'full';
    if (tier === 'full') {   // hand over at the same speed, stroke phase and intent
      const { p } = it.full, a = it.a;
      p.setIntent(a.intent); p.snap(a.phase); p.setBoat({ v: a.v, r: a.r }); it.full.intent = a.intent; it.full.acc = 0; a.coastAdv = a.coastYaw = 0;
    }
  }

  let bPrev = null, lastBoat = null, shotOn = false;   // shotOn: the notice shot is on screen (the Calm HUD folds the cockpit away meanwhile)
  // the skipper's lines: "Too close" once a session at the first close call; a quiet line at a bump (at most
  // one in 6 s); the subtitle line (Sail's hint), else Cruise's quiet line; never a pop-up, a score or a penalty
  const contacts = [], closeCalls = [], lines = [];
  let closeSaid = false, lastBumpT = -1e9, bumpPending = false;
  function say(text, kind) {
    lines.push({ t: +core.time.toFixed(2), kind, text });
    const hint = services.get('controls')?.hint;
    if (hint?.flash) return hint.flash(text, { secs: kind === 'close' ? 3.5 : 4.5 });
    const cl = services.get('cruiseLine');
    if (!cl?.show) return false;
    cl.show(text, kind === 'close' ? 3500 : 4500);
    return true;
  }
  const bVel = { vx: 0, vz: 0 };
  function boatSeen(dt) {
    const st = player?.phys?.state; if (!st || !Number.isFinite(st.x)) return null;
    if (!bPrev) { const v = st.sog ?? st.u ?? 0; bVel.vx = Math.sin(st.heading) * v; bVel.vz = -Math.cos(st.heading) * v; }
    else if (dt > 0) { const k = 1 - Math.exp(-dt / 0.5); bVel.vx += ((st.x - bPrev.x) / dt - bVel.vx) * k; bVel.vz += ((st.z - bPrev.z) / dt - bVel.vz) * k; }
    bPrev = { x: st.x, z: st.z };
    return { x: st.x, z: st.z, vx: bVel.vx, vz: bVel.vz };
  }

  function step(dt, camDt = dt) {
    if (!(dt > 0)) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1); camDt = Math.min(camDt, 0.1);
    if (!first.laid) { prepPair(); if (playNow() && settled() && pairReady()) layFirst(); }
    // who is out (every 2 s of scene time): a wanted kayak appears out of the camera's reach; a retired one leaves likewise
    if (mode !== 'bench' && core.time - lastCheck > 2) {
      lastCheck = core.time;
      const w = readWind(); windMs = windMs == null ? w : windMs + (w - windMs) * 0.1;   // smoothed (≈ 20 s): a gust does not send them home
      evening.on = eveningNow();
      const want = new Set(wanted().map((s) => s.id));
      for (const s of slots) if (want.has(s.id) && !live.has(s.id)) { const p = s.route.path.at(s.s0); if (distTo(p.x, p.z) > SPAWN_CLEAR_M) spawn(s); }
      for (const s of evening.slots) if (want.has(s.id) && !live.has(s.id)) spawn(s, s.spot);   // the evening's kayakers are already out when the lights come up
      for (const [id, it] of live) if (!want.has(id) && it.d > RETIRE_M) retire(id);
    }
    // the tiers (with hysteresis, the full tier capped to the nearest few), the full models built one a frame
    const items = [...live.values()];
    const LQ = evening.on ? EVENING_LOD : LODQ;
    for (const it of items) { it.d = distTo(it.a.x, it.a.z); it.want = pickTier(it.tier, it.d, LQ); }
    capFull(items.map((it) => ({ id: it.slot.id, d: it.d, tier: it.want, it })), LQ).forEach((q) => { q.it.want = q.tier; });
    for (const it of items) if (it.slot.group === 'first' && it.full && it.d < PAIR_FULL_M) it.want = 'full';   // the pair: never the peg tier near
    let built = 0;
    for (const it of items) {
      if (!gltf && it.d < BUILD_M + 100 && (core.headless || playing)) needFigures();   // the figures load ahead (a kayak 320 m off), so the full model is ready at 150 m; a live page only once play runs (they never share the start's bandwidth)
      if (it.want === 'full' && (!it.full || it.full.warming)) it.want = 'mid';
      if (!it.full && gltf && !built && it.d < BUILD_M && buildOk()) { const tb = performance.now(); buildFull(it); built++; buildLog.push([Math.round(performance.now() - tb), Math.round(tb)]); }   // one a frame (stats().buildMs)
      setTier(it, it.want === 'full' && it.full && !it.full.warming ? 'full' : it.want);
    }
    // the sailboat as the kayakers see it: where it is and its velocity over the water (from its own track, eased over
    // ≈ 0.5 s; at the first frame its heading and speed)
    const world = { boat: (lastBoat = boatSeen(dt)), others: items.map((it) => it.a), terrain };
    const ps0 = player?.phys?.state && Number.isFinite(player.phys.state.x) ? player.phys.state : null;
    // the headlamps after dusk (the sun under −3°), at the spectators' screen level
    const lampOn = (core.sun?.elevationDeg ?? 30) < -3;
    uLamp.value = lampOn ? 1.6 / Math.max(1e-6, core.sun?.exposure ?? 2172) : 0;
    // move everyone: the full ones by their paddler (the most overdue first, lod.js pickSteps), the rest by the hull model
    let nm = 0, nf = 0;
    const fulls = items.filter((it) => it.tier === 'full');
    for (const it of fulls) { it.acc = it.full.acc + dt; it.full.acc = it.acc; }
    const stepNow = new Set(pickSteps(fulls, dt, LQ));
    for (const it of items) {
      const { a } = it;
      const intent = think(a, it.m, dt, world);
      // the sailboat's wash rocks a kayak near it (contact.js wakeRock); a shove's drift dies away (drift)
      a.roll = ps0 ? wakeRock(ps0, a, dt) : 0;
      drift(a, dt);
      if (it.tier === 'full') {
        const full = it.full;
        if (intent.throttle !== full.intent.throttle || intent.turn !== full.intent.turn) { full.p.setIntent(intent); full.intent = intent; }
        full.p.setLook(a.look);
        if (stepNow.has(it)) {
          const tp = performance.now(); const out = full.p.update(full.acc); full.acc = 0; parts.paddler += performance.now() - tp;
          applyDrive(a, out.boat, out.state.phase);
          splashes(full, out); full.last = out;
          const tf = performance.now(); floatFull(it, out, dt); parts.float += performance.now() - tf;
        } else { coast(a, dt); const tf = performance.now(); floatFull(it, null, dt); parts.float += performance.now() - tf; }
        full.splash.update(dt);
        full.lamp.visible = lampOn;
        full.ripple.update({ v: a.v, phase: a.phase, light: THREE.MathUtils.smoothstep(core.sun?.elevationDeg ?? 30, -2, 6), camera: camera.position });
        light(full);
        full.k.update(camera.position);
        continue;
      }
      const th = performance.now();
      stepHull(a, dt, intent);
      const y = heightAt(a.x, a.z) - draft;
      tmpQ.setFromEuler(tmpE.set(0, -a.heading, a.roll ?? 0, 'YXZ'));
      tmpM.compose(tmpP.set(a.x, y, a.z), tmpQ, tmpS);
      const col = colourOf(it.slot.colour);
      if (it.tier === 'mid') {
        midHull.setMatrixAt(nm, tmpM); midHull.setColorAt(nm, col);
        midTorso.setMatrixAt(nm, tmpM); midTorso.setColorAt(nm, colourOf(PFD_COLOURS[it.slot.pfd] ?? '#B8420F'));
        midHead.setMatrixAt(nm, tmpM);
        // the paddle: a sine at the stroke rate (swung round and rocked so the blades dip in turn); across the lap at rest
        const go = 1 - (a.w.rest ?? 0), ph = a.phase * Math.PI * 2;
        local.compose(tmpP.set(0, seatY + 0.42 - 0.12 * (1 - go), seatZ - 0.40 + 0.18 * (1 - go)),
          tmpQ.setFromEuler(tmpE.set(0, go * 0.42 * Math.cos(ph), go * 0.45 * Math.sin(ph), 'YXZ')), tmpS);
        midPaddle.setMatrixAt(nm, local.premultiply(tmpM));
        nm++;
        parts.hull += performance.now() - th;
      } else {
        // far: turned to the camera about the vertical; the hull sliver as long as the kayak looks from here
        const [cx, cz] = camXZ(), dx = cx - a.x, dz = cz - a.z, dl = Math.hypot(dx, dz) || 1, toCam = Math.atan2(dx, dz);
        const w = Math.max(KAYAK.beam, KAYAK.length * Math.abs(Math.sin(a.heading) * dz / dl + Math.cos(a.heading) * dx / dl));   // |axis × view|
        tmpQ.setFromEuler(tmpE.set(0, toCam, 0));
        tmpM.compose(tmpP.set(a.x, y + draft - 0.12, a.z), tmpQ, tmpS.set(w, 0.36, 1)); farHull.setMatrixAt(nf, tmpM); farHull.setColorAt(nf, col);
        tmpM.compose(tmpP.set(a.x, y + draft + 0.2, a.z), tmpQ, tmpS.set(0.42, 0.62, 1)); farFig.setMatrixAt(nf, tmpM);
        tmpS.set(1, 1, 1);
        nf++;
        parts.hull += performance.now() - th;
      }
    }
    // contact (contact.js): the hull against each kayak near it, both bodies; a bump sets the paddler bracing and rocks the
    // kayak; the full paddler takes the kayak's new speed and spin. Then the kayakers' events: a close call, a bump
    if (ps0) for (const it of items) {
      const a = it.a; if (Math.hypot(a.x - ps0.x, a.z - ps0.z) > 9) continue;
      const c = kayakContact(ps0, a);
      if (!c) continue;
      if (c.j > 1) {
        // a brace (back strokes, 1 s), then away from the hull (a sprint, 3 s): the paddler stops driving into it
        Object.assign(it.m, { braceT: 1.0, closed: true, closeT: 3, closeMode: 'sprint', closeAway: Math.atan2(a.x - ps0.x, -(a.z - ps0.z)) }); a.rock = Math.max(a.rock ?? 0, 0.22);
        if (it.full) it.full.p.setBoat({ v: a.v, r: a.r });
        if (core.time - lastBumpT > 6) { contacts.push({ t: +core.time.toFixed(2), id: it.slot.id, j: +c.j.toFixed(1), dvBoat: +c.dvBoat.toFixed(4) }); bumpPending = true; say(LINES.bump, 'bump'); }
        lastBumpT = core.time;
      }
      if (it.full) floatFull(it, null, 0);
    }
    for (const it of items) for (const e of it.m.events.splice(0)) if (e.type === 'close') { closeCalls.push({ t: +core.time.toFixed(2), id: it.slot.id, d: +e.d.toFixed(1) }); if (!closeSaid) { closeSaid = true; say(LINES.close, 'close'); } }
    // the first pair: each paddler's closest pass (the stats), out while the boat is within 500 m of them; the skipper's line
    // once they are seen (near the boat and in the camera's view)
    if (first.slots.length && lastBoat) {
      let seen = false, nearest = Infinity;
      const f = new THREE.Vector3(); camera.getWorldDirection(f);
      const half = (camera.fov ?? 40) * Math.PI / 360 * Math.max(1, camera.aspect ?? 1.6) * 0.85;
      for (const s of first.slots) {
        const it = live.get(s.id); if (!it) continue;
        const d = Math.hypot(it.a.x - lastBoat.x, it.a.z - lastBoat.z), r = first.rec.get(s.id);
        r.startD ??= d; if (d < r.minD) { r.minD = d; r.at = core.time - first.at; }
        nearest = Math.min(nearest, d);
        const cx = it.a.x - camera.position.x, cz = it.a.z - camera.position.z, off = Math.abs(Math.atan2(cx * f.z - cz * f.x, cx * f.x + cz * f.z));
        if (d < FIRST.seeM && (off < half || !follow)) seen = true;   // (Cruise's cameras are the director's: near is seen)
      }
      first.near = nearest < 500 || !Number.isFinite(nearest) && core.time - first.at < 5;
      if (first.line && !first.line.said) { first.lineT += camDt; first.line.tick(first.lineT, { seen }); }
    }
    // the camera notices a kayak passing close (unless the player has dragged the view in the last moment, or Settings off)
    if (notice && lastBoat) {
      const st = player.phys.state, en = settingsNow(services)?.get?.('kayakCam') !== false;
      // framed for the camera's own aspect (notice.js frameShot); the first pair held NOTICE.pairHoldS and framed together
      const view = { aspect: camera.aspect ?? 16 / 9, fov: camera.fov ?? 40, phone: !!core.tier?.phone || (camera.aspect ?? 1.78) < 1 };
      const b = notice.update(camDt, { boat: { x: st.x, z: st.z, heading: st.heading }, kayaks: items.map((it) => ({ id: it.slot.id, x: it.a.x, z: it.a.z, heading: it.a.heading, group: it.slot.group ?? null, hold: it.slot.kind === 'first' ? NOTICE.pairHoldS : undefined })),
        dragging: core.time - dragAt < 0.25 || performance.now() - inputAt < 250, enabled: en, ground: (x, z) => terrain.heightAt(x, z), view });
      follow.shot = b.shot;
      shotOn = !!b.shot && b.shot.w > 0.05;
    }
    parts.steps++;
    for (const [im, n] of [[midHull, nm], [midTorso, nm], [midHead, nm], [midPaddle, nm], [farHull, nf], [farFig, nf]]) {
      im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    cpu.push(performance.now() - t0); if (cpu.length > 600) cpu.shift();
  }

  const stats = ({ reset = false } = {}) => {
    const tiers = { full: 0, mid: 0, far: 0 };
    for (const it of live.values()) if (it.tier) tiers[it.tier]++;
    const s = cpu.slice(-300).sort((x, y) => x - y), mean = s.reduce((q, v) => q + v, 0) / Math.max(1, s.length);
    const per = (v) => +(v / Math.max(1, parts.steps)).toFixed(3), split = { paddler: per(parts.paddler), float: per(parts.float), midFar: per(parts.hull), steps: parts.steps };
    if (reset) { parts.paddler = parts.float = parts.hull = parts.steps = 0; cpu.length = 0; }
    return { out: live.size, want: wanted().length, windMs: windMs == null ? null : +windMs.toFixed(2), hour: +hour().toFixed(2), tiers, split, cpuMs: +mean.toFixed(3), cpuMsP95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(3), built: [...live.values()].filter((it) => it.full).length,
      contacts, closeCalls, lines, evening: evening.on,
      first: { laid: first.laid, at: first.at == null ? null : +first.at.toFixed(2), out: first.slots.length, built: [...stash.values(), ...live.values()].filter((it) => it.slot.kind === 'first' && it.full).length, place: first.place,
        kayaks: [...first.rec.values()].map((r) => ({ id: r.id, startD: r.startD == null ? null : +r.startD.toFixed(1), minD: Number.isFinite(r.minD) ? +r.minD.toFixed(1) : null, at: r.at == null ? null : +r.at.toFixed(1) })),
        line: first.line ? { said: first.line.said, at: first.line.at == null ? null : +first.line.at.toFixed(1), dropped: first.line.dropped } : null }, lod: LODQ.tier, maxFull: LODQ.maxFull, maxOut: LODQ.maxOut, figures: !!gltf, figT, warmMs: warmLog.slice(-6), buildMs: buildLog.slice(-6),
      kayaks: [...live.values()].map((it) => ({ id: it.slot.id, route: it.slot.route.id, persona: it.slot.personality, tier: it.tier, d: Math.round(it.d), x: Math.round(it.a.x), z: Math.round(it.a.z), v: +it.a.v.toFixed(2), heading: +(it.a.heading * 180 / Math.PI).toFixed(1), resting: it.a.restLeft > 0, action: it.m.action, look: it.a.look == null ? null : Math.round(it.a.look), cpa: it.m.cpa ? { t: +it.m.cpa.t.toFixed(1), d: +it.m.cpa.d.toFixed(1) } : null, boatD: lastBoat ? Math.round(Math.hypot(it.a.x - lastBoat.x, it.a.z - lastBoat.z)) : null, meet: it.slot.meet })) };
  };
  // the figures load at once when anyone starts near, on a capture only (its first frame shows the full model), and the
  // pair is built (placed in the first step); a live page never waits for them (a slow network: the kayaks show mid and far
  // until the figures arrive, then go full one a frame; the pair is placed once both are built)
  const pairNow = mode === 'on' && !evening.on;
  if (core.headless && (pairNow || [...live.values()].some((it) => it.d < BUILD_M))) {
    await needFigures();
    for (const it of live.values()) if (it.d < BUILD_M && !it.full) buildFull(it);
    if (pairNow) while (!pairReady()) prepPair();
  }
  step(1 / 60);
  // a film (?film=1: tools/film/run.mjs, tools/kayaks-shots.mjs) steps the scene through its own film.step: the fleet rides
  // along with it, so a film frame moves the kayaks by the same dt as the boat and the water
  const film = services.get?.('film');
  const unwrap = film?.onStep ? film.onStep(step) : null;   // after each film step (src/core/filmHooks.js)
  const pub = services.provide('kayaks', { step, stats, live, slots, notice, lod: LODQ, figuresReady: () => !!gltf,
    // the notice shot is on screen: the Calm HUD folds the drawn cockpit away for it, and brings it back as it ends (not saved)
    shotOn: () => shotOn,
    // the kayaks for the chart and the cockpit's chart dial (src/sail/chart.js): where each is and its heading
    marks() { const out = []; for (const it of live.values()) out.push({ x: it.a.x, z: it.a.z, heading: it.a.heading }); return out; },
    // the logbook's moment (src/sail/logbook.js): a bump, once read
    consumeContact() { const v = bumpPending; bumpPending = false; return v; },
    // the kayaks as traffic for Cruise's navigator (src/modes/chill/navigator.js): each kayak where its present course puts
    // it at scene time t, and a point 12 m ahead of its bow, each with its own margin (the boat keeps 15 m and passes astern)
    agents(t) {
      const out = [], dtA = Math.max(0, t - core.time);
      for (const it of live.values()) {
        const a = it.a, vx = Math.sin(a.heading) * a.v + (a.pvx ?? 0), vz = -Math.cos(a.heading) * a.v + (a.pvz ?? 0), x = a.x + vx * dtA, z = a.z + vz * dtA;
        out.push({ kind: 'kayak', x, z, margin: TRAFFIC.margin }, { kind: 'kayak-bow', x: x + Math.sin(a.heading) * TRAFFIC.bowM, z: z - Math.cos(a.heading) * TRAFFIC.bowM, margin: TRAFFIC.bowMargin });
      }
      return out;
    },
  });
  return {
    update(dt, camDt = dt) { playing = true; if (!film) step(dt, camDt); },   // (the mode's update: live frames only; dt the scene clock's)
    step, stats,
    dispose() { unwrap?.(); unhookFollow?.(); unhookInput(); for (const id of [...live.keys(), ...stash.keys()]) retire(id); scene.remove(group); group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); ref.dispose(); services.remove('kayaks', pub); },
  };
}

// merge non-indexed copies of simple geometries (position + normal)
function mergeGeos(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
