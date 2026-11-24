// The kayaks on the lake in v2: v1's fleet (src/kayaks/fleet.js) without three.js. Every decision is v1's own pure code:
// who is out (src/sim/kayaks/plan.js planFleet, kayakCount on the day's wind), where they paddle (routes.js), how they
// steer and move (agent.js: one hull model), what they think of the sailboat (mind.js: they see her, predict her closest
// approach, give way), the bumps and the wash (contact.js), the levels of detail (lod.js), and the first pair placed in
// the camera's view when play starts (first.js placePair, the skipper's line once). Only the drawing is v2's
// (v2/render/kayaks.js reads `draws` each frame). v2's own on top: the capsize (v2/sim/kayak-roll.js: each kayak's roll as
// a rigid body; the sailboat's first touch shoves it across at the bow flare's height; the swim or the Eskimo roll back up;
// fleet.sfx this step's splashes for the page's sound).
//   const fleet = createKayakFleet({ terrain, seed, boat, heightAt, hour, wind, phone, clips })
//     terrain   v1's terrain object (v2/sim/lake.js lakeTerrain: heightAt, shoreDistance, lake, places)
//     start     { x, z, heading }: Sail's start (the meetings are timed from it; default the boat now)
//     boat      () → the sloop's physics state ({ x, z, heading, u, v, yawRate, sog }: v1's BoatPhysics) or null
//     heightAt  (x, z) → the water's height (the readback surface: the float)
//     hour      () → the scene's hour;  wind: () → the day's wind m/s (v1's dayWind: the habits, not the sailed level)
//     clips     the paddler's baked clips (v2/sim/kayak-clip.js) once they are in: the full tier's strokes (kayak-stroke.js:
//               the blade held in the water at the kayak's real speed, the stroke's force, turn, roll and dip on the hull)
//   fleet.lay(view)       the first pair, placed in the view { x, z, yaw, hHalf } (play has started: v1's playNow)
//   fleet.again(view)     a later pair, placed the same way (the stage director's random kayaks: v2/stage/act-kayaks.js);
//                         the last pair paddles on and leaves out of the camera's reach, as the day's kayakers do
//   fleet.step(dt, cam)   the fleet's step (cam: { x, z, fwdX, fwdZ, hHalf }); then fleet.draws: { full, mid, far }
//                         (a full record's body: the pose's look for clip.pose); fleet.splash: the blades' catches and
//                         exits this step (world: { type, key, at, water, s }), fleet.tips: key → the blade's tip (world)
//   fleet.stats()         v1's stats rows (out, tiers, first, kayaks …)
//   residents             the regions' own kayakers (v2/living/busyLake.js residentKayaks, owner 2026-11-19): out from the fleet's
//                         first step wherever the camera is (they live there all day), always stepped, never moved with the player;
//                         they go home at night or in a storm and come out again only out of the camera's reach, as v1's do
//   dayOff                no v1 day kayakers and no staged pairs (the residents replace them: desktop and tablet)
//   launcher              round B (v2/living/kayakLaunch.js createLauncher): a pair launched from shore when none has been near the
//                         player for 3 min; launchOk() false while the busy lake stands down; player() the player's pose (the
//                         sailboat, or Tessie while she is played); a launched pair leaves only home again, out of the view and far
//   tessie                () → her parts at the surface ({ pts: [[x, z], …] } or null): the kayakers within TESSIE_REACT.watchM stop and
//                         turn to watch her, within backM they back-paddle away (round B; v2/living/kayaks.js reads her sim)
//   fleet.bite(id, { x, z })  play as Tessie: her bite on a kayak (round B, owner 2026-11-21: "tessie can attack kayak"): it rolls
//                         over away from her, the paddler swims beside it, waits TESSIE_REACT.holdS out of her reach, rights it,
//                         climbs back in and paddles away from her (v2/sim/kayak-roll.js's swim, held)
import { planFleet, kayakCount, KAYAK_DAY } from '../../src/sim/kayaks/plan.js';
import { createAgent, stepHull, steerTo, HULL } from '../../src/sim/kayaks/agent.js';
import { createStroke, strokeStep, meanForce, lookAt, STROKE } from './kayak-stroke.js';
import { createMind, think } from '../../src/sim/kayaks/mind.js';
import { placePair, pairLooks, createSpotLine, FIRST } from '../../src/sim/kayaks/first.js';
import { kayakContact, drift, wakeRock } from '../../src/sim/kayaks/contact.js';
import { pickTier, capFull, lodFor } from '../../src/sim/kayaks/lod.js';
import { pickLook, PFD_COLOURS } from '../../src/sim/props/paddler/look.js';
import { KAYAK, KAYAK_COLOURS } from '../../src/props/kayak/dims.js';
import { poseRows } from './kayak-clip.js';
import { blendRows } from './kayak-rigid.js';
import { createRoll, rollImpulse, stepRoll, ROLL } from './kayak-roll.js';
import { hash01 } from '../../src/sim/kayaks/plan.js';

