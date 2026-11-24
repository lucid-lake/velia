// The staged first minutes (owner, 2026-11-05): a newcomer meets the lake's features without a pop-up. Only the
// existing subtitle line (the old skipper, src/ui/skipper.js) and the VHF speak; nothing blocks input; every beat is
// skippable by just playing; first session only (src/ui/firstVisit.js decides, src/shell.js runs it).
//
//   createStage({ effects, T })   the beats: pure, driven by update(dt, ctx), tested in tests/firstStage.test.mjs
//   introCam({ durS })            the opening camera move: low past the bow, then into the follow camera (pure maths)
//   createDirector(), MOMENTS     the camera moments over the follow view (the shallows, the osprey, the eagle, the storm)
//   attachStage({ services, settings, calm, getOptions, menu })   the live layer: reads the page, fires the effects
//
// The clock is real seconds of play: it starts when the loading screen dissolves and runs while Sail is up and the
// menu is closed (the sim runs at 2×, so 1 s of play is 2 s of the scene clock). Round 2 (owner, 2026-11-05: "storm,
// clear water, birds + fish are our highlights; they need to go earlier"): the first minute is the showreel.
//   0:00      the dissolve over the granite shelf (5–8 m); the camera skims low past the bow into the follow view (7.5 s)
//   0:00–1:00 the sky held Clear (R0), then the deck eases back to the pick (Fair: ≈ 10 s)
//   0:00–0:12 the Calm HUD holds the controls in view (then its own fade, CALM.idleS)
//   0:08      R.: "Look down — you can see the bottom" (still over the shelf; deep water by ≈ 0:30)
//   0:15      the first steering line, short (src/ui/firstSail.js STAGED_LINE: "Drag the wheel to steer.")
//   0:17      the osprey: cued 125 m ahead of the camera, on screen; hovers, plunges for a trout ≈ 0:22, climbs away
//   0:26      the eagle: cued 300 m ahead on the port side, high; glides past ≈ 50–70 m off at ≈ 0:36 (the 40 m rule holds)
//   0:28      the first gust is laid on the course ahead (fading in over 8 s), so it lands at ≈ 0:50 whatever the
//             heading; R.: "Dark water ahead — here comes a gust" as its dark water nears
//   0:58      the VHF: the harbour master's storm advisory; 1:00 the storm arc starts (36 s into its build): the front ≈ 1:27, rain and
//             lightning by ≈ 1:45, then the clearing at its own pace (camera moments: see MOMENTS below)
//   0:00–3:00 every other hint and status line is hushed (R.'s notes and the safety lines still speak)
//   after the storm clears (≈ 2:45): R.: "Want the sheets yourself? Settings → crew trims"; then normal play
// Lines keep STAGE.lineGapS between them; a line whose moment passed is dropped, never said late.
import { NOTES } from '../../../src/ui/skipper.js';
import { FIRST_BEATS } from '../../../src/metrics.js';

