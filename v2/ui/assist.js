// The assist button (owner, 2026-11-16): ONE button whose word changes with the boat's state, on the desktop's helm (the round key under
// the wheel's hub, ui/autopilot.js) and the phone's right corner (ui/flat.js). Pure: no DOM (v2/tests/assist.test.mjs).
//   TACK     upwind (|TWA| < 75°) with way on (SOG ≥ 0.6 m/s): the auto-tack (tackButton.js's TackAssist)
//   GYBE     downwind (|TWA| > 135°) with way on: the auto-gybe (the same assist)
//   FREE     in irons (|TWA| < 32° and under 1.5 kn for 3 s, sails up, not anchored or moored, no engine) or drifting astern
//            (sternway over 0.3 m/s for 3 s): FreeAssist below, the old way out of irons (back the jib, the helm reversed astern)
//   REFLOAT  aground: the kedge (src/sim/boat/ground.js kedge through src/sail/grounding.js: the crew rows the anchor out to the
//            deepest water near and hauls her off)
//   dim      a reach (75–135°), stopped, anchored or moored, the sails down: a press does nothing (the word by the wind's angle);
//            the phone shows STOP under motor as before (its own corner, ui/flat.js)
// A press runs the manoeuvre the word names; a press while one runs cancels it, and so does a hand on the helm (the wheel, the steer
// ring, a steering key). Amber ONLY while a manoeuvre runs. The cue that help is there is the word changing (a dim TACK to a full-ink
// FREE) and one soft brighten (CUE.brightenS) when FREE or REFLOAT appears; no loop.
// Beginners (Sail: the New profile; Regatta: Beginner aids) get FREE on their own after AUTO_FREE.afterS stuck with no input, one line,
// at most once per AUTO_FREE.everyS; everyone else presses it.
//   const a = createAssist({ B, tack, grounding, say, beginner, depthAt });
//   each frame before the boat steps: a.update(dt, { handHeld, input }) → B.station({ free: a.free }); a.press(); a.state
import { tackOffer } from '../../src/ui/touchMap.js';

const DEG = Math.PI / 180, KN = 0.514444;
import { clampT as clamp } from '../../src/sim/core/math.js';

export const ASSIST = Object.freeze({
  tackBelowDeg: 75, gybeAboveDeg: 135, minSpeedMs: 0.6,   // touchMap.js TOUCHUI's: TACK and GYBE as today
  ironsDeg: 32, ironsKn: 1.5, ironsS: 3,                  // FREE: in irons this long
  asternMs: 0.3,                                          // FREE: or drifting astern faster than this (m/s of sternway) as long
  furlUp: 0.5,                                            // the sails count as up under this furl
});
export const CUE = Object.freeze({ brightenS: 1.5 });     // the one soft brighten when FREE or REFLOAT appears
export const AUTO_FREE = Object.freeze({ afterS: 6, everyS: 180 });
export const LINES = Object.freeze({ free: 'Backing the jib — she’ll swing round', auto: 'Freeing her' });
export const WORDS = Object.freeze(['TACK', 'GYBE', 'FREE', 'REFLOAT']);   // every word the round key shows (it fits the longest)

// The decision table (pure). s: the boat's state ({ trueWind.angle, sog, u, furl }); o: { held (anchored, moored, docked), engine
// (on), aground, stuckS (the irons or sternway clock, s), running: null | 'tack' | 'gybe' | 'free' | 'refloat' }
// → { word, kind (what a press runs: 'tack' | 'gybe' | 'free' | 'refloat' | null), lit, dim }
export function assistState(s = null, { held = false, engine = false, aground = false, stuckS = 0, running = null } = {}) {
  const twa = s?.trueWind?.angle ?? 0, a = Math.abs(twa) / DEG, sog = s?.sog ?? 0;
  const byWind = a > 105 ? 'GYBE' : 'TACK';
  if (running) return { word: running.toUpperCase(), kind: running, lit: true, dim: false };
  if (aground) return { word: 'REFLOAT', kind: 'refloat', lit: false, dim: false };
  const sailsUp = (s?.furl ?? 0) < ASSIST.furlUp;
  if (held || !sailsUp) return { word: byWind, kind: null, lit: false, dim: true };
  if (!engine && stuckS >= ASSIST.ironsS) return { word: 'FREE', kind: 'free', lit: false, dim: false };
  const offer = tackOffer({ twa, speed: sog });
  if (offer) return { word: offer === 'gybe' ? 'GYBE' : 'TACK', kind: offer, lit: false, dim: false };
  return { word: byWind, kind: null, lit: false, dim: true };
}

// The irons clock (pure): how long she has been in irons or drifting astern, sails up, free of the bottom, the anchor and the engine
export function stuckNow(s, { held = false, engine = false, aground = false } = {}) {
  if (!s || held || engine || aground || (s.furl ?? 0) >= ASSIST.furlUp) return false;
  const a = Math.abs(s.trueWind?.angle ?? 0) / DEG;
  return (a < ASSIST.ironsDeg && (s.sog ?? 0) / KN < ASSIST.ironsKn) || (s.u ?? 0) < -ASSIST.asternMs;
}

