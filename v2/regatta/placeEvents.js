// Regatta's place-race events (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// Tessie's Deep (placeStep: her warnings, strikes and catches; stopDeep when a race ends or is replaced), the player's
// knockdown hold and DNF (knockMe, placeKnock, endHold), and phase 2 (phase2Fresh, phase2Step): Glass Boat Chase's wash and
// catch, Storm Run's squall at the gun and the rivals it knocks down. Lights on the Lake and the hunts are hooks read elsewhere.
import { createChaseWatch, washAt } from './glassChase.js';
import { rivalKnockDue, stormPlan } from './stormRun.js';
import { DEEP, avoidAdvice } from './tessieDeep.js';
import { KNOCK, holdControls } from './knocks.js';
import { RESULTS } from './tuning.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installPlaceEvents(R) {
  const { B, NAMES, glassBoat, hooked, look, onStorm, placeRow, seed, stats, stormKnocked, tessie, washTrail } = R;
  // Tessie's Deep ended or replaced: she stops hunting and goes down (her sim keeps its own clock), the drone cue off
  function stopDeep() {
    if (!R.deep) return;
    const T = tessie(), sim = T?.sim; sim?.hunt?.(false); sim?.swimTo?.(null); if (sim?.state?.visible) sim.play?.('dive', (sim.state.t ?? 0) + 0.3); T?.raceCue?.(0); R.deep = null;
  }
  // phase 2 at every new race (a restart too): the glass boat off her stop again with her head start, her wash on; the storm sent
  // away (it starts again at the gun); the storm's knocks and the camera's look cleared
  function phase2Fresh() {
    R.glass = hooked('glass') ? glassBoat() : null; R.chase = null; stats.chase = null;
    if (R.glass?.chase) { R.glass.chase({ stop: placeRow()?.glass?.stop ?? 'fannette', preS: placeRow()?.glass?.leadS ?? 0 }); R.chase = createChaseWatch(); }
    washTrail.reset(); R.washT = null;
    R.S.wash = R.glass ? (x, z) => washAt(washTrail.pts, x, z) : null;
    if (R.stormOn) { try { onStorm(null); } catch { /* the page's storm */ } }
    R.stormOn = null; stormKnocked.clear(); stats.storm = null; stats.stormKnocks = [];
    look.reset(); stats.look = null;
  }
  // ---- place races: the player's 12 s hold, Tessie's rise and ring ----
  function endHold() { if (!R.held) return; R.held = false; if (B.ctl) B.ctl.jibFree = false; if (B.driven) B.drive(null); if (R.auto || (R.S?.helper && R.aids.helper)) B.drive(R.driveHelper); }
  const holdDrive = () => { if (B.ctl) holdControls(B.ctl); };
  // a knockdown of the player in a place race: the first holds her 12 s (she rights, sheets flying, and sails on), the second is a DNF
  // (the results card: Knocked down · DNF). cause 'tessie': her tail sweep rolls the boat (B.shove, as her revenge's strike: DEEP.rollK)
  function knockMe(cause = 'knockdown') {
    if (!R.S?.place || R.result != null) return null;
    const v = R.S.race.view('me');
    if (v.status !== 'racing') return null;
    const k = R.S.knock('me', cause);
    if (!k) return 'same';
    stats.knocks.push({ cause, kind: k.kind, at: +R.S.race.clock.toFixed(1) });
    if (cause === 'tessie') { const Pp = B.phys?.P; if (Pp && B.shove) B.shove({ K: DEEP.rollK * Pp.mass * 9.81 * Pp.gm }); }
    if (k.kind === 'hold') {
      R.held = true; if (B.driven) B.drive(null); B.drive(holdDrive);
      R.coach?.note(cause === 'tessie' ? 'Tessie rolled you! 12 s to right her. Once more and you are out.' : KNOCK.line, 6, 'knockHold', true);
    } else {
      R.knocked = { line: cause === 'tessie' ? 'Tessie rolled you a second time.' : 'A second knockdown ends the race.', tip: cause === 'tessie' ? 'Give her room.' : 'Reef early, or ease the main in the gusts.' };
      if (R.finishAt == null) R.finishAt = R.S.t - RESULTS.afterS; stats.knocked = true;
    }
    return k.kind;
  }
  function placeStep() {
    const r = R.S.race, v = r.view('me');
    if (R.held && !R.S.knocks.holding('me', r.clock)) endHold();
    phase2Step(r, v);
    if (!R.deep) return;
    const T = tessie(), sim = T?.sim, st = sim?.state;
    R.deep.centre(st?.visible && R.deep.state.phase !== 'idle' ? st.centre : null);
    // every boat she may hunt: where it is, its way, its progress (the leader weighs more), whether it is being righted
    const q = B.phys.state, boats = [{ id: 'me', x: q.x, z: q.z, heading: q.heading, u: q.u ?? 0, progress: v.progressM ?? 0, status: v.status, held: R.S.knocks.holding('me', r.clock) }];
    for (const b of R.S.rivals) { const bv = r.view(b.id), bs = b.phys.state; boats.push({ id: b.id, x: bs.x, z: bs.z, heading: bs.heading, u: bs.u ?? 0, progress: bv.progressM ?? 0, status: bv.status, held: R.S.knocks.holding(b.id, r.clock) }); }
    // her last attack has gone (her sim idle) before the next one: each warning's swim starts from the deep
    const ready = !sim || st?.phase === 'idle' || !st?.visible;
    for (const e of R.deep.step(r.clock, { boats, ready })) {
      if (e.type === 'warn' && e.act === 'dash') {
        // the RPG, phase 6b (your Dash, rank 2+): she rises off the spot, ahead and to one side of your bow, and runs across it at the
        // surface (her V on the water) to arrive as the warning ends; then today's strike there
        sim?.ambush?.(e.from[0], e.from[1], e.heading, 6);
        sim?.swimTo(e.at[0], e.at[1], Math.hypot(e.at[0] - e.from[0], e.at[1] - e.from[1]) / DEEP.warnS, 6);
        sim?.hunt(true); T?.raceCue?.(1);
        R.coach?.note('Tessie is dashing at you! Tack or bear away.', 5, 'tessieWarn', true);
      } else if (e.type === 'warn' && (e.act === 'surge' || e.act === 'breach')) {
        // the RPG, phase 6b (your Tail Surge, your Breach): she swims shallow to her spot off your bow (the surge: she surfaces and
        // coils) or beside your course (the breach: she breaches there); the wave heels you away from her, never over
        // from where she is when she is near (fast enough to be there as the warning ends); still far in her last sighting's dive: a
        // fresh rise 17.5 m short of the spot under the water (cheat on where, never on motion), as a new sighting's
        const tb = boats.find((b) => b.id === e.target), h = tb?.heading ?? q.heading, from = 3.5 * DEEP.warnS;
        const d0 = st?.visible && st.centre ? Math.hypot(st.centre[0] - e.at[0], st.centre[1] - e.at[1]) : 0;
        if (d0 > 30) sim?.ambush?.(e.at[0] - Math.sin(h) * from, e.at[1] + Math.cos(h) * from, h, 3.5);
        const v = d0 > 30 ? 3.5 : Math.max(3.5, d0 / (DEEP.warnS - 1));
        sim?.riseUnder(e.at[0], e.at[1], { speed: v, from, near: 4, breach: e.act === 'breach', heading: h });
        sim?.hunt(true); T?.raceCue?.(1);
        R.coach?.note(e.act === 'surge' ? 'Tessie is coiling to slap the water! Steer clear of her.' : 'Tessie is coming up beside you! Steer clear of her.', 5, 'tessieWarn', true);
      } else if (e.type === 'warn') {
        // the warning (DEEP.warnS real s): she swims shallow up the target's course to the spot (her dark shape and wake under the
        // water), hunting (no shying), and breaches there (her neck and head out, the splash and wave); the drone under it
        const tb = boats.find((b) => b.id === e.target);
        sim?.riseUnder(e.at[0], e.at[1], { speed: 3.5, from: 3.5 * DEEP.warnS, near: 4, breach: true, heading: tb?.heading ?? q.heading });
        sim?.hunt(true); T?.raceCue?.(e.target === 'me' ? 1 : 0.6);
        if (e.target === 'me') R.coach?.note('Tessie is coming for you! Tack or bear away.', 5, 'tessieWarn', true);
        else R.coach?.moment(`Tessie is after ${NAMES[e.target] ?? 'a rival'}!`, 4, 'tessieHunt');
      } else if (e.type === 'strike' && e.act === 'surge') {
        // her tail slaps: the slap's splash and the rings on the water where she lies (the wave's front: v2/sim/tessieSurge.js)
        if (st) { sim?.play('flick', st.t); sim?.play('arc', st.t); } sim?.emit?.('slap', 'tail', 1.6); sim?.ring?.(e.at[0], e.at[1], 1); T?.raceCue?.(0.8);
      } else if (e.type === 'strike' && e.act === 'breach') { sim?.ring?.(e.at[0], e.at[1], 1); T?.raceCue?.(0.8); }   // her fall's splash and its ring
      else if (e.type === 'heel') { const heel = e.side * e.heelDeg * Math.PI / 180; if (e.id === 'me') B.wave?.({ heel }); else R.S.wave?.(e.id, heel); stats.heels = [...(stats.heels ?? []), { id: e.id, n: e.n, heelDeg: +e.heelDeg.toFixed(1), side: e.side, d: +e.d.toFixed(1), at: +r.clock.toFixed(1) }]; }   // the wave heels each boat it reaches away from her (sim/waveRoll.js: yours on the page's boat, a rival's in the session)
      else if (e.type === 'strike') { if (st) sim?.play('arc', st.t + 2.6); T?.raceCue?.(0.8); }   // after the breach her neck stays up while the ring is live
      else if (e.type === 'turn') sim?.swimTo(e.x, e.z, 2);   // slower than a boat sailing away: a turn still escapes
      else if (e.type === 'catch') { if (e.id === 'me') knockMe('tessie'); else { const k = R.S.knock(e.id, 'tessie'); if (k) R.coach?.moment(`Tessie rolled ${NAMES[e.id] ?? 'a rival'}!`, 4, 'tessieRival'); } }
      else if (e.type === 'dive') { sim?.hunt(false); sim?.swimTo(null); if (st) sim?.play('dive', st.t + 0.3); T?.raceCue?.(0); }
      if (e.type === 'warn' || e.type === 'catch') stats.attacks.push({ type: e.type, n: e.n, id: e.target ?? e.id, at: +r.clock.toFixed(1), ...(e.act ? { act: e.act } : {}) });
      stats.deep = { phase: R.deep.state.phase, n: R.deep.state.n, target: R.deep.state.target, at: R.deep.state.at ? R.deep.state.at.map((x) => +x.toFixed(1)) : null, t: +r.clock.toFixed(1), events: [...(stats.deep?.events ?? []), e.type].slice(-12) };
    }
    const ring = R.deep.ring;
    R.S.hazard = ring ? { at: ring.at, rOut: ring.rOut } : null;
    // ?autoplay's sailor (the tests' and the films' scripted sailor) dodges her as a skilled rival does: a tack or a bear-away round her ring
    if (R.auto && 'hazardAdv' in R.auto) R.auto.hazardAdv = ring && v.status === 'racing' ? avoidAdvice(q, ring.at, ring.rOut, { skill: 1, windFrom: q.trueWind ? q.heading + q.trueWind.angle : null }) : null;
  }
  // phase 2 on each step: the storm at the gun and the rivals it knocks down; the glass boat's catch
  function phase2Step(r, v) {
    if (hooked('storm') && r.clock >= 0 && R.stormOn == null && R.result == null) {
      const plan = stormPlan(R.course); let shown = false;
      try { shown = !!onStorm(plan); } catch { shown = false; }
      R.stormOn = { at: +r.clock.toFixed(1), shown, plan }; stats.storm = { at: R.stormOn.at, shown, rate: plan.rate, ref: plan.ref };
      R.coach?.moment(shown ? 'The squall is building over the ridge. Reef early.' : 'The wind is building. Reef early.', 5, 'stormStart');
    }
    if (R.stormOn && v.status !== 'finished') for (const b of R.S.rivals) {
      if (stormKnocked.has(b.id) || r.view(b.id).status !== 'racing') continue;
      const q = b.phys.state, w = R.baseWind(q.x, q.z, B.t), ms = Math.hypot(w.vx, w.vz);
      if (rivalKnockDue({ id: b.id, windMs: ms, seed: R.hand?.raceSeed ?? seed })) {
        stormKnocked.add(b.id); const k = R.S.knock(b.id, 'storm');
        if (k) { stats.stormKnocks.push({ id: b.id, kind: k.kind, at: +r.clock.toFixed(1), ms: +ms.toFixed(1) }); R.coach?.moment(`${NAMES[b.id] ?? 'A rival'} is knocked down in the squall!`, 4, 'stormRival'); }
      }
    }
    if (R.glass?.boat) { const t = B.t; washTrail.step(R.glass.boat, R.washT == null ? 0 : t - R.washT); R.washT = t; }   // her wash's record on the boat's sim clock
    if (R.chase && R.glass?.boat && R.course.finish && v.status === 'racing') {
      if (R.chase.step({ me: B.phys.state, glass: R.glass.boat, finish: R.course.finish.centre, clock: r.clock }) === 'caught') {
        stats.chase = { caughtAt: +r.clock.toFixed(1) }; R.coach?.moment('You passed Velia Travel!', 4, 'glassCaught');
      }
    }
  }
  // the page's knockdown watch (main.js B.onKnockdown) asks first: true when a place race takes it (the 12 s hold, or the same roll
  // again); false lets the page's own game end run (a DNF in the race's card: a second knock, or not a place race)
  function placeKnock() { if (!R.on || R.hubOpen || !R.S?.place) return false; const k = knockMe('knockdown'); return k === 'hold' || k === 'same'; }
  Object.assign(R, { stopDeep, phase2Fresh, endHold, placeStep, placeKnock });
}
