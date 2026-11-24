// Tessie's sighting as an act (v2/stage/acts.js 'tessie'): a thin adapter over her plug-in (v2/living/tessie.js) and her sim
// (v2/sim/tessie.js). start cues a sighting; the sim places it at its next step (in the camera's view, off the boat's track; in
// her water when the boat is near it, where the sim knows her area) and she swims as before.
//   start(ctx) ctx { tessie (the plug-in) }
// On stage until she has dived and gone, and while her revenge runs (TK: the charge, the chase, the escape or the strike: the
// director holds every other act; her cooldown counts from its end); not placed within PLACE_S (no spot in the view, her model still loading): off stage,
// 'skipped'. stop(): the cue cancelled, or she dives now.
// M3 (owner 2026-11-18): the kind is the stage's (v2/stage/tessieMoments.js through the plug-in's
// moment()): the scripted sighting, the sunset breach, the lightning neck (it waits up to NECK.waitS for a strike to stage her
// on), alongside or under the hull. "Cheat on when and where, never on motion."
import { makeHandle } from './handle.js';
import { NECK } from './tessieMoments.js';

export const PLACE_S = 25;

export function start(ctx) {
  const T = ctx.tessie, sim = T?.sim;
  if (!sim) return null;
  const n0 = sim.sightings.length, r0 = T.revenge?.state.count ?? 0;
  let t = 0;
  const kind = T.moment ? T.moment() : 'sighting';
  if (T.begin) T.begin(kind); else sim.cue();
  const waitS = kind === 'neck' ? NECK.waitS + PLACE_S : PLACE_S;
  return makeHandle({
    step(dt, h) {
      t += dt;
      const begun = sim.sightings.length > n0;
      if (begun && !sim.state.visible && !T.revenge?.active) h.finish((T.revenge?.state.count ?? 0) > r0 ? `revenge: ${T.revenge.state.result}` : 'played');
      else if (!begun && t > waitS) { sim.cancel(); T.cancelMoment?.(); h.finish('skipped'); }
    },
    stop() {
      sim.cancel(); T.cancelMoment?.(); T.revenge?.cancel?.('stage');
      if (sim.state.visible) sim.play('dive', sim.state.t + 0.5);
    },
  });
}