// The FREE manoeuvre, scripted on TackAssist's pattern (owner, 2026-11-16; about 8 s): 0–1 s both sheets eased; then the crew backs
// the jib (the clew held out FREE.jibBackDeg on the side away from the new tack's sails, so the wind on its back pushes the bow off)
// and holds the boom out the same side (the main backed), and as she gathers sternway the helm goes hard over the reversed way (going
// astern the stern goes where the blade's trailing edge points); the bow pivots. At |TWA| ≥ FREE.outDeg on the new tack the jib is
// let go to leeward, the main sheeted, the helm centred and eased out over FREE.easeS. At FREE.timeoutS still not round: the fallback,
// bear away with the jib still backed, for up to FREE.bearS more. The new tack: the side the bow already leans to (the wind's side,
// sign of TWA); a dead heading (|TWA| under FREE.tieDeg) takes the side with the deeper water ahead.
// A game aid beside the sails (FREE.pivot): a small turning moment, ramped in, that tops the pivot up toward FREE.yawDegS when the
// backed sails alone turn her slower (light air): the owner's "about 8 s"; in a fresh breeze the sails do it and the aid stays near 0.
export const FREE = Object.freeze({
  easeS: 1, outDeg: 45, doneEaseS: 0.5, timeoutS: 15, bearS: 10, tieDeg: 3,
  jibBackDeg: 30, mainBackDeg: 60, helm: 1, sheet: 80 * DEG,
  pivot: Object.freeze({ maxNm: 1500, gain: 60000, yawDegS: 9, rampS: 1.5 }),
  lookM: 60,   // the deeper-water look ahead for a tie (m)
});
export class FreeAssist {
  constructor() { this.cancel(); }
  get active() { return this.side !== 0; }
  get kind() { return this.active ? 'free' : null; }
  // twa (rad, + = wind from starboard); deeper(side): the depth ahead if she falls off onto that tack (m), for a tie
  start(twa = 0, { deeper = null } = {}) {
    let side = Math.sign(twa);
    if (Math.abs(twa) < FREE.tieDeg * DEG && deeper) { const p = deeper(1), m = deeper(-1); side = p === m ? (side || 1) : p > m ? 1 : -1; }
    this.side = side || 1; this.t = 0; this.done = 0; this.phase = 'ease'; this.out = null;
    return true;
  }
  cancel() { this.side = 0; this.t = 0; this.done = 0; this.phase = null; this.out = null; }
  // s: the boat's state ({ trueWind.angle, u, yawRate }) → the hands ({ helm, jibSide, jibBack, mainBack, sheet, pivot }) or null (done)
  step(dt, s) {
    if (!this.side) return null;
    this.t += dt;
    const ws = this.side, twa = s?.trueWind?.angle ?? 0, a = Math.abs(twa) / DEG;
    const turn = -ws;   // the bow falls away from the wind's side: wind from starboard (ws +1) turns her to port
    const round = Math.sign(twa) === ws && a >= FREE.outDeg;
    if (this.phase !== 'release' && this.t >= FREE.easeS) {
      if (round) this.phase = 'release';
      else if (this.t >= FREE.timeoutS + FREE.bearS) this.phase = 'release';
      else this.phase = this.t >= FREE.timeoutS ? 'bear' : 'back';
    }
    if (this.phase === 'release') {
      this.done += dt;
      if (this.done >= FREE.doneEaseS) { this.cancel(); return null; }
      const k = 1 - clamp(this.done / FREE.doneEaseS, 0, 1);
      return (this.out = { helm: (this.out?.helm ?? 0) * k, jibSide: 0, jibBack: 0, mainBack: 0, sheet: null, pivot: 0 });
    }
    if (this.phase === 'ease') return (this.out = { helm: 0, jibSide: 0, jibBack: 0, mainBack: 0, sheet: FREE.sheet, pivot: 0 });
    // backing: the clew to windward of the new tack (the wind's side now), the boom held out the same side; the helm by the way she
    // moves: astern reversed, ahead as ahead (the fallback bears away ahead)
    const astern = (s?.u ?? 0) < 0;
    const helm = this.phase === 'bear' ? turn * FREE.helm : (astern ? -turn : turn) * FREE.helm;
    const P = FREE.pivot, ramp = clamp((this.t - FREE.easeS) / P.rampS, 0, 1);
    const yaw = (s?.yawRate ?? 0) * turn / DEG;   // °/s the right way
    const pivot = turn * clamp(P.gain * (P.yawDegS - yaw) * DEG, 0, P.maxNm) * ramp;
    return (this.out = { helm, jibSide: ws, jibBack: FREE.jibBackDeg * DEG, mainBack: this.phase === 'bear' ? 0 : ws * FREE.mainBackDeg * DEG, sheet: FREE.sheet, pivot });
  }
}