export const STAGE = {
  hudS: 12,                   // the HUD held up through the camera move and the first lines; Calm's own fade follows
  introLineS: 15,             // the first steering line (firstSail.js), after the bottom line
  bottom: [7, 30],            // the bottom line's window (s of play)
  bottomDepth: [3, 8.5],      // m of water under the boat for it (Tahoe's water shows the granite at 8 m)
  ospreyS: 17,                // the osprey's cue
  eagleS: 26,                 // the eagle's cue
  gustPlaceS: 28,             // the first gust laid ahead of the boat ...
  gustHitS: 50,               // ... to land about then
  gust: [34, 75],             // the gust line's window
  vhfS: 58,                   // the storm advisory
  stormS: 60,                 // the storm arc starts ...
  stormS0: 36,                // ... 36 s into its build (on the 2× scene clock: the towers tall by the 1:06 moment, the front ≈ 1:27, full rain ≈ 1:45)
  clearS: 60,                 // the sky held Clear this long (R0: the blue on screen first; the clouds gather after)
  hushS: 180,                 // the other hints wait this long
  sheetsAfter: ['clear', 'after', 'none'],   // the sheets line once the storm is clearing (or gone)
  sheetsMinS: 150, endS: 330, // the sheets line not before this; the stage ends by endS at the latest
  lineGapS: 7,                // between two of the stage's lines
};
// The camera moments (round 3, owner 2026-11-05: short automatic moments, as big games frame a highlight): when each
// starts (s of play) and its ease in, hold and ease out (s). Any input ends one at once (a 0.35 s ease back); the helm
// stays live. Reduced motion: the eases ×1.6, the zoom 1.5× wider.
export const MOMENTS = {
  shallows: { at: 7, inS: 1.5, holdS: 5, outS: 1.6 },     // look down into the clear water, through "Look down"
  osprey: { at: 19, inS: 1.2, holdS: 7.2, outS: 1.4 },    // the hover, the plunge, the climb with the fish
  storm: { at: 66, inS: 2, holdS: 5, outS: 2 },           // the towers building over the west ridge
};
// R.'s lines (src/ui/skipper.js NOTES: text on the glass row, speak for the voice's clip)
export const LINES = { gust: NOTES.gustAhead, bottom: NOTES.bottom, sheets: NOTES.sheets };
export const BEATS = FIRST_BEATS;   // the metrics' first_beat values (src/metrics.js)

export function createStage({ effects, T = STAGE } = {}) {
  const S = { t: 0, said: {}, lastLine: -Infinity, moments: {}, hud: false, clear: false, osprey: false, eagle: false, gustLaid: false, gustHit: false, vhf: false, storm: false, hushed: false, done: false, cancelled: false };
  const sayOnce = (id, ctx) => {
    if (S.said[id] || !ctx.quiet || S.t - S.lastLine < T.lineGapS) return false;
    if (!effects.say(id)) return false;
    S.said[id] = S.t; S.lastLine = S.t; return true;
  };
  const end = (why) => { S.done = true; if (S.hushed) { S.hushed = false; effects.hush?.(false); } if (S.clear) { S.clear = false; effects.sky?.(false); } effects.end?.(why); };
  function cancel() { if (!S.done) { S.cancelled = true; end('cancelled'); } }
  // ctx: { mode, playing (Sail up, menu closed), quiet (no page or logbook over the play), depth (m), gustAhead (bool),
  //        gustHere (the first gust's factor at the boat), stormPhase (src/weather/stormArc.js phase, or 'none'), crewOff }
  function update(dt, ctx) {
    if (S.done) return S;
    if (ctx.stage === false) { cancel(); return S; }   // a mode with no stage (its coreOptions): the stage is over, normal play
    // the clear sky from the stage's first frame, so the dissolve already opens on it (the clock starts with play)
    if (!S.clear && S.t === 0 && ctx.stage) { S.clear = true; effects.sky?.(true); }
    if (!ctx.playing) return S;
    S.t += dt;
    const t = S.t;
    const hush = t < T.hushS; if (hush !== S.hushed) { S.hushed = hush; effects.hush?.(hush); }
    const clear = t < T.clearS; if (clear !== S.clear) { S.clear = clear; effects.sky?.(clear); }
    if (t < T.hudS) effects.hud?.(); else if (!S.hud) { S.hud = true; effects.hud?.(); }   // the controls in view, then Calm fades them as designed
    for (const [k, m] of Object.entries(MOMENTS)) if (S.moments[k] == null && t >= m.at) { S.moments[k] = t; effects.moment?.(k, m); }
    if (t >= T.bottom[0] && t <= T.bottom[1] && ctx.depth >= T.bottomDepth[0] && ctx.depth <= T.bottomDepth[1] && sayOnce('bottom', ctx)) effects.track?.('bottom');
    if (!S.osprey && t >= T.ospreyS) { S.osprey = true; if (effects.osprey?.() !== false) effects.track?.('osprey'); }
    if (!S.eagle && t >= T.eagleS) { S.eagle = true; if (effects.eagle?.() !== false) effects.track?.('eagle'); }
    // the gust: laid ahead so it lands on time; the line as its dark water nears; the hit when the boat is in it
    if (!S.gustLaid && t >= T.gustPlaceS) { S.gustLaid = true; effects.gust?.(T.gustHitS - t); }
    if (t >= T.gust[0] && t <= T.gust[1] && ctx.gustAhead && !(ctx.gustHere > 1.08)) sayOnce('gust', ctx);
    if (!S.gustHit && S.gustLaid && ctx.gustHere > 1.2) { S.gustHit = true; effects.track?.('gust'); }
    // the storm: the advisory on the VHF, then the arc, whatever the boat is doing
    if (!S.vhf && t >= T.vhfS) { S.vhf = true; effects.vhf?.(); }
    if (!S.storm && t >= T.stormS) { S.storm = true; effects.storm?.(); effects.track?.('storm'); }
    // the level choice, once the storm has cleared; then normal play
    if (S.storm && t >= T.sheetsMinS && S.said.sheets == null && T.sheetsAfter.includes(ctx.stormPhase ?? 'none')) {
      if (ctx.crewOff) S.said.sheets = -1; else sayOnce('sheets', ctx);
    }
    if ((S.said.sheets != null && !S.hushed) || t >= T.endS) end('done');
    return S;
  }
  return { update, cancel, get state() { return { ...S, said: { ...S.said } }; } };
}

