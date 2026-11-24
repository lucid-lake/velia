// The osprey's dive as an act (v2/stage/acts.js 'ospreyDive'): a thin adapter over the birds' sim (v2/sim/birds.js tryDive:
// the gates, then the dive laid 25–40° off the bow in the camera's view). The bird flies v1's hunt as before.
//   start(ctx) ctx { birds (the page's birds: .sim), beat() → { view, race } }
// It asks each frame (after no spot, every DIVE.retryS) until the dive is laid; not laid within ASK_S (night, the storm's
// shelter, the hunter busy, the boat turning, no water in the view): off stage, 'skipped'. On stage until the hunter carries
// its fish or is let go.
import { makeHandle } from './handle.js';
import { DIVE } from '../sim/birds.js';

const ASK_S = 25;

export function start(ctx) {
  const sim = ctx.birds?.sim;
  if (!sim?.tryDive) return null;
  let t = 0, retryAt = 0, laid = false;
  return makeHandle({
    step(dt, h) {
      t += dt;
      if (laid) { if (!sim.diveBusy) h.finish('played'); return; }
      if (t > ASK_S) { h.finish('skipped'); return; }
      if (t < retryAt) return;
      const r = sim.tryDive(ctx.beat?.() ?? {}, dt);
      if (r.ok) laid = true;
      else if (r.why === 'noSpot') retryAt = t + DIVE.retryS;
    },
  });
}
