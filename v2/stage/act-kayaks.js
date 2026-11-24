// The kayak pair as an act (v2/stage/acts.js 'kayaks'): a thin adapter over the kayaks' plug-in (v2/living/kayaks.js) and its
// fleet (v2/sim/kayaks.js). The opening's pair is the plug-in's own first pair, laid in the camera's view when play starts, as
// before (owner, 2026-11-17: "no change to the kayaks at the opening"); a random act lays a new pair the same way (first.js
// placePair: in the view, 22–38 m off the boat, paddling out from her line). The paddlers move as before.
//   start(ctx) ctx { kayaks (the plug-in), boat() → { x, z } | null, opening (bool), durationS: [min, max], rand (0–1) }
// On stage until the pair's beat is over: at least BEAT.minS after the lay and no kayaker within BEAT.nearM of the boat, or the
// act's longest time. The opening's pair not laid within BEAT.layWaitS (the player still on the home card): off stage at
// once ('deferred'; the plug-in lays it when play starts and the director's busy rule waits while it is near).
import { makeHandle } from './handle.js';

export const BEAT = Object.freeze({ minS: 15, nearM: 45, layWaitS: 10 });

const nearBoat = (K, b, m) => !!b && !!K.fleet && K.fleet.marks().some((k) => Math.hypot(k.x - b.x, k.z - b.z) < m);

export function start(ctx) {
  const K = ctx.kayaks;
  if (!K) return null;
  let laidAt = null, t = 0;
  const maxS = ctx.durationS?.[1] ?? 60;
  if (!ctx.opening) {   // a new pair in the view now, or nothing (no fleet yet, the card up, no water in the view)
    if (!K.again?.()) return null;
    laidAt = 0;
  }
  return makeHandle({
    step(dt, h) {
      t += dt;
      if (laidAt == null) {
        if (K.fleet?.laid) laidAt = t;
        else if (t > BEAT.layWaitS) { h.finish('deferred'); return; }
        else return;
      }
      const on = t - laidAt;
      if ((on >= BEAT.minS && !nearBoat(K, ctx.boat?.(), BEAT.nearM)) || on >= maxS) h.finish('played');
    },
  });
}