// ---- the opening camera ----
const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (6 * t - 15) + 10); };   // smootherstep
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const INTRO = { holdS: 1.0, durS: 6.5, start: { angleDeg: -40, radiusM: 30, heightM: 2.6 }, aimUpM: 2.2, aimAheadM: 3, fov: 46 };
// ?intro=old: the opening before R0 (off the starboard bow, 22°)
export const INTRO_OLD = { ...INTRO, start: { ...INTRO.start, angleDeg: 22 } };
// The move, in the boat's own frame: it opens low, ahead and off the bow, looking back at the bow under full sail, holds
// through the dissolve, then swings round that side, rising, into the follow camera's own pose, which it reaches exactly
// (the hand-over is seamless). A drag of the view (look) cuts it short over 0.8 s.
// R0 (the wallpaper first frame): it opens off the PORT bow (−40°). At the staged start (north of Fannette
// Island, heading 80°) the lens then looks back west-south-west, over the bow, to the island, the bay's head and Mount
// Tallac: Emerald Bay's own anchors, a 2.6 m eye, the horizon near mid-frame. Off the starboard bow it framed the forest wall.
//   const cam = introCam(); each frame: cam(dt, followPose, state, { look }) → { pos, target, fov } | null (done)
export function introCam({ I = INTRO, started = () => true } = {}) {
  let t = 0, cut = null;
  return (dt, follow, s, { look = false } = {}) => {
    if (started()) t += dt;
    if (look && cut == null) cut = Math.max(t, I.holdS + I.durS - 0.8);
    if (cut != null) t = Math.max(t, cut);
    const k = smooth((t - I.holdS) / I.durS);
    if (k >= 1) return null;
    const bx = s.x, bz = s.z, h = s.heading;
    // the follow pose's place round the boat: its bearing off the bow, its horizontal distance, its height
    const dx = follow.pos[0] - bx, dz = follow.pos[2] - bz;
    const fAng = wrap(Math.atan2(dx, -dz) - h), fR = Math.hypot(dx, dz), fY = follow.pos[1];
    const a0 = I.start.angleDeg * Math.PI / 180;
    // swing round the side it opened on (+ starboard, − port) to the follow camera's bearing (astern), the long way never
    let a1 = fAng;
    if (a0 >= 0) { if (a1 < a0) a1 += 2 * Math.PI; } else if (a1 > a0) a1 -= 2 * Math.PI;
    const ang = h + a0 + (a1 - a0) * k, r = I.start.radiusM + (fR - I.start.radiusM) * k, y = I.start.heightM + (fY - I.start.heightM) * k;
    const pos = [bx + Math.sin(ang) * r, y, bz - Math.cos(ang) * r];
    const bow = [bx + Math.sin(h) * I.aimAheadM, I.aimUpM + (s.heave ?? 0), bz - Math.cos(h) * I.aimAheadM];
    const target = [bow[0] + (follow.target[0] - bow[0]) * k, bow[1] + (follow.target[1] - bow[1]) * k, bow[2] + (follow.target[2] - bow[2]) * k];
    return { pos, target, fov: I.fov + ((follow.fov ?? 40) - I.fov) * k };
  };
}

