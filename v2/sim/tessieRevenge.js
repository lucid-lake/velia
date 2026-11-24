// TK, Tessie's revenge (owner, 2026-11-17: "a little horror: charge her once and she takes revenge; she tries
// to knock you down; you can try to escape; fail and you're knocked down; Tessie is like a boss in a certain area"). Pure: no
// DOM, no GPU, no Math.random, no wall clock. It drives her through the sim's motion API (v2/sim/tessie.js: hunt, ambush,
// swimTo, riseUnder, play, emit) and says what the page must do (the line, the drone, the gloom, the roll); the page does it
// (v2/living/tessie.js, v2/main.js). "Cheat on where and when, never on motion": she is placed astern or abeam while deep and
// unseen; then she swims as an animal (her turn and speed limits).
//
// The trigger: one charge (owner): while she is up and seen, the boat heading within REVENGE.chargeDeg of her bearing, closing
// faster than chargeMs, inside chargeM. Sail only (Regatta and Cruise never; a phone never makes her: feature('tessie')).
// The revenge:
//   dive    she dives at once, swimming away and down (up to diveMaxS until nothing of her is above underM)
//   quiet   quietS of quiet: the wind's sound dips, a low drone rises, the water round the boat darkens a touch (the gloom; off
//           under reduced motion)
//   chase   she comes up fromM astern or abeam (deep water, nearest the camera's view) and swims at the boat at chaseMs (11 kn; a pursuit
//           a little ahead of the boat); the skipper's MUST line "She’s coming back. Sail!"
//   escape  keep her past escapeM for escapeS, or leave her water (her area grown by waterPadM; only when the chase began in it):
//           she gives up with a tail slap and spray, the drone fades, "That was close." (once a session). The chase never runs
//           past chaseMaxS (the tone guard): then she gives up too
//   strike  she reaches the boat (catchM): she dives deep beside the hull (down), slides under the lee bilge to the keel (in),
//           rises till her back meets the keel's lee face and the bilge (up: the boat is solid to her, v2/sim/tessieClear.js;
//           owner 2026-11-18: never through the hull), her tail sweeps (the flick) and the push rolls the boat to leeward, the
//           keel swinging away from her (B.shove: the physics knocks her down; the card says "Tessie said no."); her splash,
//           wake and a deep breath; then she sinks away under the falling rail
//   then 'done': the stage's act ends when she has gone (her cooldown counts from there)
//
//   const R = createRevenge({ sim, area, mode, reduced });   mode() → 'sail' | 'cruise' | 'regatta'; reduced() → bool
//   R.step(dt, { boat: { x, z, heading, speed, heel }, playing, race, view: { x, z, yaw } })   after sim.step, before her events are heard
//   R.state   { phase, t, dist, heldS, chaseT, result ('escape' | 'strike' | 'cancel' | null), why, gloom, drone, dip, from }
//   R.events  this step's: { type: 'trigger' | 'quiet' | 'chase' | 'strike' | 'escape' | 'end', ... } (the line on chase/escape)
//   R.active  a revenge under way (the stage holds its other acts); R.cancel() (a mode change): she dives, the drone fades
import { heightAt } from './tessie.js';
import { CLEAR } from './tessieClear.js';
const CLEAR_MARGIN = CLEAR.margin;

