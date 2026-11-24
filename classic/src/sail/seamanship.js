// Day Sail's engine and ground tackle (feat/engine-anchor; D3): the keys, the dock's icons
// and the helm view's lever, wired to the physics' engine (src/boat/engine.js) and the tackle (src/boat/tackle.js);
// the parts you see (the exhaust's spray, the rode and the pennant, the fenders), the engine's and the chain's sound
// (src/engineAudio.js), the anchoring's arrival (the camera rises to a wide shot, the swell, the logbook's "at
// anchor"), "wait for sunrise", and one gentle line when the sails could do the work. Live pages only.
//
//   const sea = createSeamanship(core, { boat, phys, ctl, hint, dock, helmPick, icons, sfx });
//   each frame in controls.update: sea.pre(dt) before the physics steps (it sets ctl.throttle and ctl.furl);
//     phys.step(…, sea.env(env)); the camera: sea.camera(dt, pose, normal) → a pose; sea.post(dt, camera) after
//   sea.held: the boat is on its anchor, a mooring or the dock's lines (the pilot lets the helm go)
//
// Keys (keys.js): I the engine on / off (a pro's plain start / stop; no button on screen); + / − the lever a notch ahead / astern
// (the throttle lever's six detents, ui/throttleLever.js: a tap is one notch, held it repeats a notch every SEA.repeatS; it stays
// where it is put), 0 N; out of N the engine starts itself, and at N it stops by state (the sails drawing, or the
// anchor holding or the boat made fast; never a timer; autoStop) (W / S always trim: owner, 2026-10-30); J the anchor (drop when slow in 3–20 m, weigh), the Dawn button at anchor after dark: wait for sunrise;
// U the lines (pick up a free mooring ball within 3 m under 0.6 m/s, tie up alongside a pier within 1 m when
// stopped, let go); Y the sails down / up (the crew takes them down at anchor, on a ball or alongside, and sets them
// again when you leave).
import * as THREE from 'three/webgpu';
import { tackleEnv } from '../../../src/sim/sail/simulation.js';
import { createTackle, piersFrom, townsDeckHidden, ANCHOR } from '../../../src/sim/boat/tackle.js';
import { SHORE_REGION } from '../../../src/shoreline-layout.js';
import { createExhaust } from '../boat/exhaust.js';
import { createEngineAudio } from '../../../src/engineAudio.js';
import { blendPose } from '../../../src/boat/binoculars.js';
import { analyticSun } from '../../../src/sim/timeOfDay.js';
import { KEY } from '../../../src/sail/keys.js';
import { NOTES } from '../../../src/ui/skipper.js';
import { sailParams } from '../../../src/boat/rig.js';
import { stepNotch, autoStart, autoStop, sailsDrawing } from '../../../src/stations/sloop/throttleLever.js';
import { SEA, ICONS, EngineNudge, nextSunrise } from '../../../src/sail/seamanshipRules.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// SEA, ICONS, EngineNudge and nextSunrise: the pure rules, moved to ./seamanshipRules.js (a seam v2 imports without three)
export { SEA, ICONS, EngineNudge, nextSunrise };