// ---- the camera moments (pure maths: tests/firstStage.test.mjs) ----
// A pose is { pos, target, fov }. Poses mix by their view direction (yaw, pitch), never by the target point, so a turn
// of the head toward the stern swings round smoothly instead of flipping through the camera. `turn` (+1 / −1) pins
// the way round for a turn near 180°.
const lerp = (a, b, k) => a + (b - a) * k;
export const aimOf = (p) => { const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]]; return { yaw: Math.atan2(d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) }; };
export function mixPose(a, b, w, turn = 0) {
  if (w <= 0) return a;
  const A = aimOf(a), B = aimOf(b);
  let dy = wrap(B.yaw - A.yaw);
  if (turn && Math.sign(dy) !== turn && Math.abs(dy) > 2.2) dy += turn * 2 * Math.PI;
  const yaw = A.yaw + dy * w, pitch = lerp(A.pitch, B.pitch, w);
  const pos = [lerp(a.pos[0], b.pos[0], w), lerp(a.pos[1], b.pos[1], w), lerp(a.pos[2], b.pos[2], w)];
  const c = Math.cos(pitch);
  return { pos, target: [pos[0] + Math.sin(yaw) * c * 60, pos[1] + Math.sin(pitch) * 60, pos[2] - Math.cos(yaw) * c * 60], fov: lerp(a.fov ?? 40, b.fov ?? 40, w) };
}
// the weight of a moment at t s into it (ease in, hold, ease out); a cut at cutAt eases out from where it was over cutS
export function momentWeight(t, m, { cutAt = null, cutS = 0.35 } = {}) {
  const w0 = (x) => (x < m.inS ? smooth(x / m.inS) : x < m.inS + m.holdS ? 1 : 1 - smooth((x - m.inS - m.holdS) / m.outS));
  if (cutAt == null) return t >= m.inS + m.holdS + m.outS ? 0 : w0(t);
  return w0(cutAt) * (1 - smooth((t - cutAt) / cutS));
}
// the vertical field of view that draws a bird of span `spanM` at `distM` about `px` tall on a 720 px-high frame
export const fovFor = (spanM, distM, px = 100, minDeg = 7, maxDeg = 40, frameH = 720) => Math.min(maxDeg, Math.max(minDeg, 2 * Math.atan(spanM * frameH / (2 * px * distM)) * 180 / Math.PI));
// the shallows: higher and closer, behind and a little to starboard, looking down into the water ahead of the bow
// (the low sun is astern to port: the boat's shadow falls ahead to starboard), as the clarity film frames it
export function shallowsPose(s) {
  const fx = Math.sin(s.heading), fz = -Math.cos(s.heading), rx = -fz, rz = fx;
  return { pos: [s.x - fx * 13 + rx * 5, 17, s.z - fz * 13 + rz * 5], target: [s.x + fx * 11 + rx * 4, -2, s.z + fz * 11 + rz * 4], fov: 50 };
}
// the storm: from a little above and to starboard of the follow camera, the head turned to the west ridge (bearing 255°)
// and up 6°, where the cell's towers build (src/weather/stormArc.js: it comes from the WSW)
export function stormPose(follow, s, { bearingDeg = 255, upDeg = 9 } = {}) {
  const rx = Math.cos(s.heading), rz = Math.sin(s.heading), b = bearingDeg * Math.PI / 180, u = upDeg * Math.PI / 180;
  const pos = [follow.pos[0] + rx * 10, follow.pos[1] + 6, follow.pos[2] + rz * 10];
  return { pos, target: [pos[0] + Math.sin(b) * 1000, pos[1] + Math.tan(u) * 1000, pos[2] - Math.cos(b) * 1000], fov: 52 };
}
// a bird: the camera stays where it is and turns to it, zoomed so it reads ≈ px tall
export function birdPose(follow, bird, { spanM = 1.6, px = 100, minDeg = 7 } = {}) {
  const d = Math.hypot(bird[0] - follow.pos[0], bird[1] - follow.pos[1], bird[2] - follow.pos[2]);
  return { pos: follow.pos, target: bird, fov: fovFor(spanM, d, px, minDeg), distM: d };
}