export const REVENGE = Object.freeze({
  chargeDeg: 15, chargeMs: 2, chargeM: 40,     // the charge: heading within 15° of her bearing, closing over 2 m/s, inside 40 m
  diveMaxS: 3.5, underM: -1.8, diveMs: 4.2,    // the dive: until nothing of her is above 1.8 m down (at most 3.5 s), swimming away
  quietS: 2,                                   // the quiet before she comes
  fromM: 45, fromDeg: [180, 150, -150, 110, -110, 90, -90],   // where she comes up: 45 m off, astern first, then the quarters, abeam
  chaseMs: 11 * 1852 / 3600,                   // 11 kn (5.7 m/s; owner 2026-11-18: B, catches a dithering beginner, not a good sailor)
  leadS: 1.2,                                  // her pursuit aims this far ahead of the boat
  catchM: 6, escapeM: 25, escapeS: 30, chaseMaxS: 30, waterPadM: 30,
  leeM: 3.2, strikeMaxS: 9,                    // the strike: down beside the hull 3.2 m to leeward, then in and up (at most 9 s)
  underDy: -3.2,                               // m under her swimming depth while she goes under (the keel's 1.6 m and her girth)
  contactLat: 1.25, contactDy: -0.55,          // her spine at the keel's lee face (m from the centreline) and her rise there
  inNear: 1.4, upS: 3.5, touchM: 0.15,         // in: this near the contact point she rises; the push when her gap is within touchM of the margin (or upS)
  postDy: -3.6,                                // and she sinks away under the rail as the boat rolls toward her
  rollK: 1.3,                                  // the tail sweep's roll moment, × the boat's displacement × GM (B.shove)
  gloom: 0.22,                                 // the darkening's most (alpha of black over the water round the boat)
  dip: 0.45,                                   // the wind and water's sound under the drone (× their level)
  lines: { chase: 'She’s coming back. Sail!', escape: 'That was close.' },
  rise: 0.8, fall: 3,                          // s the drone and gloom take to rise and to fade
});
const DEG = Math.PI / 180;
import { wrap } from '../../src/sim/core/math.js';