const SPAWN_CLEAR_M = 250, RETIRE_M = 400;   // v1's: a kayak appears or leaves only this far from the camera
const PAIR_FULL_M = 150;                     // v1's: the pair stays full inside this whatever the tier's cap
export const KAYAK_NEAR_M = 60, KAYAK_SHELL_M = 90;   // v1's hero distances: the deck hardware to 60 m, the fine shell to 90 m
export const LINES = Object.freeze({ close: 'Too close', bump: 'Bumped a kayak. Easy now', capsize: 'Oops — give the kayaks room.' });
// the capsize (feat/v2-kayak-capsize, v2/sim/kayak-roll.js): each paddler's chance of rolling back up (an Eskimo roll) by
// personality; the seconds a kayaker keeps well clear of the sailboat after a bump or a swim (its wanted gap and its act
// distances raised); the neck's place in the kayak's frame (the seated figure's pivot in the water, the baked rest pose)
export const CAPSIZE = Object.freeze({ skill: { experienced: 0.75, casual: 0.35, distracted: 0.15 }, waryS: 45, bumpWaryS: 20, neck: [0, 0.79, 0.33], lineAfterHitS: 3 });
const REST = Object.freeze({ throttle: 0, turn: 0 });
// round B: the kayakers and Tessie. watchM: she is at the surface this near: the paddle stops, the head and the bow turn to her;
// backM: back strokes away from her (bow to her); keepS: the watch holds this long after she has gone; turnDeg/stopDeg: the bow is
// swept round past turnDeg off her, until stopDeg; the bite: spinW the roll rate it gives (rad/s, past the occupied hull's 55° barrier),
// holdS the seconds the swimmer waits beside the hull (seeded in the range) while she is more than reachM off, awayS paddling away after
export const TESSIE_REACT = Object.freeze({ watchM: 40, backM: 15, keepS: 5, turnDeg: 60, stopDeg: 25, lookMax: 100, spinW: 7, holdS: Object.freeze([20, 40]), reachM: 15, awayS: 30, spookBackS: 3, spookAwayS: 20 });
const RDEG = Math.PI / 180;
const L = KAYAK.length * 0.38, B = KAYAK.beam * 0.40;   // v1's float: five heights at ±0.38 L, ±0.40 B

// sRGB hex → linear rgb
export function linear(hex) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  return c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
}