// The director: the opening move, then one moment at a time over the follow camera. update() returns the pose to draw
// (the follow pose itself between moments), or null once the stage is over and nothing plays (the hook lets go).
export function createDirector({ intro = introCam(), reduced = false, done = () => false } = {}) {
  let first = intro, m = null, introCut = false;
  const slow = reduced ? 1.6 : 1;
  return {
    play(kind, spec, poseFn, { turn = 0 } = {}) { m = { kind, t: 0, spec: { ...spec, inS: spec.inS * slow, outS: spec.outS * slow }, poseFn, turn, cutAt: null }; },
    cancel() { introCut = true; if (m && m.cutAt == null) m.cutAt = m.t; },
    get playing() { return m?.kind ?? (first ? 'intro' : null); },
    update(dt, follow, s, { look = false } = {}) {
      if (first) { const p = first(dt, follow, s, { look: look || introCut }); if (p) return p; first = null; }
      if (look && m && m.cutAt == null) m.cutAt = m.t;
      if (m) {
        m.t += dt;
        const over = m.cutAt != null ? m.t - m.cutAt > 0.35 : m.t >= m.spec.inS + m.spec.holdS + m.spec.outS;
        if (over) { m = null; return follow; }
        let b = m.poseFn(follow, s);
        if (!b) { if (!m.last) { m = null; return follow; } b = m.last; if (m.cutAt == null) m.cutAt = m.t; }   // the subject gone: ease back from the last pose
        m.last = b;
        return mixPose(follow, b, momentWeight(m.t, m.spec, { cutAt: m.cutAt }), m.turn);
      }
      return done() ? null : follow;
    },
  };
}

