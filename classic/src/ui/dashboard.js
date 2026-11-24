// The helm dashboard's small behaviours (owner, 2026-10-30): the rest dimming. (The phone's flip dots between the two
// circles are gone,: a phone in Sail shows the wind dial, and the chart is the CHART key's.)
//
//   const dash = createDashboard();   // shell.js; the 'dashboard' service
//   dash.dispose();
// DimClock is pure (tests/dashboard.test.mjs): after IDLE_S seconds with no input the dashboard dims (the button row's words fade, the
// circles go to 82 %), but never in the first MIN_SESSION_S seconds of a session; any input, or a hint on screen, brings it back at once.
import { ensureTokens } from '../../../src/ui/tokens.js';

export const DIM = { idleS: 8, minSessionS: 60 };
export class DimClock {
  constructor({ idleS = DIM.idleS, minSessionS = DIM.minSessionS } = {}) { this.idleS = idleS; this.minSessionS = minSessionS; this.t = 0; this.last = 0; }
  touch() { this.last = this.t; }
  tick(dt, { busy = false } = {}) { this.t += dt; if (busy) this.last = this.t; return this.dim; }
  get dim() { return this.t >= this.minSessionS && this.t - this.last >= this.idleS; }
}

export function createDashboard({ root = document.body, doc = document } = {}) {
  ensureTokens();
  const H = doc.documentElement;
  const clock = new DimClock();
  const touch = () => { clock.touch(); H.classList.remove('lk-dim'); };
  const evs = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'];
  for (const e of evs) addEventListener(e, touch, { passive: true, capture: true });
  const timer = setInterval(() => {
    const busy = !!doc.querySelector('.lk-hint .row.in');
    H.classList.toggle('lk-dim', clock.tick(0.5, { busy }));
  }, 500);
  return { clock, dispose() { clearInterval(timer); for (const e of evs) removeEventListener(e, touch, { capture: true }); H.classList.remove('lk-dim'); } };
}