export function createKayakFleet({ terrain, seed = 1, start: start0 = null, boat = () => null, heightAt = () => 0, hour = () => 13, wind = () => 0, storm = () => false, phone = false, mode = 'on', clips = null, say = null, draft = 0.12, residents = [], dayOff = false, residentHours = [8, 20], launcher = null, launchOk = () => true, player = null, tessie = () => null, popM = 900 }) {
  const LODQ = lodFor(phone ? { phone: true } : null);
  const b0 = boat(), start = start0 ?? (b0 && Number.isFinite(b0.x) ? { x: b0.x, z: b0.z, heading: b0.heading } : null);   // v1: the boat at the fleet's attach (Sail's start)
  const slots = mode === 'off' || dayOff ? [] : planFleet({ seed, terrain, start });
  const residentsOut = () => { const h = hour(); return mode === 'off' || storm() || !(h >= residentHours[0] && h < residentHours[1]) ? [] : residents; };
  const live = new Map();   // id → { a, m, slot, tier, look, d, ph (the drawn stroke's phase), st (the full tier's stroke), shell }
  const cam = { x: 0, z: 0, fwdX: 0, fwdZ: -1, hHalf: 0.6 };
  let windMs = null, time = 0, lastCheck = -1e9;
  const first = { slots: [], looks: pairLooks(seed), laid: false, at: null, line: null, lineT: 0, rec: new Map(), near: true, place: null };
  const contacts = [], closeCalls = [], lines = [], capsizes = [];
  let closeSaid = false, lastBumpT = -1e9, capsizeSaid = false, bumpPending = null;
  const sfx = [];   // this step's sounds for the host: { type: 'capsize' | 'righted', x, z }
  const distTo = (x, z) => Math.hypot(x - cam.x, z - cam.z);
  const lookOf = (slot) => pickLook(slot.seed, { sex: slot.sex, pfd: slot.pfd });
  function wanted() {
    if (mode === 'off') return [];
    const day = slots.slice(0, kayakCount({ hour: hour(), windMs: windMs ?? 0, storm: storm(), seed }));
    return [...residentsOut(), ...(first.near ? [...first.slots, ...day] : day).slice(0, LODQ.maxOut)];
  }
  function spawn(slot, place = null) {
    const a = createAgent({ slot, ...(place ?? {}) });
    live.set(slot.id, { a, m: createMind(slot), slot, tier: null, look: lookOf(slot), d: distTo(a.x, a.z), ph: a.phase,
      R: createRoll({ seed: slot.seed, skill: CAPSIZE.skill[slot.personality] ?? 0.3 }), wary: 0, baseP: null, hitT: -1e9, touchT: -1e9, swY: null, surfaced: false,
      tz: null, bitten: false, kindWas: null,
      fig: new Float32Array(12), hull: new Float32Array(12), figPose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 }, swim: { yaw: 0, roll: 0, arms: 0, wave: 0, wavePh: 0, scullPh: 0 }, pad: { k: 0, x: 0, y: 0, z: 0, yaw: 0 } });
  }
  const retire = (id) => live.delete(id);
  for (const s of residentsOut()) spawn(s);   // the residents are out already when the fleet is made: they live there (never placed for the camera)
  // the skipper's lines (v1's: "Too close" once, a quiet line at a bump at most every 6 s), through the host's subtitle
  function line(text, kind) { const ok = say ? say(text, kind) : false; if (ok !== false || kind !== 'spot') lines.push({ t: +time.toFixed(2), kind, text, shown: ok !== false }); return ok; }

  // the first pair (first.js): placed in the camera's view, then ordinary kayakers on their own routes
  function lay(view) {
    if (first.laid) return first.place;
    first.laid = true;
    const ps = boat();
    if (mode === 'off' || !ps || !Number.isFinite(ps.x)) return null;
    const r = placePair({ seed, terrain, pose: { x: ps.x, z: ps.z, heading: ps.heading }, view });
    if (!r) return null;
    first.slots = r.slots; first.at = time; first.place = { side: r.side, R: r.R, course: r.course };
    for (const s of r.slots) { spawn(s, s.place); first.rec.set(s.id, { id: s.id, startD: null, minD: Infinity, at: null }); }
    first.line = createSpotLine({ show: (text) => line(text, 'spot') });
    return first.place;
  }

  // a later pair (the stage's random act): placePair again on a seed of its own (new faces, new ids), in the view now
  let pairs = 0;
  function again(view) {
    const ps = boat();
    if (dayOff) return null;   // the residents replace the staged pairs
    if (mode === 'off' || !first.laid || !ps || !Number.isFinite(ps.x)) return null;
    const n = pairs + 1;
    const r = placePair({ seed: (seed + 7919 * n) | 0, terrain, pose: { x: ps.x, z: ps.z, heading: ps.heading }, view });
    if (!r) return null;
    pairs = n;
    const slots = r.slots.map((s) => ({ ...s, id: `${s.id}-p${n}` }));
    first.slots = slots; first.at = time; first.place = { side: r.side, R: r.R, course: r.course, n };
    for (const s of slots) { spawn(s, s.place); first.rec.set(s.id, { id: s.id, startD: null, minD: Infinity, at: null }); }
    return first.place;
  }

  // the boat as the kayakers see it: its place and its velocity over the water from its own track (eased ≈ 0.5 s)
  let bPrev = null, lastBoat = null;
  const bVel = { vx: 0, vz: 0 };
  function boatSeen(dt) {
    const st = boat(); if (!st || !Number.isFinite(st.x)) return null;
    if (!bPrev) { const v = st.sog ?? st.u ?? 0; bVel.vx = Math.sin(st.heading) * v; bVel.vz = -Math.cos(st.heading) * v; }
    else if (dt > 0) { const k = 1 - Math.exp(-dt / 0.5); bVel.vx += ((st.x - bPrev.x) / dt - bVel.vx) * k; bVel.vz += ((st.z - bPrev.z) / dt - bVel.vz) * k; }
    bPrev = { x: st.x, z: st.z };
    return { x: st.x, z: st.z, vx: bVel.vx, vz: bVel.vz };
  }

  // the draw records (reused arrays; the renderer reads them after each step)
  const draws = { full: [], mid: [], far: [] };
  // the full kayak on the water: heave, pitch and roll from five heights, the stroke's dip and roll (v1's floatFull)
  function floatPose(it) {
    const a = it.a, ch = Math.cos(a.heading), sh = Math.sin(a.heading), st = it.st;
    const hAt = (lx, lz) => heightAt(a.x + ch * lx - sh * lz, a.z + sh * lx + ch * lz);
    const c = hAt(0, 0), bow = hAt(0, -L), stern = hAt(0, L), port = hAt(-B, 0), stbd = hAt(B, 0);
    const mean = (2 * c + bow + stern + port + stbd) / 6, dip = st?.dip ?? 0;
    return { x: a.x, y: mean - draft - dip * 0.03, z: a.z, water: mean, yaw: -a.heading, pitch: Math.atan2(bow - stern, 2 * L) * 0.85 - dip * 0.01, roll: Math.atan2(stbd - port, 2 * B) * 0.6 + (a.roll ?? 0) + (st?.roll ?? 0) };
  }
  // the roll on a float pose (v2/sim/kayak-roll.js): about the roll centre (ROLL.yc up the kayak's frame, so a hull upside
  // down rides with its keel out of the water), the empty hull a little higher; under the water nothing of it is drawn by
  // the world's water level (cut) once it has rolled far or a paddler is in the water (the kayak's own waterline before)
  function rolled(it, fp) {
    const R = it.R;
    if (R.phi === 0 && R.aboard === 1 && !R.busy) { fp.cut = null; return fp; }
    fp.roll += R.phi;
    poseRows(fp, tmpRows);
    fp.x += ROLL.yc * -tmpRows[1]; fp.y += ROLL.yc * (1 - tmpRows[5]) + (1 - R.aboard) * ROLL.lift; fp.z += ROLL.yc * -tmpRows[9];
    fp.cut = R.busy || Math.abs(R.phi) > 0.3 ? fp.water : null;
    return fp;
  }
  // a full record's capsize parts: the swimmer's place in the world (fig: rows taking the seated figure to the water), its
  // look (arms, the wave, the head shaken), the paddle off the hands (pad: its place, its turn, k how far off the hands)
  function capsized(it, rec, dt) {
    const R = it.R, sw = R.sw, a = it.a;
    rec.fig = null; rec.pad = null;
    if (!R.busy) return;
    const L = it.swim, T = time * Math.PI * 2;
    L.yaw = 0; L.arms = 0; L.wave = 0;
    if (R.mode === 'settle') L.yaw = 0.5 * Math.sin(T * 2.6) * Math.max(0, 1 - R.t / ROLL.settleT);   // up again: a shake of the head
    if (sw.vis) {
      swimmerAt(it, tmp3);
      it.swY = it.swY == null ? tmp3[1] : it.swY + (tmp3[1] - it.swY) * (1 - Math.exp(-dt / 0.25));   // the body rides the swell, a little behind it
      const fq = it.figPose; fq.yaw = -a.heading + sw.yaw; fq.pitch = sw.tilt; poseRows(fq, it.fig);
      const N = CAPSIZE.neck, f = it.fig, py = it.swY + sw.h;
      f[3] = tmp3[0] - (f[0] * N[0] + f[1] * N[1] + f[2] * N[2]); f[7] = py - (f[4] * N[0] + f[5] * N[1] + f[6] * N[2]); f[11] = tmp3[2] - (f[8] * N[0] + f[9] * N[1] + f[10] * N[2]);
      if (sw.mix > 0) blendRows(f, poseRows(rec, it.hull), sw.mix, f);   // the climb's last moment lands on the seat
      rec.fig = f;
      L.yaw += sw.shake * 0.55 * Math.sin(T * 2.4); L.arms = Math.max(0, Math.min(1, sw.arms)); L.wave = Math.max(0, Math.min(1, sw.wave));
      L.wavePh = T * 1.6; L.scullPh = T * 0.7;
    }
    rec.body = L;
    const pd = R.pd;
    if (pd.free > 0) {
      const ch = Math.cos(a.heading), sh = Math.sin(a.heading), P = it.pad;
      P.k = Math.max(0, Math.min(1, pd.free)) * (1 - Math.max(0, Math.min(1, sw.hold)));
      P.x = a.x + pd.x * ch - pd.z * sh; P.z = a.z + pd.x * sh + pd.z * ch; P.y = heightAt(P.x, P.z) + 0.03; P.yaw = -a.heading + pd.yaw;
      rec.pad = P;
    }
  }
  // the kayak frame → the world (a float pose's rows) for the blades' points
  const fr = new Float32Array(12);
  const toWorld = (p, q) => [fr[0] * q[0] + fr[1] * q[1] + fr[2] * q[2] + fr[3], fr[4] * q[0] + fr[5] * q[1] + fr[6] * q[2] + fr[7], fr[8] * q[0] + fr[9] * q[1] + fr[10] * q[2] + fr[11]];
  const splash = [], tips = new Map();
  const spooks = [];   // play as Tessie: splashes queued for the next step ({ x, z, r })
  let spookCount = 0;

  // ---- the capsize's side (v2/sim/kayak-roll.js): the mind kept clear of the boat, the water thrown up, the lines ----
  const tmp3 = [0, 0, 0], tmpRows = new Float32Array(12);
  // a kayaker shaken by a bump keeps well clear of the sailboat for a while: a wider gap wanted, acting from further off
  function wary(it, secs) {
    if (!it.baseP) { const P = it.m.P; it.baseP = P; it.m.P = { ...P, want: Math.max(P.want * 2.5, 28), actM: Math.max(P.actM, 30), actT: Math.max(P.actT, 45), scan: [1.5, 2.5] }; }
    it.wary = Math.max(it.wary, secs);
  }
  // the swimmer's neck in the world (the heading frame's offsets: off to starboard, fz aft)
  function swimmerAt(it, out) {
    const a = it.a, sw = it.R.sw, ch = Math.cos(a.heading), sh = Math.sin(a.heading);
    out[0] = a.x + sw.off * ch - sw.fz * sh; out[2] = a.z + sw.off * sh + sw.fz * ch; out[1] = heightAt(out[0], out[2]);
    return out;
  }
  // water thrown up (the blades' splash, living/kayaks-splash.js: s its strength, n bursts within 0.5 m of the point)
  function burst(it, at, s, n) {
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5, ch = Math.cos(it.a.heading), sh = Math.sin(it.a.heading);
      splash.push({ type: 'catch', key: `${it.slot.id}:cap${i}`, at: [at[0] + sh * u * 1.6, at[1], at[2] - ch * u * 1.6], water: at[1], s });
    }
  }
  function onRollEvent(it, e) {
    const a = it.a, R = it.R;
    if (e === 'capsize') {
      // the low gunwale and the paddler going in: water along the side, and the sound
      const ch = Math.cos(a.heading), sh = Math.sin(a.heading), side = -R.side * 0.45;
      tmp3[0] = a.x + ch * side; tmp3[2] = a.z + sh * side; tmp3[1] = heightAt(tmp3[0], tmp3[2]);
      burst(it, tmp3, 2.2, 6);
      sfx.push({ type: 'capsize', x: a.x, z: a.z });
      const byBoat = time - it.hitT < CAPSIZE.lineAfterHitS;
      capsizes.push({ t: +time.toFixed(2), id: it.slot.id, kind: R.kind, byBoat, byTessie: it.bitten });
      if (byBoat) { bumpPending = null; if (!capsizeSaid) { capsizeSaid = true; line(LINES.capsize, 'capsize'); } }
    } else if ((e === 'settle' && R.capsizes && R.sw.vis === 0 && R.kind === 'roll') || e === 'climb') {
      // up again (the Eskimo roll's hull slapping down, or the righted hull): a smaller splash and the second take
      tmp3[0] = a.x; tmp3[2] = a.z; tmp3[1] = heightAt(a.x, a.z);
      burst(it, tmp3, 0.9, 2);
      sfx.push({ type: 'righted', x: a.x, z: a.z });
    } else if (e === 'done') {
      wary(it, CAPSIZE.waryS);
      if (it.bitten) { it.bitten = false; if (it.kindWas) R.kind = it.kindWas; it.kindWas = null; it.tz = { mode: 'away', t: TESSIE_REACT.awayS, x: it.tzAt?.x ?? a.x, z: it.tzAt?.z ?? a.z }; }
    }
  }

  // ---- round B: Tessie near (the watch, the back strokes, paddling away after a swim) ----
  // her nearest part at the surface: { x, z, d } or null
  let herNow = null;
  function herNear(a) {
    if (!herNow) return null;
    let best = null;
    for (const p of herNow) { const d = Math.hypot(p[0] - a.x, p[1] - a.z); if (!best || d < best.d) best = { x: p[0], z: p[1], d }; }
    return best;
  }
  // the reaction's intent (or null: the mind steers). Natural strokes only: back strokes, sweeps on the spot, a cruise away; never a sprint
  function react(it, dt) {
    const a = it.a, K = TESSIE_REACT, h = herNear(a);
    if (h) it.tzAt = { x: h.x, z: h.z };
    if (h && h.d <= K.backM && it.tz?.mode !== 'away' && !it.tz?.still) it.tz = { mode: 'back', t: K.keepS, x: h.x, z: h.z };
    else if (h && h.d <= K.watchM && (!it.tz || it.tz.mode === 'watch')) it.tz = { mode: 'watch', t: K.keepS, x: h.x, z: h.z };
    else if (h && it.tz) { it.tz.x = h.x; it.tz.z = h.z; }
    const z = it.tz; if (!z) return null;
    z.t -= dt;
    if (z.t <= 0) {
      if (z.mode === 'back' && z.then) { it.tz = { mode: 'away', t: z.then, x: z.x, z: z.z }; return react(it, 1e-6); }
      it.tz = null; a.look = null; a.turning = 0; return null;
    }
    const toHer = Math.atan2(z.x - a.x, -(z.z - a.z)), off = Math.atan2(Math.sin(toHer - a.heading), Math.cos(toHer - a.heading)), aoff = Math.abs(off) / RDEG;
    if (z.mode === 'away') {
      // paddling away from her at the cruise (the bow swung round first with sweeps, as steerTo does)
      a.look = aoff < 100 ? Math.max(-K.lookMax, Math.min(K.lookMax, off / RDEG)) : null;
      return steerTo(a, toHer + Math.PI, 0.5);
    }
    a.look = Math.max(-K.lookMax, Math.min(K.lookMax, off / RDEG));   // the head: on her
    // the bow round to her: sweeps on the spot past turnDeg, until stopDeg
    if (z.mode === 'watch' && a.v > 0.5) { a.turning = 0; return (a.intent = { throttle: -0.6, turn: 0 }); }   // the glide checked first, then the bow round
    if (z.still) a.turning = 0;
    else if (!a.turning && aoff > K.turnDeg) a.turning = Math.sign(off);
    else if (a.turning && (aoff < K.stopDeg || Math.sign(off) !== a.turning)) a.turning = 0;
    if (a.turning) return (a.intent = { throttle: 0, turn: a.turning });
    if (z.mode === 'back') return (a.intent = { throttle: -1, turn: 0 });   // back strokes: the stern away from her
    return (a.intent = { throttle: a.v > 0.3 ? -0.6 : 0, turn: 0 });   // the paddle stops (a back stroke or two to check the glide)
  }
  // her bite (play as Tessie): over away from her, a swim held beside the hull, then righted and away
  function bite(id, at = {}) {
    const it = live.get(id); if (!it || it.R.busy || it.bitten) return false;
    const a = it.a, R = it.R, ch = Math.cos(a.heading), sh = Math.sin(a.heading);
    const hx = at.x ?? a.x, hz = at.z ?? a.z, side = ((hx - a.x) * ch + (hz - a.z) * sh) >= 0 ? 1 : -1;   // +1: she is on its starboard
    it.kindWas ??= R.kind; R.kind = 'swim'; R.tries = 1; it.bitten = true;
    const K = TESSIE_REACT;
    R.hold = K.holdS[0] + (K.holdS[1] - K.holdS[0]) * hash01(it.slot.seed, 31 + spookCount + bites);
    R.w = side * K.spinW;   // pushed away from her: her side lifts (+ lifts the starboard)
    it.tz = null; it.tzAt = { x: hx, z: hz };
    tmp3[0] = a.x + ch * side * 0.5; tmp3[2] = a.z + sh * side * 0.5; tmp3[1] = heightAt(tmp3[0], tmp3[2]);
    burst(it, tmp3, 1.8, 4);
    bites++;
    return true;
  }
  let bites = 0;
  const launched = new Map();   // id → { region, group }

  // the first fleet: everyone wanted, where the plan puts them (v1's: a capture's frame is the plan's own picture)
  windMs = wind();
  for (const s of wanted()) spawn(s);

  function step(dt, c = null) {
    if (!(dt > 0)) return draws;
    dt = Math.min(dt, 0.1); time += dt;
    splash.length = 0;   // (this step's catches and exits only: the splash reads them after the step)
    // Tessie's splashes (play as Tessie): each kayaker within r is splashed (water thrown over her) and spooked: back strokes, then a cruise
    // away from it (round B: natural strokes, never a sprint), wary for CAPSIZE.waryS. A splash never tips a kayak (owner, 2026-11-20); only
    // her bite does (fleet.bite, round B)
    for (const sp of spooks.splice(0)) for (const it of live.values()) {
      const a = it.a, d = Math.hypot(a.x - sp.x, a.z - sp.z); if (d > sp.r || it.R.busy) continue;
      const away = Math.atan2(a.x - sp.x, -(a.z - sp.z)), wy = heightAt(a.x, a.z);
      tmp3[0] = a.x - Math.sin(away) * 0.8; tmp3[2] = a.z + Math.cos(away) * 0.8; tmp3[1] = wy;
      burst(it, tmp3, 1.6, 5);
      // the splash ahead: back strokes straight off it first; abeam or astern: turn and paddle away at once
      const ahead = Math.abs(Math.atan2(Math.sin(away + Math.PI - a.heading), Math.cos(away + Math.PI - a.heading))) < Math.PI / 2;
      it.tz = ahead ? { mode: 'back', t: TESSIE_REACT.spookBackS, then: TESSIE_REACT.spookAwayS, x: sp.x, z: sp.z, still: true } : { mode: 'away', t: TESSIE_REACT.spookAwayS, x: sp.x, z: sp.z };
      wary(it, CAPSIZE.waryS); spookCount++;
    }
    if (c) Object.assign(cam, c);
    // who is out (every 2 s of scene time): appear and leave only out of the camera's reach (v1's)
    if (time - lastCheck > 2) {
      lastCheck = time;
      const w = wind(); windMs = windMs == null ? w : windMs + (w - windMs) * 0.1;
      const want = new Set(wanted().map((s) => s.id));
      for (const s of [...residents, ...slots]) if (want.has(s.id) && !live.has(s.id)) { const p = s.route.path.at(s.s0); if (distTo(p.x, p.z) > SPAWN_CLEAR_M) spawn(s); }
      for (const [id, it] of live) if (!want.has(id) && !launched.has(id) && it.d > RETIRE_M) retire(id);
      // the launched pairs (round B) leave once past the course (route.past) or home again (a lap of their loop), out of the view and popM
      // from the camera; at night or in a storm (no residents out) that is not waited for
      const out = residentsOut().length > 0;
      for (const [id, L] of launched) {
        const it = live.get(id); if (!it) { launched.delete(id); continue; }
        const cx = it.a.x - cam.x, cz = it.a.z - cam.z, off = Math.abs(Math.atan2(cx * cam.fwdZ - cz * cam.fwdX, cx * cam.fwdX + cz * cam.fwdZ));
        const lead = live.get(L.group) ?? it;   // (the lead's progress counts for the pair)
        if ((lead.a.lap >= 1 || lead.a.s >= (lead.slot.route.past ?? Infinity) || !out) && it.d >= popM && off > cam.hHalf + 0.15 && !it.R.busy) { retire(id); launched.delete(id); L.left = time; }
      }
    }
    // round B: a pair launched from shore when none has been near the player for the launcher's time (desktop and tablet: the residents)
    if (launcher) {
      const pl = player ? player() : boat();
      const slotsNew = launcher.tick(dt, { player: pl && Number.isFinite(pl.x) ? pl : null, cam, marks: marks(), allow: mode !== 'off' && residentsOut().length > 0 && !!launchOk() });
      if (slotsNew) for (const s of slotsNew) { spawn(s); launched.set(s.id, { region: s.region, group: s.group, at: time }); }
    }
    { const T = tessie(); herNow = T && T.pts && T.pts.length ? T.pts : null; }
    const items = [...live.values()];
    for (const it of items) { it.d = distTo(it.a.x, it.a.z); it.want = pickTier(it.tier, it.d, LODQ); }
    capFull(items.map((it) => ({ id: it.slot.id, d: it.d, tier: it.want, it })), LODQ).forEach((q) => { q.it.want = q.tier; });
    for (const it of items) if (it.slot.group === 'first' && it.d < PAIR_FULL_M) it.want = 'full';   // the pair: never the peg tier near
    for (const it of items) {
      const tier = it.want === 'full' && !clips ? 'mid' : it.want;   // the figures not in yet: mid (v1's)
      if (tier === 'full' && it.tier !== 'full') { it.ph = it.a.phase; if (it.st) { it.st.ph = it.a.phase; it.st.wet[0] = it.st.wet[1] = false; } }   // the hand-over at the same stroke phase
      it.tier = tier;
    }
    const world = { boat: (lastBoat = boatSeen(dt)), others: items.map((it) => it.a), terrain };
    const ps0 = boat(), ps = ps0 && Number.isFinite(ps0.x) ? ps0 : null;
    draws.full.length = 0; draws.mid.length = 0; draws.far.length = 0;
    sfx.length = 0;
    for (const it of items) {
      const { a } = it;
      // a capsized kayaker does not paddle: the hull drifts and glides to rest while the roll runs its beats
      const busy = it.R.busy, intent = busy ? (a.intent = REST) : (react(it, dt) ?? think(a, it.m, dt, world));
      if (busy) { it.m.braceT = 0; it.m.closeT = 0; a.look = null; }
      // a bitten kayak's swimmer waits beside the hull while she is within reach (v2/sim/kayak-roll.js: R.hold)
      if (it.R.hold > 0) { const h = herNear(a); if (!h || h.d > TESSIE_REACT.reachM) it.R.hold = Math.max(0, it.R.hold - dt); }
      a.roll = ps ? wakeRock(ps, a, dt) : 0;
      drift(a, dt);
      stepHull(a, dt, intent);
      if (it.tier === 'full' && busy) { if (it.st) { it.st.roll = 0; it.st.dip = 0; it.st.wet[0] = it.st.wet[1] = false; } it.ev = null; a.lookDeg = 0; }
      else if (it.tier === 'full') {
        // the stroke at the kayak's real speed (the blade held in the water, the kayak moving up to it); its force takes
        // the place of the gait's mean force in the hull model, its moment yaws the bow away from the blade
        it.st ??= createStroke({ clips, sex: it.look.sex, seed: it.slot.seed, phase: it.ph });
        a.lookDeg = lookAt(a, ps);   // the head: the mind's glance, or the sloop watched while near
        const o = strokeStep(it.st, a, dt);
        a.v += (o.F - meanForce(a.w)) / HULL.M * dt;
        a.r += o.M / HULL.I * dt;
        it.ph = a.phase = it.st.ph;   // (the mid tier takes over at the same phase)
        it.ev = o.events;
      }
    }
    // contact (v1's): the hull against each kayak near it; a bump braces the paddler, rocks the kayak, says a quiet line
    // (the hull's real outline against the kayak's waterline ellipse, src/sim/kayaks/contact.js: the impulse along the hull's
    // normal; its part across the kayak, at the bow flare's height over the roll centre, rolls the kayak: a soft touch rocks it,
    // a hard one on the beam puts it over, v2/sim/kayak-roll.js)
    if (ps) for (const it of items) {
      const a = it.a; if (Math.hypot(a.x - ps.x, a.z - ps.z) > 9) continue;
      // the closing speed across the kayak before the contact resolves (the boat's velocity less the kayak's, on its beam)
      const ch = Math.cos(a.heading), sh = Math.sin(a.heading), bh = ps.heading;
      const vbx = Math.sin(bh) * (ps.u ?? 0) + Math.cos(bh) * (ps.v ?? 0), vbz = -Math.cos(bh) * (ps.u ?? 0) + Math.sin(bh) * (ps.v ?? 0);
      const vkx = Math.sin(a.heading) * a.v + (a.pvx ?? 0), vkz = -Math.cos(a.heading) * a.v + (a.pvz ?? 0);
      const vBeam = (vbx - vkx) * ch + (vbz - vkz) * sh;   // + : the boat moving to the kayak's starboard
      const cc = kayakContact(ps, a);
      if (!cc) continue;
      // the first touch: the hull pressing into the kayak's side must shove its beam up to the boat's speed (the boat ≈ 40 ×
      // heavier; little restitution: contact.js's 0.15, the sway's added mass 1.5 ×), at the bow flare's height over the roll
      // centre: pushed to starboard above it, the starboard side goes down. Only from the side the boat is on, closing, and
      // once a touch (the resolver parts them a frame and the hull meets the kayak again while it keeps pressing: one shove)
      const sideC = Math.sign((cc.x - a.x) * ch + (cc.z - a.z) * sh) || -Math.sign(vBeam);
      let jb = 0;
      if (time - it.touchT > 0.5 && vBeam * sideC < 0) { jb = 1.15 * HULL.M * 1.5 * vBeam; rollImpulse(it.R, -jb * ROLL.hitH); }
      it.touchT = time;
      if (cc.j > 1) {
        if (!it.R.busy) Object.assign(it.m, { braceT: 1.0, closed: true, closeT: 3, closeMode: 'sprint', closeAway: Math.atan2(a.x - ps.x, -(a.z - ps.z)) });
        it.hitT = time; wary(it, CAPSIZE.bumpWaryS);
        if (time - lastBumpT > 6) { contacts.push({ t: +time.toFixed(2), id: it.slot.id, j: +cc.j.toFixed(1), vBeam: +vBeam.toFixed(2), dvBoat: +cc.dvBoat.toFixed(4) }); bumpPending ??= time; }
        lastBumpT = time;
      }
    }
    // the roll: each kayak's own (the water's slope across its beam: a breaking crest's rare slap in a strong wind)
    for (const it of items) {
      const a = it.a, R = it.R, ch = Math.cos(a.heading), sh = Math.sin(a.heading);
      const slope = Math.atan2(heightAt(a.x + ch * B, a.z + sh * B) - heightAt(a.x - ch * B, a.z - sh * B), 2 * B);
      let boatB = null;
      if (lastBoat) { const dx = lastBoat.x - a.x, dz = lastBoat.z - a.z, kx = dx * ch + dz * sh, kz = -(dx * sh - dz * ch); boatB = Math.atan2(-kx, -kz); }
      stepRoll(R, dt, { slope, windMs: windMs ?? 0, boat: boatB });
      for (const e of R.events) onRollEvent(it, e);
      if (it.wary > 0 && !R.busy) { it.wary -= dt; if (it.wary <= 0 && it.baseP) { it.m.P = it.baseP; it.baseP = null; } }
      // the swimmer comes up: a little water off the head as it breaks the surface
      if (R.sw.vis && !it.surfaced && R.sw.h > -0.12 && R.sw.hV > 0) { it.surfaced = true; burst(it, swimmerAt(it, tmp3), 0.7, 1); }
      if (!R.sw.vis) it.surfaced = false;
    }
    if (bumpPending != null && time - bumpPending > 1.2) { bumpPending = null; line(LINES.bump, 'bump'); }
    for (const it of items) for (const e of it.m.events.splice(0)) if (e.type === 'close') { closeCalls.push({ t: +time.toFixed(2), id: it.slot.id, d: +e.d.toFixed(1) }); if (!closeSaid) { closeSaid = true; line(LINES.close, 'close'); } }
    // the draw records
    for (const it of items) {
      const a = it.a;
      if (it.tier === 'full') {
        const fp = rolled(it, floatPose(it)), st = it.st;
        if (st) st.body.roll = -STROKE.headRoll * fp.roll;   // the head keeps 10 % of the hull's roll
        const rec = { id: it.slot.id, d: it.d, ...fp, sex: it.look.sex, look: it.look, colour: it.slot.colour, w: a.w, phase: it.ph, body: st?.body ?? null, near: it.d < KAYAK_NEAR_M, shell: it.d < KAYAK_SHELL_M ? 'near' : 'far' };
        capsized(it, rec, dt);
        draws.full.push(rec);
        // the blades in the world: the catches and exits for the splash, the tips for the drips (v1's splashes)
        if (st) {
          poseRows(fp, fr);
          const sp = Math.abs(a.v) * 1.6;   // v1's strength: the blade's speed past the hull (≈ v · 1.1) and half the kayak's
          for (let s = 0; s < 2; s++) tips.set(`${it.slot.id}:${s}`, toWorld(fr, [st.blades[6 + 3 * s], st.blades[7 + 3 * s], st.blades[8 + 3 * s]]));
          for (const e of it.ev ?? []) splash.push({ type: e.type, key: `${it.slot.id}:${e.side}`, at: toWorld(fr, e.at), water: fp.water, s: e.type === 'catch' ? 0.4 + sp * 0.4 : 0.5 + sp * 0.3 });
          it.ev = null;
        }
      }
      else {
        const water = heightAt(a.x, a.z), y = water - draft;
        const rec = rolled(it, { id: it.slot.id, d: it.d, x: a.x, y, z: a.z, water, yaw: -a.heading, pitch: 0, roll: a.roll ?? 0, colour: it.slot.colour, pfd: it.slot.pfd, phase: a.phase, go: 1 - (a.w.rest ?? 0), heading: a.heading });
        (it.tier === 'mid' ? draws.mid : draws.far).push(rec);
      }
    }
    draws.full.sort((p, q) => p.d - q.d);
    // the first pair: each paddler's closest pass, out while the boat is within 500 m; the skipper's line once seen
    if (first.slots.length && lastBoat) {
      let seen = false, nearest = Infinity;
      const half = cam.hHalf * 0.85;
      for (const s of first.slots) {
        const it = live.get(s.id); if (!it) continue;
        const d = Math.hypot(it.a.x - lastBoat.x, it.a.z - lastBoat.z), r = first.rec.get(s.id);
        r.startD ??= d; if (d < r.minD) { r.minD = d; r.at = time - first.at; }
        nearest = Math.min(nearest, d);
        const cx = it.a.x - cam.x, cz = it.a.z - cam.z, off = Math.abs(Math.atan2(cx * cam.fwdZ - cz * cam.fwdX, cx * cam.fwdX + cz * cam.fwdZ));
        if (d < FIRST.seeM && off < half) seen = true;
      }
      first.near = nearest < 500 || !Number.isFinite(nearest) && time - first.at < 5;
      if (first.line && !first.line.said) { first.lineT += dt; first.line.tick(first.lineT, { seen }); }
    }
    return draws;
  }

  function stats() {
    const tiers = { full: 0, mid: 0, far: 0 };
    for (const it of live.values()) if (it.tier) tiers[it.tier]++;
    return {
      out: live.size, want: wanted().length, windMs: windMs == null ? null : +windMs.toFixed(2), hour: +hour().toFixed(2), tiers, lod: LODQ.tier, maxFull: LODQ.maxFull, maxOut: LODQ.maxOut,
      figures: !!clips, contacts, closeCalls, lines, capsizes,
      first: { laid: first.laid, at: first.at == null ? null : +first.at.toFixed(2), out: first.slots.length, place: first.place,
        kayaks: [...first.rec.values()].map((r) => ({ id: r.id, startD: r.startD == null ? null : +r.startD.toFixed(1), minD: Number.isFinite(r.minD) ? +r.minD.toFixed(1) : null, at: r.at == null ? null : +r.at.toFixed(1) })),
        line: first.line ? { said: first.line.said, at: first.line.at == null ? null : +first.line.at.toFixed(1), dropped: first.line.dropped } : null },
      kayaks: [...live.values()].map((it) => ({ id: it.slot.id, route: it.slot.route.id, persona: it.slot.personality, tier: it.tier, d: Math.round(it.d), x: Math.round(it.a.x), z: Math.round(it.a.z), v: +it.a.v.toFixed(2), heading: +(it.a.heading * 180 / Math.PI).toFixed(1), resting: it.a.restLeft > 0, action: it.m.action, roll: +(it.R.phi * 180 / Math.PI).toFixed(1), mode: it.R.mode, wary: it.wary > 0, sex: it.look.sex, boatD: lastBoat ? Math.round(Math.hypot(it.a.x - lastBoat.x, it.a.z - lastBoat.z)) : null })),
    };
  }
  return {
    step, lay, again, stats, draws, live, slots, LOD: LODQ, first, splash, tips, sfx, bite, launched, launcher,
    get bites() { return bites; },
    react(id) { const it = live.get(id); return it?.tz ? it.tz.mode : null; },
    setClips(c) { clips = c; },
    get laid() { return first.laid; },
    // play as Tessie: a splash at (x, z) spooks the kayakers within r m at the next step (never tips them)
    spook(x, z, r = 20) { spooks.push({ x, z, r }); return true; },
    get spooked() { return spookCount; },
    wary(id) { const it = live.get(id); return !!it && it.wary > 0; },
    marks,
  };
  // the kayaks for the chart (v1's marks()), the busy lake's others and Tessie's targets: id, launched (round B), busy (capsized)
  function marks() { const out = []; for (const it of live.values()) out.push({ id: it.slot.id, x: it.a.x, z: it.a.z, heading: it.a.heading, launched: !!it.slot.launched, region: it.slot.region ?? null, group: it.slot.group ?? null, busy: it.R.busy }); return out; }
}

// the colours a kayak and its paddler wear (linear rgb): the kayak's preset, the PFD, the top, the shorts, the shoes, the
// skin, the hair, the cap (v1's look.js picks; the blade v1's default blue)
export function kayakColours(rec) {
  const lk = rec.look ?? {};
  return {
    hull: linear(KAYAK_COLOURS[rec.colour] ?? '#D6BA0C'), pfd: linear(lk.pfd ?? PFD_COLOURS[rec.pfd] ?? '#B8420F'),
    top: linear(lk.top ?? '#1D2433'), shorts: linear(lk.shorts ?? '#18181A'), shoes: linear(lk.shoes ?? '#202124'),
    skin: linear(lk.skin ?? '#D9A47C'), hair: linear(lk.hair ?? '#3B2A1E'), hat: linear(lk.hatColour ?? '#E9E4D8'), blade: linear('#1A66B4'),
  };
}
export { KAYAK_DAY };