export function createSeamanship(core, { boat, phys, ctl, hint = null, dock = null, helmPick = null, sfx = null }) {
  const { flags, scene, terrain, shoreline, harbour, audio, camera, clock, services } = core;
  const off = new AbortController(), signal = off.signal;
  const balls = [...(shoreline?.layout?.field ?? []), ...(shoreline?.layout?.balls ?? [])];
  const tk = createTackle({ dims: boat.dims, depthAt: (x, z) => -terrain.heightAt(x, z), balls, piers: piersFrom({ shoreline: shoreline?.layout, harbour: harbour?.layout,
    towns: core.towns?.layout, skip: townsDeckHidden(SHORE_REGION) }) });
  const eng = phys.engine;
  const hooks = { kedge: null };
  let furlWant = 0, leverHeldDir = 0, leverHeldAt = 0, lastMode = 'free', t = 0, atN = 0;

  // ---- the actions (keys, the dock, the probes) ----
  // NOTES: the words and what the voice reads (ui/skipper.js); a finger gets the note's touch wording, never a key
  const say = (id, key, d = '') => { const N = NOTES[id], f = !!services.get('modality')?.touch && N.touch;
    return hint?.note?.((f ? N.touch : N.text).replace('{d}', d), f ? '' : key, f ? N.touchSpeak ?? N.touch : N.speak); };
  const actions = {
    engine() { const on = eng.toggle(); if (on) eng.setLever(0); return on; },
    // the lever put somewhere (the panel's drag; snap: its release on a notch, a click)
    lever(v, { snap = false } = {}) { if (autoStart({ from: eng.lever, to: v, engineOn: eng.on, detent: eng.P.detent })) eng.start(); const was = eng.lever; eng.setLever(v); if (snap && Math.abs(was - v) > 1e-3) sfx?.cue('click', { rate: 0.9 }); },
    neutral() { eng.setLever(0); },
    // a notch ahead (+1) or astern (−1) on the throttle lever's detents; out of STOP with the engine off, it starts (the starter, the catch)
    step(dir) { const from = eng.lever, to = stepNotch(from, dir); if (autoStart({ from, to, engineOn: eng.on, detent: eng.P.detent })) eng.start(); eng.setLever(to); sfx?.cue('click', { rate: 0.9 }); return to; },
    anchor() {
      if (tk.mode === 'anchor') { tk.weigh(); return 'weigh'; }
      if (hooks.kedge && tk.mode === 'free' && services.get('boat')?.ground?.state.mode === 'aground') { hooks.kedge(); return 'kedge'; }   // aground: J rows the anchor out and hauls (grounding.js)
      const r = tk.drop(phys.state);
      if (!r.ok) {
        const d = r.depth != null ? `${r.depth.toFixed(0)} m` : '';
        say(r.why === 'fast' ? 'fast' : r.why === 'deep' ? 'deep' : r.why === 'shallow' ? 'shallow' : 'tied', 'J', d);
      }
      return r.ok ? 'drop' : r.why;
    },
    lines() {
      const rel = tk.release(); if (rel) return rel;
      const m = tk.moor(phys.state); if (m.ok) return 'moored';
      const d = tk.tieUp(phys.state); if (d.ok) return 'docked';
      if (m.d != null && m.d < 25) say(m.why === 'fast' ? 'ballFast' : 'ball', 'U');
      else if (d.gap != null && d.gap < 12) say(d.why === 'fast' ? 'pierFast' : 'pier', 'U');
      return 'none';
    },
    sails() { furlWant = furlWant > 0.5 ? 0 : 1; return furlWant; },
    sunrise() { return waitForSunrise(); },
  };
  addEventListener('keydown', (e) => {
    if (e.lkVirtual || e.metaKey || e.ctrlKey) return;
    if (e.code === KEY.engine && !e.repeat) actions.engine();
    const dir = (e.code === KEY.ahead || e.code === 'NumpadAdd') ? 1 : (e.code === KEY.astern || e.code === 'NumpadSubtract') ? -1 : 0;
    if (dir && !e.repeat) { actions.step(dir); leverHeldDir = dir; leverHeldAt = t; }
    if (e.code === KEY.neutral) actions.neutral();
    if (e.code === KEY.anchor && !e.repeat) { actions.anchor(); }
    if (e.code === KEY.lines && !e.repeat) actions.lines();
    if (e.code === KEY.sails && !e.repeat) actions.sails();
  }, { signal });
  addEventListener('keyup', (e) => { if ([KEY.ahead, 'NumpadAdd', KEY.astern, 'NumpadSubtract'].includes(e.code)) leverHeldDir = 0; }, { signal });
  // motoring: the engine on with the sails down (the skipper's lines read it)
  const motoring = () => eng.on && Math.max(ctl.furl ?? 0, furlWant) >= 0.5;
  addEventListener('blur', () => { leverHeldDir = 0; }, { signal });

  // the dock's icons (toolDock.js) and the helm view's lever (helmPick.js: held, a drag up / down moves it)
  dock?.register({ id: 'engine', key: 'I', name: 'engine', icon: ICONS.engine, order: 44, code: 'KeyI', lit: () => eng.on, badge: () => (eng.on ? (eng.gear > 0 ? '▲' : eng.gear < 0 ? '▼' : '·') : '') });
  dock?.register({ id: 'anchor', key: 'J', name: 'anchor', icon: ICONS.anchor, order: 45, code: 'KeyJ', lit: () => tk.mode === 'anchor' && tk.state.anchor.phase !== 'stowed' });
  // wait for dawn: a button beside the anchor, shown only while anchored (held) and the sun is down (was Shift+J)
  dock?.register({ id: 'dawn', key: '', name: 'wait for dawn', icon: ICONS.dawn, order: 45.5, action: () => actions.sunrise(), visible: () => tk.mode === 'anchor' && tk.state.anchor.phase === 'held' && !waking && (core.sun?.elevationDeg ?? 90) < 0 });
  dock?.register({ id: 'sails', key: 'Y', name: 'sails up / down', icon: ICONS.sails, order: 47, code: KEY.sails, lit: () => (ctl.furl ?? 0) < 0.5 });
  dock?.register({ id: 'lines', key: 'U', name: 'lines', icon: ICONS.lines, order: 46, code: 'KeyU', lit: () => tk.mode === 'moored' || tk.mode === 'docked', visible: () => tk.mode === 'moored' || tk.mode === 'docked' || (tk.nearestBall(phys.state)?.d ?? 1e9) < 40 || tk.state.pierGap < 15 });
  // The cockpit's engine controls (boat/hero-cockpit: cockpit.glb's engine_gear and engine_throttle on the pedestal,
  // engine_key and the oil and temperature lamps on the port well wall; cockpitLook.js look.engine). One lever in the
  // physics (−1 astern … +1 ahead, ENGINE.detent of neutral) shows as the boat's two: the gear lever (ahead, neutral,
  // astern) and the throttle (0 … full). In the helm view each is a part (helmPick): hold the gear lever and push it
  // up or down (ahead / astern; back to the middle is neutral), hold the throttle and drag (up opens it), click the
  // key (on / off). Without the cockpit's nodes, the 'throttle' socket's stand-in lever takes the single lever.
  const cp = () => boat.modules.cockpit?.userData?.engine ?? null;
  const DETENT = eng.P.detent;
  const setGT = (gear, thr) => eng.setLever(gear === 0 ? 0 : gear * (DETENT + 0.001 + clamp(thr, 0, 1) * (1 - DETENT - 0.001)));
  const gearNow = () => (Math.abs(eng.lever) < DETENT ? 0 : Math.sign(eng.lever));
  const thrNow = () => (Math.abs(eng.lever) < DETENT ? 0 : (Math.abs(eng.lever) - DETENT) / (1 - DETENT));
  let drag = null;
  if (helmPick) {
    const E = cp();
    // helmPick proxies a group by its bounds; a bare mesh is wrapped in a group at its own pose (the lever then turns
    // inside the wrapper, from its rest pose)
    const pickable = (o) => { if (!o?.isMesh) return o; const g = new THREE.Group(); g.name = `${o.name}-pick`; o.parent.add(g); g.position.copy(o.position); g.quaternion.copy(o.quaternion); g.scale.copy(o.scale); g.add(o); o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); return g; };
    if (E?.gear && E?.throttle) {
      helmPick.register({ id: 'engine-gear', object: pickable(E.gear), kind: 'hold', action: (on) => { drag = on ? { kind: 'gear', dy: 0, g0: gearNow() } : null; } });
      helmPick.register({ id: 'engine-throttle', object: pickable(E.throttle), kind: 'hold', action: (on) => { drag = on ? { kind: 'throttle', t: thrNow() } : null; } });
      if (E.key) helmPick.register({ id: 'engine-key', object: pickable(E.key), kind: 'click', action: () => actions.engine() });
      if (boat.modules.throttle) boat.modules.throttle.visible = false;   // the stand-in goes; the real levers are here
    } else {
      helmPick.register({ id: 'throttle', object: boat.sockets.throttle, kind: 'hold', action: (on) => { drag = on ? { kind: 'single', lever: eng.lever } : null; if (on && !eng.on) actions.engine(); } });
    }
    addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'single') { drag.lever = clamp(drag.lever - e.movementY / 140, -1, 1); eng.setLever(Math.abs(drag.lever) < 0.06 ? 0 : drag.lever); }
      else if (drag.kind === 'throttle') { drag.t = clamp(drag.t - e.movementY / 160, 0, 1); setGT(gearNow(), drag.t); }
      else { drag.dy -= e.movementY; const g = clamp(drag.g0 + Math.round(drag.dy / 40), -1, 1); if (g !== gearNow()) setGT(g, g === 0 ? 0 : thrNow()); }
    }, { signal });
    addEventListener('pointerup', () => { drag = null; }, { signal });
  }

  // ---- what you see: the exhaust, the rode, the pennant, the fenders ----
  const exhaust = createExhaust();
  exhaust.uniforms.uColor.value.set(0xe9ede9).multiplyScalar((core.lum ?? 1) * 3.6);
  scene.add(exhaust.mesh);
  const lineMat = new THREE.LineBasicNodeMaterial({ color: 0x2b2a27 });
  const ropeMat = new THREE.LineBasicNodeMaterial({ color: 0xd8d0bc });
  const mkLine = (mat, n) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)); const l = new THREE.Line(g, mat); l.frustumCulled = false; l.visible = false; scene.add(l); return l; };
  const rode = mkLine(lineMat, 12), pennant = mkLine(ropeMat, 8), dockLines = [mkLine(ropeMat, 2), mkLine(ropeMat, 2)];
  const fenderMat = new THREE.MeshStandardNodeMaterial({ color: 0xe8e6e0, roughness: 0.5 });
  const fenders = new THREE.Group(); fenders.name = 'fenders'; boat.sockets.hull.add(fenders);
  for (const side of [1, -1]) for (const z of [-1.6, 0.2, 1.9]) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.42, 4, 10), fenderMat); f.position.set(side * 1.62, 0.55, z); f.userData.side = side; fenders.add(f);
  }
  fenders.visible = false;
  const _v = new THREE.Vector3();
  function drawLine(l, pts) { const a = l.geometry.attributes.position; for (let i = 0; i < a.count; i++) { const p = pts[Math.min(i, pts.length - 1)]; a.setXYZ(i, p[0], p[1], p[2]); } a.needsUpdate = true; l.visible = true; }

  // ---- the sound ----
  const ea = audio ? createEngineAudio({ audio }) : null;
  let lastOut = 0, chainMs = 0;

  // ---- the arrival (anchoring): the camera rises to a wide shot, the swell, the logbook's "at anchor" ----
  const A = SEA.arrival;
  let slowFor = 0, holding = false, arrival = null, inputAt = -9, arrived = false;
  for (const ev of ['keydown', 'pointerdown', 'wheel']) addEventListener(ev, (e) => { if (!e.lkVirtual && !e.lkDock) inputAt = t; }, { signal, passive: true });
  function startArrival() {
    const s = phys.state, cx = camera.position.x - s.x, cz = camera.position.z - s.z, l = Math.hypot(cx, cz) || 1;
    arrival = { t0: t, dir: [cx / l, cz / l], k: 0, phase: 'rise' };
  }
  function arrivalPose(dt, normal) {
    if (!arrival) return normal;
    const a = arrival, s = phys.state, age = t - a.t0;
    if (a.phase === 'rise' && inputAt > a.t0 + 0.5) { a.phase = 'back'; a.backAt = t; a.from = a.k; }
    if (a.phase === 'rise') { a.k = ease(age / A.riseS); if (age > A.riseS + A.holdWideS) { a.phase = 'back'; a.backAt = t; a.from = a.k; } }
    else { a.k = a.from * (1 - ease((t - a.backAt) / A.backS)); if (a.k <= 0) { arrival = null; return normal; } }
    // the wide pose: back along the camera's own bearing and up, the boat low in the frame with the bay around it
    const wide = { pos: [s.x + a.dir[0] * A.backM, A.upM, s.z + a.dir[1] * A.backM], target: [s.x - a.dir[0] * 25, 1.5, s.z - a.dir[1] * 25], fov: A.fov, near: 0.5 };
    return blendPose(normal, wide, a.k);
  }

  // ---- wait for sunrise (D3): at anchor, the screen fades, the clock moves to the dawn, it fades back in ----
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;background:#05080b;opacity:0;pointer-events:none;z-index:9;transition:opacity 1.6s cubic-bezier(.4,0,.6,1)';
  document.body.appendChild(veil);
  let waking = null;
  function waitForSunrise() {
    if (tk.mode !== 'anchor' || tk.state.anchor.phase !== 'held' || waking || !clock) { say('dawn', 'J'); return false; }
    const simT = services.get('controls')?.simT ?? core.time;
    const now = clock.hourAt(simT), rise = nextSunrise(now, core.daylight?.sunAt ?? analyticSun);
    if (rise == null) return false;
    waking = { at: t, hour: rise - SEA.sunrise.before, set: false };
    veil.style.opacity = '1';
    return waking.hour;
  }
  function stepSunrise() {
    if (!waking) return;
    if (!waking.set && t - waking.at > SEA.sunrise.fadeS + SEA.sunrise.darkS) {
      const simT = services.get('controls')?.simT ?? core.time;
      clock.setHour(waking.hour, simT); waking.set = true; waking.setAt = t;
      veil.style.transition = 'opacity 3.2s cubic-bezier(.4,0,.6,1)'; veil.style.opacity = '0';
    }
    if (waking.set && t - waking.setAt > 3.5) { veil.style.transition = 'opacity 1.6s cubic-bezier(.4,0,.6,1)'; waking = null; }
  }

  const nudge = new EngineNudge();
  const talk = { started: false, keys: false, sails: false, motorAt: 0, ball: false, ballAt: -99 };
  let lampsOn = null;
  const rigDrum = () => boat.modules.rigging?.getObjectByName?.('furler-drum') ?? null;

  // ---- each frame ----
  function pre(dt) {
    t += dt;
    // the lever: held + / −, a stop at neutral on the way through
    if (leverHeldDir && t - leverHeldAt >= SEA.repeatS) { actions.step(leverHeldDir); leverHeldAt = t; }   // held: a notch every repeatS (it stays)
    ctl.throttle = eng.lever;
    // the crew's sails: down while the boat is held (anchor set, on a ball, alongside) or when you asked
    const s = phys.state, mode = tk.mode;
    const heldNow = (mode === 'anchor' && ['down', 'held'].includes(tk.state.anchor.phase)) || mode === 'moored' || mode === 'docked';
    s.held = heldNow;   // the hints read it: no "turn away from the wind" while the boat lies head to wind on purpose
    if (mode !== lastMode) { if (mode === 'free') furlWant = 0; lastMode = mode; }
    ctl.furl = heldNow ? 1 : furlWant;
    // the arrival: the anchor holding, the boat slow, for holdS
    holding = mode === 'anchor' && tk.state.anchor.phase === 'held' && !tk.state.anchor.dragging;
    slowFor = holding && s.sog < A.slowMs ? slowFor + dt : 0;
    if (slowFor >= A.holdS && !arrived && !api.arrivalOff) { arrived = true; startArrival(); }   // arrivalOff: the one-tap fireworks holds the show's framing (src/sail/showNow.js)
    if (!holding) arrived = false;
    // the engine's first words: on the first start, + and − (it holds the setting); then, with the sails up, "sails down? Y" (once each)
    if (eng.state === 'running' && !talk.started) { talk.started = true; talk.motorAt = t; }
    if (talk.started && !talk.keys && eng.on && t - talk.motorAt > 1.5) { talk.keys = true; say('motorKeys', '+'); }
    if (talk.started && !talk.sails && eng.on && !motoring() && (ctl.furl ?? 0) < 0.5 && t - talk.motorAt > 9) { talk.sails = true; say('sailsDown', 'Y'); }
    // a mooring ball near (the MOOR switch wakes): R. says so, once an approach, never while held
    { const nb = tk.nearestBall(s)?.d ?? 1e9;
      if (mode === 'free' && nb < 40 && !talk.ball && t - talk.ballAt > 60) { talk.ball = true; talk.ballAt = t; say('ballNear', 'U'); }
      if (nb > 60) talk.ball = false; }
    // the engine stops by state at N: the sails drawing, or the anchor holding / the boat made fast; never a timer
    atN = eng.on && Math.abs(eng.lever) < eng.P.detent ? atN + dt : 0;
    const madeFast = mode === 'moored' || mode === 'docked';
    const why = autoStop({ engineOn: eng.on, lever: eng.lever, atNeutralS: atN, drawing: sailsDrawing({ furl: s.furl ?? ctl.furl, mainFill: s.mainFill, jibFill: s.jibFill }), held: holding || madeFast, detent: eng.P.detent });
    if (why) { eng.stop(); atN = 0; say(why === 'sails' ? 'engineOffSails' : madeFast ? 'engineOffFast' : 'engineOffAnchor', ''); }
    // the gentle line
    if (nudge.update(dt, s, { muted: services.get('skills')?.muted === true })) say('engine', '0');
    stepSunrise();
  }
  // outside hooks that run after each physics tick, after the dock's (the racing marks: src/marks/scene.js)
  const posts = [];
  // the base env may carry the bottom's hooks (assemble.js: ground.ext/post). They run with the tackle's, and not while the boat is
  // moored or made fast to a pier (those keep their own collisions); a held boat's ground state is reset (src/sail/simulation.js tackleEnv)
  const env = (e) => tackleEnv(e, tk, posts);
  const addPost = (f) => { posts.push(f); return () => { const i = posts.indexOf(f); if (i >= 0) posts.splice(i, 1); }; };
  function post(dt) {
    const s = phys.state;
    // the cockpit's controls follow the engine: the gear lever ±0.55 rad (+ forward = ahead), the throttle 0 … 0.9 rad,
    // the key a quarter turn on (a little more while the starter cranks); the oil and temperature lamps glow with the key
    // on and no oil pressure yet (cranking, or a stall), and go out once it runs, as a real panel's do
    const E = cp();
    if (E) {
      const ud = (o) => (o.userData.r0 ??= o.rotation.clone());
      if (E.gear) E.gear.rotation.x = ud(E.gear).x + 0.55 * (s.engineGear || gearNow());
      if (E.throttle) E.throttle.rotation.x = ud(E.throttle).x + 0.9 * thrNow();
      if (E.key) E.key.rotation.z = ud(E.key).z + (eng.on ? (eng.state === 'cranking' ? 1.1 : 0.8) : 0);
      const warn = eng.on && eng.rpm < 0.6 * eng.P.rpmIdle;
      if (warn !== lampsOn) { E.setLamps?.(warn ? 1 : 0, warn ? 1 : 0); lampsOn = warn; }
    }
    // the furler drum turns as the jib rolls (the rig's drum, spars-mesh.js): ≈ 6 turns from out to furled
    boat.modules.rigging?.parent && rigDrum()?.userData?.turn?.(sailParams(s).jib.furl * 6 * 2 * Math.PI);
    // the exhaust from its socket
    const st = boat.sockets.exhaust; st.getWorldPosition(_v);
    const h = s.heading, aft = [-Math.sin(h), Math.cos(h)], stbd = [Math.cos(h), Math.sin(h)];
    exhaust.update(s, { at: [_v.x, _v.y, _v.z], aft, stbd }, dt);
    // the rode: from the roller down to the water toward the anchor (the rest is under the surface), the stowed
    // anchor shown on the roller only while it is stowed
    const an = tk.state.anchor, roller = boat.sockets.hull.localToWorld(new THREE.Vector3(...(boat.dims.HULL.anchorRoller ?? [0, 1.1, -4.4])));   // the roller's axle (dims.js)
    // the anchor itself (hardware.glb's plough on the 'anchor' socket): lowered along −y as
    // the chain runs out (it follows the rode's length out of the roller), hidden once it is 1 m under; back up on weighing
    { const sk = boat.sockets.anchor, y0 = boat.dims.HULL.anchorPin?.[1] ?? sk.userData.y0 ?? (sk.userData.y0 = sk.position.y), drop = an.phase === 'stowed' ? 0 : Math.min(an.out, y0 + 1.2);
      sk.position.y = y0 - drop; sk.visible = drop < y0 + 1.0; }
    if (tk.mode === 'anchor' && an.phase !== 'stowed') {
      const dx = an.x - roller.x, dz = an.z - roller.z, L = Math.hypot(dx, dz) || 1;
      const steep = an.phase === 'falling' || an.phase === 'up' ? 0.05 : clamp(0.9 - an.H / 1500, 0.15, 0.9);   // a loaded rode leaves at a flatter angle
      const reach = roller.y / Math.max(0.2, Math.tan(Math.atan2(1, steep) * 0.9));
      const pts = []; for (let i = 0; i < 12; i++) { const k = i / 11; pts.push([roller.x + dx / L * reach * k, roller.y * (1 - k) - 0.4 * k, roller.z + dz / L * reach * k]); }
      drawLine(rode, pts);
    } else rode.visible = false;
    if (tk.mode === 'moored' && tk.state.ball) {
      const b = tk.state.ball, pts = []; for (let i = 0; i < 8; i++) { const k = i / 7; pts.push([roller.x + (b.x - roller.x) * k, roller.y * (1 - k) + 0.25 * k - Math.sin(Math.PI * k) * 0.35, roller.z + (b.z - roller.z) * k]); }
      drawLine(pennant, pts);
    } else pennant.visible = false;
    tk.state.lines.forEach((L, i) => {
      if (!dockLines[i]) return;
      const hh = s.heading, wx = s.x + L.px * Math.sin(hh) + L.py * Math.cos(hh), wz = s.z - L.px * Math.cos(hh) + L.py * Math.sin(hh);
      drawLine(dockLines[i], [[wx, 1.0, wz], [L.cleat[0], 1.4, L.cleat[1]]]);
    });
    for (let i = tk.state.lines.length; i < dockLines.length; i++) dockLines[i].visible = false;
    // the fenders: on the pier's side, while the crew has them down
    fenders.visible = tk.state.fenders;
    if (fenders.visible && tk.state.nearPier) {
      const p = tk.state.nearPier, mx = (p.a[0] + p.b[0]) / 2, mz = (p.a[1] + p.b[1]) / 2, hh = s.heading;
      const side = Math.sign((mx - s.x) * Math.cos(hh) + (mz - s.z) * Math.sin(hh)) || 1;   // the pier to starboard (+) or port
      for (const f of fenders.children) f.visible = f.userData.side === side;
    }
    // the sound: the engine and the chain's speed
    const out = an.phase === 'stowed' ? 0 : an.out;
    chainMs += ((out - lastOut) / Math.max(dt, 1e-3) / (services.get('controls')?.timeScale ?? 2) - chainMs) * Math.min(1, dt / 0.15); lastOut = out;
    const camDist = Math.hypot(camera.position.x - s.x, camera.position.y, camera.position.z - s.z);
    ea?.update(s, { camDist, chainMs: Math.abs(chainMs) });
  }

  function dispose() {
    off.abort(); scene.remove(exhaust.mesh); for (const l of [rode, pennant, ...dockLines]) scene.remove(l); boat.sockets.hull.remove(fenders); veil.remove(); ea?.dispose();
    services.remove('seamanship', api);
  }
  const api = {
    get motoring() { return motoring(); },
    get furlWant() { return furlWant; },
    pre, post, env, addPost, camera: (dt, pose, normal) => arrivalPose(dt, normal), dispose, actions, tackle: tk, hooks, exhaust, engineAudio: ea, nudge,
    get held() { return tk.mode !== 'free' && (tk.mode !== 'anchor' || ['down', 'held'].includes(tk.state.anchor.phase)); },
    get holding() { return holding && slowFor >= A.holdS; },   // at anchor, set and still (the logbook's "at anchor")
    get anchoredNow() { return holding; },   // the anchor down and holding (discoveries.js times the stillness itself)
    get arrival() { return arrival ? { phase: arrival.phase, k: arrival.k } : null; },
    get waking() { return waking; }, get chainMs() { return chainMs; }, get hour() { return core.sun?.hour ?? null; },
    get state() { const s = phys.state; return { engine: eng.state, rpm: Math.round(eng.rpm), lever: +eng.lever.toFixed(2), gear: eng.gear ?? 0, thrust: Math.round(s.thrust), mode: tk.mode, anchor: { ...tk.state.anchor }, fenders: tk.state.fenders, furl: +s.furl.toFixed(2), sog: +s.sog.toFixed(2), depth: -terrain.heightAt(s.x, s.z), why: tk.state.why }; },
  };
  services.provide('seamanship', api);
  services.provide('seamanshipHour', () => core.sun?.hour ?? null);   // the probe's clock read (tools/probe_engine.mjs)
  return api;
}
export { ANCHOR };
