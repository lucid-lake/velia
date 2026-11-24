// The July 4th show's plug-in for v2/main.js: v1's rule for when it is built (src/fireworks/share.js showOn: the map's
// highlight day, ?fireworks not 0), the show clock (v2/sim/fireworks.js: liveShowClock on a live running clock, its own real
// seconds from 21:44; showClock in captures; ?fwt pins it), the GPU side
// (render/fireworks.js), the barges' evening (20:30–23:30) and the sound and music (v2/audio/fireworks.js; live pages
// only: each burst's sound from its own shell, delayed and quieter with distance). Open world (owner, 2026-11-15:
// "fireworks on means fireworks on, the boat is independent"): the show plays at its own launch site; in Sail nothing
// moves the boat or the camera (no start at the viewing spot, no show framing: the player sails toward it and looks up);
// in Cruise the autopilot keeps its route and only the camera turns toward the show while it plays (cruiseCamera:
// v2/sim/showFrame.js). main.js calls: attach(B, windField, { thud }), frame(...), idle() (a race's frames), cruiseCamera(dt, pose, o), run,
// encodePost, wantsDepth, drawSolid, drawLight, prime() (a capture, before its first frame), stats().
// L3: the props are solid (v1's src/fireworks/solids.js on v1's world.js recipe: v2/sim/solids.js): the barges with their pusher tugs and the
// four patrol boats, in the boat's own physics tick (the seamanship's post), solid only while drawn (the barges' evening;
// never in a race); a bump thuds (v1's player.cue('thud', { v: j / 3765, mat: 'rock' })). The spectators' anchored
// sailboats are not drawn in v2 yet (BACKLOG-v2 #19), so they are not solid either (no ghost wall)
import { createShowState, gameShow, showOn, showClock, liveShowClock, bargesOut, lampLevels, nightOf, SCALE, SHOW_LENGTH, STEP } from '../sim/fireworks.js';
import { createShowFrame } from '../sim/showFrame.js';   // Cruise's camera toward the show (owner, 2026-11-15)
import { createFireworksRender, showRamp } from '../render/fireworks.js';
import { createFireworksAudio } from '../audio/fireworks.js';
import { showNeed, createLazy } from '../sim/lazyShow.js';   // the show's script off the boot path (perf/v2-phone-load)
import { createOccluder } from '../sim/fireworksOcclude.js';   // the bursts' light behind the land (owner, 2026-11-18)
import { createSolids } from '../sim/solids.js';   // L3: v1's solid props (src/fireworks/solids.js, copied three-free): the barges, tugs and patrol boats stop our boat
import { fireworksSite, inShowScene, showStartHeading, showStartPose } from '../sim/fireworksSite.js';   // the launch site: the bay (default) or past the mouth (?fwsite, the 2026-11-18 A/B)
import { isHighlightDay } from '../../src/sim/day.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { feature } from '../../src/core/features.js';
import { saluteShow, SALUTE } from '../regatta/salute.js';   // the barges' salute at a place race's finish

// the page's general bloom (render/bloom.js) while the show's own post blooms the stars (owner, 2026-11-18: the finale read as a
// white disc: two blooms stacked on the overlapping bursts): its share, eased with the post's ramp
export const MAIN_BLOOM_IN_SHOW = 0.2;
export const WIND_GAIN = 1.4;   // v1's world.js: the show's wind × 1.4 (the air aloft)

export function fireworksOn(flags) { return showOn(flags, isHighlightDay(CURRENT_WATERS)); }