// ---- the cues (pure: tested) ----
// The eagle: 300 m ahead on the boat's port side, 45 m abeam, high against the sky (22 m), down the line past the boat.
// It passes 50–70 m from the follow camera (src/birds/ turns any bird away inside 75 m and never lets one inside 40 m).
const EAGLE = { aheadM: 300, offsetM: 45, side: -1, fromY: 40, height: 22 };
export function eagleCue(boat, E = EAGLE) {
  const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), sx = -fz, sz = fx;   // forward, starboard
  const px = boat.x + sx * E.offsetM * E.side, pz = boat.z + sz * E.offsetM * E.side;
  return { bird: 'eagle', side: E.side, offset: E.offsetM, height: E.height, from: [px + fx * E.aheadM, E.fromY, pz + fz * E.aheadM], yaw: Math.atan2(-fx, -fz) };
}
// The osprey. With the sun given (the live page; round 4, owner 2026-11-05: the strike read dark), its fish is SUN_M
// from the camera toward the sun, so the hover stands against the bright sky and the plunge lands in the sun's glitter:
// the splash and the spray backlit on bright water. The camera moment turns that way (`turn`: the way round). Without
// a sun: 100 m ahead of the camera along its view, a little right of centre. Either way it comes in from 40 m to one
// side, at 20 m. src/birds/ plunges only 50–120 m off the boat and more than 50 m from the camera. Returns null when
// the water there is too shallow (depthAt < 3 m) on both sides.
export const OSPREY = { aheadM: 100, rightM: 10, backM: 40, y: 20, sunM: 62 };
export function ospreyCue(cam, depthAt, O = OSPREY, sun = null) {
  const sn = sun ? Math.hypot(sun.x, sun.z) : 0;
  if (sn > 1e-3) {
    const ux = sun.x / sn, uz = sun.z / sn, rx = -uz, rz = ux;
    const camYaw = Math.atan2(cam.fx, -cam.fz), sunYaw = Math.atan2(ux, -uz), d = wrap(sunYaw - camYaw);
    for (const side of [1, -1]) {
      const x = cam.x + ux * O.sunM + rx * 6 * side, z = cam.z + uz * O.sunM + rz * 6 * side;
      if (depthAt(x, z) >= 3) return { x, z, y: O.y, after: 0.3, back: O.backM, yaw: Math.atan2(rx * side, rz * side), turn: Math.sign(d) || 1 };
    }
  }
  const fx = cam.fx, fz = cam.fz, n = Math.hypot(fx, fz) || 1, ux = fx / n, uz = fz / n, rx = -uz, rz = ux;   // forward, right
  for (const side of [1, -1]) {
    const x = cam.x + ux * O.aheadM + rx * O.rightM * side, z = cam.z + uz * O.aheadM + rz * O.rightM * side;
    if (depthAt(x, z) >= 3) return { x, z, y: O.y, after: 0.3, back: O.backM, yaw: Math.atan2(rx * side, rz * side) };
  }
  return null;
}
// The first gust, laid on the course: its centre where the boat will be in `secs` of play (the sim runs at 2×) plus
// half its depth along the course, fading in over riseS of the scene clock, held 3 min, then the usual fade.
export function gustAt(boat, secs, { t, dirDeg, speedMs, gain = 0.35, alongM = 95, acrossM = 150, edgeM = 10, riseS = 16, simRate = 2, pad = 60 }) {
  const d = Math.max(60, boat.sog * simRate * secs + pad), fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
  return { x: boat.x + fx * d, z: boat.z + fz * d, alongM, acrossM, edgeM, gain, driftFrac: 0, dirDeg, speedMs, riseAt: t, riseS, holdS: t + 180, fadeS: 60 };
}
// is the first gust's dark water ahead on the course (30–110 m) and not yet at the boat?
export function gustAheadOf(boat, factorAt, { from = 30, to = 110, step = 10, over = 1.12 } = {}) {
  const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
  for (let d = from; d <= to; d += step) if (factorAt(boat.x + fx * d, boat.z + fz * d) > over) return true;
  return false;
}