export function createRevenge({ sim, area = null, mode = () => 'sail', reduced = () => false, depthAt = () => 30, R = REVENGE } = {}) {
  const st = { phase: 'idle', t: 0, dist: null, heldS: 0, chaseT: 0, result: null, why: null, gloom: 0, drone: 0, dip: 0, from: null, count: 0, inWater: false, lee: 0, sub: null, subT: 0 };
  const events = [];
  let closeSaid = false, want = 0, gloomWant = 0, lastBoat = null, chargedSighting = -1;
  const ev = (type, o = {}) => events.push({ type, ...o });
  const go = (phase) => { st.phase = phase; st.t = 0; };
  const inWater = (b, pad) => !!area && Math.hypot(b.x - area.x, b.z - area.z) <= area.r + pad;
  // her body: the nearest point at the surface (m) and its bearing, and the highest point of her (m: > 0 above the water)
  function body(b) {
    const s = sim.state.spine, L = sim.L, N = s.length / 8, ds = L / (N - 1);
    let best = Infinity, bx = 0, bz = 0, top = -Infinity, nearAny = Infinity;
    for (let i = 0; i < N; i += 2) {
      const x = s[i * 8], y = s[i * 8 + 1], z = s[i * 8 + 2], tp = y + heightAt(i * ds, L);
      top = Math.max(top, tp);
      const d = Math.hypot(x - b.x, z - b.z);
      nearAny = Math.min(nearAny, d);
      if (tp > -0.3 && d < best) { best = d; bx = x; bz = z; }
    }
    return { d: best, x: bx, z: bz, top, nearAny };
  }
  function charged(b) {
    const S = sim.state;
    // up and seen: any part of her at the surface (a shy dive that has just begun still counts: a fast charge makes her sink
    // before it is inside 40 m, and that is still a charge)
    if (!S.visible || S.phase === 'rise' || sim.hunting) return false;
    if (sim.sightings.length === chargedSighting) return false;
    const h = body(b);
    if (!(h.d <= R.chargeM)) return false;
    const brg = Math.atan2(h.x - b.x, -(h.z - b.z));
    const off = Math.abs(wrap(brg - b.heading));
    // closing: the boat's own speed over the ground toward her (her own way is slow and across: the boat's charge is what counts)
    const closing = Math.max(0, b.speed ?? 0) * Math.cos(off);
    return off <= R.chargeDeg * DEG && closing > R.chargeMs;
  }
  // where she comes up ("cheat on where"): fromM off the boat, astern, on a quarter or abeam, with deep water there and on her way
  // in; of those, the one nearest the middle of the camera's view (the player sees her humps and her V come), astern first on a tie
  function spot(b, view) {
    let best = null;
    for (const dg of R.fromDeg) {
      const a = b.heading + dg * DEG, x = b.x + Math.sin(a) * R.fromM, z = b.z - Math.cos(a) * R.fromM;
      let ok = depthAt(x, z) > 8;
      for (let k = 1; ok && k < 5; k++) ok = depthAt(b.x + (x - b.x) * k / 5, b.z + (z - b.z) * k / 5) > 4;
      if (!ok) continue;
      const off = view ? Math.abs(wrap(Math.atan2(x - view.x, -(z - view.z)) - view.yaw)) : 0;
      if (!best || off < best.off - 1e-6) best = { x, z, deg: dg, off };
    }
    return best;
  }
  const leeOf = (b) => {
    // the lee side: the side she heels to (heel < 0: to port); upright, the side away from the wind she was given
    const h = b.heel ?? 0, s = Math.abs(h) > 2 * DEG ? Math.sign(h) : st.lee || -1;
    return s;
  };
  function finish(result, why) { st.result = result; st.why = why; want = 0; gloomWant = 0; sim.hunt(false); go('done'); ev('end', { result, why }); }
  const self = {
    R, state: st, events,
    get active() { return st.phase !== 'idle' && st.phase !== 'done'; },
    cancel(why = 'cancel') {
      if (!self.active) return false;
      if (sim.state.visible) { sim.swimTo(null); sim.play('dive', sim.state.t + 0.3); }
      finish('cancel', why); return true;
    },
    // back to watching (her cooldown is the stage's)
    reset() { if (self.active) self.cancel(); go('idle'); st.result = null; st.why = null; },
    step(dt, { boat = null, playing = true, race = false, view = null } = {}) {
      events.length = 0;
      // the drone, the dip and the gloom ease toward what the phase wants (the gloom off under reduced motion)
      const k = (x, w) => x + (w - x) * Math.min(1, dt / (w > x ? R.rise : R.fall));
      const ease = () => { st.drone = k(st.drone, want); st.dip = st.drone; st.gloom = k(st.gloom, reduced() ? 0 : gloomWant); if (!want && st.drone < 0.001) st.drone = st.dip = 0; if (st.gloom < 0.001 && !gloomWant) st.gloom = 0; };
      // no boat to read (the player has her): nothing else runs, but what is still up fades out to rest
      if (!boat && playing && dt > 0) { ease(); return st; }
      if (!playing || !(dt > 0) || !boat) { lastBoat = boat ? { x: boat.x, z: boat.z } : lastBoat; return st; }
      st.t += dt;
      const m = mode();
      if (self.active && (race || m !== 'sail')) self.cancel(race ? 'race' : m);
      ease();
      if (st.phase === 'done' && st.drone < 0.01 && !sim.state.visible) go('idle');
      if (st.phase === 'idle' || st.phase === 'done') {
        if (st.phase === 'idle' && m === 'sail' && !race && charged(boat)) {
          chargedSighting = sim.sightings.length; st.count++; st.result = null; st.why = null; st.heldS = 0; st.chaseT = 0;
          st.inWater = inWater(boat, R.waterPadM);
          st.lee = leeOf(boat);
          // she dives at once, away from the boat and down
          const S = sim.state, away = Math.atan2(S.centre[0] - boat.x, -(S.centre[1] - boat.z));
          sim.hunt(true); sim.swimTo(S.centre[0] + Math.sin(away) * 60, S.centre[1] - Math.cos(away) * 60, R.diveMs); sim.play('dive', S.t + 0.2);
          want = 1; gloomWant = 1;
          go('dive'); ev('trigger', { dist: +body(boat).d.toFixed(1) });
        }
        lastBoat = { x: boat.x, z: boat.z };
        return st;
      }
      const h = sim.state.visible ? body(boat) : null;
      if (st.phase === 'dive') {
        if (!h || h.top < R.underM || st.t >= R.diveMaxS) { go('quiet'); ev('quiet'); }
      } else if (st.phase === 'quiet') {
        if (st.t >= R.quietS) {
          const p = spot(boat, view);
          if (!p) { finish('cancel', 'no water'); }
          else {
            const head = Math.atan2(boat.x - p.x, -(boat.z - p.z));
            sim.ambush(p.x, p.z, head, R.chaseMs * 0.8);
            sim.swimTo(boat.x, boat.z, R.chaseMs);
            st.from = p.deg; go('chase'); ev('chase', { line: R.lines.chase, from: p.deg });
          }
        }
      } else if (st.phase === 'chase') {
        st.chaseT += dt;
        // the pursuit: a little ahead of the boat (the animal's limits are the sim's)
        const v = lastBoat ? [(boat.x - lastBoat.x) / dt, (boat.z - lastBoat.z) / dt] : [0, 0];
        sim.swimTo(boat.x + v[0] * R.leadS, boat.z + v[1] * R.leadS, R.chaseMs);
        const n = sim.state.nose, d = n ? Math.hypot(n.x - boat.x, n.z - boat.z) : Infinity;
        st.dist = +d.toFixed(1);
        st.heldS = d > R.escapeM ? st.heldS + dt : 0;
        if (d <= R.catchM) {
          st.lee = leeOf(boat);   // heel < 0 is to port: lee = sign(heel) × right
          sim.depth(R.underDy); sim.contact(false);
          st.sub = 'down'; st.subT = 0;
          go('strike');
        } else if (st.inWater && !inWater(boat, R.waterPadM)) giveUp('water');
        else if (st.heldS >= R.escapeS) giveUp('distance');
        else if (st.chaseT >= R.chaseMaxS) giveUp('time');
      } else if (st.phase === 'strike') {
        // down beside the lee side, in under the bilge to the keel, up till her back meets it; then the tail sweeps, the boat rolls
        const n = sim.state.nose;
        st.subT += dt;
        const v = lastBoat ? [(boat.x - lastBoat.x) / dt, (boat.z - lastBoat.z) / dt] : [0, 0], vb = Math.hypot(v[0], v[1]);
        const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), rx = Math.cos(boat.heading), rz = Math.sin(boat.heading);
        const at = (lat, fwd, lead = 0) => [boat.x + st.lee * rx * lat + fx * fwd + v[0] * lead, boat.z + st.lee * rz * lat + fz * fwd + v[1] * lead];
        if (!n || !sim.state.visible) { /* gone: nothing to strike with */ finish('cancel', 'lost'); }
        else {
          if (st.sub === 'down') {
            const p = at(R.leeM, 0, 1.0); sim.swimTo(p[0], p[1], Math.max(1.5, Math.min(R.chaseMs, vb + 2)));
            if (sim.dy <= R.underDy + 0.5) { st.sub = 'in'; st.subT = 0; }
          } else if (st.sub === 'in') {
            const p = at(R.contactLat, 0, 0.8); sim.swimTo(p[0], p[1], Math.max(1.0, Math.min(R.chaseMs, vb + 1.2)));
            const c = at(R.contactLat, 0);
            if (Math.hypot(n.x - c[0], n.z - c[1]) <= R.inNear) { st.sub = 'up'; st.subT = 0; sim.contact(true); sim.depth(R.contactDy); }
          } else {
            // alongside the keel, at the boat's own speed (an animal cannot hover): her back up against its lee face and the bilge
            const p = at(R.contactLat, 8); sim.swimTo(p[0], p[1], Math.max(0.6, vb));
          }
          // the touch counts once she has risen to the keel (not while she is still passing under it)
          const touch = st.sub === 'up' && sim.dy >= R.contactDy - 0.5 && sim.state.clear <= CLEAR_MARGIN + R.touchM;
          if (touch || (st.sub === 'up' && st.subT >= R.upS) || st.t >= R.strikeMaxS) {
            sim.swimTo(null); sim.play('flick', sim.state.t); sim.play('dive', sim.state.t + 5.5);   // after the flick's 5 s (its slap)
            sim.contact(false); sim.depth(R.postDy); sim.behave(true);   // calm: the boat beside her does not make her shy (her flick plays out)
            sim.emit('break', 'nose', 1.4); sim.emit('breath', 'nose', 1.2);
            ev('strike', { K: st.lee * R.rollK, lee: st.lee, touch, clear: Number.isFinite(sim.state.clear) ? +sim.state.clear.toFixed(2) : null });
            finish('strike', 'caught');
          }
        }
      }
      lastBoat = { x: boat.x, z: boat.z };
      return st;
    },
  };
  function giveUp(why) {
    // a tail slap and spray, then away and down
    sim.swimTo(null); sim.play('flick', sim.state.t); sim.play('dive', sim.state.t + 6.5);
    const said = !closeSaid; closeSaid = true;
    ev('escape', { why, line: said ? R.lines.escape : null });
    finish('escape', why);
  }
  return self;
}