export function createFireworksPlugin({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa, msaaCounts = null, depthFormat, flags, P, water = null, errors = [], audioCore = null, race = null, heightAt = null }) {   // heightAt: the ground's CPU twin (the glow's occlusion)   // race(): a race is on (Regatta cuts the show: nothing solid)   // audioCore: the page's music door (v2/audio/music.js createLateCore)
  if (!fireworksOn(flags)) return null;
  const tier = feature('fireworksTier').tier;   // v1's phone tier (half the stars, no streaks): a phone, a tablet or L2–L3, or ?touch=1 (src/core/features.js)
  const tall = typeof innerWidth === 'number' && innerHeight > innerWidth;
  const site = fireworksSite(flags), barges = site.barges, SHOW_CENTRE = site.centre;
  // the show's script off the boot path (v2/sim/lazyShow.js): made at once when the show clock runs, in an idle slice when
  // the evening is near, else never; until then the state holds an empty script (nothing is spawned outside the window)
  const state = createShowState({ show: { seed: P.seed, length: SHOW_LENGTH, events: [] }, barges, scale: SCALE, tier });
  const lazy = createLazy(() => { const s = gameShow(P.seed, { tall, barges }); state.setShow(s); snd?.setShow(s); return s; });
  const gpu = createFireworksRender({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa, msaaCounts, depthFormat, state, scale: SCALE, barges, slopeView: water?.slope?.createView({ dimension: '2d-array' }) ?? null, errors });
  const pin = flags.fwt != null && Number.isFinite(parseFloat(flags.fwt)) ? parseFloat(flags.fwt) : null;
  const clockOf = showClock({ pin, hour0: P.hour, timerate: P.timerate });
  // a live page whose day clock runs: the show on its own real-time clock from 21:44 (sim/fireworks.js liveShowClock; owner,
  // 2026-11-15: a time event, nothing slows the day clock for it); captures, films and a pinned ?fwt keep showClock
  const live = pin == null && !P.headless && (P.clockMode === 'day' || P.clockMode === 'rate');
  const liveClock = live ? liveShowClock() : null;
  // (no sound on a film page, ?filmui=1: v1's goldens film muted; the audio's loading made v2-hud-full's frames differ run to run)
  const snd = !P.headless && flags.filmui !== true && flags.fwsound !== false ? createFireworksAudio({ show: null, barges, scale: SCALE, seed: P.seed, phone: tier === 'phone', core: audioCore }) : null;
  // ?layers= (profiling): without 'fireworks' the show still runs (and Cruise's camera still turns), but nothing is dispatched or drawn
  const drawOn = !flags.layers || String(flags.layers).split(',').includes('fireworks');
  let B = null, wind = null, showT = null, primed = false, thud = null, framed = false;
  const showFrame = createShowFrame({ aim: SHOW_CENTRE, length: SHOW_LENGTH });
  const solids = createSolids({ barges, toward: site.toward, wet: null, sailboats: [], onBump: (e) => { bumps.push(e); if (bumps.length > 8) bumps.shift(); thud?.('thud', { v: e.j / 3765, mat: 'rock' }); } });
  const bumps = [];
  const occ = createOccluder({ heightAt }), occEye = [0, 0, 0];
  let solidOn = false, offPost = null, up = false;
  // the salute (Pass the Channel's finish): SALUTE.lengthS of the show's own shells at the barges, at any hour, on
  // its own real-seconds clock (a race's frames run it: main.js lets the fireworks draw in a race while it plays); then the show's own
  // script comes back and everything the salute left is cleared
  let salT = null, salutes = 0;
  const SAL_TAIL_S = 6;   // the last stars and smoke fade after the last burst
  const salFrame = createShowFrame({ aim: SHOW_CENTRE, length: SALUTE.lengthS - 3 });   // the race camera turns to the salute (reach: it must be seen), then back   // up: a show clock was seen since the last leave
  const leaves = [];   // the last leaves' reasons (stats)
  const windAt = (t) => { const w = wind?.sample?.(SHOW_CENTRE[0], SHOW_CENTRE[1], t); return w ? [w.vx * WIND_GAIN, 0, w.vz * WIND_GAIN] : [0, 0, 0]; };
  const frameLook = { wind: [0, 0, 0], gain: 1, pixRad: 0.001, night: 0, lamps: null, simT: 0, props: false, fixedSteps: 0, showDist: 750, showT: null, occlude: null };
  frameLook.occlude = (flash) => occ.apply(flash, occEye); frameLook.eye = occEye;   // the eye: the occlusion and the barges' level of detail   // the bank's light × the share of each burst the eye sees past the land
  const self = {
    tier, state, gpu, audio: snd, site,
    mainBloom: () => 1 - (1 - MAIN_BLOOM_IN_SHOW) * (drawOn && gpu.wantsDepth() && showT != null ? showRamp(showT) : 0),
    inScene: (hour, pinned) => inShowScene(hour, pinned), facing: (x, z, windFromDeg = null) => showStartHeading(site, x, z, windFromDeg), startAt: () => showStartPose(site),   // the fireworks scene faces the show (main.js)
    get show() { return lazy.get(); },   // the script (made now if it was not yet)
    get showBuilt() { return lazy.built; },
    attach(b, w, o = {}) {
      B = b; wind = w; thud = o.thud ?? null;
      // the solids in the boat's tick (v1: player.addPost); off until the barges' evening (setOn below)
      solids.setOn({ barges: false, crowd: false });
      offPost = B?.sea?.addPost ? B.sea.addPost((st, dt, t) => { if (solidOn && !race?.()) solids.post(st, dt, t); }) : null;
    },
    get showT() { return showT; },
    salute() {
      const s = saluteShow(lazy.get());
      state.setShow(s); snd?.setShow(s);
      salT = -0.25; salutes++; primed = false; showT = null;
      return true;
    },
    get saluting() { return salT != null; },
    // the race's camera during the salute (main.js): turned toward the barges while it plays, eased in and out; the player's look wins
    saluteCamera(dt, pose, { input = false } = {}) { const w = salFrame.step(dt, salT, { input }); return w > 0 ? salFrame.apply(pose, w) : pose; },
    // Cruise's camera during the show (main.js placeCamera, Cruise's rig pose in, the pose on screen out): turned toward
    // the show from where it is, eased in over 2 s, held, eased out over 2 s after the finale; the player's look wins
    // (input: a drag or the binoculars); a capture (headless) at once on its first frame or under a pinned ?fwt, a headless
    // film eased on its own fixed steps. off: a view that does not turn (Above's chart view)
    cruiseCamera(dt, pose, { simT, hour, input = false, off = false } = {}) {
      const t = liveClock ? showT : clockOf(simT, hour);
      const w = showFrame.step(dt, off ? null : t, { input, instant: P.headless && (pin != null || !framed) });
      framed = true;
      return w > 0 ? showFrame.apply(pose, w) : pose;
    },
    showFrame,
    // a capture: the show seeked to its pinned time before the first frame (deterministic)
    prime(simT) {
      const t = clockOf(simT, P.hour);
      if (t != null) lazy.get();
      if (t != null && t > -30 && gpu.ready()) gpu.seek(t, windAt(simT)); else if (t != null) gpu.clear(t);
      primed = gpu.ready();
    },
    // the show left by any route (fix 2026-11-18, owner: "If I switch to Fireworks first, then switch to another time, say
    // Golden, the last fireworks are left in the sky"): a time pick or skipping time out of its window, a cut back to before
    // it, a race (main.js idle()): every star, flash and puff cleared on the GPU and in the state, the post off (its ramp
    // follows the show clock), the show's sound stopped; the next frame with a show clock seeks afresh
    leave(why = 'left') {
      gpu.clear(); snd?.leave(); primed = false; up = false;
      leaves.push(why); if (leaves.length > 8) leaves.shift();
    },
    // a frame the show is not run (a race): leave it once
    idle() { showT = null; if (salT != null) return; if (up || state.active) self.leave('race'); },
    // before the graph, every frame: the show clock, the GPU's step, the look's numbers, the sound
    // rate: game s per sim s now, speed: sim s per real s, cuts: the clock's cuts, gliding: a glide under way (the live show clock's inputs)
    frame({ simT, hour, dt, eye, fwd, h, fovDeg, sunElevDeg, exposure, rate = 0, speed = 1, cuts = 0, gliding = false }) {
      if (salT != null) {   // the salute's own clock (real seconds; a capture's frames step it by their dt too)
        salT += Math.max(0, dt);
        if (salT > SALUTE.lengthS + SAL_TAIL_S) { salT = null; self.leave('salute'); const s = lazy.built ? lazy.get() : { seed: P.seed, length: SHOW_LENGTH, events: [] }; state.setShow(s); snd?.setShow(s); }
      }
      const t = salT != null ? salT : liveClock ? liveClock.step({ hour, dt, rate: rate * speed, cuts, gliding }) : clockOf(simT, hour);
      showT = t;
      if (t == null && (up || state.active)) self.leave('out');   // out of the show's window (a time pick, skipping time): nothing left in the sky
      if (t != null) up = true;
      const w = windAt(simT);
      let step = 0, fixed = 0;
      const need = showNeed({ t, hour });
      if (need === 'now') lazy.get(); else if (need === 'soon') lazy.soon();
      if (t != null && !gpu.ready()) { state.setTime(t); primed = false; }   // the group not built yet (a pick in the first seconds): seek once it is
      else if (t != null) {
        if (!primed) { if (t > -30) gpu.seek(t, w); else gpu.clear(t); primed = true; }
        else if (P.headless) fixed = Math.max(0, Math.floor((t - state.t) / STEP + 1e-6));   // v1's capture step: whole 1/60 s steps
        else {
          const d = t - state.t;
          // a jump of the show clock (a cut: Fireworks picked again, the clock set): the old bursts and their sound go at once, the
          // GPU replays the new time (a seek) or holds before the show (a clear)
          if (d > 0.3 || d < -0.05) { snd?.leave(); if (t > -30) gpu.seek(t, w); else gpu.clear(t); } else step = Math.min(Math.max(d, 0), 1 / 20);
        }
      }
      const night = nightOf(sunElevDeg);
      frameLook.wind = w; frameLook.gain = 1 / Math.max(exposure, 1e-6); frameLook.pixRad = (fovDeg * Math.PI / 180) / Math.max(1, h);
      frameLook.showDist = Math.hypot(SHOW_CENTRE[0] - eye[0], SHOW_CENTRE[1] - eye[2]);   // v1's FW.dist: how far the water's mirrored rays look for the bursts
      frameLook.night = night; frameLook.lamps = lampLevels(t, night); frameLook.simT = simT; frameLook.props = bargesOut(hour); frameLook.fixedSteps = fixed; frameLook.showT = t; occEye[0] = eye[0]; occEye[1] = eye[1]; occEye[2] = eye[2];   // the post's ramp (render/fireworks.js showRamp)
      // L3: solid only while drawn (a prop coming in over our boat stays a ghost until she is clear: v1's armed), the patrol
      // boats drawn where the bumps put them
      if (frameLook.props !== solidOn) { solidOn = frameLook.props; solids.setOn({ barges: solidOn, crowd: false }); }
      if (solidOn) gpu.setPatrols(solids.bodies);
      gpu.frame(step, frameLook);
      snd?.update(t, { x: eye[0], y: eye[1], z: eye[2], fx: fwd[0], fz: fwd[2] }, dt, hour);
    },
    run: (pass, c) => { if (drawOn) gpu.run(pass, c); },
    encodePost: (enc, c, ts, frameBG, offsets, targets, n) => (drawOn ? gpu.encodePost(enc, c, ts, frameBG, offsets, targets, n) : false),   // v1's post after the scene: the bloom, the land's night look and wash, the stars' target for the water's reflection
    wantsDepth: () => drawOn && gpu.wantsDepth(),   // the scene pass keeps its depth for the post
    drawSolid: (pass, c) => { if (drawOn) gpu.drawSolid(pass, c); },
    drawLight: (pass, c) => { if (drawOn) gpu.drawLight(pass, c); },
    solids, bumps,
    stats: () => ({ salute: { on: salT != null, t: salT == null ? null : +salT.toFixed(2), n: salutes }, leaves: leaves.slice(), showBuilt: lazy.built, solid: solidOn, contacts: solids.stats.contacts, showT: showT == null ? null : +showT.toFixed(3), tier, ...state.stats(), gpu: gpu.stats, audio: snd?.audio?.state ?? null, showFrame: +showFrame.weight.toFixed(4), showYield: showFrame.yielded }),
  };
  return self;
}