// ---- the live layer ----
export function attachStage({ services, settings, calm = null, getOptions = () => services.get('modeOptions') ?? {}, menu, track = () => {} }) {
  const core = services.get('core'), flags = core.flags ?? {};
  let entered = false, introSet = null, lastNow = null, ospreyTurn = 0;
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const birdAt = (who) => { const b = core.birds?.find?.(who); return b && (b.fade ?? 1) > 0.2 ? [b.pos[0], b.pos[1], b.pos[2]] : null; };
  const director = createDirector({ intro: introCam({ I: flags.intro === 'old' ? INTRO_OLD : INTRO, started: () => entered }), reduced, done: () => stage.state.done });
  const log = [];   // [beat, seconds of play]: the stage's own record (the 'firstStage' service's log; the films read it on window.__lakeshore)
  const note = (k) => log.push([k, +stage.state.t.toFixed(1)]);
  const depthAt = (x, z) => -(core.terrain?.heightAt?.(x, z) ?? 0);
  const effects = {
    hud: () => { calm?.wake?.('all'); if (!log.some((r) => r[0] === 'hud')) note('hud'); },
    hush: (on) => { services.get('controls')?.hint?.hush?.(on); note(on ? 'hush' : 'unhush'); },
    // the opening minute's clear sky (R0): the deck held at Clear, then eased back to the player's pick (Fair by default)
    sky: (on) => { if (flags.firstsky === '0') return; core.sky?.holdClear?.(on); note(on ? 'sky:clear' : 'sky:back'); },
    moment: (kind, spec) => {
      const zoom = reduced ? 1.5 : 1;
      const pose = kind === 'shallows' ? (f, s) => shallowsPose(s)
        : kind === 'storm' ? (f, s) => stormPose(f, s)
        : kind === 'osprey' ? (f) => { const p = birdAt('hunter'); return p && birdPose(f, p, { spanM: 1.6, px: 240 / zoom, minDeg: 3.5 * zoom }); }
        : null;
      if (!pose) return;
      director.play(kind, spec, pose, { turn: kind === 'storm' ? 1 : kind === 'osprey' ? ospreyTurn : 0 }); note(`cam:${kind}`);
    },
    osprey: () => {
      const B = core.birds, c = core.camera;
      if (!B?.cue || !c) { note('osprey:none'); return false; }
      const e = c.matrixWorld.elements, cam = { x: c.position.x, z: c.position.z, fx: -e[8], fz: -e[10] }, sun = core.sun?.direction;
      const cue = ospreyCue(cam, depthAt, OSPREY, sun && sun.y > 0 ? { x: sun.x, z: sun.z } : null);
      if (!cue) { note('osprey:shallow'); return false; }
      ospreyTurn = cue.turn ?? 0;
      B.cue('plunge', cue); note('osprey'); return true;
    },
    eagle: () => {
      const s = services.get('player')?.phys?.state, B = core.birds;
      if (!s || !B?.cue) { note('eagle:none'); return false; }
      B.cue('lowpass', eagleCue(s)); const e = B.find?.('eagle'); if (e) { e.speed = 11; e.state = {}; }
      note('eagle'); return true;
    },
    gust: (secs) => {
      const s = services.get('player')?.phys?.state, w = core.wind; if (!s || !w) return;
      w.first = gustAt(s, secs, { t: core.time, dirDeg: w.base?.dirDeg ?? 200, speedMs: w.base?.speedMs ?? 5 });
      note('gust:laid');
    },
    say: (id) => {
      const h = services.get('controls')?.hint, n = LINES[id]; if (!h?.note || !n) return false;
      const ok = h.note(n.text, '', n.speak);
      if (ok) note(`line:${id}`);
      return ok;
    },
    vhf: () => { const ok = services.get('captainTools')?.hmAsk?.('hm_storm'); note(ok ? 'vhf' : 'vhf:off'); },
    storm: () => { if (!core.storm?.running) core.storm?.start?.({ s0: STAGE.stormS0 }); note('storm'); },
    track: (beat) => track('first_beat', { beat }),
    end: (why) => note(`end:${why}`),
  };
  const stage = createStage({ effects });
  const playing = () => entered && !!getOptions().stage && !!services.get('controls') && !!services.get('player')?.phys?.state && menu.state === 'gone' && document.visibilityState !== 'hidden';
  addEventListener('lakeshore:entered', () => { entered = true; note('entered'); });
  // any input hands the camera back at once (a moment eases out over 0.35 s; the opening move is cut short)
  const hand = () => { if (entered && director.playing) { director.cancel(); note('cam:cancel'); } };
  for (const k of ['keydown', 'pointerdown', 'wheel', 'touchstart']) addEventListener(k, hand, { capture: true, passive: true });
  function update() {
    const now = performance.now(), dt = lastNow == null ? 0 : Math.min(0.25, (now - lastNow) / 1000); lastNow = now;
    const c = services.get('controls'), s = services.get('player')?.phys?.state;
    // the opening camera: on the controls as soon as they exist (under the loading screen), moving once entered
    if (c && introSet !== c && !stage.state.done && stage.state.t < 1) { introSet = c; c.setIntro?.((dt, f, s, o) => director.update(dt, f, s, o)); c.hint?.hush?.(true); }   // hushed from the first frame (a reef at the start would flash)
    if (stage.state.done) return;
    const w = core.wind, t = core.time;
    const factorAt = (x, z) => (w?.firstGustAt ? w.firstGustAt(x, z, t) : 1);
    stage.update(dt, {
      stage: !!getOptions().stage, playing: playing(), quiet: !services.get('logbook')?.logbook?.isOpen,
      depth: s ? depthAt(s.x, s.z) : 99, gustAhead: s ? gustAheadOf(s, factorAt) : false, gustHere: s ? factorAt(s.x, s.z) : 1,
      stormPhase: core.storm?.running ? core.storm.info?.phase ?? 'none' : 'none',
      crewOff: settings.get('crewTrim') === false,
    });
  }
  return { update, stage, log, director, get entered() { return entered; }, get t() { return stage.state.t; } };
}
