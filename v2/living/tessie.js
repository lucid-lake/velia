// Tessie's plug-in for v2/main.js (one marked block there; M1). Desktop only: main.js asks
// living/tessie-policy.js once at load and makes this plug-in only on a desktop at L0–L2 (a phone or a tablet never makes
// it: no model, no pipelines, no fetch, no sound). Its three pipelines are the deferred group 'tessie' (after 'kayaks'),
// built after the first frame; the model is fetched once play has started (the card has gone) and the group is built.
//   const T = createTessiePlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, wake, errors, flags, P, depthAt })
//   T.attach({ B, ui, hold, race, mode })         once the boat exists (race(): a race runs); when she rises is the stage
//                                                   director's (v2/stage/acts.js 'tessie': T.sim.cue())
//   await T.prime(view)                             a capture with ?tessie=: the model in, the sighting placed (now: at once)
//   T.step(dt, view, level)                         each sim frame, after the camera (the living clock: real time)
//   c = T.camera(dt, c)                            the camera's assist (first sighting, no input for 3 s: up to 15° toward her)
//   c = T.cruiseCamera(dt, c, { input })           M3: Cruise's cut (she appears: the shot turns to her at ≤ 15°/s, eased, holds, returns)
//   T.moment() → the kind the stage gives her next (v2/stage/tessieMoments.js); T.begin(kind) stages it (act-tessie.js)
//   T.fill(ok, eye, focalPx); T.runWater(pass, c) in water-sim; T.draw(pass, c) and T.drawFx(pass, c) before the water;
//   T.drawMirror(pass, c) and T.drawMist(pass, c) after it; T.setAudio(audio) (her synthesised sound); T.stats()
// view: { eye: [x, y, z], fwd: [x, y, z], fovDeg, aspect }
import { createTessieRender } from '../render/tessie.js';
import { createTessie } from '../sim/tessie.js';
import { tessieFlag, tessieDraws } from './tessie-policy.js';
import { createTessieFx } from './tessie-fx.js';
import { createTessieSound } from './tessie-sound.js';
import { areaOf } from '../stage/areas.js';
import { createRevenge, REVENGE } from '../sim/tessieRevenge.js';   // TK: one charge and she takes revenge
import { NOTES } from '../../src/ui/skipper.js';   // the revenge's two spoken lines (tessieChase, tessieClose)
import { createBehave } from '../sim/tessieBehave.js';   // M3: alongside and under the hull
import { createCamCut } from '../sim/tessieCamCut.js';   // M3: Cruise's camera cut
import { pickMoment, momentFlag, neckReady, glowShare, NECK } from '../stage/tessieMoments.js';   // M3: the rare moments' staging
export { createTessiePlayer } from './tessiePlayer.js';   // play as Tessie: the page's swap, her keys, camera and HUD (her chunk)

const TESSIE_URL = new URL('../assets/tessie/tessie.glb', import.meta.url);