// The controller (one per page). B: the boat (phys.state, sea.held, phys.engine, ground); tack: tackButton.js's ({ press, active,
// kind, assist, offer }); grounding: src/sail/grounding.js's ({ kedge }); say(text, kind): the skipper's line; beginner(): auto-free on;
// depthAt(x, z): the bottom's depth (m, + down) for FREE's tie; now(): the page clock (s, for the once-per-3-min rule)
// pilotTurn(): AUTO's own tack or gybe toward a mark ('tack' | 'gybe' | null; ui/autopilot.js pilot.turning): the key shows it lit,
// as a manoeuvre the player started (owner 2026-11-17: "shows the tack on the boat"); a press still acts as the word says
export function createAssist({ B, tack = null, grounding = null, say = () => {}, beginner = () => false, depthAt = null, pilotTurn = () => null } = {}) {
  const free = new FreeAssist();
  let stuckS = 0, idleS = 0, t = 0, lastAuto = -Infinity, last = null, cueAt = -Infinity, cueN = 0, kedgeOn = false, out = null;
  const st = () => B?.phys?.state ?? B?.state ?? null;
  const facts = () => ({ held: !!B?.sea?.held, engine: !!B?.phys?.engine?.on, aground: B?.ground?.state?.mode === 'aground' });
  const running = () => (free.active ? 'free' : tack?.active ? (tack.assist?.kind ?? tack.kind ?? 'tack') : kedgeOn ? 'refloat' : null);
  let S = assistState(null);
  const deeper = (side) => {
    const s = st(); if (!s || !depthAt) return 0;
    const h = s.heading - side * 50 * DEG;   // the heading she falls off onto (the bow turns away from the wind's side)
    return depthAt(s.x + Math.sin(h) * FREE.lookM, s.z - Math.cos(h) * FREE.lookM);
  };
  function startFree(line) {
    const s = st(); if (!s) return false;
    free.start(s.trueWind?.angle ?? 0, { deeper });
    say(line, 'reply');
    return true;
  }
  const A = {
    free, get stuckS() { return stuckS; },
    get state() { return { ...S, stuckS, cue: A.cue }; },
    get word() { return S.word; }, get lit() { return S.lit; }, get dim() { return S.dim; },
    // the pilot's interface (ui/autopilot.js createPilot's tack): offer (a press would act), active (a manoeuvre runs), kind, press
    get offer() { return S.dim ? null : S.kind; }, get active() { return !!running(); }, get kind() { return running() ?? S.kind; },
    get assist() { return { kind: running() }; },
    // the soft brighten now (0 … 1, a raised cosine over CUE.brightenS) and how many times it has started
    get cue() { const k = (t - cueAt) / CUE.brightenS; return k >= 0 && k < 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * k) : 0; },
    get cues() { return cueN; },
    get hands() { return out; },
    // a press: cancel what runs, or run what the word names; false when nothing happened (dim)
    press() {
      idleS = 0;   // a press is the player's input: the beginner's auto-free waits again
      if (free.active) { free.cancel(); out = null; return false; }
      if (tack?.active) { tack.press(); return false; }   // tackButton's press cancels its running assist
      const k = S.kind;
      if (S.dim || !k) return false;
      if (k === 'free') return startFree(LINES.free);
      if (k === 'refloat') { grounding?.kedge?.(); kedgeOn = !!B?.ground?.state?.kedging; return true; }
      return !!tack?.press?.();
    },
    cancel() { idleS = 0; free.cancel(); out = null; if (tack?.active) tack.press(); },
    // each frame before the boat's step. handHeld: a hand on the helm (the wheel, the steer ring); input: a steering or trim key or
    // finger this frame (the beginner's auto-free waits for none)
    update(dt, { handHeld = false, input = false } = {}) {
      t += dt;
      const s = st(), f = facts();
      kedgeOn = !!B?.ground?.state?.kedging && f.aground;
      if (free.active && handHeld) free.cancel();
      stuckS = stuckNow(s, f) ? stuckS + dt : 0;
      idleS = input || handHeld ? 0 : idleS + dt;
      out = free.active ? free.step(dt, s) : null;
      if (out && !free.active) out = null;
      S = assistState(s, { ...f, stuckS, running: running() ?? pilotTurn() ?? null });
      // the cue: one soft brighten when FREE or REFLOAT appears (the word changed to it), never a loop
      if ((S.word === 'FREE' || S.word === 'REFLOAT') && !S.lit && last !== S.word) { cueAt = t; cueN++; }
      last = S.lit ? last : S.word;
      // a beginner stuck with no input: FREE on its own, once per AUTO_FREE.everyS
      if (S.kind === 'free' && !S.lit && beginner() && stuckS >= AUTO_FREE.afterS && idleS >= AUTO_FREE.afterS && t - lastAuto >= AUTO_FREE.everyS) {
        lastAuto = t; startFree(LINES.auto); out = free.step(0, s);
        S = assistState(s, { ...f, stuckS, running: 'free' });
      }
      return S;
    },
  };
  return A;
}