export function createTessiePlugin({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, wake, errors = [], flags, P, depthAt, under = false }) {   // under: phase 2a (src/core/features.js tessieUnder)
  const R = createTessieRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, wake, errors, under });
  const F = tessieFlag(flags.tessie);
  const area = areaOf('tessieWaters');   // her water (v2/stage/areas.js): near it each sighting is placed in it (how often: the stage's tessie act)
  const sim = createTessie({ seed: P.seed, depthAt, area });
  let B = null, ui = null, hold = null, race = () => false, sunOf = () => [0, 1, 0], sound = null;
  // M3: her behaviours, the rare moments' staging, Cruise's cut. hourOf: the clock's hour; stormOf: null
  // or { s, strikes: [{ s, bolt }] } (the storm's arc second and its next strikes); cruiseOn: Cruise runs
  const behave = createBehave({ sim, depthAt }), camCut = createCamCut(), force = momentFlag(flags.tessiem);
  let hourOf = () => 12, stormOf = () => null, cruiseOn = () => false;
  const done = { breach: false, neck: false };
  let cutLast = { calls: 0 };   // the cut's last call (stats: a film reads why it turned or not)
  let pending = null, cutSeen = 0, stormRate = null, lastStormS = null, nextIn = null, lastBoat = null;
  const vel = [0, 0];
  // TK: the revenge, made at attach (it needs the mode); its clock (the living one) for the strike's knockdown
  let revenge = null, clockT = 0, strikeAt = -Infinity;
  let raceDrone = 0;   // Tessie's Deep (v2/regatta/tessieDeep.js): the drone's level while she rises on the course (0–1)
  // M2: her splashes, drips and mist, her shadow on the bed (living/tessie-fx.js), her sound (living/tessie-sound.js)
  const fx = createTessieFx({ seed: P.seed, bedAt: (x, z) => -depthAt(x, z) });
  const eventLog = [];   // the events heard, for a film's offline sound (tools/v2-tessie-film.mjs): { t (s, page clock), type, x, z, s, cam }
  let loadP = null, started = false, level = 0, nowDone = false;
  const t = { assetMs: null, playAt: null };
  const t0 = performance.now();
  // play has started: a capture at once; a live page once the lake is live behind or beside the card. The kayaks' rule (v1's
  // playNow) waits for the card to go; Tessie also counts the home card (owner portrait,: "open the game, touch
  // nothing": a returning player who touches nothing sits on the home card with the lake live to its right)
  const cardState = () => globalThis.document?.getElementById?.('lk-load')?.dataset?.state;
  const playNow = () => {
    if (P.headless) return true;
    const st = cardState();
    return st == null || st === 'out' || st === 'gone' || st === 'menu' || st === 'attract' || st === 'home';
  };
  // the part of the view she may be placed in: the whole frame, or right of the home card while it is up (its right edge at
  // NDC x ≈ −0.14 at 16:9: she goes in −0.05…0.92)
  const camOf = (v) => {
    const l = Math.hypot(v.fwd[0], v.fwd[2]) || 1, yaw = Math.atan2(v.fwd[0] / l, -v.fwd[2] / l), th = Math.tan(v.fovDeg * Math.PI / 360) * v.aspect;
    const st = P.headless ? null : cardState();
    if ((st === 'home' || st === 'menu') && v.aspect > 1.2) { const a0 = Math.atan(-0.05 * th), a1 = Math.atan(0.92 * th); return { x: v.eye[0], z: v.eye[2], yaw: yaw + (a0 + a1) / 2, hHalf: (a1 - a0) / 2 / 0.85 }; }
    return { x: v.eye[0], z: v.eye[2], yaw, hHalf: Math.atan(th) };
  };
  // the boat for her: where it is, its speed, its ground velocity on her clock (vx, vz) and its drawn pose (M3: the hold reads the
  // heave, heel, pitch, boom and jib the boat is drawn with)
  const boatOf = () => {
    const s = B?.state; if (!s || !Number.isFinite(s.x)) return null;
    const p = B.pose ?? s;
    return { x: s.x, z: s.z, heading: s.heading ?? 0, speed: s.sog ?? s.speed ?? 0, vx: vel[0], vz: vel[1],
      heel: p.heel ?? 0, pitch: p.pitch ?? 0, heave: p.heave ?? 0, boomAngle: p.boomAngle ?? 0, jibAngle: p.jibAngle ?? 0 };
  };
  const load = () => (loadP ??= R.load(TESSIE_URL.href).then((a) => { t.assetMs = +(performance.now() - t0).toFixed(1); sim.L = a.L; return a; }));
  // the camera's assist: the first sighting only, and only with no input for 3 s: the follow camera's aim
  // eases up to ASSIST_DEG toward her while she is up, then back; any key, tap, drag or wheel ends it at once (the camera is the
  // player's)
  const ASSIST_DEG = 20, ASSIST_IDLE_S = 3;
  let lastInput = -1e9, assist = 0, assistDone = false;
  if (!P.headless && typeof addEventListener === 'function') for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart']) addEventListener(ev, () => { lastInput = performance.now(); if (assist !== 0) assistDone = true; }, { passive: true, capture: true });
  function cameraAssist(dt, c) {
    const st = sim.state, first = sim.sightings.length === 1;
    const idle = (performance.now() - lastInput) / 1000 > ASSIST_IDLE_S;
    let want = 0;
    if (!assistDone && first && st.visible && idle && st.phase !== 'rise' && st.phase !== 'dive') {
      const dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2], l = Math.hypot(dx, dz) || 1;
      const fx = dx / l, fz = dz / l, ex = st.centre[0] - c.pos[0], ez = st.centre[1] - c.pos[2];
      const ang = Math.atan2(ex * -fz + ez * fx, ex * fx + ez * fz);   // + to starboard
      const v = lastView; const mid = v ? v.yaw - Math.atan2(fx, -fz) : 0;   // the usable window's middle (right of the home card while it is up)
      const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
      want = Math.max(-ASSIST_DEG, Math.min(ASSIST_DEG, wrapA(ang - mid) * 180 / Math.PI * 0.8)) * Math.PI / 180;
    } else if (!idle && assist !== 0) { assistDone = true; }
    if (assistDone && !idle) { assist = 0; return c; }   // input: at once
    assist += (want - assist) * (1 - Math.exp(-dt / 1.5));
    if (Math.abs(assist) < 1e-4) return c;
    const cs = Math.cos(assist), sn = Math.sin(assist), dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2];
    return { ...c, target: [c.pos[0] + dx * cs - dz * sn, c.target[1], c.pos[2] + dx * sn + dz * cs] };
  }
  let lastView = null;
  // the skipper's line through Sail's hint (the kayaks' way: desktop shows it; a phone never has her)
  // the revenge's lines: the skipper's spoken notes (src/ui/skipper.js NOTES; MUST: they show at once, over any line)
  function sayNote(id) { const n = NOTES[id], hint = ui?.()?.services?.get?.('controls')?.hint; if (!n || !hint) return false; return hint.note ? hint.note(n.text, '', n.speak, { kind: `sea.${id}` }) : say(n.text); }
  function say(text) { const hint = ui?.()?.services?.get?.('controls')?.hint; return hint?.flash ? hint.flash(text, { secs: 4.5 }) ?? true : false; }
  const self = {
    render: R, get sim() { return sim; }, on: true,   // on: the harness's A/B (draws and dispatches off, the sim runs)
    // play as Tessie (living/tessiePlayer.js sets these): playing: the player has her (no revenge, no camera assist or cut); boatFor(boat):
    // the hull she is held outside this frame (the nearest of the Halcyon and the lake's sailboats); playDip: the beds' level under the
    // surface; the sound's swim (the rush, the low-pass)
    playing: false, boatFor: null, playDip: 1,
    get sound() { return sound; },
    attach(o) {
      B = o.B; ui = o.ui ?? null; hold = o.hold ?? null; race = o.race ?? race; sunOf = o.sun ?? sunOf;
      hourOf = o.hour ?? hourOf; stormOf = o.storm ?? stormOf; cruiseOn = o.cruise ?? cruiseOn;
      // mode() → 'sail' | 'cruise' | 'regatta' (the revenge is Sail's); reduced() → the OS's reduced motion (no gloom)
      revenge = createRevenge({ sim, area, depthAt, mode: o.mode ?? (() => 'sail'), reduced: o.reduced ?? (() => false) });
      return self;
    },
    get revenge() { return revenge; },
    raceCue(level = 0) { raceDrone = Math.max(0, Math.min(1, level)); },   // the race's warning: the low drone under her rise
    get behave() { return behave; }, get camCut() { return camCut; }, get done() { return done; }, get pending() { return pending; },
    // M3: the kind the stage gives her next (a flag forces one: ?tessiem=)
    moment() { return pickMoment({ force, hour: hourOf(), storm: !!stormOf(), near: sim.nearArea, n: sim.sightings.length, done, seed: P.seed }); },
    // M3: stage it. 'sighting' and 'breach' are cued now (the sim places her at its next step); 'neck' waits for a strike due
    // NECK.leadS ahead (cheat on when); 'alongside' and 'under' start at the next step that finds deep water by the boat
    begin(kind = 'sighting') {
      pending = null;
      if (kind === 'breach') { done.breach = true; return sim.cue({ kind: 'breach' }); }
      if (kind === 'neck' || kind === 'alongside' || kind === 'under') { pending = { kind, t: 0, retryAt: 0 }; if (kind === 'neck') done.neck = true; return true; }
      return sim.cue();
    },
    cancelMoment() { pending = null; behave.cancel(); },
    // the knockdown in hand is hers: her tail sweep came within the last 6 s (main.js: the end card's cause 'tessie')
    revengeCause() { return clockT - strikeAt < 6; },
    // the beds' level under the drone (1: as they are; REVENGE.dip at the drone's full)
    dip() { return Math.min(self.playDip, 1 - (1 - REVENGE.dip) * (revenge?.state.dip ?? 0)); },
    setAudio(audio, settings = null) { if (!P.headless && audio) sound = createTessieSound({ audio, seed: P.seed, settings }); },   // settings: Setup's effects switch (the sound switch and M mute the master)
    eventLog, fx,
    async prime(view) {
      await load();
      if (F.now) { sim.now(F.breach ? 8 : 11, { boat: boatOf(), view: camOf(view) }); if (F.breach) sim.play('breach'); nowDone = true; }
    },
    step(dt, view, lv = 0) {
      level = lv;
      if (!B) return;
      const playing = playNow();
      if (playing && t.playAt == null) t.playAt = +(performance.now() - t0).toFixed(1);
      // the model once play has started and the group is built (nothing before the first frame: the card first)
      if (!started && playing && !hold?.()) { started = true; load().catch(() => {}); }
      if (!R.ready) return;
      const cam = camOf(view), boat0 = boatOf(), boat = self.playing && self.boatFor ? (self.boatFor(boat0) ?? boat0) : boat0;
      // the window (yaw, half-angle) without the assist's turn: the director and the assist aim at the same place
      lastView = { ...cam, yaw: cam.yaw - assist };
      if (F.now && !nowDone && boat) { sim.now(F.breach ? 8 : 11, { boat, view: cam }); if (F.breach) sim.play('breach'); nowDone = true; }
      // M3: the boat's ground velocity on her clock (the behaviours keep pace with it)
      if (boat && dt > 0 && playing) { if (lastBoat) { vel[0] = (boat.x - lastBoat.x) / dt; vel[1] = (boat.z - lastBoat.z) / dt; boat.vx = vel[0]; boat.vz = vel[1]; } lastBoat = { x: boat.x, z: boat.z }; }
      // M3: the storm's next strike, in s of her clock (its arc's pace measured against hers)
      const sm = stormOf();
      if (sm && Number.isFinite(sm.s) && dt > 0) {
        if (lastStormS != null && sm.s > lastStormS) { const r = (sm.s - lastStormS) / dt; stormRate = stormRate == null ? r : stormRate + (r - stormRate) * 0.1; }
        lastStormS = sm.s;
        const nx = (sm.strikes ?? []).filter((k) => k.s > sm.s), rate = stormRate ?? 1;
        const fit = nx.find((k) => k.bolt && neckReady((k.s - sm.s) / rate)) ?? nx.find((k) => neckReady((k.s - sm.s) / rate)) ?? nx[0];
        nextIn = fit ? (fit.s - sm.s) / rate : null;
      } else { lastStormS = null; nextIn = null; }
      // M3: a staged moment waiting for its time and place
      if (pending && playing && boat && dt > 0) {
        pending.t += dt;
        if (pending.kind === 'neck') {
          if (neckReady(nextIn)) { sim.cue({ kind: 'neck', flashAt: sim.playT + dt + nextIn }); pending = null; }
          else if (pending.t > NECK.waitS || !sm) { sim.cue(); pending = null; }   // no flash to stage it on: an ordinary sighting
        } else if (pending.t >= pending.retryAt && !race()) {
          if (behave.start(pending.kind, { boat, view: cam })) pending = null;
          else { pending.retryAt = pending.t + 2; if (pending.t > 20) { sim.cue(); pending = null; } }
        }
      }
      sim.step(dt, { playing, boat, view: cam, race: !!race() });
      if (dt > 0) clockT += dt;
      if (revenge?.active && behave.active) behave.cancel();   // her revenge drives her now
      if (behave.active && boat) { if (race()) behave.cancel(); else behave.step(dt, { boat }); }
      // TK: the revenge reads her and the boat after her step, and drives her (its sound moments join hers below)
      if (revenge?.active && self.playing) revenge.cancel('play');
      // played: no boat for the revenge to read, but the drone, the ducked beds and the gloom it left still fade out to rest
      if (revenge && self.playing && (revenge.state.drone > 0 || revenge.state.gloom > 0)) {
        revenge.step(dt, { boat: null, playing });
        sound?.drone(Math.max(revenge.state.drone, raceDrone), dt);
      }
      if (revenge && boat && !self.playing) {
        revenge.step(dt, { boat: { ...boat, heel: B.state.heel ?? 0 }, playing, race: !!race(), view: cam });
        for (const e of revenge.events) {
          if (e.type === 'chase') sayNote('tessieChase');
          else if (e.type === 'escape' && e.line) sayNote('tessieClose');
          else if (e.type === 'strike') { strikeAt = clockT; const Pp = B.phys?.P; if (Pp) B.shove?.({ K: e.K * Pp.mass * 9.81 * Pp.gm }); }
        }
        sound?.drone(Math.max(revenge.state.drone, raceDrone), dt);   // her race's warning (raceCue) shares the revenge's drone
      }
      fx.step(dt, sim.state, sunOf());
      if (sim.state.events.length) {
        const camYaw = { x: cam.x, z: cam.z, yaw: cam.yaw };
        for (const e of sim.state.events) {
          if (eventLog.length > 400) eventLog.shift();
          eventLog.push({ t: performance.now() / 1000, type: e.type, x: e.x, z: e.z, s: e.s, cam: camYaw });
          sound?.play(e, camYaw);
        }
      }
      if (sim.line.pending) { const text = typeof sim.line.pending === "string" ? sim.line.pending : sim.T.line; sim.line.pending = false; say(text); }
    },
    camera(dt, c) { return P.headless || !R.ready || self.playing ? c : cameraAssist(dt, c); },
    // M3: Cruise's cut (owner 2026-11-18): once a sighting, when she has broken the surface, the shot turns to
    // her (≤ 15°/s, eased: sim/tessieCamCut.js), holds a few seconds, turns back; the player's own look sends it back
    cruiseCamera(dt, c, { input = false } = {}) {
      if (!R.ready || !c || self.playing) return c;
      const st = sim.state;
      let cue = false, angle = null;
      if (st.visible && st.phase !== 'rise' && st.phase !== 'dive' && cruiseOn()) {
        const dx = c.target[0] - c.pos[0], dz = c.target[2] - c.pos[2], l = Math.hypot(dx, dz) || 1, fx = dx / l, fz = dz / l;
        const ex = st.centre[0] - c.pos[0], ez = st.centre[1] - c.pos[2];
        angle = Math.atan2(ex * -fz + ez * fx, ex * fx + ez * fz);   // + to the right of the shot
        if (sim.sightings.length !== cutSeen) { cue = true; cutSeen = sim.sightings.length; }
      }
      cutLast = { calls: cutLast.calls + 1, cruise: !!cruiseOn(), angle: angle == null ? null : +(angle * 180 / Math.PI).toFixed(1), input: !!input, cue };
      return camCut.apply(c, camCut.step(dt, { cue, angle, input }));
    },
    fill(ok = true, eye = null, focalPx = 0) {   // ok: her group built and her layer on
      const on = ok && self.on && tessieDraws(level);
      const c = sim.state.centre;
      // M3: her night wake's glow (owner 2026-11-18): from the sun 2° under the horizon to 7° (?tessiem=glow: at any hour, captures)
      R.update(sim.state, on, eye, focalPx, on && sim.state.visible && c ? depthAt(c[0], c[1]) : 30, glowShare(sunOf()[1], force === 'glow'));   // the water under her: the column behind her (render/tessie.js)
      R.updateFx(on ? { shadowPts: fx.shadow, nShadow: fx.nShadow, drops: fx.drops, mists: fx.mists, focalPx } : {});
      // TK: the gloom round the boat while the revenge runs (0 under reduced motion: the revenge's own rule)
      const g = revenge?.state.gloom ?? 0, s = B?.state;
      R.updateGloom(ok && self.on && g > 0 && s ? { x: s.x, z: s.z, heading: s.heading ?? 0, a: g * REVENGE.gloom } : null);
    },
    drawFx(pass, c) { R.drawFx(pass, c); },
    drawMist(pass, c) { R.drawMist(pass, c); },
    runWater(pass, c) { R.runWater(pass, c); },
    draw(pass, c) { R.draw(pass, c); },
    drawMirror(pass, c) { R.drawMirror(pass, c); },
    stats() { return { ...sim.stats(), m3: { kind: sim.kind, pending: pending ? { kind: pending.kind, t: +pending.t.toFixed(1) } : null, done: { ...done }, force, behave: { ...behave.state, active: behave.active }, camCut: { ...camCut.state, last: cutLast }, nextStrikeS: nextIn == null ? null : +nextIn.toFixed(2) }, revenge: revenge ? { ...revenge.state, active: revenge.active } : null, render: R.stats, fx: { drops: fx.drops.length, mists: fx.mists.length, shadow: fx.nShadow, events: { ...fx.stats.events } }, sound: sound?.stats ?? null, ms: t, level, draws: tessieDraws(level) }; },
  };
  // ?tessie=<s> (the first sighting's break at that play time) is the stage director's: main.js passes it as the act's opening
  return self;
}
